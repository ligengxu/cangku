from sqlalchemy import Column, Integer, Date, Enum, DateTime, func
from app.database import Base


class WorkerProductionEdit(Base):
    __tablename__ = "worker_production_edits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    original_id = Column(Integer, nullable=False)
    worker_id = Column(Integer, nullable=False)
    sku_id = Column(Integer, nullable=False)
    production_date = Column(Date, nullable=False)
    actual_packaging_quantity = Column(Integer, nullable=False)
    audit_status = Column(Enum("pending", "approved", "rejected"), default="pending")
    edit_date = Column(DateTime, server_default=func.now())
