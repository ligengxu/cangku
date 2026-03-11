from sqlalchemy import Column, Integer, String, DECIMAL, TIMESTAMP, func
from app.database import Base


class CartonBox(Base):
    __tablename__ = "carton_boxes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    box_type = Column(String(255), nullable=False)
    purchase_price = Column(DECIMAL(10, 2), nullable=False)
    stock_quantity = Column(Integer, nullable=False, default=0)
    low_stock_threshold = Column(Integer, nullable=False, default=50)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
