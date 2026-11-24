"""EventBus abstraction shared by the Kafka and in-memory implementations.

Semantics (both implementations):
- `publish(topic, event)` delivers the event to every consumer group subscribed to `topic`.
- A subscription = (topic, group_id, handler). Within a group events are handled sequentially.
- If the handler returns, the delivery is acknowledged (offset committed). If it raises, the
  delivery is NOT acknowledged and is redelivered after a short pause. Application-level failures
  are turned into retry/DLQ hand-offs by `app.workers.consumer.IdempotentConsumer`, so a raising
  handler means an infrastructure problem (e.g. Mongo down) and redelivery is the right thing.
"""

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.events.envelope import EventEnvelope

Handler = Callable[[EventEnvelope], Awaitable[None]]


class EventBusUnavailable(RuntimeError):
    """Raised when an event cannot be published right now (e.g. Kafka is unreachable)."""


@dataclass(frozen=True)
class Subscription:
    topic: str
    group_id: str
    handler: Handler


class EventBus(ABC):
    name: str = "abstract"

    def __init__(self) -> None:
        self._subscriptions: list[Subscription] = []

    def subscribe(self, topic: str, group_id: str, handler: Handler) -> None:
        """Register a consumer. Must be called before `start()`."""
        self._subscriptions.append(Subscription(topic, group_id, handler))

    @property
    def subscriptions(self) -> list[Subscription]:
        return list(self._subscriptions)

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    @abstractmethod
    async def publish(self, topic: str, event: EventEnvelope) -> None: ...

    @abstractmethod
    async def health(self) -> str:
        """Return "up", "down" or "disabled"."""

    @property
    @abstractmethod
    def connected(self) -> bool: ...
