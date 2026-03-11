from sqlalchemy import Column, Integer, DECIMAL, String, DateTime, func
from app.database import Base


class ManualOutboundLog(Base):
    __tablename__ = "manual_outbound_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticket_id = Column(Integer, nullable=False)
    operator_id = Column(Integer, nullable=False)
    operation_time = Column(DateTime, server_default=func.now())
    estimated_weight = Column(DECIMAL(10, 2), nullable=True)
    actual_weight = Column(DECIMAL(10, 2), nullable=True)
    notes = Column(String(500), nullable=True)
