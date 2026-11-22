"""Pure rule-matching / routing tests (CONTRACT section 3)."""

from datetime import UTC, datetime

import pytest

from app.workflow.rules import FALLBACK_RULE_NAME, build_steps, default_workflow_document, select_route

WF = default_workflow_document(datetime.now(UTC))


def route(amount, department="Engineering", request_type="PURCHASE", wf=WF):
    return select_route(wf, amount=amount, department=department, request_type=request_type)


@pytest.mark.parametrize(
    ("amount", "rule", "roles"),
    [
        (1, "Small spend", ["MANAGER"]),
        (9999.99, "Small spend", ["MANAGER"]),
        (10000, "Medium spend", ["MANAGER", "FINANCE"]),  # min inclusive / max exclusive
        (99999.99, "Medium spend", ["MANAGER", "FINANCE"]),
        (100000, "Large spend", ["MANAGER", "FINANCE", "DIRECTOR"]),
        (5_000_000, "Large spend", ["MANAGER", "FINANCE", "DIRECTOR"]),
    ],
)
def test_default_workflow_amount_tiers(amount, rule, roles):
    r = route(amount)
    assert r.rule_name == rule
    assert [s["role"] for s in r.steps] == roles
    assert r.workflow_id == "WF-DEFAULT-PURCHASE"
    assert all(s["sla_hours"] == 24 for s in r.steps)


def test_no_workflow_falls_back_to_single_manager_step():
    r = route(500, wf=None)
    assert r.workflow_id is None
    assert r.rule_name == FALLBACK_RULE_NAME
    assert r.steps == [{"role": "MANAGER", "sla_hours": 24}]


def test_no_matching_rule_falls_back_but_keeps_workflow_id():
    wf = {**WF, "rules": [{"name": "Sales only", "priority": 1, "conditions": {"departments": ["Sales"]},
                           "steps": [{"role": "DIRECTOR", "sla_hours": 4}]}]}
    r = route(500, department="Engineering", wf=wf)
    assert r.workflow_id == WF["_id"]
    assert r.rule_name == FALLBACK_RULE_NAME
    assert [s["role"] for s in r.steps] == ["MANAGER"]


def test_departments_condition_is_case_insensitive_and_priority_ordered():
    wf = {
        **WF,
        "rules": [
            # Deliberately out of order: priority decides, not list position.
            {"name": "Everyone", "priority": 50, "conditions": {}, "steps": [{"role": "MANAGER", "sla_hours": 24}]},
            {"name": "Finance dept", "priority": 1, "conditions": {"departments": ["finance", "Treasury"]},
             "steps": [{"role": "DIRECTOR", "sla_hours": 8}]},
        ],
    }
    assert route(10, department="FINANCE", wf=wf).rule_name == "Finance dept"
    assert route(10, department="treasury", wf=wf).steps == [{"role": "DIRECTOR", "sla_hours": 8.0}]
    assert route(10, department="Engineering", wf=wf).rule_name == "Everyone"
    assert route(10, department=None, wf=wf).rule_name == "Everyone"


def test_request_types_condition():
    wf = {**WF, "rules": [{"name": "Travel", "priority": 1, "conditions": {"request_types": ["travel"]},
                           "steps": [{"role": "FINANCE", "sla_hours": 2}]}]}
    assert route(10, request_type="TRAVEL", wf=wf).rule_name == "Travel"
    assert route(10, request_type="PURCHASE", wf=wf).rule_name == FALLBACK_RULE_NAME


def test_build_steps_activates_only_first_step():
    now = datetime(2026, 1, 1, tzinfo=UTC)
    steps = build_steps([{"role": "MANAGER", "sla_hours": 0.5}, {"role": "FINANCE", "sla_hours": 24}], now)
    assert steps[0]["status"] == "PENDING" and steps[0]["started_at"] == now
    assert (steps[0]["due_at"] - now).total_seconds() == 1800
    assert steps[1]["status"] == "WAITING" and steps[1]["due_at"] is None
    assert [s["index"] for s in steps] == [0, 1]
    assert all(s["assigned_role"] == s["role"] and s["escalation_level"] == 0 for s in steps)
