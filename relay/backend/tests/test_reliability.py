"""Idempotency, retries/DLQ/replay, SLA escalation, optimistic concurrency, outbox and audit coverage."""

from datetime import timedelta

import pytest

from app.core.clock import utcnow
from app.core.redis import get_redis
from app.events.bus import EventBus, EventBusUnavailable
from app.events.envelope import (
    DLQ_TOPIC,
    GROUP_AUDIT,
    GROUP_WORKFLOW,
    MAIN_TOPIC,
    RETRY_TOPIC,
    EventEnvelope,
    EventType,
    Source,
    new_event,
)
from app.events.publisher import EventPublisher, OutboxRelay
from app.workers.consumer import IdempotentConsumer
from app.workflow.engine import ConcurrencyConflict, WorkflowEngine


def decision_event(req, actor, decision="APPROVE", comment=None):
    return new_event(
        EventType.APPROVAL_DECISION,
        req["id"],
        source=Source.API,
        actor={"actor_id": actor["id"], "actor_name": actor["name"], "actor_role": actor["role"]},
        payload={"decision": decision, "comment": comment, "step_index": req["current_step"]},
    )


async def user(api, who):
    return (await api.get(who, "/api/auth/me")).json()


# ------------------------------------------------------------------ idempotency
async def test_duplicate_event_delivered_twice_causes_one_transition(api, bus, db, monkeypatch):
    req = await api.request((await api.create("employee", amount=50_000))["id"])
    assert req["version"] == 2
    event = decision_event(req, await user(api, "manager"))

    handled = []
    original = WorkflowEngine._on_decision

    async def spy(self, e):
        handled.append(e.event_id)
        return await original(self, e)

    monkeypatch.setattr(WorkflowEngine, "_on_decision", spy)

    await bus.publish(MAIN_TOPIC, event)
    await bus.publish(MAIN_TOPIC, event)  # at-least-once redelivery
    await api.drain()

    assert handled == [event.event_id]  # the consumer-level dedupe skipped the duplicate
    after = await api.request(req["id"])
    assert after["version"] == 3  # exactly one transition
    assert after["current_step"] == 1 and after["steps"][0]["status"] == "APPROVED"
    assert await db.processed_events.count_documents({"group": GROUP_WORKFLOW, "event_id": event.event_id}) == 1
    assert await db.audit_logs.count_documents({"event_id": event.event_id}) == 1
    assert await get_redis().exists(f"relay:processed:{GROUP_WORKFLOW}:{event.event_id}")
    timeline = (await api.get("manager", f"/api/requests/{req['id']}/timeline")).json()
    assert [e["event_type"] for e in timeline].count("STEP_APPROVED") == 1


async def test_stale_decision_with_new_event_id_cannot_double_approve(api, bus):
    req = await api.request((await api.create("employee", amount=50_000))["id"])
    manager = await user(api, "manager")
    await bus.publish(MAIN_TOPIC, decision_event(req, manager))
    await bus.publish(MAIN_TOPIC, decision_event(req, manager))  # different event_id, same step_index
    await api.drain()
    after = await api.request(req["id"])
    assert after["version"] == 3 and after["current_step"] == 1 and after["steps"][1]["status"] == "PENDING"


async def test_idempotent_consumer_mongo_is_source_of_truth(app):
    calls = []

    async def handler(e):
        calls.append(e.event_id)

    consumer = IdempotentConsumer("test-group", handler, publisher=None)
    event = new_event(EventType.REQUEST_APPROVED, "REQ-1", source=Source.API)
    await consumer(event)
    await consumer(event)
    await get_redis().flushall()  # fast path lost -> Mongo still dedupes
    await consumer(event)
    assert calls == [event.event_id]


async def test_engine_cas_rejects_stale_version(api, runtime):
    req = await api.create("employee", amount=500)
    from app.core.db import get_database

    doc = await get_database().requests.find_one({"_id": req["id"]})
    engine = WorkflowEngine(runtime.publisher)
    await engine._cas(doc, {"title": "first"})
    with pytest.raises(ConcurrencyConflict):
        await engine._cas(doc, {"title": "second"})  # same (now stale) version


