from sqlalchemy import Column, Integer, Date, String, Enum, TIMESTAMP, func
from app.database import Base


class ModificationRequest(Base):
    __tablename__ = "modification_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    worker_production_id = Column(Integer, nullable=False)
    worker_id = Column(Integer, nullable=False)
    sku_id = Column(Integer, nullable=False)
    production_date = Column(Date, nullable=False)
    requested_quantity = Column(Integer, nullable=False)
    request_reason = Column(String(255), nullable=True)
    status = Column(Enum("pending", "approved", "rejected"), default="pending")
    created_at = Column(TIMESTAMP, server_default=func.now())
