"""Consumer group `relay-retry-worker` on `relay.request.events.retry`.

Waits until the event's `retry_at` (exponential backoff computed by the failing consumer) and then
re-publishes it to the main topic, where only the `target_group` consumer will act on it.
Idempotency key includes the attempt number because the same event_id passes through the retry
topic once per attempt.
"""

import asyncio
import logging

from app.core.clock import utcnow
from app.events.envelope import GROUP_RETRY, MAIN_TOPIC, EventEnvelope
from app.events.publisher import EventPublisher
from app.workers.consumer import IdempotentConsumer

log = logging.getLogger("relay.workers.retry")

# Never block a partition for longer than this, whatever retry_at says.
MAX_SLEEP_SECONDS = 60.0


class RetryWorker:
    def __init__(self, publisher: EventPublisher) -> None:
        self.publisher = publisher

    async def handle(self, event: EventEnvelope) -> None:
        if event.retry_at is not None:
            wait = (event.retry_at - utcnow()).total_seconds()
            if wait > 0:
                await asyncio.sleep(min(wait, MAX_SLEEP_SECONDS))
        log.info("Re-publishing %s (%s) attempt %d for %s", event.event_id, event.event_type, event.attempt,
                 event.target_group)
        await self.publisher.publish(MAIN_TOPIC, event)


def build_retry_consumer(publisher: EventPublisher) -> IdempotentConsumer:
    return IdempotentConsumer(
        GROUP_RETRY,
        RetryWorker(publisher).handle,
        publisher,
        key_fn=lambda e: f"{e.event_id}:{e.attempt}",
        retry_failures=False,  # a failing re-publish is redelivered by the bus, never re-retried
        respect_target_group=False,
    )
