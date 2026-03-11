from pydantic import BaseModel
from datetime import datetime


class NoticeCreate(BaseModel):
    title: str | None = None
    content: str
    type: str | None = None
    target_role: str | None = None
    expires_hours: int | None = None


class NoticeOut(BaseModel):
    id: int
    title: str | None = None
    content: str
    type: str | None
    target_role: str | None
    is_active: bool | None
    created_by: int | None = None
    created_at: datetime | None
    expires_at: datetime | None

    class Config:
        from_attributes = True


class ActionLogOut(BaseModel):
    id: int
    user_id: int
    username: str
    action: str
    data_before: str | None
    data_after: str | None
    ip_address: str | None
    timestamp: datetime | None

    class Config:
        from_attributes = True


class SearchResult(BaseModel):
    type: str
    id: int
    label: str
    description: str | None = None
