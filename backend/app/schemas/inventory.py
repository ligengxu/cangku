from pydantic import BaseModel, field_validator
from decimal import Decimal
from datetime import datetime


class SkuCreate(BaseModel):
    fruit_id: int
    fruit_name: str
    sku_name: str
    sku_description: str | None = None
    fruit_weight: Decimal
    material_weight: Decimal
    production_performance: Decimal
    carton_box_id: int | None = None


class SkuUpdate(BaseModel):
    sku_name: str | None = None
    sku_description: str | None = None
    fruit_weight: Decimal | None = None
    material_weight: Decimal | None = None
    production_performance: Decimal | None = None
    carton_box_id: int | None = None


class SkuOut(BaseModel):
    id: int
    fruit_id: int
    fruit_name: str
    sku_name: str
    sku_description: str | None
    fruit_weight: Decimal
    material_weight: Decimal
    total_weight: Decimal
    production_performance: Decimal
    carton_box_id: int | None

    class Config:
        from_attributes = True


class CartonBoxCreate(BaseModel):
    box_type: str
    purchase_price: Decimal

    @field_validator("box_type")
    @classmethod
    def box_type_not_empty(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("纸箱类型不能为空")
        if len(s) > 64:
            raise ValueError("纸箱类型不超过 64 字符")
        return s


class CartonBoxUpdate(BaseModel):
    box_type: str | None = None
    purchase_price: Decimal | None = None

    @field_validator("box_type")
    @classmethod
    def box_type_not_empty(cls, v: str | None) -> str | None:
        if v is None:
            return v
        s = v.strip()
        if not s:
            raise ValueError("纸箱类型不能为空")
        if len(s) > 64:
            raise ValueError("纸箱类型不超过 64 字符")
        return s


class CartonBoxOut(BaseModel):
    id: int
    box_type: str
    purchase_price: Decimal
    stock_quantity: int
    low_stock_threshold: int = 50
    created_at: datetime | None

    class Config:
        from_attributes = True


class FruitCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("水果名称不能为空")
        if len(s) > 64:
            raise ValueError("水果名称不超过 64 字符")
        return s


class FruitUpdate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("水果名称不能为空")
        if len(s) > 64:
            raise ValueError("水果名称不超过 64 字符")
        return s


class FruitOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True


class SupplierCreate(BaseModel):
    name: str
    type: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("供应商名称不能为空")
        if len(s) > 128:
            raise ValueError("供应商名称不超过 128 字符")
        return s
    contact: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    alipay_account: str | None = None
    bank_card: str | None = None
    notes: str | None = None


class SupplierUpdate(BaseModel):
    name: str | None = None
    type: str | None = None
    contact: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    alipay_account: str | None = None
    bank_card: str | None = None
    notes: str | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is None:
            return v
        s = v.strip()
        if not s:
            raise ValueError("供应商名称不能为空")
        if len(s) > 128:
            raise ValueError("供应商名称不超过 128 字符")
        return s


class SupplierOut(BaseModel):
    id: int
    name: str
    type: str
    contact: str | None
    contact_person: str | None
    phone: str | None
    alipay_account: str | None
    bank_card: str | None
    notes: str | None
    created_at: datetime | None

    class Config:
        from_attributes = True
