"""Idempotent consumer wrapper with retry / DLQ hand-off (CONTRACT section 5, reliability rules).

    delivery -> already processed by this group?  -> skip (ack)
             -> handler ok                        -> mark processed (ack)
             -> handler raised, attempt < MAX     -> publish to .retry (attempt+1, retry_at, last_error) (ack)
             -> handler raised, attempt >= MAX    -> publish to .dlq + `dead_letters` doc + EVENT_DEAD_LETTERED (ack)

If the hand-off itself fails (e.g. Mongo down) the exception propagates, the bus does not commit
and the message is redelivered.
"""

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta

from app.core.clock import utcnow
from app.core.config import settings
from app.core.db import get_database
from app.events.envelope import DLQ_TOPIC, MAIN_TOPIC, RETRY_TOPIC, EventEnvelope, EventType, new_event
from app.events.publisher import EventPublisher
from app.services.idempotency import ProcessedEventStore

log = logging.getLogger("relay.workers.consumer")

EventHandler = Callable[[EventEnvelope], Awaitable[None]]


def dead_letter_id(group: str, event_id: str) -> str:
    return "DL-" + uuid.uuid5(uuid.NAMESPACE_URL, f"{group}:{event_id}").hex[:12].upper()


def group_source(group: str) -> str:
    return group.removeprefix("relay-")


class IdempotentConsumer:
    def __init__(
        self,
        group: str,
        handler: EventHandler,
        publisher: EventPublisher,
        *,
        store: ProcessedEventStore | None = None,
        key_fn: Callable[[EventEnvelope], str] | None = None,
        retry_failures: bool = True,
        respect_target_group: bool = True,
    ) -> None:
        self.group = group
        self.handler = handler
        self.publisher = publisher
        self.store = store or ProcessedEventStore()
        self.key_fn = key_fn or (lambda e: e.event_id)
        self.retry_failures = retry_failures
        self.respect_target_group = respect_target_group

    async def __call__(self, event: EventEnvelope) -> None:
        if self.respect_target_group and event.target_group and event.target_group != self.group:
            return  # a retry meant for another consumer group
        key = self.key_fn(event)
        if await self.store.is_processed(self.group, key):
            log.info("[%s] duplicate event %s (%s) skipped", self.group, key, event.event_type)
            return
        try:
            await self.handler(event)
        except Exception as exc:  # noqa: BLE001
            if not self.retry_failures:
                raise
            await self._hand_off(event, exc, key)
            return
        await self.store.mark_processed(self.group, key, event_type=event.event_type)

    async def _hand_off(self, event: EventEnvelope, exc: Exception, key: str) -> None:
        error = f"{type(exc).__name__}: {exc}"
        if event.attempt >= settings.MAX_EVENT_RETRIES:
            await self._dead_letter(event, error, key)
            return
        delay = settings.RETRY_BACKOFF_SECONDS * (2**event.attempt)
        retry = event.model_copy(
            update={
                "attempt": event.attempt + 1,
                "retry_at": utcnow() + timedelta(seconds=delay),
                "last_error": error,
                "target_group": self.group,
            }
        )
        log.warning(
            "[%s] event %s (%s) failed on attempt %d: %s -> retry #%d in %.1fs",
            self.group, event.event_id, event.event_type, event.attempt, error, retry.attempt, delay,
        )
        await self.publisher.publish(RETRY_TOPIC, retry)

    async def _dead_letter(self, event: EventEnvelope, error: str, key: str) -> None:
        dl_id = dead_letter_id(self.group, event.event_id)
        now = utcnow()
        failed = event.model_copy(update={"last_error": error})
        await get_database().dead_letters.update_one(
            {"_id": dl_id},
            {
                "$setOnInsert": {
                    "event": failed.model_dump(mode="json"),
                    "error": error,
                    "group": self.group,
                    "failed_at": now,
                    "attempts": event.attempt + 1,
                    "status": "PENDING",
                    "request_id": event.request_id,
                    "event_type": event.event_type,
                }
            },
            upsert=True,
        )
        log.error("[%s] event %s (%s) exhausted retries -> DLQ %s: %s",
                  self.group, event.event_id, event.event_type, dl_id, error)
        await self.publisher.publish(DLQ_TOPIC, failed)
        await self.publisher.publish(
            MAIN_TOPIC,
            new_event(
                EventType.EVENT_DEAD_LETTERED,
                event.request_id,
                source=group_source(self.group),
                correlation_id=event.correlation_id,
                payload={
                    "dead_letter_id": dl_id,
                    "original_event_id": event.event_id,
                    "original_event_type": event.event_type,
                    "group": self.group,
                    "attempts": event.attempt + 1,
                    "error": error,
                },
            ),
        )
        await self.store.mark_processed(self.group, key, event_type=event.event_type, status="DEAD_LETTERED")
