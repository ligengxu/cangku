from sqlalchemy import Column, Integer, Date, String, Enum, Text, TIMESTAMP, func
from app.database import Base


class WorkerLeave(Base):
    __tablename__ = "worker_leaves"

    id = Column(Integer, primary_key=True, autoincrement=True)
    worker_id = Column(Integer, nullable=False)
    leave_date = Column(Date, nullable=False)
    leave_type = Column(String(50), nullable=True)
    reason = Column(Text, nullable=True)
    status = Column(Enum("pending", "approved", "rejected"), default="pending")
    created_at = Column(TIMESTAMP, server_default=func.now())
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(TIMESTAMP, nullable=True)
    review_note = Column(Text, nullable=True)
