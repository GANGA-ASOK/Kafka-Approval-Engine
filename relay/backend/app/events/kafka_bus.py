"""Kafka implementation of the EventBus (aiokafka).

- Producer: acks=all + idempotent producer, key = request_id (per-request ordering).
- Admin client: creates the three topics on startup (3 partitions, RF 1 by default).
- Consumers: one AIOKafkaConsumer per subscription, `enable_auto_commit=False`; the offset is
  committed only after the handler returns (successful handle or retry/DLQ hand-off).
- Resilience: if Kafka is unreachable the bus keeps retrying in the background with capped
  exponential backoff instead of failing the whole process; `health()` reports "down" meanwhile.
"""

import asyncio
import logging
import socket

from aiokafka import AIOKafkaConsumer, AIOKafkaProducer
from aiokafka.admin import AIOKafkaAdminClient, NewTopic
from aiokafka.structs import TopicPartition

from app.core.config import settings
from app.events.bus import EventBus, EventBusUnavailable, Subscription
from app.events.envelope import ALL_TOPICS, EventEnvelope

log = logging.getLogger("relay.events.kafka")

_CLIENT_ID = f"relay-{socket.gethostname()}"


class KafkaEventBus(EventBus):
    name = "kafka"

    def __init__(self, bootstrap_servers: str | None = None) -> None:
        super().__init__()
        self._bootstrap = bootstrap_servers or settings.KAFKA_BOOTSTRAP_SERVERS
        self._producer: AIOKafkaProducer | None = None
        self._admin: AIOKafkaAdminClient | None = None
        self._connected = asyncio.Event()
        self._stopping = False
        self._tasks: list[asyncio.Task] = []

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        """Non-blocking: connection (and consumer start-up) happens in the background."""
        self._stopping = False
        self._tasks.append(asyncio.create_task(self._connect_loop(), name="kafka-connect"))

    async def stop(self) -> None:
        self._stopping = True
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            try:
                await t
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        self._tasks = []
        for client in (self._producer, self._admin):
            if client is not None:
                try:
                    await (client.stop() if isinstance(client, AIOKafkaProducer) else client.close())
                except Exception:  # noqa: BLE001
                    log.debug("error closing kafka client", exc_info=True)
        self._producer = None
        self._admin = None
        self._connected.clear()

    async def wait_connected(self, timeout: float | None = None) -> bool:
        try:
            await asyncio.wait_for(self._connected.wait(), timeout)
            return True
        except TimeoutError:
            return False

    @property
    def connected(self) -> bool:
        return self._connected.is_set()

    async def _connect_loop(self) -> None:
        delay = 1.0
        while not self._stopping:
            try:
                await self._ensure_topics()
                producer = AIOKafkaProducer(
                    bootstrap_servers=self._bootstrap,
                    client_id=f"{_CLIENT_ID}-producer",
                    acks="all",
                    enable_idempotence=True,
                    linger_ms=5,
                    request_timeout_ms=15000,
                )
                await producer.start()
                self._producer = producer
                self._connected.set()
                log.info("Connected to Kafka at %s", self._bootstrap)
                break
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "Kafka unreachable at %s (%s: %s); retrying in %.0fs - API keeps serving, health shows kafka=down",
                    self._bootstrap, type(exc).__name__, exc, delay,
                )
                await self._close_admin()
                await asyncio.sleep(delay)
                delay = min(delay * 2, settings.KAFKA_CONNECT_RETRY_MAX_SECONDS)
        for sub in self._subscriptions:
            self._tasks.append(
                asyncio.create_task(self._consume_loop(sub), name=f"kafka-consumer:{sub.group_id}:{sub.topic}")
            )

    async def _close_admin(self) -> None:
        if self._admin is not None:
            try:
                await self._admin.close()
            except Exception:  # noqa: BLE001
                pass
            self._admin = None

    async def _ensure_topics(self) -> None:
        if self._admin is None:
            admin = AIOKafkaAdminClient(
                bootstrap_servers=self._bootstrap, client_id=f"{_CLIENT_ID}-admin", request_timeout_ms=10000
            )
            await admin.start()
            self._admin = admin
        existing = set(await self._admin.list_topics())
        missing = [t for t in ALL_TOPICS if t not in existing]
        if missing:
            await self._admin.create_topics(
                [
                    NewTopic(
                        name=t,
                        num_partitions=settings.KAFKA_TOPIC_PARTITIONS,
                        replication_factor=settings.KAFKA_REPLICATION_FACTOR,
                    )
                    for t in missing
                ]
            )
            log.info("Created Kafka topics: %s", ", ".join(missing))

    # ------------------------------------------------------------------ publish
    async def publish(self, topic: str, event: EventEnvelope) -> None:
        if not self.connected or self._producer is None:
            raise EventBusUnavailable("Kafka is not connected")
        try:
            await asyncio.wait_for(
                self._producer.send_and_wait(topic, value=event.to_bytes(), key=event.key),
                timeout=settings.KAFKA_PUBLISH_TIMEOUT_SECONDS,
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise EventBusUnavailable(f"Kafka publish failed: {type(exc).__name__}: {exc}") from exc

    # ------------------------------------------------------------------ health
    async def health(self) -> str:
        if not self.connected or self._admin is None:
            return "down"
        try:
            await asyncio.wait_for(self._admin.describe_cluster(), timeout=3)
            return "up"
        except Exception:  # noqa: BLE001
            return "down"

    # ------------------------------------------------------------------ consume
    async def _consume_loop(self, sub: Subscription) -> None:
        delay = 1.0
        while not self._stopping:
            consumer = AIOKafkaConsumer(
                sub.topic,
                bootstrap_servers=self._bootstrap,
                group_id=sub.group_id,
                client_id=f"{_CLIENT_ID}-{sub.group_id}",
                enable_auto_commit=False,
                auto_offset_reset="earliest",
                max_poll_records=50,
            )
            try:
                await consumer.start()
                log.info("Consumer group %s subscribed to %s", sub.group_id, sub.topic)
                delay = 1.0
                await self._poll(consumer, sub)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.warning("Consumer %s on %s failed (%s); restarting in %.0fs", sub.group_id, sub.topic, exc, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, settings.KAFKA_CONNECT_RETRY_MAX_SECONDS)
            finally:
                try:
                    await consumer.stop()
                except Exception:  # noqa: BLE001
                    pass

    async def _poll(self, consumer: AIOKafkaConsumer, sub: Subscription) -> None:
        while not self._stopping:
            batches = await consumer.getmany(timeout_ms=1000)
            for tp, messages in batches.items():
                for msg in messages:
                    if not await self._dispatch(consumer, sub, tp, msg):
                        break  # partition was rewound; remaining messages will be re-fetched

    async def _dispatch(self, consumer: AIOKafkaConsumer, sub: Subscription, tp: TopicPartition, msg) -> bool:
        try:
            event = EventEnvelope.from_bytes(msg.value)
        except Exception:  # noqa: BLE001 - poison message: log and skip
            log.error("Skipping undecodable message %s@%s offset %s", tp.topic, tp.partition, msg.offset)
            await consumer.commit({tp: msg.offset + 1})
            return True
        try:
            await sub.handler(event)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - infrastructure failure: do not commit, rewind and back off
            log.exception("Handler %s failed for event %s; will redeliver", sub.group_id, event.event_id)
            consumer.seek(tp, msg.offset)
            await asyncio.sleep(2)
            return False
        await consumer.commit({tp: msg.offset + 1})
        return True