# ------------------------------------------------------------------ retries / DLQ / replay
async def test_fail_marker_retries_then_dead_letters_then_replay(api, bus, db):
    req = await api.create("employee", amount=500, title="Broken [fail] request")
    rid = req["id"]
    assert (await api.request(rid))["status"] == "SUBMITTED"  # never routed

    retries = [e for t, e in bus.published if t == RETRY_TOPIC and e.request_id == rid]
    assert [e.attempt for e in retries] == [1, 2, 3]
    assert all(e.target_group == GROUP_WORKFLOW and "FaultInjected" in e.last_error for e in retries)
    assert all(e.retry_at is not None for e in retries)
    assert len([e for t, e in bus.published if t == DLQ_TOPIC and e.request_id == rid]) == 1

    dlq = (await api.get("admin", "/api/admin/dlq?status=PENDING")).json()
    assert len(dlq) == 1
    dl = dlq[0]
    assert dl["group"] == GROUP_WORKFLOW and dl["attempts"] == 4 and dl["status"] == "PENDING"
    assert dl["event_type"] == "REQUEST_SUBMITTED" and dl["request_id"] == rid
    assert "Injected failure" in dl["error"]
    assert (await api.get("admin", "/api/stats")).json()["dlq_pending"] == 1

    # The audit logger recorded the original event exactly once (retries are not re-audited).
    submitted = await db.audit_logs.count_documents({"request_id": rid, "event_type": "REQUEST_SUBMITTED"})
    assert submitted == 1
    assert await db.audit_logs.count_documents({"request_id": rid, "event_type": "EVENT_DEAD_LETTERED"}) == 1

    r = await api.post("admin", f"/api/admin/dlq/{dl['id']}/replay")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "REPLAYED" and r.json()["replay_event_id"]
    await api.drain()

    routed = await api.request(rid)
    assert routed["status"] == "PENDING_APPROVAL" and routed["current_approver_role"] == "MANAGER"
    types = [e["event_type"] for e in (await api.get("admin", f"/api/requests/{rid}/timeline")).json()]
    assert "EVENT_REPLAYED" in types and types.count("REQUEST_SUBMITTED") == 2 and "REQUEST_ROUTED" in types
    assert (await api.post("admin", f"/api/admin/dlq/{dl['id']}/replay")).status_code == 409
    assert (await api.get("admin", "/api/admin/dlq?status=PENDING")).json() == []
    assert (await api.post("admin", "/api/admin/dlq/DL-NOPE/replay")).status_code == 404


async def test_discard_dead_letter(api):
    await api.create("employee", amount=500, title="[FAIL] again")
    dl = (await api.get("admin", "/api/admin/dlq")).json()[0]
    r = await api.post("admin", f"/api/admin/dlq/{dl['id']}/discard")
    assert r.status_code == 200 and r.json()["status"] == "DISCARDED" and r.json()["discarded_by"]
    assert (await api.post("admin", f"/api/admin/dlq/{dl['id']}/replay")).status_code == 409


async def test_transient_failure_recovers_via_retry(api, runtime, bus, monkeypatch):
    """A handler that fails once is retried and succeeds - no dead letter."""
    original = WorkflowEngine._on_submitted
    state = {"fails": 1}

    async def flaky(self, event):
        if state["fails"]:
            state["fails"] -= 1
            raise RuntimeError("transient")
        return await original(self, event)

    monkeypatch.setattr(WorkflowEngine, "_on_submitted", flaky)
    req = await api.create("employee", amount=500)
    assert (await api.request(req["id"]))["status"] == "PENDING_APPROVAL"
    assert len([e for t, e in bus.published if t == RETRY_TOPIC]) == 1
    assert (await api.get("admin", "/api/admin/dlq")).json() == []


# ------------------------------------------------------------------ API idempotency
async def test_idempotency_key_replays_first_response(api, db):
    body = {"title": "Chair", "amount": 3000, "department": "Engineering"}
    key = {"Idempotency-Key": "abc-123"}
    first = await api.post("employee", "/api/requests", json=body, headers=key)
    second = await api.post("employee", "/api/requests", json=body, headers=key)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert second.headers.get("Idempotent-Replayed") == "true"
    assert await db.requests.count_documents({}) == 1

    conflict = await api.post("employee", "/api/requests", json={**body, "amount": 1}, headers=key)
    assert conflict.status_code == 409
    other_user = await api.post("manager", "/api/requests", json=body, headers=key)
    assert other_user.status_code == 201 and other_user.json()["id"] != first.json()["id"]
    no_key = await api.post("employee", "/api/requests", json=body)
    assert no_key.json()["id"] != first.json()["id"]
    assert await get_redis().ttl(f"relay:idem:{first.json()['requester_id']}:abc-123") > 23 * 3600


