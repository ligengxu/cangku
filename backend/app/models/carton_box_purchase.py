from sqlalchemy import Column, Integer, DECIMAL, Enum, TIMESTAMP, Index, func
from app.database import Base


class CartonBoxPurchase(Base):
    __tablename__ = "carton_box_purchases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    supplier_id = Column(Integer, nullable=False, index=True)
    carton_box_id = Column(Integer, nullable=False, index=True)
    purchase_price = Column(DECIMAL(10, 2), nullable=False)
    purchase_quantity = Column(Integer, nullable=False)
    status = Column(Enum("pending", "approved"), default="pending")
    payment_status = Column(Enum("unpaid", "paid"), default="unpaid", index=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(TIMESTAMP, nullable=True, default=None, index=True)

    __table_args__ = (
        Index('idx_cbp_deleted_payment', 'deleted_at', 'payment_status'),
    )
