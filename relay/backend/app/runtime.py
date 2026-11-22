"""Process runtime shared by the FastAPI lifespan and the standalone worker entry point.

Owns the infrastructure clients, the event bus, the publisher/outbox relay, the consumer groups
and the SLA monitor.
"""

import asyncio
import logging

from app.core import db as mongo
from app.core import redis as redis_core
from app.core.config import settings
from app.events.bus import EventBus
from app.events.envelope import GROUP_AUDIT, GROUP_RETRY, GROUP_WORKFLOW, MAIN_TOPIC, RETRY_TOPIC
from app.events.kafka_bus import KafkaEventBus
from app.events.memory_bus import InMemoryEventBus
from app.events.publisher import EventPublisher, OutboxRelay
from app.services.seed import seed_all
from app.workers.audit_consumer import build_audit_consumer
from app.workers.retry_worker import build_retry_consumer
from app.workers.sla_monitor import SlaMonitor
from app.workers.workflow_consumer import build_workflow_consumer

log = logging.getLogger("relay.runtime")


def configure_logging() -> None:
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    logging.getLogger("relay").setLevel(logging.INFO)
    logging.getLogger("aiokafka").setLevel(logging.WARNING)


class Runtime:
    def __init__(self, *, run_workers: bool | None = None, bus: EventBus | None = None) -> None:
        self.run_workers = settings.RUN_WORKERS if run_workers is None else run_workers
        self.bus: EventBus = bus or (InMemoryEventBus() if settings.EVENT_BUS == "memory" else KafkaEventBus())
        self.publisher = EventPublisher(self.bus)
        self.outbox = OutboxRelay(self.bus)
        self.sla_monitor = SlaMonitor(self.publisher)
        self._bootstrap_task: asyncio.Task | None = None
        self.bootstrapped = asyncio.Event()

    async def start(self) -> None:
        await mongo.connect_to_mongo()
        await redis_core.connect_to_redis()

        try:
            await self._bootstrap()
        except Exception as exc:  # noqa: BLE001 - keep serving; retry in background
            log.error("Database bootstrap failed (%s); retrying in background", exc)
            self._bootstrap_task = asyncio.create_task(self._bootstrap_retry_loop(), name="db-bootstrap")

        if self.run_workers:
            self.bus.subscribe(MAIN_TOPIC, GROUP_WORKFLOW, build_workflow_consumer(self.publisher))
            self.bus.subscribe(MAIN_TOPIC, GROUP_AUDIT, build_audit_consumer(self.publisher))
            self.bus.subscribe(RETRY_TOPIC, GROUP_RETRY, build_retry_consumer(self.publisher))
        await self.bus.start()
        self.outbox.start()
        if self.run_workers:
            self.sla_monitor.start()
        log.info("Runtime started: event_bus=%s run_workers=%s", self.bus.name, self.run_workers)

    async def _bootstrap(self) -> None:
        await mongo.ensure_indexes()
        await seed_all(settings.SEED_DEMO_DATA)
        self.bootstrapped.set()

    async def _bootstrap_retry_loop(self) -> None:
        delay = 2.0
        while not self.bootstrapped.is_set():
            await asyncio.sleep(delay)
            try:
                await self._bootstrap()
                log.info("Database bootstrap succeeded")
            except Exception as exc:  # noqa: BLE001
                log.warning("Database bootstrap still failing: %s", exc)
                delay = min(delay * 2, 30)

    async def stop(self) -> None:
        if self._bootstrap_task:
            self._bootstrap_task.cancel()
        if self.run_workers:
            await self.sla_monitor.stop()
        await self.outbox.stop()
        await self.bus.stop()
        await redis_core.close_redis()
        await mongo.close_mongo_connection()
        log.info("Runtime stopped")


_current: Runtime | None = None


def set_runtime(rt: Runtime | None) -> None:
    global _current
    _current = rt


def get_runtime() -> Runtime:
    if _current is None:
        raise RuntimeError("Runtime not started")
    return _current


def get_publisher() -> EventPublisher:
    return get_runtime().publisher
