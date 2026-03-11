from sqlalchemy import Column, Integer, String, DECIMAL, DateTime, func
from app.database import Base


class FailureLog(Base):
    __tablename__ = "failure_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tickets_num = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    worker_id = Column(Integer, nullable=False)
    sku_id = Column(Integer, nullable=False)
    batch_id = Column(Integer, nullable=False)
    failure_reason = Column(String(255), nullable=False)
    failure_time = Column(DateTime, server_default=func.now())
    scanned_weight = Column(DECIMAL(10, 2), nullable=True)