# ------------------------------------------------------------------ SLA / escalation
async def test_sla_breach_escalates_through_chain(api, runtime, db):
    wf = (await api.get("admin", "/api/workflows/WF-DEFAULT-PURCHASE")).json()
    wf["rules"][0]["steps"][0]["sla_hours"] = 0.005  # 18 s
    assert (await api.put("admin", "/api/workflows/WF-DEFAULT-PURCHASE", json={"rules": wf["rules"]})).status_code == 200

    rid = (await api.create("employee", amount=500))["id"]
    req = await api.request(rid)
    assert req["steps"][0]["sla_hours"] == 0.005

    monitor = runtime.sla_monitor
    assert await monitor.tick() == 0  # not yet due
    later = utcnow() + timedelta(minutes=1)
    assert await monitor.tick(now=later) == 1
    assert await monitor.tick(now=later) == 0  # dedupe key prevents a second breach event
    await api.drain()

    req = await api.request(rid)
    step = req["steps"][0]
    assert req["status"] == "ESCALATED" and req["current_approver_role"] == "DIRECTOR"
    assert (step["role"], step["assigned_role"], step["breached"], step["escalation_level"]) == (
        "MANAGER", "DIRECTOR", True, 1)
    assert req["sla_due_at"] == step["due_at"]
    assert (await api.get("employee", "/api/stats")).json()["breached"] == 1

    types = [e["event_type"] for e in (await api.get("admin", f"/api/requests/{rid}/timeline")).json()]
    assert types[-2:] == ["SLA_BREACHED", "REQUEST_ESCALATED"]
    esc = (await api.get("admin", f"/api/audit?request_id={rid}&event_type=REQUEST_ESCALATED")).json()["items"][0]
    assert esc["payload"]["from_role"] == "MANAGER" and esc["payload"]["to_role"] == "DIRECTOR"
    assert esc["source"] == "workflow-engine"
    breach = (await api.get("admin", f"/api/audit?request_id={rid}&event_type=SLA_BREACHED")).json()["items"][0]
    assert breach["source"] == "sla-monitor" and breach["actor_id"] == "system"

    # The escalated step now belongs to DIRECTOR.
    assert rid not in {x["id"] for x in (await api.get("manager", "/api/requests?scope=inbox")).json()["items"]}
    assert rid in {x["id"] for x in (await api.get("director", "/api/requests?scope=inbox")).json()["items"]}
    assert (await api.decide("manager", rid)).status_code == 403

    # Next level: DIRECTOR -> ADMIN, then ADMIN has no target -> stays assigned, monitoring stops.
    assert await monitor.tick(now=utcnow() + timedelta(minutes=2)) == 1
    await api.drain()
    req = await api.request(rid)
    assert (req["current_approver_role"], req["steps"][0]["escalation_level"]) == ("ADMIN", 2)
    assert await monitor.tick(now=utcnow() + timedelta(minutes=3)) == 1
    await api.drain()
    req = await api.request(rid)
    assert req["current_approver_role"] == "ADMIN" and req["sla_due_at"] is None
    assert req["steps"][0]["breached"] is True
    assert await monitor.tick(now=utcnow() + timedelta(hours=5)) == 0

    assert (await api.decide("admin", rid)).status_code == 202
    assert (await api.request(rid))["status"] == "APPROVED"


async def test_escalated_step_approval_continues_chain(api, runtime):
    rid = (await api.create("employee", amount=50_000))["id"]
    assert await runtime.sla_monitor.tick(now=utcnow() + timedelta(hours=25)) == 1
    await api.drain()
    assert (await api.request(rid))["status"] == "ESCALATED"
    await api.decide("director", rid)
    req = await api.request(rid)
    assert req["status"] == "PENDING_APPROVAL" and req["current_approver_role"] == "FINANCE"
    assert req["steps"][0]["acted_by_name"] == "Dev Director"


async def test_sla_monitor_respects_redis_lock(api, runtime):
    await api.create("employee", amount=500)
    await get_redis().set("relay:lock:sla-monitor", "another-instance", ex=60)
    assert await runtime.sla_monitor.tick(now=utcnow() + timedelta(days=2)) == 0
    await get_redis().delete("relay:lock:sla-monitor")
    assert await runtime.sla_monitor.tick(now=utcnow() + timedelta(days=2)) == 1


