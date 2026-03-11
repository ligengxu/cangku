from sqlalchemy import Column, Integer, String, Text, Boolean, TIMESTAMP, func
from app.database import Base


class SkuTransaction(Base):
    __tablename__ = "sku_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fruit_purchase_id = Column(Integer, nullable=False)
    sku_id = Column(Integer, nullable=False)
    worker_id = Column(Integer, nullable=False)
    worker_name = Column(String(255), nullable=False)
    sku_name = Column(String(255), nullable=False)
    sku_description = Column(Text, nullable=False)
    fruit_name = Column(String(255), nullable=False)
    quantity = Column(Integer, nullable=False)
    transaction_date = Column(TIMESTAMP, server_default=func.now())
    is_printed = Column(Boolean, nullable=False, default=False)
