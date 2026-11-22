"""Consumer group `relay-audit-logger`: writes EVERY event on the main topic to `audit_logs`."""

import logging
from collections import OrderedDict

from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import get_database
from app.events.envelope import GROUP_AUDIT, EventEnvelope
from app.events.publisher import EventPublisher
from app.workers.consumer import IdempotentConsumer

log = logging.getLogger("relay.workers.audit")


class AuditLogger:
    def __init__(self, cache_size: int = 1024) -> None:
        self._cache: OrderedDict[str, tuple[str | None, str | None]] = OrderedDict()
        self._cache_size = cache_size

    async def _request_info(self, request_id: str | None) -> tuple[str | None, str | None]:
        if not request_id:
            return None, None
        if request_id in self._cache:
            self._cache.move_to_end(request_id)
            return self._cache[request_id]
        doc = await get_database().requests.find_one({"_id": request_id}, {"title": 1, "requester_id": 1})
        info = (doc.get("title"), doc.get("requester_id")) if doc else (None, None)
        if doc:
            self._cache[request_id] = info
            if len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)
        return info

    async def handle(self, event: EventEnvelope) -> None:
        title, requester_id = await self._request_info(event.request_id)
        occurred = event.occurred_at
        doc = {
            "_id": f"AUD-{event.event_id}",
            "event_id": event.event_id,
            "event_type": event.event_type,
            "request_id": event.request_id,
            "request_title": title or event.payload.get("title"),
            "requester_id": requester_id,
            "actor_id": event.actor_id,
            "actor_name": event.actor_name,
            "actor_role": event.actor_role,
            "source": event.source,
            "occurred_at": occurred,
            # microsecond sort key: Mongo datetimes only keep milliseconds
            "occurred_ts": int(occurred.timestamp() * 1_000_000),
            "recorded_at": utcnow(),
            "payload": event.payload,
            "correlation_id": event.correlation_id,
            "attempt": event.attempt,
        }
        try:
            await get_database().audit_logs.insert_one(doc)
        except DuplicateKeyError:
            log.debug("audit entry for %s already exists", event.event_id)


def build_audit_consumer(publisher: EventPublisher) -> IdempotentConsumer:
    return IdempotentConsumer(GROUP_AUDIT, AuditLogger().handle, publisher)
