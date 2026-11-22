# RELAY — Phase 2 Shared Contract

Single source of truth for the backend, frontend, infra and docs work. If you need to deviate, keep the
deviation backward compatible and record it in `relay/docs/ASSUMPTIONS.md` under your section.

## 1. Runtime & ports
| Component | How it runs | Port |
|---|---|---|
| FastAPI backend | `cd relay/backend && uv run uvicorn app.main:app --reload --port 8000` | 8000 |
| React frontend (Vite) | `cd relay/frontend && npm run dev` | 5173 |
| MongoDB 7 | docker compose | 27017 |
| Redis 7 | docker compose | 6379 |
| Kafka (KRaft, single node) | docker compose, host listener `localhost:9092` | 9092 |
| Kafka UI | docker compose | 8080 |

Settings (pydantic-settings, env-overridable, `.env` supported):
`MONGODB_URL, DATABASE_NAME, REDIS_URL, KAFKA_BOOTSTRAP_SERVERS, SECRET_KEY, ALGORITHM,
ACCESS_TOKEN_EXPIRE_MINUTES, CORS_ORIGINS (comma list, default http://localhost:5173),
EVENT_BUS ("kafka" | "memory", default kafka), RUN_WORKERS (bool, default true — consumers + SLA monitor
run as asyncio tasks in the FastAPI lifespan), SLA_CHECK_INTERVAL_SECONDS (default 15),
MAX_EVENT_RETRIES (default 3), RETRY_BACKOFF_SECONDS (default 2, exponential), SEED_DEMO_DATA (bool, default true)`.

Workers can also run standalone: `uv run python -m app.workers` (same code, no HTTP).

## 2. Roles & RBAC
Roles: `EMPLOYEE < MANAGER < FINANCE < DIRECTOR < ADMIN`.

| Capability | EMPLOYEE | MANAGER | FINANCE | DIRECTOR | ADMIN |
|---|---|---|---|---|---|
| Create request, view/cancel own | ✓ | ✓ | ✓ | ✓ | ✓ |
| Approvals inbox (steps assigned to my role) | – | ✓ | ✓ | ✓ | ✓ (all) |
| Approve / reject current step | – | if step role == mine | same | same | any |
| View any request | – | ✓ | ✓ | ✓ | ✓ |
| Audit log: all entries | – (own requests only) | ✓ | ✓ | ✓ | ✓ |
| Workflows CRUD, DLQ, users admin | – | – | – | – | ✓ |

- Nobody may approve their own request (403).
- Public `POST /api/auth/register` always creates an `EMPLOYEE`. ADMIN creates other roles via `/api/admin/users`.
- RBAC is enforced server-side with a reusable dependency `require_roles(*roles)`; JWT carries `sub` (user id) and `role`.

Seeded demo users (when `SEED_DEMO_DATA`), password for all: `Relay@123`
`employee@relay.dev` (Esha Employee, EMPLOYEE, dept Engineering), `manager@relay.dev` (Manoj Manager, MANAGER),
`finance@relay.dev` (Farah Finance, FINANCE), `director@relay.dev` (Dev Director, DIRECTOR), `admin@relay.dev` (Ada Admin, ADMIN).

## 3. Workflow engine (configurable, dynamic routing)
Collection `workflows`. Seeded default (request_type `PURCHASE`, also used as fallback for any type without its own workflow):
```json
{
  "_id": "WF-DEFAULT-PURCHASE", "name": "Purchase approvals", "request_type": "PURCHASE",
  "active": true, "version": 1,
  "rules": [
    {"name": "Small spend",  "priority": 1, "conditions": {"max_amount": 10000},                 "steps": [{"role": "MANAGER", "sla_hours": 24}]},
    {"name": "Medium spend", "priority": 2, "conditions": {"min_amount": 10000, "max_amount": 100000}, "steps": [{"role": "MANAGER", "sla_hours": 24}, {"role": "FINANCE", "sla_hours": 24}]},
    {"name": "Large spend",  "priority": 3, "conditions": {"min_amount": 100000},                "steps": [{"role": "MANAGER", "sla_hours": 24}, {"role": "FINANCE", "sla_hours": 24}, {"role": "DIRECTOR", "sla_hours": 24}]}
  ],
  "escalation": {"MANAGER": "DIRECTOR", "FINANCE": "DIRECTOR", "DIRECTOR": "ADMIN", "ADMIN": null},
  "created_at": "...", "updated_at": "..."
}
```
Rule matching: rules sorted by `priority` asc, first match wins. Conditions (all optional, AND-ed):
`min_amount` (inclusive, amount >= min), `max_amount` (exclusive, amount < max), `departments` (list, case-insensitive),
`request_types` (list). No match → fallback single step `MANAGER, 24h`. `sla_hours` is a float (0.01 h ≈ 36 s for demos).
Updating a workflow bumps `version`; in-flight requests keep the step plan they were routed with (snapshot on the request).

