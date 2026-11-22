from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.common import UTCDateTime
from app.models.user import Role


class StepDefinition(BaseModel):
    role: Role
    sla_hours: float = Field(default=24, gt=0)


class RuleConditions(BaseModel):
    model_config = ConfigDict(extra="ignore")

    min_amount: float | None = Field(default=None, ge=0)
    max_amount: float | None = Field(default=None, ge=0)
    departments: list[str] | None = None
    request_types: list[str] | None = None

    @model_validator(mode="after")
    def _check_range(self):
        if self.min_amount is not None and self.max_amount is not None and self.min_amount >= self.max_amount:
            raise ValueError("min_amount must be less than max_amount")
        return self


class Rule(BaseModel):
    name: str = Field(min_length=1)
    priority: int = 100
    conditions: RuleConditions = Field(default_factory=RuleConditions)
    steps: list[StepDefinition] = Field(min_length=1)


DEFAULT_ESCALATION: dict[str, str | None] = {
    "MANAGER": "DIRECTOR",
    "FINANCE": "DIRECTOR",
    "DIRECTOR": "ADMIN",
    "ADMIN": None,
}


def _validate_escalation(v: dict[str, str | None]) -> dict[str, str | None]:
    roles = {r.value for r in Role}
    for k, target in v.items():
        if k not in roles or (target is not None and target not in roles):
            raise ValueError(f"invalid escalation mapping {k!r} -> {target!r}")
        if target == k:
            raise ValueError(f"role {k} cannot escalate to itself")
    return v


class WorkflowBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    request_type: str = Field(default="PURCHASE", min_length=1, max_length=50)
    active: bool = True
    rules: list[Rule] = Field(default_factory=list)
    escalation: dict[str, str | None] = Field(default_factory=lambda: dict(DEFAULT_ESCALATION))

    _esc = field_validator("escalation")(_validate_escalation)

    @field_validator("request_type")
    @classmethod
    def _upper(cls, v: str) -> str:
        return v.strip().upper()


class WorkflowCreate(WorkflowBase):
    id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_\-]{3,64}$")


class WorkflowUpdate(BaseModel):
    """Partial update; any omitted field keeps its current value. Always bumps `version`."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    request_type: str | None = None
    active: bool | None = None
    rules: list[Rule] | None = None
    escalation: dict[str, str | None] | None = None

    @field_validator("escalation")
    @classmethod
    def _esc(cls, v):
        return None if v is None else _validate_escalation(v)

    @field_validator("request_type")
    @classmethod
    def _upper(cls, v):
        return None if v is None else v.strip().upper()


class Workflow(WorkflowBase):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: str = Field(alias="_id")
    version: int = 1
    created_at: UTCDateTime | None = None
    updated_at: UTCDateTime | None = None


class WorkflowResponse(WorkflowBase):
    id: str
    version: int
    created_at: UTCDateTime | None = None
    updated_at: UTCDateTime | None = None


class RoutePreview(BaseModel):
    workflow_id: str | None
    rule_name: str
    steps: list[StepDefinition]
