from typing import Any

from pydantic import BaseModel, Field

from app.models.common import UTCDateTime


class AuditEntry(BaseModel):
    id: str
    event_id: str
    event_type: str
    request_id: str | None = None
    actor_id: str | None = None
    actor_name: str | None = None
    actor_role: str | None = None
    source: str | None = None
    occurred_at: UTCDateTime
    recorded_at: UTCDateTime
    payload: dict[str, Any] = Field(default_factory=dict)
    request_title: str | None = None
    correlation_id: str | None = None
    attempt: int = 0

    @classmethod
    def from_db(cls, doc: dict[str, Any]) -> "AuditEntry":
        return cls.model_validate({**doc, "id": str(doc["_id"])})


class AuditList(BaseModel):
    items: list[AuditEntry]
    total: int


class DeadLetter(BaseModel):
    id: str
    event: dict[str, Any]
    error: str
    group: str
    failed_at: UTCDateTime
    attempts: int
    status: str
    request_id: str | None = None
    event_type: str | None = None
    replayed_at: UTCDateTime | None = None
    replayed_by: str | None = None
    replay_event_id: str | None = None
    discarded_at: UTCDateTime | None = None
    discarded_by: str | None = None

    @classmethod
    def from_db(cls, doc: dict[str, Any]) -> "DeadLetter":
        return cls.model_validate({**doc, "id": str(doc["_id"])})


class Stats(BaseModel):
    by_status: dict[str, int]
    my_open: int
    inbox: int
    breached: int
    dlq_pending: int
    approved_last_7d: int
    avg_cycle_hours: float | None
