import logging
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import JSONResponse

from app.core.clock import utcnow
from app.core.db import get_database
from app.core.rbac import get_current_user, require_approver
from app.events.envelope import MAIN_TOPIC, EventType, Source, actor_from_user, new_event
from app.events.publisher import EventPublisher
from app.models.audit import AuditEntry
from app.models.request import (
    ACTIVE_STATUSES,
    FINAL_STATUSES,
    Accepted,
    Decision,
    DecisionIn,
    RequestCreate,
    RequestList,
    RequestResponse,
    RequestStatus,
)
from app.models.user import Role, UserInDB
from app.runtime import get_publisher
from app.services.audit import request_timeline
from app.services.idempotency import ApiIdempotencyCache, IdempotencyConflict
from app.services.requests import get_visible_request, inbox_filter, new_request_id, text_filter

log = logging.getLogger("relay.api.requests")
router = APIRouter()
_idem = ApiIdempotencyCache()


@router.get("", response_model=RequestList)
async def list_requests(
    scope: Literal["mine", "inbox", "all"] = "mine",
    status_: RequestStatus | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    skip: int = Query(default=0, ge=0),
    user: UserInDB = Depends(get_current_user),
):
    if scope == "mine":
        query = {"requester_id": user.id}
    elif user.role == Role.EMPLOYEE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"scope={scope} requires an approver role")
    elif scope == "inbox":
        query = inbox_filter(user)
    else:
        query = {}
    if status_ is not None:
        if scope == "inbox" and status_ not in ACTIVE_STATUSES:
            return RequestList(items=[], total=0)
        query["status"] = status_.value
    query.update(text_filter(q))
    db = get_database()
    cursor = db.requests.find(query).sort("created_at", -1).skip(skip).limit(limit)
    items = [RequestResponse.from_db(d) async for d in cursor]
    return RequestList(items=items, total=await db.requests.count_documents(query))


@router.post("", status_code=status.HTTP_201_CREATED, response_model=RequestResponse)
async def create_request(
    body: RequestCreate,
    user: UserInDB = Depends(get_current_user),
    publisher: EventPublisher = Depends(get_publisher),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=200),
):
    fingerprint = _idem.fingerprint(body.model_dump())
    if idempotency_key:
        try:
            cached = await _idem.begin(user.id, idempotency_key, fingerprint)
        except IdempotencyConflict as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=exc.detail) from None
        except Exception:  # noqa: BLE001 - Redis down: degrade to non-idempotent create
            log.warning("Idempotency cache unavailable; creating request without Idempotency-Key protection")
            idempotency_key = None
            cached = None
        if cached:
            return JSONResponse(cached["body"], status_code=cached["status_code"],
                                headers={"Idempotent-Replayed": "true"})

    try:
        now = utcnow()
        doc = {
            "_id": new_request_id(),
            "request_type": body.request_type,
            "title": body.title,
            "description": body.description,
            "amount": float(body.amount),
            "currency": body.currency,
            "department": body.department or user.department or "General",
            "requester_id": user.id,
            "requester_name": user.name,
            "status": RequestStatus.SUBMITTED.value,
            "workflow_id": None,
            "workflow_version": None,
            "rule_name": None,
            "steps": [],
            "current_step": None,
            "current_approver_role": None,
            "sla_due_at": None,
            "version": 1,
            "created_at": now,
            "updated_at": now,
            "completed_at": None,
        }
        await get_database().requests.insert_one(doc)
        await publisher.publish(
            MAIN_TOPIC,
            new_event(
                EventType.REQUEST_SUBMITTED,
                doc["_id"],
                source=Source.API,
                actor=actor_from_user(user),
                payload={
                    "title": doc["title"],
                    "amount": doc["amount"],
                    "currency": doc["currency"],
                    "department": doc["department"],
                    "request_type": doc["request_type"],
                },
            ),
        )
    except Exception:
        if idempotency_key:
            await _idem.abort(user.id, idempotency_key)
        raise

    out = RequestResponse.from_db(doc).model_dump(mode="json")
    if idempotency_key:
        try:
            await _idem.complete(user.id, idempotency_key, fingerprint, status.HTTP_201_CREATED, out)
        except Exception:  # noqa: BLE001
            log.warning("Could not cache idempotent response", exc_info=True)
    return JSONResponse(out, status_code=status.HTTP_201_CREATED)


@router.get("/{request_id}", response_model=RequestResponse)
async def get_request(request_id: str, user: UserInDB = Depends(get_current_user)):
    return RequestResponse.from_db(await get_visible_request(request_id, user))


@router.get("/{request_id}/timeline", response_model=list[AuditEntry])
async def get_timeline(request_id: str, user: UserInDB = Depends(get_current_user)):
    await get_visible_request(request_id, user)
    return await request_timeline(request_id)


@router.post("/{request_id}/decision", status_code=status.HTTP_202_ACCEPTED, response_model=Accepted)
async def decide(
    request_id: str,
    body: DecisionIn,
    user: UserInDB = Depends(require_approver),
    publisher: EventPublisher = Depends(get_publisher),
):
    doc = await get_database().requests.find_one({"_id": request_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if doc["requester_id"] == user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot approve or reject your own request")
    if doc["status"] not in ACTIVE_STATUSES or doc.get("current_step") is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Request is {doc['status']} and has no step awaiting a decision")
    if user.role != Role.ADMIN and doc.get("current_approver_role") != user.role.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail=f"Current step is assigned to {doc.get('current_approver_role')}")
    comment = (body.comment or "").strip() or None
    if body.decision == Decision.REJECT and not comment:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A comment is required to reject")

    event = new_event(
        EventType.APPROVAL_DECISION,
        request_id,
        source=Source.API,
        actor=actor_from_user(user),
        payload={"decision": body.decision.value, "comment": comment, "step_index": doc["current_step"]},
    )
    await publisher.publish(MAIN_TOPIC, event)
    return Accepted(event_id=event.event_id)


@router.post("/{request_id}/cancel", status_code=status.HTTP_202_ACCEPTED, response_model=Accepted)
async def cancel(
    request_id: str,
    user: UserInDB = Depends(get_current_user),
    publisher: EventPublisher = Depends(get_publisher),
):
    doc = await get_database().requests.find_one({"_id": request_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if doc["requester_id"] != user.id and user.role != Role.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the requester can cancel this request")
    if doc["status"] in FINAL_STATUSES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Request is already {doc['status']}")
    event = new_event(
        EventType.REQUEST_CANCEL_REQUESTED,
        request_id,
        source=Source.API,
        actor=actor_from_user(user),
        payload={"status_at_request": doc["status"]},
    )
    await publisher.publish(MAIN_TOPIC, event)
    return Accepted(event_id=event.event_id)
