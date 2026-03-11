from pydantic import BaseModel, field_validator
from datetime import date, datetime
from decimal import Decimal


class BatchAssignmentCreate(BaseModel):
    purchase_id: int
    worker_ids: list[int]
    assignment_date: date | None = None


class BatchAssignmentOut(BaseModel):
    id: int
    purchase_id: int
    worker_id: int
    assignment_date: date | None

    class Config:
        from_attributes = True


class SkuTransactionCreate(BaseModel):
    fruit_purchase_id: int
    sku_id: int
    quantity: int
    fruit_name: str | None = None


class SkuTransactionOut(BaseModel):
    id: int
    fruit_purchase_id: int
    sku_id: int
    worker_id: int
    worker_name: str
    sku_name: str
    sku_description: str | None
    fruit_name: str
    quantity: int
    transaction_date: datetime | None
    is_printed: bool

    class Config:
        from_attributes = True


class ProductionAuditAction(BaseModel):
    id: int
    action: str  # approved / rejected
    note: str | None = None
    adjusted_quantity: int | None = None
    reject_reason: str | None = None


class BatchAuditAction(BaseModel):
    ids: list[int]
    action: str  # approved / rejected
    note: str | None = None
    reject_reason: str | None = None


class CheckChangesAction(BaseModel):
    production_ids: list[int]


class PrintLabelAction(BaseModel):
    transaction_id: int


class ReprintLabelAction(BaseModel):
    label_id: int | None = None
    sku_id: int | None = None
    worker_id: int | None = None
    quantity: int = 1
    reason: str = ""


class PrintWithLabelsAction(BaseModel):
    transaction_ids: list[int]


class BatchLookupAction(BaseModel):
    barcodes: list[str]


class BatchEditAuditAction(BaseModel):
    ids: list[int]
    action: str  # approved / rejected


class WorkerProductionCreate(BaseModel):
    sku_id: int
    production_date: date
    actual_packaging_quantity: int


class BatchWorkerInputAction(BaseModel):
    items: list[WorkerProductionCreate]


class WorkerProductionOut(BaseModel):
    id: int
    worker_id: int
    sku_id: int
    production_date: date
    printed_quantity: int
    actual_packaging_quantity: int
    audit_status: str | None
    created_at: datetime | None
    worker_name: str | None = None
    sku_name: str | None = None

    class Config:
        from_attributes = True
