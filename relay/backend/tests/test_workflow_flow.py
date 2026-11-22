"""End-to-end workflow tests through the REST API + in-memory event bus."""


def event_types(timeline):
    return [e["event_type"] for e in timeline]


async def test_create_returns_submitted_then_engine_routes(api):
    r = await api.post("employee", "/api/requests", json={"title": "Mouse", "amount": 900, "department": "Engineering"})
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "SUBMITTED" and body["steps"] == [] and body["id"].startswith("REQ-")
    assert body["currency"] == "INR" and body["request_type"] == "PURCHASE" and body["version"] == 1
    assert body["requester_name"] == "Esha Employee"
    assert body["created_at"].endswith("Z")

    await api.drain()
    req = await api.request(body["id"])
    assert req["status"] == "PENDING_APPROVAL"
    assert req["rule_name"] == "Small spend"
    assert req["workflow_id"] == "WF-DEFAULT-PURCHASE" and req["workflow_version"] == 1
    assert req["current_step"] == 0 and req["current_approver_role"] == "MANAGER"
    assert req["sla_due_at"] == req["steps"][0]["due_at"]
    assert req["steps"][0]["status"] == "PENDING"
    assert req["version"] == 2


async def test_full_large_approval_chain(api):
    req = await api.create("employee", amount=250_000, title="Servers")
    rid = req["id"]
    got = await api.request(rid)
    assert got["rule_name"] == "Large spend"
    assert [s["role"] for s in got["steps"]] == ["MANAGER", "FINANCE", "DIRECTOR"]
    assert [s["status"] for s in got["steps"]] == ["PENDING", "WAITING", "WAITING"]

    for i, who in enumerate(("manager", "finance", "director")):
        inbox = (await api.get(who, "/api/requests?scope=inbox")).json()
        assert rid in {x["id"] for x in inbox["items"]}, who
        r = await api.decide(who, rid, comment=f"ok from {who}")
        assert r.status_code == 202 and r.json()["accepted"] is True and r.json()["event_id"]
        got = await api.request(rid)
        assert got["steps"][i]["status"] == "APPROVED"
        assert got["steps"][i]["acted_by_name"] is not None
        assert got["steps"][i]["comment"] == f"ok from {who}"

    assert got["status"] == "APPROVED"
    assert got["current_step"] is None and got["current_approver_role"] is None and got["sla_due_at"] is None
    assert got["completed_at"] is not None
    assert got["version"] == 5  # insert + routed + 3 decisions

    timeline = (await api.get("employee", f"/api/requests/{rid}/timeline")).json()
    types = event_types(timeline)
    assert types[0] == "REQUEST_SUBMITTED" and types[-1] == "REQUEST_APPROVED"
    assert types.count("STEP_APPROVED") == 3 and types.count("STEP_ACTIVATED") == 3
    assert types.count("APPROVAL_DECISION") == 3 and "REQUEST_ROUTED" in types
    assert [e["occurred_at"] for e in timeline] == sorted(e["occurred_at"] for e in timeline)
    assert all(e["request_title"] == "Servers" for e in timeline)


async def test_medium_routes_manager_then_finance_and_inbox_moves(api):
    req = await api.create("employee", amount=10_000)
    rid = req["id"]
    assert (await api.request(rid))["rule_name"] == "Medium spend"
    fin_inbox = (await api.get("finance", "/api/requests?scope=inbox")).json()
    assert rid not in {x["id"] for x in fin_inbox["items"]}
    await api.decide("manager", rid)
    got = await api.request(rid)
    assert got["status"] == "PENDING_APPROVAL" and got["current_approver_role"] == "FINANCE"
    assert got["steps"][1]["status"] == "PENDING" and got["steps"][1]["due_at"]
    fin_inbox = (await api.get("finance", "/api/requests?scope=inbox")).json()
    assert rid in {x["id"] for x in fin_inbox["items"]}
    mgr_inbox = (await api.get("manager", "/api/requests?scope=inbox")).json()
    assert rid not in {x["id"] for x in mgr_inbox["items"]}


