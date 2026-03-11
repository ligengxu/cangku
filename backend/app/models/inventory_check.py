from sqlalchemy import Column, Integer, Date, String, Text, TIMESTAMP, Index, func
from app.database import Base


class InventoryCheck(Base):
    __tablename__ = "inventory_checks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    check_date = Column(Date, nullable=False, index=True)
    check_user_id = Column(Integer, nullable=True)
    check_note = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="draft", index=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class InventoryCheckDetail(Base):
    __tablename__ = "inventory_check_details"

    id = Column(Integer, primary_key=True, autoincrement=True)
    check_id = Column(Integer, nullable=False, index=True)
    carton_box_id = Column(Integer, nullable=False, index=True)
    system_quantity = Column(Integer, nullable=True)
    actual_quantity = Column(Integer, nullable=True)
    difference = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