## 4. Request document (collection `requests`)
```json
{
  "_id": "REQ-1A2B3C4D", "request_type": "PURCHASE", "title": "...", "description": "...",
  "amount": 25000.0, "currency": "INR", "department": "Engineering",
  "requester_id": "USER-...", "requester_name": "Esha Employee",
  "status": "SUBMITTED | PENDING_APPROVAL | ESCALATED | APPROVED | REJECTED | CANCELLED",
  "workflow_id": "WF-DEFAULT-PURCHASE", "workflow_version": 1, "rule_name": "Medium spend",
  "steps": [{
    "index": 0, "role": "MANAGER", "assigned_role": "MANAGER", "sla_hours": 24,
    "status": "WAITING | PENDING | APPROVED | REJECTED | SKIPPED",
    "started_at": null, "due_at": null, "breached": false, "escalation_level": 0,
    "acted_by": null, "acted_by_name": null, "acted_at": null, "comment": null
  }],
  "current_step": 0,               // index of active step, null when finished
  "current_approver_role": "MANAGER", // == steps[current_step].assigned_role, null when finished
  "sla_due_at": "...",             // == steps[current_step].due_at
  "version": 3,                    // optimistic concurrency; every state transition does compare-and-set
  "created_at": "...", "updated_at": "...", "completed_at": null
}
```
Lifecycle: API inserts with `status=SUBMITTED`, `steps=[]`, publishes `REQUEST_SUBMITTED`. The workflow consumer routes it
(selects rule, snapshots steps, activates step 0 → `PENDING_APPROVAL`). Approve on last step → `APPROVED`; any reject →
`REJECTED` (remaining steps `SKIPPED`); cancel (requester, while not final) → `CANCELLED`. SLA breach → step `breached=true`,
`assigned_role` = escalation target, `escalation_level+1`, new `due_at`, request `status=ESCALATED`. If no escalation
target, mark breached and leave assigned. Approval of an escalated step continues normally (status back to
`PENDING_APPROVAL` for the next step).

## 5. Events (Kafka)
Topics (auto-created by the backend on startup via admin client, 3 partitions, RF 1):
- `relay.request.events` — domain events (key = `request_id` → per-request ordering)
- `relay.request.events.retry` — failed events awaiting retry
- `relay.request.events.dlq` — events that exhausted retries

Envelope (JSON):
```json
{"event_id": "uuid4", "event_type": "...", "request_id": "REQ-...", "actor_id": "USER-... | system",
 "actor_name": "...", "actor_role": "...", "occurred_at": "ISO-8601 UTC", "payload": {}, "attempt": 0,
 "correlation_id": "uuid4", "source": "api | workflow-engine | sla-monitor"}
```
Event types:
- Commands/inputs (from API or SLA monitor): `REQUEST_SUBMITTED`, `APPROVAL_DECISION` (payload `{decision: APPROVE|REJECT, comment, step_index}`), `REQUEST_CANCEL_REQUESTED`, `SLA_BREACHED` (payload `{step_index, due_at}`)
- Outcomes (emitted by workflow engine): `REQUEST_ROUTED` (`{rule_name, steps}`), `STEP_ACTIVATED` (`{step_index, role, due_at}`), `STEP_APPROVED`, `STEP_REJECTED`, `REQUEST_ESCALATED` (`{step_index, from_role, to_role, escalation_level}`), `REQUEST_APPROVED`, `REQUEST_REJECTED`, `REQUEST_CANCELLED`
- Ops: `EVENT_DEAD_LETTERED`, `EVENT_REPLAYED`

Consumer groups on `relay.request.events`:
1. `relay-workflow-engine` — applies commands, emits outcome events.
2. `relay-audit-logger` — writes EVERY event to `audit_logs` (fan-out demonstration).
Group `relay-retry-worker` on `.retry` re-publishes to the main topic after backoff (`retry_at` in payload headers/envelope `retry_at`).

Reliability rules:
- **Idempotency**: each consumer group records `(group, event_id)` in Mongo `processed_events` (unique index) and a Redis
  fast-path key `relay:processed:{group}:{event_id}` (TTL 7 d). Duplicate → skip + commit. State transitions additionally use
  `version` compare-and-set, and decisions validate `step_index == current_step` so replays can't double-approve.
