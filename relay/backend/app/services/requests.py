"""Request-related query helpers shared by the requests, stats and audit routers."""

import re
import uuid
from typing import Any

from fastapi import HTTPException, status

from app.core.db import get_database
from app.models.request import ACTIVE_STATUSES
from app.models.user import Role, UserInDB


def new_request_id() -> str:
    return f"REQ-{uuid.uuid4().hex[:8].upper()}"


def inbox_filter(user: UserInDB) -> dict[str, Any]:
    """Active requests whose current step is assigned to the user's role (ADMIN: all active).
    Own requests are excluded for everyone since self-approval is forbidden."""
    q: dict[str, Any] = {
        "status": {"$in": [s.value for s in ACTIVE_STATUSES]},
        "requester_id": {"$ne": user.id},
    }
    if user.role != Role.ADMIN:
        q["current_approver_role"] = user.role.value
    return q


def visibility_filter(user: UserInDB) -> dict[str, Any]:
    """EMPLOYEE sees own requests; approver roles see all."""
    return {"requester_id": user.id} if user.role == Role.EMPLOYEE else {}


def text_filter(q: str | None) -> dict[str, Any]:
    if not q:
        return {}
    rx = {"$regex": re.escape(q.strip()), "$options": "i"}
    return {"$or": [{"title": rx}, {"description": rx}, {"_id": rx}, {"requester_name": rx}, {"department": rx}]}


async def get_visible_request(request_id: str, user: UserInDB) -> dict[str, Any]:
    doc = await get_database().requests.find_one({"_id": request_id})
    if doc is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Request not found")
    if user.role == Role.EMPLOYEE and doc["requester_id"] != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only view your own requests")
    return doc
