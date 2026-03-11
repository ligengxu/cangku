from pydantic import BaseModel
from datetime import date, time, datetime
from decimal import Decimal


class WorkerCreate(BaseModel):
    username: str
    real_name: str | None = None
    phone: str | None = None
    alipay_account: str | None = None
    password: str = "123456"


class WorkerUpdate(BaseModel):
    real_name: str | None = None
    phone: str | None = None
    alipay_account: str | None = None


class WorkerOut(BaseModel):
    id: int
    username: str
    role: str
    real_name: str | None
    phone: str | None
    alipay_account: str | None

    class Config:
        from_attributes = True


class AttendanceRecord(BaseModel):
    id: int
    worker_id: int
    work_date: date
    clock_in: time | None
    clock_out: time | None
    work_hours: Decimal | None
    status: str | None
    note: str | None

    class Config:
        from_attributes = True


class AttendanceCreate(BaseModel):
    worker_id: int
    work_date: date
    clock_in: time | None = None
    clock_out: time | None = None
    status: str = "present"
    note: str | None = None


class LeaveCreate(BaseModel):
    leave_date: date
    leave_type: str | None = None
    reason: str | None = None


class LeaveOut(BaseModel):
    id: int
    worker_id: int
    leave_date: date
    leave_type: str | None
    reason: str | None
    status: str | None
    created_at: datetime | None
    reviewed_by: int | None
    reviewed_at: datetime | None
    review_note: str | None

    class Config:
        from_attributes = True


class LeaveReview(BaseModel):
    id: int
    decision: str  # approved / rejected
    note: str | None = None