- **Manual commits** (`enable_auto_commit=False`), commit after successful handle or after hand-off to retry/DLQ.
- **Retries**: handler exception → publish to `.retry` with `attempt+1`, `retry_at = now + RETRY_BACKOFF_SECONDS * 2^attempt`, `last_error`.
  When `attempt >= MAX_EVENT_RETRIES` → publish to `.dlq` and insert into Mongo `dead_letters`
  (`{_id, event, error, group, failed_at, attempts, status: "PENDING|REPLAYED|DISCARDED"}`) and emit `EVENT_DEAD_LETTERED`.
- **API idempotency**: `POST /api/requests` honours an `Idempotency-Key` header; the first response is cached in Redis 24 h
  (`relay:idem:{user_id}:{key}`) and replayed for duplicates.
- **SLA monitor**: loop every `SLA_CHECK_INTERVAL_SECONDS`; acquires Redis lock `relay:lock:sla-monitor` (SET NX EX) so only one
  instance scans; finds active steps with `due_at < now` and `breached=false`, publishes `SLA_BREACHED` (dedupe key
  `relay:sla:{request_id}:{step_index}:{escalation_level}`).
- **Fault injection for demos/tests**: a request whose title contains `[fail]` makes the workflow engine raise on
  `REQUEST_SUBMITTED` → demonstrates retries then DLQ. Admin replay re-publishes the original event with a new `event_id`
  only if the admin chose "replay"; the replay passes through (the `[fail]` check is skipped when payload `replayed=true`).
- `EVENT_BUS=memory`: in-process asyncio bus with identical semantics (used by tests; lets the API run without Kafka).

## 6. REST API (prefix `/api`, JSON, snake_case, JWT Bearer)
Errors: `{"detail": "..."}` with proper 400/401/403/404/409/422.

Auth
- `POST /auth/register` `{email, password, name, department?}` → `UserResponse` (role EMPLOYEE)
- `POST /auth/login` (OAuth2 form: username, password) → `{access_token, token_type, user: UserResponse}`
- `GET /auth/me` → `UserResponse` `{id, email, name, role, department}`

Requests
- `GET /requests?scope=mine|inbox|all&status=&q=&limit=50&skip=0` → `{items: RequestResponse[], total}`
  (`inbox` = current_approver_role == my role and requester != me; ADMIN inbox = all active; `all` requires non-EMPLOYEE)
- `POST /requests` `{title, description, amount, currency="INR", department, request_type="PURCHASE"}` (+ `Idempotency-Key`) → 201 `RequestResponse` (status SUBMITTED)
- `GET /requests/{id}` → `RequestResponse` (full document incl. `steps`)
- `POST /requests/{id}/decision` `{decision: "APPROVE"|"REJECT", comment?}` → 202 `{accepted: true, event_id}` (validates role/step/self-approval synchronously; reject requires a comment)
- `POST /requests/{id}/cancel` → 202 `{accepted: true, event_id}`
- `GET /requests/{id}/timeline` → `AuditEntry[]` (ascending)

Workflows
- `GET /workflows` (any authenticated) → `Workflow[]`
- `GET /workflows/preview?amount=&department=&request_type=` → `{workflow_id, rule_name, steps:[{role, sla_hours}]}` (used by the New Request form for live route preview)
- `POST /workflows`, `PUT /workflows/{id}`, `DELETE /workflows/{id}` — ADMIN

Audit
- `GET /audit?request_id=&event_type=&actor_id=&source=&from=&to=&limit=50&skip=0` → `{items: AuditEntry[], total}`
  AuditEntry: `{id, event_id, event_type, request_id, actor_id, actor_name, actor_role, source, occurred_at, recorded_at, payload, request_title}`

Stats
- `GET /stats` → `{by_status: {STATUS: n}, my_open: n, inbox: n, breached: n, dlq_pending: n, approved_last_7d: n, avg_cycle_hours: float|null}`

Admin (ADMIN only)
- `GET /admin/dlq?status=PENDING` → `DeadLetter[]`; `POST /admin/dlq/{id}/replay`; `POST /admin/dlq/{id}/discard`
- `GET /admin/users`; `POST /admin/users` `{email, password, name, role, department?}`

Health
- `GET /health` → `{status: "ok"|"degraded", components: {mongo: "up|down", redis: "up|down", kafka: "up|down|disabled"}, event_bus}`

## 7. Ownership (to avoid edit conflicts)
- Backend agent: everything under `relay/backend/` except `Dockerfile`.
- Frontend agent: everything under `relay/frontend/` except `Dockerfile`.
- Infra/docs agent: `relay/docker-compose.yml`, `relay/backend/Dockerfile`, `relay/frontend/Dockerfile`, `relay/scripts/**`, `relay/README.md`, root `README.md`.
- Assumptions: each agent appends to its own section in `relay/docs/ASSUMPTIONS.md` (create the section if missing; never rewrite other sections).
- Nobody commits to git; the orchestrator does.