async def test_reject_requires_comment_and_skips_remaining_steps(api):
    req = await api.create("employee", amount=150_000)
    rid = req["id"]
    r = await api.decide("manager", rid, "REJECT")
    assert r.status_code == 422 and "comment" in r.json()["detail"]
    r = await api.decide("manager", rid, "reject", comment="Over budget")
    assert r.status_code == 202
    got = await api.request(rid)
    assert got["status"] == "REJECTED"
    assert [s["status"] for s in got["steps"]] == ["REJECTED", "SKIPPED", "SKIPPED"]
    assert got["steps"][0]["comment"] == "Over budget"
    types = event_types((await api.get("manager", f"/api/requests/{rid}/timeline")).json())
    assert types[-2:] == ["STEP_REJECTED", "REQUEST_REJECTED"]


async def test_cancel_by_requester(api):
    req = await api.create("employee", amount=50_000)
    rid = req["id"]
    assert (await api.post("manager", f"/api/requests/{rid}/cancel")).status_code == 403
    r = await api.post("employee", f"/api/requests/{rid}/cancel")
    assert r.status_code == 202 and r.json()["event_id"]
    await api.drain()
    got = await api.request(rid)
    assert got["status"] == "CANCELLED" and got["completed_at"]
    assert [s["status"] for s in got["steps"]] == ["SKIPPED", "SKIPPED"]
    assert (await api.post("employee", f"/api/requests/{rid}/cancel")).status_code == 409
    assert (await api.decide("manager", rid)).status_code == 409


async def test_list_filters_and_search(api):
    a = await api.create("employee", amount=100, title="Coffee beans")
    b = await api.create("employee", amount=200, title="Desk lamp")
    await api.decide("manager", b["id"])
    approved = (await api.get("employee", "/api/requests?status=APPROVED")).json()
    assert [x["id"] for x in approved["items"]] == [b["id"]]
    found = (await api.get("manager", "/api/requests?scope=all&q=coffee")).json()
    assert found["total"] == 1 and found["items"][0]["id"] == a["id"]
    paged = (await api.get("manager", "/api/requests?scope=all&limit=1")).json()
    assert paged["total"] == 2 and len(paged["items"]) == 1
    assert paged["items"][0]["id"] == b["id"]  # newest first
    admin_inbox = (await api.get("admin", "/api/requests?scope=inbox")).json()
    assert {x["id"] for x in admin_inbox["items"]} == {a["id"]}


async def test_preview_endpoint(api):
    r = await api.get("employee", "/api/workflows/preview", params={"amount": 42_000, "department": "Engineering"})
    assert r.status_code == 200
    assert r.json() == {
        "workflow_id": "WF-DEFAULT-PURCHASE",
        "rule_name": "Medium spend",
        "steps": [{"role": "MANAGER", "sla_hours": 24.0}, {"role": "FINANCE", "sla_hours": 24.0}],
    }
    # Unknown request type -> default workflow is the fallback.
    r = await api.get("employee", "/api/workflows/preview", params={"amount": 1, "request_type": "travel"})
    assert r.json()["workflow_id"] == "WF-DEFAULT-PURCHASE" and r.json()["rule_name"] == "Small spend"


