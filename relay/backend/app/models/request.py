from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.common import UTCDateTime


class RequestStatus(StrEnum):
    SUBMITTED = "SUBMITTED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    ESCALATED = "ESCALATED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"


ACTIVE_STATUSES = (RequestStatus.PENDING_APPROVAL, RequestStatus.ESCALATED)
OPEN_STATUSES = (RequestStatus.SUBMITTED, *ACTIVE_STATUSES)
FINAL_STATUSES = (RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.CANCELLED)


class StepStatus(StrEnum):
    WAITING = "WAITING"
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SKIPPED = "SKIPPED"


class Decision(StrEnum):
    APPROVE = "APPROVE"
    REJECT = "REJECT"


class RequestCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    amount: float = Field(gt=0, le=1e12)
    currency: str = Field(default="INR", min_length=3, max_length=3)
    department: str | None = Field(default=None, max_length=120)
    request_type: str = Field(default="PURCHASE", min_length=1, max_length=50)

    @field_validator("title")
    @classmethod
    def _strip_title(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("title must not be blank")
        return v

    @field_validator("currency", "request_type")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class ApprovalStep(BaseModel):
    model_config = ConfigDict(extra="allow")

    index: int
    role: str
    assigned_role: str
    sla_hours: float
    status: StepStatus
    started_at: UTCDateTime | None = None
    due_at: UTCDateTime | None = None
    breached: bool = False
    escalation_level: int = 0
    acted_by: str | None = None
    acted_by_name: str | None = None
    acted_at: UTCDateTime | None = None
    comment: str | None = None


class RequestResponse(BaseModel):
    id: str
    request_type: str
    title: str
    description: str = ""
    amount: float
    currency: str
    department: str | None = None
    requester_id: str
    requester_name: str | None = None
    status: RequestStatus
    workflow_id: str | None = None
    workflow_version: int | None = None
    rule_name: str | None = None
    steps: list[ApprovalStep] = Field(default_factory=list)
    current_step: int | None = None
    current_approver_role: str | None = None
    sla_due_at: UTCDateTime | None = None
    version: int
    created_at: UTCDateTime
    updated_at: UTCDateTime
    completed_at: UTCDateTime | None = None

    @classmethod
    def from_db(cls, doc: dict[str, Any]) -> "RequestResponse":
        return cls.model_validate({**doc, "id": doc["_id"]})


class RequestList(BaseModel):
    items: list[RequestResponse]
    total: int


class DecisionIn(BaseModel):
    decision: Decision
    comment: str | None = Field(default=None, max_length=2000)

    @field_validator("decision", mode="before")
    @classmethod
    def _upper(cls, v):
        return v.upper() if isinstance(v, str) else v


class Accepted(BaseModel):
    accepted: bool = True
    event_id: str
