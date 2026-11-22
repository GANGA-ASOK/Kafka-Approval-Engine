import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.core.clock import utcnow
from app.core.db import get_database
from app.core.rbac import get_current_user, require_admin
from app.models.user import UserInDB
from app.models.workflow import RoutePreview, StepDefinition, WorkflowCreate, WorkflowResponse, WorkflowUpdate
from app.services.workflows import preview_route
from app.workflow.rules import DEFAULT_WORKFLOW_ID

router = APIRouter()


def _out(doc: dict) -> WorkflowResponse:
    return WorkflowResponse.model_validate({**doc, "id": doc["_id"]})


async def _ensure_single_active(request_type: str, exclude_id: str | None) -> None:
    q: dict = {"request_type": request_type, "active": True}
    if exclude_id:
        q["_id"] = {"$ne": exclude_id}
    other = await get_database().workflows.find_one(q, {"_id": 1})
    if other:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Workflow {other['_id']} is already active for request_type {request_type}; deactivate it first",
        )


@router.get("", response_model=list[WorkflowResponse])
async def list_workflows(_: UserInDB = Depends(get_current_user)):
    cursor = get_database().workflows.find({}).sort([("request_type", 1), ("name", 1)])
    return [_out(d) async for d in cursor]


@router.get("/preview", response_model=RoutePreview)
async def preview(
    amount: float = Query(ge=0),
    department: str | None = None,
    request_type: str = "PURCHASE",
    _: UserInDB = Depends(get_current_user),
):
    route = await preview_route(amount=amount, department=department, request_type=request_type.upper())
    return RoutePreview(
        workflow_id=route.workflow_id,
        rule_name=route.rule_name,
        steps=[StepDefinition(**s) for s in route.steps],
    )


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(workflow_id: str, _: UserInDB = Depends(get_current_user)):
    doc = await get_database().workflows.find_one({"_id": workflow_id})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return _out(doc)


@router.post("", response_model=WorkflowResponse, status_code=status.HTTP_201_CREATED)
async def create_workflow(body: WorkflowCreate, _: UserInDB = Depends(require_admin)):
    if body.active:
        await _ensure_single_active(body.request_type, None)
    now = utcnow()
    doc = {
        "_id": body.id or f"WF-{uuid.uuid4().hex[:8].upper()}",
        **body.model_dump(mode="json", exclude={"id"}),
        "version": 1,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await get_database().workflows.insert_one(doc)
    except DuplicateKeyError:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workflow id already exists") from None
    return _out(doc)


@router.put("/{workflow_id}", response_model=WorkflowResponse)
async def update_workflow(workflow_id: str, body: WorkflowUpdate, _: UserInDB = Depends(require_admin)):
    db = get_database()
    current = await db.workflows.find_one({"_id": workflow_id})
    if not current:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    changes = body.model_dump(mode="json", exclude_unset=True, exclude_none=True)
    if not changes:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="No fields to update")
    request_type = changes.get("request_type", current["request_type"])
    if changes.get("active", current.get("active", True)):
        await _ensure_single_active(request_type, workflow_id)
    # Version bump; requests already routed keep their snapshotted step plan.
    doc = await db.workflows.find_one_and_update(
        {"_id": workflow_id},
        {"$set": {**changes, "updated_at": utcnow()}, "$inc": {"version": 1}},
        return_document=ReturnDocument.AFTER,
    )
    return _out(doc)


@router.delete("/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workflow(workflow_id: str, _: UserInDB = Depends(require_admin)):
    if workflow_id == DEFAULT_WORKFLOW_ID:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The default workflow cannot be deleted (it is the routing fallback); edit or deactivate it instead",
        )
    res = await get_database().workflows.delete_one({"_id": workflow_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
