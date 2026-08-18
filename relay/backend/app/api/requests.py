from fastapi import APIRouter, Depends, HTTPException
from typing import List
from datetime import datetime
from app.models.request import RequestCreate, RequestResponse, RequestStatus
from app.models.user import UserInDB
from app.api.auth import get_current_user
from app.core.db import get_database
import uuid

router = APIRouter()

@router.post("", response_model=RequestResponse)
async def create_request(req_in: RequestCreate, current_user: UserInDB = Depends(get_current_user)):
    db = get_database()
    req_id = f"REQ-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.utcnow()
    
    req_dict = {
        "_id": req_id,
        "request_type": req_in.request_type,
        "title": req_in.title,
        "description": req_in.description,
        "amount": req_in.amount,
        "currency": req_in.currency,
        "requester_id": current_user.id,
        "department": req_in.department,
        "status": RequestStatus.PENDING_APPROVAL.value,
        "current_step": 1,
        "current_approver_id": None,
        "created_at": now,
        "updated_at": now
    }
    
    await db.requests.insert_one(req_dict)
    
    # In Phase 3, this is where we will publish REQUEST_CREATED event to Kafka
    
    return RequestResponse(id=req_id, **req_dict)

@router.get("", response_model=List[RequestResponse])
async def get_requests(current_user: UserInDB = Depends(get_current_user)):
    db = get_database()
    cursor = db.requests.find({"requester_id": current_user.id})
    requests = await cursor.to_list(length=100)
    
    res = []
    for req in requests:
        res.append(RequestResponse(id=req["_id"], **req))
    return res

@router.get("/{request_id}", response_model=RequestResponse)
async def get_request(request_id: str, current_user: UserInDB = Depends(get_current_user)):
    db = get_database()
    req = await db.requests.find_one({"_id": request_id})
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
        
    # basic authorization
    if req["requester_id"] != current_user.id and current_user.role.value not in ["ADMIN", "MANAGER", "FINANCE", "DIRECTOR"]:
        raise HTTPException(status_code=403, detail="Forbidden")
        
    return RequestResponse(id=req["_id"], **req)
