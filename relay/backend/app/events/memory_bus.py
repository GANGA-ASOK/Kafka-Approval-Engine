"""In-process asyncio event bus with the same delivery semantics as the Kafka bus.

Used by the test-suite and for Kafka-less local development (`EVENT_BUS=memory`). Events are
serialised to JSON on publish (like Kafka) so handlers never share mutable objects.
"""

import asyncio
import logging

from app.events.bus import EventBus, Subscription
from app.events.envelope import EventEnvelope

log = logging.getLogger("relay.events.memory")


class _Consumer:
    def __init__(self, sub: Subscription) -> None:
        self.sub = sub
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.busy = False
        self.task: asyncio.Task | None = None


class InMemoryEventBus(EventBus):
    name = "memory"

    def __init__(self, redelivery_delay: float = 0.05) -> None:
        super().__init__()
        self._consumers: list[_Consumer] = []
        self._started = False
        self._redelivery_delay = redelivery_delay
        self.published: list[tuple[str, EventEnvelope]] = []  # inspection aid for tests

    async def start(self) -> None:
        if self._started:
            return
        self._consumers = [_Consumer(s) for s in self._subscriptions]
        for c in self._consumers:
            c.task = asyncio.create_task(self._run(c), name=f"memory-consumer:{c.sub.group_id}:{c.sub.topic}")
        self._started = True
        log.info("In-memory event bus started with %d consumer(s)", len(self._consumers))

    async def stop(self) -> None:
        for c in self._consumers:
            if c.task:
                c.task.cancel()
        for c in self._consumers:
            if c.task:
                try:
                    await c.task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass
        self._consumers = []
        self._started = False

    async def publish(self, topic: str, event: EventEnvelope) -> None:
        raw = event.model_dump_json()
        self.published.append((topic, EventEnvelope.model_validate_json(raw)))
        for c in self._consumers:
            if c.sub.topic == topic:
                c.queue.put_nowait(raw)

    async def health(self) -> str:
        return "disabled"

    @property
    def connected(self) -> bool:
        return True

    async def _run(self, c: _Consumer) -> None:
        while True:
            raw = await c.queue.get()
            c.busy = True
            try:
                await c.sub.handler(EventEnvelope.model_validate_json(raw))
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 - not acked -> redeliver
                log.exception("Handler for group %s failed; redelivering", c.sub.group_id)
                await asyncio.sleep(self._redelivery_delay)
                c.queue.put_nowait(raw)
            finally:
                c.busy = False
                c.queue.task_done()

    async def drain(self, timeout: float = 10.0, settle_rounds: int = 3) -> None:
        """Wait until every queue is empty and no handler is running (test helper)."""
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        stable = 0
        while stable < settle_rounds:
            idle = all(c.queue.empty() and not c.busy for c in self._consumers)
            stable = stable + 1 if idle else 0
            if loop.time() > deadline:
                raise TimeoutError("event bus did not drain in time")
            await asyncio.sleep(0.005)
