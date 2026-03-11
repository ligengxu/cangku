from sqlalchemy import Column, Integer, Date, Time, DECIMAL, String, Enum
from app.database import Base


class WorkerAttendance(Base):
    __tablename__ = "worker_attendance"

    id = Column(Integer, primary_key=True, autoincrement=True)
    worker_id = Column(Integer, nullable=False)
    work_date = Column(Date, nullable=False)
    clock_in = Column(Time, nullable=True)
    clock_out = Column(Time, nullable=True)
    work_hours = Column(DECIMAL(5, 2), nullable=True)
    status = Column(Enum("present", "absent", "late", "leave", "half_day"), default="present")
    note = Column(String(500), nullable=True)
