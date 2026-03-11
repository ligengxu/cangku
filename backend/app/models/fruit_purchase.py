from sqlalchemy import Column, Integer, String, Date, DECIMAL, Enum, TIMESTAMP, Index
from app.database import Base


class FruitPurchase(Base):
    __tablename__ = "fruit_purchases"

    id = Column(Integer, primary_key=True, autoincrement=True)
    supplier_id = Column(Integer, nullable=False, index=True)
    fruit_id = Column(Integer, nullable=False, index=True)
    supplier_name = Column(String(255), nullable=False)
    fruit_name = Column(String(255), nullable=False)
    purchase_date = Column(Date, nullable=False, index=True)
    purchase_price = Column(DECIMAL(10, 2), nullable=False)
    purchase_weight = Column(DECIMAL(10, 2), nullable=False)
    payment_status = Column(Enum("unpaid", "paid"), default="unpaid", index=True)
    deleted_at = Column(TIMESTAMP, nullable=True, default=None, index=True)

    __table_args__ = (
        Index('idx_fp_deleted_date', 'deleted_at', 'purchase_date'),
        Index('idx_fp_deleted_payment', 'deleted_at', 'payment_status'),
    )
