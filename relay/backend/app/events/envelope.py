"""Event envelope, event types and topic names (CONTRACT section 5)."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.clock import utcnow
from app.models.common import UTCDateTime

MAIN_TOPIC = "relay.request.events"
RETRY_TOPIC = "relay.request.events.retry"
DLQ_TOPIC = "relay.request.events.dlq"
ALL_TOPICS = (MAIN_TOPIC, RETRY_TOPIC, DLQ_TOPIC)

GROUP_WORKFLOW = "relay-workflow-engine"
GROUP_AUDIT = "relay-audit-logger"
GROUP_RETRY = "relay-retry-worker"


class EventType(StrEnum):
    # Commands / inputs
    REQUEST_SUBMITTED = "REQUEST_SUBMITTED"
    APPROVAL_DECISION = "APPROVAL_DECISION"
    REQUEST_CANCEL_REQUESTED = "REQUEST_CANCEL_REQUESTED"
    SLA_BREACHED = "SLA_BREACHED"
    # Outcomes
    REQUEST_ROUTED = "REQUEST_ROUTED"
    STEP_ACTIVATED = "STEP_ACTIVATED"
    STEP_APPROVED = "STEP_APPROVED"
    STEP_REJECTED = "STEP_REJECTED"
    REQUEST_ESCALATED = "REQUEST_ESCALATED"
    REQUEST_APPROVED = "REQUEST_APPROVED"
    REQUEST_REJECTED = "REQUEST_REJECTED"
    REQUEST_CANCELLED = "REQUEST_CANCELLED"
    # Ops
    EVENT_DEAD_LETTERED = "EVENT_DEAD_LETTERED"
    EVENT_REPLAYED = "EVENT_REPLAYED"


class Source(StrEnum):
    API = "api"
    WORKFLOW_ENGINE = "workflow-engine"
    SLA_MONITOR = "sla-monitor"
    AUDIT_LOGGER = "audit-logger"
    RETRY_WORKER = "retry-worker"


SYSTEM_ACTOR = {"actor_id": "system", "actor_name": "System", "actor_role": "SYSTEM"}


class EventEnvelope(BaseModel):
    model_config = ConfigDict(extra="ignore")

    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str
    request_id: str | None = None
    actor_id: str = "system"
    actor_name: str | None = "System"
    actor_role: str | None = "SYSTEM"
    occurred_at: UTCDateTime = Field(default_factory=utcnow)
    payload: dict[str, Any] = Field(default_factory=dict)
    attempt: int = 0
    correlation_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    source: str = Source.API.value
    # Reliability metadata (additive to the contract envelope)
    retry_at: UTCDateTime | None = None
    last_error: str | None = None
    target_group: str | None = None

    def to_bytes(self) -> bytes:
        return self.model_dump_json().encode("utf-8")

    @classmethod
    def from_bytes(cls, raw: bytes | str) -> "EventEnvelope":
        return cls.model_validate_json(raw)

    @property
    def key(self) -> bytes | None:
        return self.request_id.encode("utf-8") if self.request_id else None


def new_event(
    event_type: EventType | str,
    request_id: str | None,
    *,
    source: Source | str,
    payload: dict[str, Any] | None = None,
    actor: dict[str, Any] | None = None,
    correlation_id: str | None = None,
    occurred_at: datetime | None = None,
) -> EventEnvelope:
    actor = actor or SYSTEM_ACTOR
    data: dict[str, Any] = {
        "event_type": str(event_type),
        "request_id": request_id,
        "actor_id": actor.get("actor_id", "system"),
        "actor_name": actor.get("actor_name"),
        "actor_role": actor.get("actor_role"),
        "payload": payload or {},
        "source": str(source),
    }
    if correlation_id:
        data["correlation_id"] = correlation_id
    if occurred_at:
        data["occurred_at"] = occurred_at
    return EventEnvelope(**data)


def actor_from_user(user) -> dict[str, Any]:
    return {"actor_id": user.id, "actor_name": user.name, "actor_role": str(user.role)}
