from sqlalchemy import Column, Integer, Date, Enum, Boolean, TIMESTAMP, String, func
from app.database import Base


class WorkerProduction(Base):
    __tablename__ = "worker_production"

    id = Column(Integer, primary_key=True, autoincrement=True)
    worker_id = Column(Integer, nullable=False)
    sku_id = Column(Integer, nullable=False)
    production_date = Column(Date, nullable=False)
    printed_quantity = Column(Integer, nullable=False)
    actual_packaging_quantity = Column(Integer, nullable=False)
    audit_status = Column(Enum("pending", "approved", "rejected"), default="pending")
    created_at = Column(TIMESTAMP, server_default=func.now())
    can_modify = Column(Boolean, default=True)
    audit_by = Column(Integer, nullable=True)
    audit_at = Column(TIMESTAMP, nullable=True)
    reject_reason = Column(String(500), nullable=True)
