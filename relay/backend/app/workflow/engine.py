"""Workflow engine: applies command events to requests and emits outcome events.

Every state transition is a compare-and-set on `version` (optimistic concurrency). Commands that
no longer apply (stale step index, already-final request, ...) are ignored rather than failed, so
duplicate or replayed deliveries can never double-approve.
"""

import logging
from typing import Any

from app.core.clock import hours, iso, utcnow
from app.core.db import get_database
from app.events.envelope import MAIN_TOPIC, EventEnvelope, EventType, Source, new_event
from app.events.publisher import EventPublisher
from app.models.request import ACTIVE_STATUSES, FINAL_STATUSES, RequestStatus, StepStatus
from app.models.workflow import DEFAULT_ESCALATION
from app.services.workflows import load_workflow_for
from app.workflow.rules import build_steps, select_route

log = logging.getLogger("relay.workflow.engine")

FAIL_MARKER = "[fail]"


class FaultInjected(RuntimeError):
    """Raised for requests whose title contains `[fail]` (demo of retries -> DLQ)."""


class ConcurrencyConflict(RuntimeError):
    """The request changed between read and compare-and-set; the event will be retried."""


class RequestNotFound(LookupError):
    pass


class WorkflowEngine:
    def __init__(self, publisher: EventPublisher) -> None:
        self.publisher = publisher

    async def handle(self, event: EventEnvelope) -> None:
        handler = {
            EventType.REQUEST_SUBMITTED: self._on_submitted,
            EventType.APPROVAL_DECISION: self._on_decision,
            EventType.REQUEST_CANCEL_REQUESTED: self._on_cancel,
            EventType.SLA_BREACHED: self._on_sla_breached,
        }.get(event.event_type)
        if handler is None:
            return  # outcome / ops events are not commands for the engine
        await handler(event)

    # ------------------------------------------------------------------ helpers
    async def _load(self, request_id: str | None) -> dict[str, Any]:
        doc = await get_database().requests.find_one({"_id": request_id})
        if doc is None:
            raise RequestNotFound(f"request {request_id} not found")
        return doc

    async def _cas(self, doc: dict[str, Any], updates: dict[str, Any]) -> None:
        now = utcnow()
        result = await get_database().requests.update_one(
            {"_id": doc["_id"], "version": doc["version"]},
            {"$set": {**updates, "updated_at": now}, "$inc": {"version": 1}},
        )
        if result.modified_count != 1:
            raise ConcurrencyConflict(f"request {doc['_id']} version {doc['version']} is stale")

    async def _emit(self, cause: EventEnvelope, event_type: EventType, payload: dict[str, Any], *, actor=None) -> None:
        await self.publisher.publish(
            MAIN_TOPIC,
            new_event(
                event_type,
                cause.request_id,
                source=Source.WORKFLOW_ENGINE,
                payload=payload,
                actor=actor,
                correlation_id=cause.correlation_id,
            ),
        )

    @staticmethod
    def _actor(event: EventEnvelope) -> dict[str, Any]:
        return {"actor_id": event.actor_id, "actor_name": event.actor_name, "actor_role": event.actor_role}

    # ------------------------------------------------------------------ REQUEST_SUBMITTED
    async def _on_submitted(self, event: EventEnvelope) -> None:
        doc = await self._load(event.request_id)
        if doc["status"] != RequestStatus.SUBMITTED:
            log.info("Request %s already routed (status %s); ignoring", doc["_id"], doc["status"])
            return
        if FAIL_MARKER in doc.get("title", "").lower() and not event.payload.get("replayed"):
            raise FaultInjected(f"Injected failure for request {doc['_id']} (title contains {FAIL_MARKER})")

        workflow = await load_workflow_for(doc.get("request_type", "PURCHASE"))
        route = select_route(
            workflow, amount=float(doc["amount"]), department=doc.get("department"), request_type=doc["request_type"]
        )
        now = utcnow()
        steps = build_steps(route.steps, now)
        first = steps[0]
        await self._cas(
            doc,
            {
                "status": RequestStatus.PENDING_APPROVAL.value,
                "workflow_id": route.workflow_id,
                "workflow_version": route.workflow_version,
                "rule_name": route.rule_name,
                "escalation_chain": route.escalation,
                "steps": steps,
                "current_step": 0,
                "current_approver_role": first["assigned_role"],
                "sla_due_at": first["due_at"],
            },
        )
        log.info("Routed %s via %s/%s (%d step(s))", doc["_id"], route.workflow_id, route.rule_name, len(steps))
        await self._emit(
            event,
            EventType.REQUEST_ROUTED,
            {
                "workflow_id": route.workflow_id,
                "workflow_version": route.workflow_version,
                "rule_name": route.rule_name,
                "steps": route.steps,
            },
        )
        await self._emit(
            event,
            EventType.STEP_ACTIVATED,
            {"step_index": 0, "role": first["assigned_role"], "due_at": iso(first["due_at"])},
        )

    # ------------------------------------------------------------------ APPROVAL_DECISION
    async def _on_decision(self, event: EventEnvelope) -> None:
        doc = await self._load(event.request_id)
        p = event.payload
        step_index = p.get("step_index")
        decision = str(p.get("decision", "")).upper()
        if doc["status"] not in ACTIVE_STATUSES:
            log.info("Decision for %s ignored: status %s", doc["_id"], doc["status"])
            return
        if step_index != doc.get("current_step"):
            log.info("Decision for %s ignored: step %s != current %s", doc["_id"], step_index, doc.get("current_step"))
            return
        step = doc["steps"][step_index]
        # Re-validate authorisation against the *current* state (an escalation may have happened
        # between the synchronous API check and this event being processed).
        if event.actor_id == doc["requester_id"]:
            log.warning("Self-approval attempt on %s by %s ignored", doc["_id"], event.actor_id)
            return
        if event.actor_role != "ADMIN" and event.actor_role != step["assigned_role"]:
            log.warning("Decision on %s by role %s ignored: step assigned to %s",
                        doc["_id"], event.actor_role, step["assigned_role"])
            return
        if decision not in ("APPROVE", "REJECT"):
            log.warning("Unknown decision %r for %s ignored", decision, doc["_id"])
            return

        now = utcnow()
        steps = [dict(s) for s in doc["steps"]]
        steps[step_index].update(
            status=StepStatus.APPROVED.value if decision == "APPROVE" else StepStatus.REJECTED.value,
            acted_by=event.actor_id,
            acted_by_name=event.actor_name,
            acted_at=now,
            comment=p.get("comment"),
        )
        actor = self._actor(event)
        step_payload = {"step_index": step_index, "role": step["assigned_role"], "comment": p.get("comment")}

        if decision == "REJECT":
            for s in steps[step_index + 1 :]:
                s["status"] = StepStatus.SKIPPED.value
            await self._cas(doc, self._final(RequestStatus.REJECTED, steps, now))
            await self._emit(event, EventType.STEP_REJECTED, step_payload, actor=actor)
            await self._emit(event, EventType.REQUEST_REJECTED, {"step_index": step_index, "comment": p.get("comment")},
                             actor=actor)
            return

        next_index = step_index + 1
        if next_index >= len(steps):
            await self._cas(doc, self._final(RequestStatus.APPROVED, steps, now))
            await self._emit(event, EventType.STEP_APPROVED, step_payload, actor=actor)
            await self._emit(event, EventType.REQUEST_APPROVED, {"steps_approved": len(steps)}, actor=actor)
            return

        nxt = steps[next_index]
        nxt.update(status=StepStatus.PENDING.value, started_at=now, due_at=now + hours(nxt["sla_hours"]))
        await self._cas(
            doc,
            {
                "status": RequestStatus.PENDING_APPROVAL.value,
                "steps": steps,
                "current_step": next_index,
                "current_approver_role": nxt["assigned_role"],
                "sla_due_at": nxt["due_at"],
            },
        )
        await self._emit(event, EventType.STEP_APPROVED, step_payload, actor=actor)
        await self._emit(
            event,
            EventType.STEP_ACTIVATED,
            {"step_index": next_index, "role": nxt["assigned_role"], "due_at": iso(nxt["due_at"])},
        )

    @staticmethod
    def _final(status: RequestStatus, steps: list[dict[str, Any]], now) -> dict[str, Any]:
        return {
            "status": status.value,
            "steps": steps,
            "current_step": None,
            "current_approver_role": None,
            "sla_due_at": None,
            "completed_at": now,
        }

    # ------------------------------------------------------------------ REQUEST_CANCEL_REQUESTED
    async def _on_cancel(self, event: EventEnvelope) -> None:
        doc = await self._load(event.request_id)
        if doc["status"] in FINAL_STATUSES:
            log.info("Cancel for %s ignored: already %s", doc["_id"], doc["status"])
            return
        if event.actor_id != doc["requester_id"] and event.actor_role != "ADMIN":
            log.warning("Cancel of %s by non-owner %s ignored", doc["_id"], event.actor_id)
            return
        now = utcnow()
        steps = [dict(s) for s in doc.get("steps") or []]
        for s in steps:
            if s["status"] in (StepStatus.PENDING, StepStatus.WAITING):
                s["status"] = StepStatus.SKIPPED.value
        await self._cas(doc, self._final(RequestStatus.CANCELLED, steps, now))
        await self._emit(event, EventType.REQUEST_CANCELLED, {"previous_status": doc["status"]},
                         actor=self._actor(event))

    # ------------------------------------------------------------------ SLA_BREACHED
    async def _on_sla_breached(self, event: EventEnvelope) -> None:
        doc = await self._load(event.request_id)
        p = event.payload
        step_index = p.get("step_index")
        if doc["status"] not in ACTIVE_STATUSES or step_index != doc.get("current_step"):
            log.info("SLA breach for %s ignored (stale)", doc["_id"])
            return
        step = dict(doc["steps"][step_index])
        if step["status"] != StepStatus.PENDING or step.get("escalation_level", 0) != p.get("escalation_level", 0):
            log.info("SLA breach for %s step %s ignored (already handled)", doc["_id"], step_index)
            return

        chain = doc.get("escalation_chain") or DEFAULT_ESCALATION
        from_role = step["assigned_role"]
        to_role = chain.get(from_role)
        now = utcnow()
        steps = [dict(s) for s in doc["steps"]]

        if not to_role:
            # End of the chain: mark breached, keep the assignee, stop monitoring this step.
            steps[step_index].update(breached=True)
            await self._cas(doc, {"steps": steps, "sla_due_at": None})
            log.info("SLA breached on %s step %s; no escalation target for %s", doc["_id"], step_index, from_role)
            return

        level = step.get("escalation_level", 0) + 1
        due_at = now + hours(step["sla_hours"])
        steps[step_index].update(breached=True, assigned_role=to_role, escalation_level=level, due_at=due_at)
        await self._cas(
            doc,
            {
                "status": RequestStatus.ESCALATED.value,
                "steps": steps,
                "current_approver_role": to_role,
                "sla_due_at": due_at,
            },
        )
        log.info("Escalated %s step %s: %s -> %s (level %s)", doc["_id"], step_index, from_role, to_role, level)
        await self._emit(
            event,
            EventType.REQUEST_ESCALATED,
            {
                "step_index": step_index,
                "from_role": from_role,
                "to_role": to_role,
                "escalation_level": level,
                "due_at": iso(due_at),
            },
        )
