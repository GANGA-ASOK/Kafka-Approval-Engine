from pydantic import BaseModel, Field
from typing import Optional
from enum import Enum
from datetime import datetime

class RequestStatus(str, Enum):
    DRAFT = "DRAFT"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    ESCALATED = "ESCALATED"
    CANCELLED = "CANCELLED"
    COMPLETED = "COMPLETED"

class RequestCreate(BaseModel):
    title: str
    description: str
    amount: float
    currency: str = "INR"
    department: str
    request_type: str = "PURCHASE"

class RequestInDB(BaseModel):
    id: str = Field(alias="_id")
    request_type: str
    title: str
    description: str
    amount: float
    currency: str
    requester_id: str
    department: str
    status: RequestStatus
    current_step: int
    current_approver_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class RequestResponse(BaseModel):
    id: str
    request_type: str
    title: str
    description: str
    amount: float
    currency: str
    requester_id: str
    department: str
    status: RequestStatus
    current_step: int
    current_approver_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
