from datetime import datetime

from fastapi import APIRouter, Depends, Query

from app.core.clock import ensure_utc
from app.core.rbac import get_current_user
from app.models.audit import AuditList
from app.models.user import UserInDB
from app.services.audit import build_audit_filter, query_audit

router = APIRouter()


@router.get("", response_model=AuditList)
async def list_audit(
    request_id: str | None = None,
    event_type: str | None = Query(default=None, description="Single type or comma-separated list"),
    actor_id: str | None = None,
    source: str | None = None,
    from_: datetime | None = Query(default=None, alias="from"),
    to: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    skip: int = Query(default=0, ge=0),
    user: UserInDB = Depends(get_current_user),
):
    """Newest first. EMPLOYEE users only see entries for their own requests."""
    q = build_audit_filter(
        user, request_id=request_id, event_type=event_type, actor_id=actor_id, source=source,
        from_=ensure_utc(from_), to=ensure_utc(to),
    )
    items, total = await query_audit(q, limit=limit, skip=skip)
    return AuditList(items=items, total=total)
