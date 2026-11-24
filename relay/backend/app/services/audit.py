"""Audit-log queries (dashboard + per-request timeline)."""

from datetime import datetime
from typing import Any

from app.core.db import get_database
from app.models.audit import AuditEntry
from app.models.user import Role, UserInDB


def _ts(dt: datetime) -> int:
    return int(dt.timestamp() * 1_000_000)


def build_audit_filter(
    user: UserInDB,
    *,
    request_id: str | None = None,
    event_type: str | None = None,
    actor_id: str | None = None,
    source: str | None = None,
    from_: datetime | None = None,
    to: datetime | None = None,
) -> dict[str, Any]:
    q: dict[str, Any] = {}
    if user.role == Role.EMPLOYEE:
        q["requester_id"] = user.id  # employees only see entries for their own requests
    if request_id:
        q["request_id"] = request_id
    if event_type:
        types = [t.strip().upper() for t in event_type.split(",") if t.strip()]
        q["event_type"] = types[0] if len(types) == 1 else {"$in": types}
    if actor_id:
        q["actor_id"] = actor_id
    if source:
        q["source"] = source
    if from_ or to:
        rng: dict[str, Any] = {}
        if from_:
            rng["$gte"] = _ts(from_)
        if to:
            rng["$lte"] = _ts(to)
        q["occurred_ts"] = rng
    return q


async def query_audit(q: dict[str, Any], *, limit: int, skip: int, ascending: bool = False) -> tuple[list[AuditEntry], int]:
    db = get_database()
    direction = 1 if ascending else -1
    cursor = db.audit_logs.find(q).sort([("occurred_ts", direction), ("recorded_at", direction)]).skip(skip)
    if limit:
        cursor = cursor.limit(limit)
    items = [AuditEntry.from_db(d) async for d in cursor]
    total = await db.audit_logs.count_documents(q)
    return items, total


async def request_timeline(request_id: str) -> list[AuditEntry]:
    items, _ = await query_audit({"request_id": request_id}, limit=0, skip=0, ascending=True)
    return items
