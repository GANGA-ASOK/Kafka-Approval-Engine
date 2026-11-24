"""Workflow persistence helpers (lookup used by the engine and the preview endpoint)."""

from typing import Any

from app.core.db import get_database
from app.workflow.rules import DEFAULT_WORKFLOW_ID, Route, select_route


async def load_workflow_for(request_type: str) -> dict[str, Any] | None:
    """Active workflow for `request_type`, else the active default PURCHASE workflow, else None."""
    db = get_database()
    wf = await db.workflows.find_one(
        {"request_type": (request_type or "").upper(), "active": True}, sort=[("updated_at", -1)]
    )
    if wf is None:
        wf = await db.workflows.find_one({"_id": DEFAULT_WORKFLOW_ID, "active": True})
    return wf


async def preview_route(*, amount: float, department: str | None, request_type: str) -> Route:
    wf = await load_workflow_for(request_type)
    return select_route(wf, amount=amount, department=department, request_type=request_type)
