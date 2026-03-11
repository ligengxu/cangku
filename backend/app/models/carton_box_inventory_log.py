from sqlalchemy import Column, Integer, String, TIMESTAMP, func
from app.database import Base


class CartonBoxInventoryLog(Base):
    __tablename__ = "carton_box_inventory_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    carton_box_id = Column(Integer, nullable=False)
    original_stock = Column(Integer, nullable=False)
    change_quantity = Column(Integer, nullable=False)
    reason = Column(String(255), nullable=False)
    changed_at = Column(TIMESTAMP, server_default=func.now())