# ------------------------------------------------------------------ audit coverage
async def test_audit_entry_written_for_every_event(api, bus, db):
    a = (await api.create("employee", amount=250_000))["id"]
    for who in ("manager", "finance"):
        await api.decide(who, a)
    await api.decide("director", a, "REJECT", comment="not this quarter")
    b = (await api.create("employee", amount=50))["id"]
    await api.post("employee", f"/api/requests/{b}/cancel")
    await api.create("employee", amount=50, title="[fail] x")
    await api.drain()

    main_ids = {e.event_id for t, e in bus.published if t == MAIN_TOPIC}
    audited = {d["event_id"] async for d in db.audit_logs.find({}, {"event_id": 1})}
    assert main_ids == audited
    assert await db.processed_events.count_documents({"group": GROUP_AUDIT}) == len(main_ids)

    every_type = {d["event_type"] async for d in db.audit_logs.find({}, {"event_type": 1})}
    assert {"REQUEST_SUBMITTED", "REQUEST_ROUTED", "STEP_ACTIVATED", "APPROVAL_DECISION", "STEP_APPROVED",
            "STEP_REJECTED", "REQUEST_REJECTED", "REQUEST_CANCEL_REQUESTED", "REQUEST_CANCELLED",
            "EVENT_DEAD_LETTERED"} <= every_type


async def test_audit_endpoint_filters_and_employee_scope(api):
    mine = (await api.create("employee", amount=100))["id"]
    theirs = (await api.create("manager", amount=100))["id"]
    await api.decide("admin", mine)

    everything = (await api.get("admin", "/api/audit?limit=500")).json()
    assert everything["total"] == len(everything["items"]) > 0
    occurred = [e["occurred_at"] for e in everything["items"]]
    assert occurred == sorted(occurred, reverse=True)  # newest first
    entry = everything["items"][0]
    assert set(entry) >= {"id", "event_id", "event_type", "request_id", "actor_id", "actor_name", "actor_role",
                          "source", "occurred_at", "recorded_at", "payload", "request_title"}

    emp = (await api.get("employee", "/api/audit?limit=500")).json()
    assert {e["request_id"] for e in emp["items"]} == {mine}
    assert (await api.get("employee", f"/api/audit?request_id={theirs}")).json()["total"] == 0

    admin = await user(api, "admin")
    by_actor = (await api.get("manager", f"/api/audit?actor_id={admin['id']}")).json()
    assert {e["event_type"] for e in by_actor["items"]} == {"APPROVAL_DECISION", "STEP_APPROVED", "REQUEST_APPROVED"}
    multi = (await api.get("manager", "/api/audit?event_type=REQUEST_SUBMITTED,REQUEST_APPROVED")).json()
    assert multi["total"] == 3
    src = (await api.get("manager", "/api/audit?source=api")).json()
    assert {e["source"] for e in src["items"]} == {"api"}
    future = (utcnow() + timedelta(hours=1)).isoformat()
    assert (await api.get("manager", "/api/audit", params={"from": future})).json()["total"] == 0
    assert (await api.get("manager", "/api/audit", params={"to": future, "limit": 1})).json()["total"] == everything["total"]
    paged = (await api.get("manager", "/api/audit?limit=2&skip=1")).json()
    assert [e["id"] for e in paged["items"]] == [e["id"] for e in everything["items"][1:3]]


# ------------------------------------------------------------------ outbox fallback
class FlakyBus(EventBus):
    name = "flaky"

    def __init__(self):
        super().__init__()
        self.up = False
        self.sent: list[EventEnvelope] = []

    async def start(self): ...
    async def stop(self): ...

    async def publish(self, topic, event):
        if not self.up:
            raise EventBusUnavailable("down")
        self.sent.append(event)

    async def health(self):
        return "up" if self.up else "down"

    @property
    def connected(self):
        return self.up


async def test_publisher_buffers_in_outbox_when_bus_down(app, db):
    flaky = FlakyBus()
    publisher = EventPublisher(flaky)
    events = [new_event(EventType.REQUEST_SUBMITTED, f"REQ-{i}", source=Source.API) for i in range(3)]
    for e in events:
        await publisher.publish(MAIN_TOPIC, e)
    assert await db.outbox.count_documents({}) == 3

    relay = OutboxRelay(flaky)
    assert await relay.flush() == 0  # still down
    flaky.up = True
    assert await relay.flush() == 3
    assert [e.event_id for e in flaky.sent] == [e.event_id for e in events]  # order preserved
    assert await db.outbox.count_documents({}) == 0
