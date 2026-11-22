# Backend assumptions & decisions

## Contract interpretation
- **SLA re-escalation:** after a breach the step keeps `breached=true` (the UI shows it was breached). Further escalation is driven by the request's `sla_due_at`. The SLA monitor scans active requests with `sla_due_at < now`, not only `breached=false`, so the whole chain MANAGER→DIRECTOR→ADMIN works. The Redis dedupe key includes `escalation_level`, so each level fires once. At the end of the chain (no target), the step is marked breached, stays assigned, and `sla_due_at` is set to `null`, which stops monitoring.
- **Escalated steps:** an escalated step can be decided by its *current* `assigned_role` (or ADMIN), not by its original `role`. This matches the inbox definition (`current_approver_role == my role`). The engine re-checks role and self-approval when it processes the event, because an escalation can happen between the API check and event processing. A decision that is no longer valid is ignored, not failed.
- **ADMIN inbox:** "all active" requests, excluding the admin's own (self-approval is forbidden for everyone). The same exclusion applies to every role's inbox.
- **Cancel:** the requester, or ADMIN, can cancel while the request is not final (including `SUBMITTED`). Steps that are pending or waiting become `SKIPPED`.
- **Escalation chain snapshot:** besides the step plan, the workflow's `escalation` map is copied onto the request as `escalation_chain` (an extra field). This keeps in-flight requests unaffected by later workflow edits.
- **Fallback:** no active workflow for a `request_type` → the active `WF-DEFAULT-PURCHASE` is used. No workflow at all, or no matching rule → one `MANAGER, 24h` step with `rule_name = "Default (no rule matched)"`.
- **Status codes:** register returns 201, a duplicate email returns 409, and bad login returns 401. Validation errors return 422 with `detail` as a **string** (contract shape) and the raw pydantic list under `errors`. Reject without a comment returns 422. A decision or cancel on a finished request returns 409.
- **Health:** served at both `/health` and `/api/health` (compose healthcheck uses the latter). It always returns HTTP 200, with `status: degraded` when a component is down. It also includes `workers: bool` (additive).
- **DLQ list:** `GET /admin/dlq` with no `status` returns all dead letters (newest first). Replay and discard return the updated `DeadLetter` and give 409 if it is not `PENDING`. Replay targets every consumer group (the state guards make this safe).
- **Workflows:** `PUT` is a partial update (omitted fields unchanged) and always bumps `version`. Only one active workflow per `request_type` is allowed (409 otherwise). `WF-DEFAULT-PURCHASE` cannot be deleted (409); deactivate or edit it instead. `GET /workflows/{id}` was added.
- **Audit:** `GET /audit` sorts newest first. `event_type` accepts a comma-separated list. `from`/`to` filter on `occurred_at`. EMPLOYEE callers only see entries for their own requests. Entries also carry `correlation_id` and `attempt`. The timeline sorts ascending by a microsecond sort key (`occurred_ts`), because Mongo datetimes only keep milliseconds.
- **Stats scope:** EMPLOYEE sees own requests, other roles see all. `dlq_pending` is 0 for EMPLOYEE. `avg_cycle_hours` covers APPROVED and REJECTED requests (latest 1000). `breached` = active requests whose pending step is breached.
- **Demo user departments (contract only fixes the employee's):** manager Engineering, finance Finance, director Leadership, admin Operations. `department` on a new request defaults to the user's department, then "General".
- **Defaults:** `description` defaults to `""`. `amount` must be > 0. Currency and request_type are upper-cased.

## Reliability design
- **Retry routing:** a retried event keeps its `event_id` and carries `target_group`, so only the failing group re-handles it (the audit logger does not re-audit). The retry worker dedupes on `event_id:attempt`. Envelope additions: `retry_at`, `last_error`, `target_group`. All of them are optional.
- **Attempt counting:** `attempt` 0 is the first delivery. Backoff is `RETRY_BACKOFF_SECONDS * 2^attempt` (2s, 4s, 8s), and the event is dead-lettered when `attempt >= MAX_EVENT_RETRIES`. That is 4 tries in total, so `attempts = 4` in `dead_letters`. Dead-letter ids come from `(group, event_id)`, and the event is then marked processed (status `DEAD_LETTERED`), so a redelivery cannot create a second dead letter.
- **Idempotency order:** check, then handle, then mark processed. A crash before marking causes a redelivery. Redelivery is safe because transitions use a `version` compare-and-set plus `step_index`, `status` and `escalation_level` guards. A failed compare-and-set raises `ConcurrencyConflict`, and the normal retry path re-reads state.
- **Outbox (beyond the contract):** if publishing fails (Kafka down or timed out after `KAFKA_PUBLISH_TIMEOUT_SECONDS`), the event is stored in Mongo `outbox`. `OutboxRelay` re-publishes it once the bus is connected, with a per-document lease so the API and worker processes don't both send it. As a result, API writes still succeed while Kafka is down. A possible double publish is absorbed by consumer idempotency.
- **Kafka start-up:** the bus connects in a background loop with capped exponential backoff (`KAFKA_CONNECT_RETRY_MAX_SECONDS`). The API serves meanwhile and health shows `kafka: down`. Consumers start after the connection succeeds. If a handler raises an infrastructure error (not an application error), the offset is not committed, the partition is rewound, and the message is redelivered.
- **Mongo start-up:** if Mongo is unreachable at boot, the index and seed bootstrap is retried in the background instead of crashing.
- **SLA lock:** the holder renews it (value = instance id, TTL = 2 × interval). If Redis is down, the scan runs without the lock; the engine's escalation-level guard keeps this safe.
- **Fault injection:** a `[fail]` match is case-insensitive.

## Implementation choices
- passlib was removed. The code uses `bcrypt` directly (passlib breaks with bcrypt ≥ 4.1). Passwords must be 8–72 bytes. `BCRYPT_ROUNDS` is configurable (the tests use 4).
- `email-validator` was added (required by `EmailStr`). Dev dependencies: pytest, pytest-asyncio, httpx, mongomock-motor and fakeredis.
- Datetimes are stored as BSON dates (motor `tz_aware=True`) and serialised as ISO-8601 UTC with `Z`.
- `get_current_user` reads the role from the database (not the JWT), so role changes take effect immediately. The JWT still carries `sub` and `role`, plus `name`.
- Extra settings, all with defaults: `BCRYPT_ROUNDS`, `KAFKA_TOPIC_PARTITIONS`, `KAFKA_REPLICATION_FACTOR`, `KAFKA_CONNECT_RETRY_MAX_SECONDS`, `KAFKA_PUBLISH_TIMEOUT_SECONDS`, `OUTBOX_RELAY_INTERVAL_SECONDS`. The default `ACCESS_TOKEN_EXPIRE_MINUTES` is 1 day.
- `processed_events` has a 30-day TTL index. The Redis fast-path keys expire after 7 days, as the contract specifies.
- With `EVENT_BUS=memory` and `RUN_WORKERS=false`, published events have no consumer and are dropped. Memory mode is intended to run with workers.
