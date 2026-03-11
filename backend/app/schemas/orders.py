from pydantic import BaseModel
from datetime import date, datetime
from decimal import Decimal


class FruitPurchaseCreate(BaseModel):
    supplier_id: int | None = None
    fruit_id: int | None = None
    supplier_name: str | None = None
    fruit_name: str | None = None
    purchase_date: date
    purchase_price: Decimal
    purchase_weight: Decimal


class FruitPurchaseUpdate(BaseModel):
    purchase_date: date | None = None
    purchase_price: Decimal | None = None
    purchase_weight: Decimal | None = None
    payment_status: str | None = None


class FruitPurchaseOut(BaseModel):
    id: int
    supplier_id: int
    fruit_id: int
    supplier_name: str
    fruit_name: str
    purchase_date: date
    purchase_price: Decimal
    purchase_weight: Decimal
    payment_status: str | None = "unpaid"

    class Config:
        from_attributes = True


class MaterialPurchaseCreate(BaseModel):
    supplier_id: int
    supplier_name: str | None = None
    material_type: str | None = None
    material_name: str | None = None
    purchase_amount: Decimal | None = None
    purchase_date: date | None = None
    notes: str | None = None


class MaterialPurchaseOut(BaseModel):
    id: int
    supplier_id: int
    supplier_name: str | None
    material_type: str | None
    material_name: str | None
    purchase_amount: Decimal | None
    purchase_date: date | None
    status: str | None
    payment_status: str | None
    notes: str | None
    created_at: datetime | None

    class Config:
        from_attributes = True


class MaterialPurchaseUpdate(BaseModel):
    supplier_id: int | None = None
    supplier_name: str | None = None
    material_type: str | None = None
    material_name: str | None = None
    purchase_amount: Decimal | None = None
    purchase_date: date | None = None
    payment_status: str | None = None
    notes: str | None = None


class CartonPurchaseCreate(BaseModel):
    supplier_id: int
    carton_box_id: int
    purchase_price: Decimal
    purchase_quantity: int


class CartonPurchaseUpdate(BaseModel):
    supplier_id: int | None = None
    carton_box_id: int | None = None
    purchase_price: Decimal | None = None
    purchase_quantity: int | None = None
    payment_status: str | None = None


class CartonPurchaseOut(BaseModel):
    id: int
    supplier_id: int
    carton_box_id: int
    purchase_price: Decimal
    purchase_quantity: int
    status: str | None
    payment_status: str | None
    created_at: datetime | None
    supplier_name: str | None = None
    box_type: str | None = None
    stock_quantity: int | None = None

    class Config:
        from_attributes = True


class PaymentStatusUpdate(BaseModel):
    order_type: str
    order_ids: list[int]
    payment_status: str
    password: str | None = None
