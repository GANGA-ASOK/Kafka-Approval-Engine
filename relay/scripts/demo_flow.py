#!/usr/bin/env python3
"""RELAY demo: drives the whole approval flow using only the REST API (stdlib only).

Usage: python scripts/demo_flow.py [--base http://localhost:8000] [--skip-dlq] [--dlq-wait 40]
Requires the backend running with SEED_DEMO_DATA=true.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

PASSWORD = "Relay@123"
USERS = {r: f"{r}@relay.dev" for r in ("employee", "manager", "finance", "director", "admin")}
FINAL = {"APPROVED", "REJECTED", "CANCELLED"}


class Api:
    def __init__(self, base):
        self.base = base.rstrip("/") + "/api"
        self.tokens = {}

    def call(self, method, path, token=None, body=None, form=None, headers=None):
        data, h = None, dict(headers or {})
        if form is not None:
            data = urllib.parse.urlencode(form).encode()
            h["Content-Type"] = "application/x-www-form-urlencoded"
        elif body is not None:
            data = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        if token:
            h["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(self.base + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw.decode(errors="replace")

    def login(self, who):
        s, b = self.call("POST", "/auth/login", form={"username": USERS[who], "password": PASSWORD})
        if s != 200:
            sys.exit(f"login failed for {who}: {s} {b}")
        self.tokens[who] = b["access_token"]
        return b["user"]

    def t(self, who):
        return self.tokens[who]


def wait_for(fn, timeout=20, interval=0.5):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(interval)
    return None


def get_req(api, who, rid):
    return api.call("GET", f"/requests/{rid}", api.t(who))[1]


def create(api, title, amount):
    s, b = api.call("POST", "/requests", api.t("employee"), body={
        "title": title, "description": "Created by demo_flow.py", "amount": amount,
        "currency": "INR", "department": "Engineering", "request_type": "PURCHASE"},
        headers={"Idempotency-Key": str(uuid.uuid4())})
    if s != 201:
        sys.exit(f"create failed: {s} {b}")
    return b["_id"] if "_id" in b else b["id"]


def routed(api, rid):
    def f():
        r = get_req(api, "employee", rid)
        return r if r and r.get("steps") else None
    return wait_for(f)


def decide(api, who, rid, decision, comment=None):
    r = get_req(api, who, rid)
    step = r["current_step"]
    s, b = api.call("POST", f"/requests/{rid}/decision", api.t(who),
                    body={"decision": decision, "comment": comment})
    if s != 202:
        sys.exit(f"decision by {who} failed: {s} {b}")
    # wait for async state change
    wait_for(lambda: (lambda x: x["current_step"] != step or x["status"] in FINAL)(get_req(api, who, rid)))


def walk(api, rid, roles, reject_at=None):
    for role in roles:
        who = role.lower()
        r = get_req(api, who, rid)
        if r["status"] in FINAL:
            break
        if reject_at == role:
            decide(api, who, rid, "REJECT", "Not justified")
        else:
            decide(api, who, rid, "APPROVE", "Looks good")


def show(api, rid, label):
    r = get_req(api, "admin", rid)
    path = " -> ".join(f"{s['role']}:{s['status']}" for s in r["steps"]) or "(no steps)"
    print(f"  [{label}] {rid} rule='{r.get('rule_name')}' status={r['status']}  {path}")
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--skip-dlq", action="store_true")
    ap.add_argument("--dlq-wait", type=int, default=45, help="seconds to wait for the DLQ entry")
    a = ap.parse_args()
    api = Api(a.base)

    s, h = api.call("GET", "/health")
    print("Health:", s, h)
    for u in USERS:
        api.login(u)
    print("Logged in as:", ", ".join(USERS.values()))

    print("\n1. Small request (INR 5,000) -> Manager only")
    r1 = create(api, "Demo: USB keyboards", 5000)
    routed(api, r1)
    walk(api, r1, ["MANAGER"])
    show(api, r1, "small")

    print("\n2. Medium request (INR 50,000) -> Manager -> Finance")
    r2 = create(api, "Demo: Standing desks", 50000)
    routed(api, r2)
    walk(api, r2, ["MANAGER", "FINANCE"])
    show(api, r2, "medium")

    print("\n3. Large request (INR 500,000) -> Manager -> Finance -> Director")
    r3 = create(api, "Demo: Server rack", 500000)
    routed(api, r3)
    walk(api, r3, ["MANAGER", "FINANCE", "DIRECTOR"])
    show(api, r3, "large")

    print("\n4. Large request rejected by Finance (Director step is SKIPPED)")
    r4 = create(api, "Demo: Gold-plated chairs", 300000)
    routed(api, r4)
    walk(api, r4, ["MANAGER", "FINANCE", "DIRECTOR"], reject_at="FINANCE")
    show(api, r4, "rejected")

    print("\n5. Self-approval check (employee cannot approve own request)")
    r5 = create(api, "Demo: self approve attempt", 1000)
    routed(api, r5)
    s, b = api.call("POST", f"/requests/{r5}/decision", api.t("employee"), body={"decision": "APPROVE"})
    print(f"  employee approving own request -> HTTP {s} {b}")

    print("\nTimeline of the medium request:")
    s, tl = api.call("GET", f"/requests/{r2}/timeline", api.t("manager"))
    for e in tl:
        print(f"  {e['occurred_at']}  {e['event_type']:<20} source={e['source']}")

    if not a.skip_dlq:
        print("\n6. Fault injection: '[fail]' request -> retries -> DLQ")
        r6 = create(api, "Demo [fail] poison event", 2000)
        print(f"  created {r6}; waiting up to {a.dlq_wait}s for dead letter (retries use exponential backoff)...")
        dl = wait_for(lambda: next((d for d in (api.call("GET", "/admin/dlq?status=PENDING", api.t("admin"))[1] or [])
                                    if (d.get("event") or {}).get("request_id") == r6), None),
                      timeout=a.dlq_wait, interval=2)
        if dl:
            print(f"  dead letter {dl.get('_id') or dl.get('id')}: attempts={dl.get('attempts')} error={dl.get('error')}")
            print("  (replay it from the Admin > DLQ page or POST /api/admin/dlq/{id}/replay)")
        else:
            print("  no dead letter appeared in time (is RUN_WORKERS on and MAX_EVENT_RETRIES small enough?)")
        show(api, r6, "dlq")

    s, st = api.call("GET", "/stats", api.t("admin"))
    print("\nStats:", json.dumps(st))
    print("\nDone. Browse Kafka topics at http://localhost:8080 and the UI at http://localhost:5173")


if __name__ == "__main__":
    main()
