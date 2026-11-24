"""Rule matching / dynamic routing (CONTRACT section 3). Pure functions, no I/O."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.core.clock import hours
from app.models.request import StepStatus

DEFAULT_WORKFLOW_ID = "WF-DEFAULT-PURCHASE"
FALLBACK_RULE_NAME = "Default (no rule matched)"
FALLBACK_STEPS: list[dict[str, Any]] = [{"role": "MANAGER", "sla_hours": 24}]


@dataclass(frozen=True)
class Route:
    workflow_id: str | None
    workflow_version: int | None
    rule_name: str
    steps: list[dict[str, Any]]  # [{role, sla_hours}]
    escalation: dict[str, str | None]


def _norm(values) -> set[str]:
    return {str(v).strip().lower() for v in values or []}


def rule_matches(conditions: dict[str, Any] | None, *, amount: float, department: str | None, request_type: str) -> bool:
    c = conditions or {}
    min_amount = c.get("min_amount")
    max_amount = c.get("max_amount")
    if min_amount is not None and not amount >= float(min_amount):
        return False
    if max_amount is not None and not amount < float(max_amount):
        return False
    departments = c.get("departments")
    if departments and (department or "").strip().lower() not in _norm(departments):
        return False
    request_types = c.get("request_types")
    if request_types and (request_type or "").strip().lower() not in _norm(request_types):
        return False
    return True


def select_route(
    workflow: dict[str, Any] | None, *, amount: float, department: str | None, request_type: str
) -> Route:
    """Rules sorted by priority asc, first match wins; no match -> MANAGER 24h fallback."""
    from app.models.workflow import DEFAULT_ESCALATION

    if workflow is None:
        return Route(None, None, FALLBACK_RULE_NAME, [dict(s) for s in FALLBACK_STEPS], dict(DEFAULT_ESCALATION))
    escalation = dict(workflow.get("escalation") or DEFAULT_ESCALATION)
    rules = sorted(workflow.get("rules") or [], key=lambda r: r.get("priority", 100))
    for rule in rules:
        if rule_matches(rule.get("conditions"), amount=amount, department=department, request_type=request_type):
            steps = [{"role": str(s["role"]), "sla_hours": float(s.get("sla_hours", 24))} for s in rule["steps"]]
            return Route(workflow["_id"], workflow.get("version", 1), rule["name"], steps, escalation)
    return Route(
        workflow["_id"], workflow.get("version", 1), FALLBACK_RULE_NAME, [dict(s) for s in FALLBACK_STEPS], escalation
    )


def build_steps(route_steps: list[dict[str, Any]], now: datetime) -> list[dict[str, Any]]:
    """Snapshot the step plan onto the request; step 0 is activated immediately."""
    steps = []
    for i, s in enumerate(route_steps):
        active = i == 0
        steps.append(
            {
                "index": i,
                "role": s["role"],
                "assigned_role": s["role"],
                "sla_hours": s["sla_hours"],
                "status": StepStatus.PENDING.value if active else StepStatus.WAITING.value,
                "started_at": now if active else None,
                "due_at": now + hours(s["sla_hours"]) if active else None,
                "breached": False,
                "escalation_level": 0,
                "acted_by": None,
                "acted_by_name": None,
                "acted_at": None,
                "comment": None,
            }
        )
    return steps


def default_workflow_document(now: datetime) -> dict[str, Any]:
    from app.models.workflow import DEFAULT_ESCALATION

    return {
        "_id": DEFAULT_WORKFLOW_ID,
        "name": "Purchase approvals",
        "request_type": "PURCHASE",
        "active": True,
        "version": 1,
        "rules": [
            {"name": "Small spend", "priority": 1, "conditions": {"max_amount": 10000},
             "steps": [{"role": "MANAGER", "sla_hours": 24}]},
            {"name": "Medium spend", "priority": 2, "conditions": {"min_amount": 10000, "max_amount": 100000},
             "steps": [{"role": "MANAGER", "sla_hours": 24}, {"role": "FINANCE", "sla_hours": 24}]},
            {"name": "Large spend", "priority": 3, "conditions": {"min_amount": 100000},
             "steps": [{"role": "MANAGER", "sla_hours": 24}, {"role": "FINANCE", "sla_hours": 24},
                       {"role": "DIRECTOR", "sla_hours": 24}]},
        ],
        "escalation": dict(DEFAULT_ESCALATION),
        "created_at": now,
        "updated_at": now,
    }
