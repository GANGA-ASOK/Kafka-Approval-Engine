"""Event publisher with a transactional-outbox style fallback.

If the bus is unavailable (Kafka down), the event is stored in the Mongo `outbox` collection and
re-published by `OutboxRelay` once the bus is back. Consumers are idempotent on `event_id`, so a
rare double publish (timeout after the broker actually stored the message) is harmless.
"""

import asyncio
import logging
from datetime import timedelta

from pymongo import ReturnDocument

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_database
from app.events.bus import EventBus, EventBusUnavailable
from app.events.envelope import EventEnvelope

log = logging.getLogger("relay.events.publisher")


class EventPublisher:
    def __init__(self, bus: EventBus) -> None:
        self.bus = bus

    async def publish(self, topic: str, event: EventEnvelope) -> None:
        try:
            await self.bus.publish(topic, event)
        except EventBusUnavailable as exc:
            log.warning("Bus unavailable (%s); buffering event %s (%s) in outbox", exc, event.event_id, event.event_type)
            await get_database().outbox.update_one(
                {"_id": f"{topic}:{event.event_id}:{event.attempt}"},
                {
                    "$setOnInsert": {
                        "topic": topic,
                        "event": event.model_dump(mode="json"),
                        "created_at": utcnow(),
                        "lease_until": None,
                    },
                    "$set": {"last_error": str(exc)},
                },
                upsert=True,
            )


class OutboxRelay:
    """Drains the outbox whenever the bus is connected. A per-document lease avoids two
    processes (API + standalone workers) publishing the same entry concurrently."""

    def __init__(self, bus: EventBus) -> None:
        self.bus = bus
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="outbox-relay")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def _run(self) -> None:
        while True:
            try:
                if self.bus.connected:
                    await self.flush()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("Outbox relay iteration failed")
            await asyncio.sleep(settings.OUTBOX_RELAY_INTERVAL_SECONDS)

    async def flush(self, limit: int = 200) -> int:
        db = get_database()
        sent = 0
        for _ in range(limit):
            now = utcnow()
            doc = await db.outbox.find_one_and_update(
                {"$or": [{"lease_until": None}, {"lease_until": {"$lt": now}}]},
                {"$set": {"lease_until": now + timedelta(seconds=30)}},
                sort=[("created_at", 1)],
                return_document=ReturnDocument.AFTER,
            )
            if doc is None:
                break
            try:
                await self.bus.publish(doc["topic"], EventEnvelope.model_validate(doc["event"]))
            except EventBusUnavailable:
                await db.outbox.update_one({"_id": doc["_id"]}, {"$set": {"lease_until": None}})
                break
            await db.outbox.delete_one({"_id": doc["_id"]})
            sent += 1
        if sent:
            log.info("Outbox relay re-published %d event(s)", sent)
        return sent
