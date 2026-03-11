from sqlalchemy import Column, Integer, Date
from app.database import Base


class BatchAssignment(Base):
    __tablename__ = "batch_assignments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    purchase_id = Column(Integer, nullable=False)
    worker_id = Column(Integer, nullable=False)
    assignment_date = Column(Date, nullable=True)
