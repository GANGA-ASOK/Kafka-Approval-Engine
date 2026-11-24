"""Auth, JWT and RBAC tests."""

import jwt

from app.core.config import settings
from app.core.security import get_password_hash, verify_password


def test_bcrypt_hashing_roundtrip():
    h = get_password_hash("Relay@123")
    assert h.startswith("$2")
    assert verify_password("Relay@123", h)
    assert not verify_password("wrong", h)
    assert not verify_password("x" * 100, h)  # >72 bytes never raises


async def test_demo_login_returns_token_and_user(api):
    r = await api.client.post("/api/auth/login", data={"username": "manager@relay.dev", "password": "Relay@123"})
    assert r.status_code == 200
    body = r.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["role"] == "MANAGER" and body["user"]["name"] == "Manoj Manager"
    claims = jwt.decode(body["access_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    assert claims["sub"] == body["user"]["id"] and claims["role"] == "MANAGER"

    me = await api.get("manager", "/api/auth/me")
    assert me.json() == body["user"]


async def test_seeded_users_have_expected_roles(api):
    r = await api.get("admin", "/api/admin/users")
    assert r.status_code == 200
    roles = {u["email"]: u["role"] for u in r.json()}
    assert roles == {
        "employee@relay.dev": "EMPLOYEE", "manager@relay.dev": "MANAGER", "finance@relay.dev": "FINANCE",
        "director@relay.dev": "DIRECTOR", "admin@relay.dev": "ADMIN",
    }
    employee = next(u for u in r.json() if u["role"] == "EMPLOYEE")
    assert employee["department"] == "Engineering" and employee["name"] == "Esha Employee"


async def test_login_failures(api):
    bad = await api.client.post("/api/auth/login", data={"username": "manager@relay.dev", "password": "nope"})
    assert bad.status_code == 401 and bad.json()["detail"] == "Incorrect email or password"
    unknown = await api.client.post("/api/auth/login", data={"username": "ghost@relay.dev", "password": "x"})
    assert unknown.status_code == 401
    assert (await api.client.get("/api/auth/me")).status_code == 401
    garbage = await api.client.get("/api/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert garbage.status_code == 401


async def test_register_always_creates_employee(api):
    r = await api.client.post(
        "/api/auth/register",
        json={"email": "New.Person@Relay.dev", "password": "Secret#123", "name": "New Person", "role": "ADMIN",
              "department": "Sales"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "EMPLOYEE" and r.json()["email"] == "new.person@relay.dev"
    dup = await api.client.post(
        "/api/auth/register", json={"email": "new.person@relay.dev", "password": "Secret#123", "name": "Again"}
    )
    assert dup.status_code == 409
    login = await api.client.post("/api/auth/login", data={"username": "new.person@relay.dev", "password": "Secret#123"})
    assert login.status_code == 200


async def test_validation_errors_have_string_detail(api):
    r = await api.client.post("/api/auth/register", json={"email": "bad", "password": "x", "name": ""})
    assert r.status_code == 422
    assert isinstance(r.json()["detail"], str) and "password" in r.json()["detail"]


async def test_admin_creates_privileged_user(api):
    r = await api.post("admin", "/api/admin/users",
                       json={"email": "fin2@relay.dev", "password": "Secret#123", "name": "Fin Two", "role": "FINANCE"})
    assert r.status_code == 201 and r.json()["role"] == "FINANCE"


async def test_non_admin_cannot_use_admin_routes(api):
    for who in ("employee", "manager", "finance", "director"):
        assert (await api.get(who, "/api/admin/users")).status_code == 403
        assert (await api.get(who, "/api/admin/dlq")).status_code == 403
        r = await api.post(who, "/api/admin/users",
                           json={"email": f"x{who}@relay.dev", "password": "Secret#123", "name": "X", "role": "ADMIN"})
        assert r.status_code == 403
        assert (await api.post(who, "/api/admin/dlq/DL-X/replay")).status_code == 403
        wf = await api.post(who, "/api/workflows", json={"name": "x", "request_type": "X", "rules": []})
        assert wf.status_code == 403
        assert (await api.put(who, "/api/workflows/WF-DEFAULT-PURCHASE", json={"name": "hacked"})).status_code == 403


async def test_employee_scopes_and_visibility(api):
    req = await api.create("employee")
    assert (await api.get("employee", "/api/requests?scope=all")).status_code == 403
    assert (await api.get("employee", "/api/requests?scope=inbox")).status_code == 403
    mine = (await api.get("employee", "/api/requests?scope=mine")).json()
    assert mine["total"] == 1 and mine["items"][0]["id"] == req["id"]

    # Another employee cannot see or cancel it, approvers can view it.
    await api.client.post("/api/auth/register",
                          json={"email": "other@relay.dev", "password": "Relay@123", "name": "Other"})
    assert (await api.get("other", f"/api/requests/{req['id']}")).status_code == 403
    assert (await api.get("other", f"/api/requests/{req['id']}/timeline")).status_code == 403
    assert (await api.post("other", f"/api/requests/{req['id']}/cancel")).status_code == 403
    assert (await api.get("finance", f"/api/requests/{req['id']}")).status_code == 200
    assert (await api.get("manager", "/api/requests/REQ-NOPE")).status_code == 404


async def test_decision_rbac_denials(api):
    req = await api.create("employee", amount=50_000)  # MANAGER -> FINANCE
    rid = req["id"]

    r = await api.decide("employee", rid)
    assert r.status_code == 403  # employees never approve
    r = await api.decide("finance", rid)
    assert r.status_code == 403 and "MANAGER" in r.json()["detail"]  # wrong role for current step
    r = await api.decide("director", rid)
    assert r.status_code == 403

    # Self-approval: a manager's own request is in the manager step but they may not act.
    own = await api.create("manager", amount=500)
    r = await api.decide("manager", own["id"])
    assert r.status_code == 403 and "own request" in r.json()["detail"]
    own_inbox = (await api.get("manager", "/api/requests?scope=inbox")).json()
    assert own["id"] not in {i["id"] for i in own_inbox["items"]}

    # Admin can act on any step but also not on their own request.
    admin_own = await api.create("admin", amount=500)
    assert (await api.decide("admin", admin_own["id"])).status_code == 403
    assert (await api.decide("admin", rid)).status_code == 202

    # Decisions on a missing request / finished request.
    assert (await api.decide("manager", "REQ-NOPE")).status_code == 404
    small = await api.create("employee", amount=100)
    assert (await api.decide("manager", small["id"])).status_code == 202
    assert (await api.decide("manager", small["id"])).status_code == 409