async def test_custom_workflow_with_department_routing(api):
    wf = {
        "id": "WF-TRAVEL",
        "name": "Travel",
        "request_type": "travel",
        "rules": [
            {"name": "Sales travel", "priority": 1, "conditions": {"departments": ["sales"]},
             "steps": [{"role": "DIRECTOR", "sla_hours": 12}]},
            {"name": "Other travel", "priority": 2, "conditions": {},
             "steps": [{"role": "FINANCE", "sla_hours": 6}]},
        ],
    }
    r = await api.post("admin", "/api/workflows", json=wf)
    assert r.status_code == 201, r.text
    assert r.json()["request_type"] == "TRAVEL" and r.json()["version"] == 1
    assert (await api.post("admin", "/api/workflows", json=wf)).status_code == 409

    sales = await api.create("employee", amount=999_999, request_type="TRAVEL", department="SALES")
    other = await api.create("employee", amount=5, request_type="TRAVEL", department="Engineering")
    s = await api.request(sales["id"])
    o = await api.request(other["id"])
    assert (s["workflow_id"], s["rule_name"], [x["role"] for x in s["steps"]]) == ("WF-TRAVEL", "Sales travel", ["DIRECTOR"])
    assert (o["rule_name"], o["steps"][0]["sla_hours"]) == ("Other travel", 6)

    listed = (await api.get("employee", "/api/workflows")).json()
    assert {w["id"] for w in listed} == {"WF-DEFAULT-PURCHASE", "WF-TRAVEL"}
    assert (await api.client.delete("/api/workflows/WF-TRAVEL", headers=await api.h("admin"))).status_code == 204
    r = await api.client.delete("/api/workflows/WF-DEFAULT-PURCHASE", headers=await api.h("admin"))
    assert r.status_code == 409


async def test_workflow_update_bumps_version_and_inflight_keeps_snapshot(api):
    before = await api.create("employee", amount=500)
    wf = (await api.get("admin", "/api/workflows/WF-DEFAULT-PURCHASE")).json()
    rules = wf["rules"]
    rules[0]["steps"] = [{"role": "FINANCE", "sla_hours": 2}]
    r = await api.put("admin", "/api/workflows/WF-DEFAULT-PURCHASE", json={"rules": rules})
    assert r.status_code == 200 and r.json()["version"] == 2
    bad = await api.put("admin", "/api/workflows/WF-DEFAULT-PURCHASE",
                        json={"rules": [{"name": "x", "conditions": {"min_amount": 5, "max_amount": 1}, "steps": []}]})
    assert bad.status_code == 422

    after = await api.create("employee", amount=500)
    old = await api.request(before["id"])
    new = await api.request(after["id"])
    assert (old["workflow_version"], old["steps"][0]["role"]) == (1, "MANAGER")
    assert (new["workflow_version"], new["steps"][0]["role"], new["steps"][0]["sla_hours"]) == (2, "FINANCE", 2)
    # The in-flight request is still approvable by the role it was routed to.
    assert (await api.decide("manager", before["id"])).status_code == 202
    assert (await api.request(before["id"]))["status"] == "APPROVED"


async def test_department_defaults_to_user_department(api):
    r = await api.post("employee", "/api/requests", json={"title": "No dept", "amount": 10})
    assert r.status_code == 201 and r.json()["department"] == "Engineering"


async def test_health_and_stats(api):
    h = (await api.client.get("/health")).json()
    assert h == {"status": "ok", "components": {"mongo": "up", "redis": "up", "kafka": "disabled"},
                 "event_bus": "memory", "workers": True}
    assert (await api.client.get("/api/health")).status_code == 200

    a = await api.create("employee", amount=500)
    b = await api.create("employee", amount=50_000)
    await api.create("manager", amount=50)
    await api.decide("manager", a["id"])
    await api.decide("manager", b["id"], "REJECT", comment="no")

    emp = (await api.get("employee", "/api/stats")).json()
    assert emp["by_status"]["APPROVED"] == 1 and emp["by_status"]["REJECTED"] == 1
    assert emp["by_status"]["PENDING_APPROVAL"] == 0  # manager's own request is not visible to employee
    assert emp["my_open"] == 0 and emp["inbox"] == 0 and emp["dlq_pending"] == 0
    assert emp["approved_last_7d"] == 1 and emp["avg_cycle_hours"] is not None and emp["avg_cycle_hours"] >= 0

    mgr = (await api.get("manager", "/api/stats")).json()
    assert mgr["by_status"]["PENDING_APPROVAL"] == 1 and mgr["my_open"] == 1
    assert mgr["inbox"] == 0  # own request excluded
    assert (await api.get("director", "/api/stats")).json()["inbox"] == 0
    assert (await api.get("admin", "/api/stats")).json()["inbox"] == 1
