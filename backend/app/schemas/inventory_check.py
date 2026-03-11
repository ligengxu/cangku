from pydantic import BaseModel, field_validator
from datetime import date, datetime


class InventoryCheckDetailCreate(BaseModel):
    carton_box_id: int
    actual_quantity: int


class InventoryCheckCreate(BaseModel):
    check_date: date
    check_note: str | None = None
    details: list[InventoryCheckDetailCreate]

    @field_validator("check_note")
    @classmethod
    def note_length(cls, v: str | None) -> str | None:
        if v and len(v.strip()) > 500:
            raise ValueError("备注不超过 500 字符")
        return v.strip() if v else v


class InventoryCheckDetailOut(BaseModel):
    id: int
    check_id: int
    carton_box_id: int
    box_type: str | None = None
    system_quantity: int | None
    actual_quantity: int | None
    difference: int | None
    created_at: datetime | None

    class Config:
        from_attributes = True


class InventoryCheckOut(BaseModel):
    id: int
    check_date: datetime | date
    check_user_id: int | None
    check_user_name: str | None = None
    check_note: str | None
    status: str
    detail_count: int = 0
    total_difference: int = 0
    created_at: datetime | None
    updated_at: datetime | None

    @field_validator("check_date", mode="before")
    @classmethod
    def coerce_check_date(cls, v: object) -> object:
        if isinstance(v, datetime):
            return v.date()
        return v

    class Config:
        from_attributes = True


class InventoryCheckFullOut(InventoryCheckOut):
    details: list[InventoryCheckDetailOut] = []
