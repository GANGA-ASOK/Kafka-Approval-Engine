from datetime import timedelta

from fastapi import APIRouter, Depends

from app.core.clock import ensure_utc, utcnow
from app.core.db import get_database
from app.core.rbac import get_current_user
from app.models.audit import Stats
from app.models.request import ACTIVE_STATUSES, OPEN_STATUSES, RequestStatus, StepStatus
from app.models.user import Role, UserInDB
from app.services.requests import inbox_filter, visibility_filter

router = APIRouter()

CYCLE_SAMPLE = 1000


@router.get("", response_model=Stats)
async def stats(user: UserInDB = Depends(get_current_user)):
    """Counts are scoped to what the caller can see (EMPLOYEE: own requests; others: all)."""
    db = get_database()
    scope = visibility_filter(user)

    by_status = {s.value: 0 for s in RequestStatus}
    async for row in db.requests.aggregate([{"$match": scope}, {"$group": {"_id": "$status", "n": {"$sum": 1}}}]):
        by_status[row["_id"]] = row["n"]

    my_open = await db.requests.count_documents(
        {"requester_id": user.id, "status": {"$in": [s.value for s in OPEN_STATUSES]}}
    )
    inbox = 0 if user.role == Role.EMPLOYEE else await db.requests.count_documents(inbox_filter(user))
    breached = await db.requests.count_documents(
        {
            **scope,
            "status": {"$in": [s.value for s in ACTIVE_STATUSES]},
            "steps": {"$elemMatch": {"status": StepStatus.PENDING.value, "breached": True}},
        }
    )
    dlq_pending = 0 if user.role == Role.EMPLOYEE else await db.dead_letters.count_documents({"status": "PENDING"})
    approved_last_7d = await db.requests.count_documents(
        {**scope, "status": RequestStatus.APPROVED.value, "completed_at": {"$gte": utcnow() - timedelta(days=7)}}
    )

    durations: list[float] = []
    cursor = (
        db.requests.find(
            {**scope, "status": {"$in": [RequestStatus.APPROVED.value, RequestStatus.REJECTED.value]},
             "completed_at": {"$ne": None}},
            {"created_at": 1, "completed_at": 1},
        )
        .sort("completed_at", -1)
        .limit(CYCLE_SAMPLE)
    )
    async for d in cursor:
        durations.append((ensure_utc(d["completed_at"]) - ensure_utc(d["created_at"])).total_seconds() / 3600)
    avg_cycle_hours = round(sum(durations) / len(durations), 4) if durations else None

    return Stats(
        by_status=by_status,
        my_open=my_open,
        inbox=inbox,
        breached=breached,
        dlq_pending=dlq_pending,
        approved_last_7d=approved_last_7d,
        avg_cycle_hours=avg_cycle_hours,
    )
