# Assumptions log

## Orchestrator (requirements & architecture)
- The original repo was Phase 1 only (JWT login/register + request CRUD). The three résumé bullets describe the target state, so the missing parts are implemented, not just checked.
- Defaults the user approved: amount-tier routing (<₹10k Manager; ₹10k–₹1L Manager→Finance; ≥₹1L Manager→Finance→Director), 24 h SLA per step, escalation to the next role up (Manager/Finance→Director→Admin).
- "Event-driven": the API validates synchronously but changes state asynchronously. It publishes events, and Kafka consumers apply the state transitions, so decision endpoints return 202 Accepted and the UI refreshes or polls.
- Consumers and the SLA monitor run inside the FastAPI process by default (asyncio tasks) for a one-command dev experience. A standalone worker entry point exists for scaling out.
- Public sign-up creates EMPLOYEE accounts only (to prevent privilege escalation). Demo accounts for every role are seeded.
- `EVENT_BUS=memory` exists so tests (and Kafka-less dev) run with the same semantics.
- Work happens on the local branch `feat/phase2-workflow-engine`. Nothing is pushed.

## Backend
- Full list of backend decisions and contract interpretations: [`assumptions/backend.md`](assumptions/backend.md).
- Deviations are additive only. The main ones: a Mongo outbox for publishing while Kafka is down; SLA re-escalation driven by `sla_due_at` (not only `breached=false`) so the escalation chain continues; `/api/health` served as an alias of `/health`; validation `detail` returned as a string; optional envelope fields `retry_at`, `last_error` and `target_group`.
