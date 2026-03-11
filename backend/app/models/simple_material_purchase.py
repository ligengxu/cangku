from sqlalchemy import Column, Integer, String, DECIMAL, Enum, Text, Date, TIMESTAMP, Index, func
from app.database import Base


class SimpleMaterialPurchase(Base):
    __tablename__ = "simple_material_purchases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    supplier_id = Column(Integer, nullable=False, index=True)
    supplier_name = Column(String(255), nullable=True)
    material_type = Column(String(100), nullable=True, index=True)
    material_name = Column(String(255), nullable=True)
    purchase_amount = Column(DECIMAL(10, 2), nullable=True)
    purchase_date = Column(Date, nullable=True, index=True)
    status = Column(Enum("pending", "approved"), default="pending")
    payment_status = Column(Enum("unpaid", "paid"), default="unpaid", index=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(TIMESTAMP, nullable=True, default=None, index=True)

    __table_args__ = (
        Index('idx_smp_deleted_date', 'deleted_at', 'purchase_date'),
        Index('idx_smp_deleted_payment', 'deleted_at', 'payment_status'),
    )
