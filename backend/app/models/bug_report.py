from sqlalchemy import Column, Integer, String, Text, Enum, DateTime, func
from app.database import Base


class BugReport(Base):
    __tablename__ = "bug_reports"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    page_url = Column(String(500), nullable=True)
    priority = Column(Enum("low", "medium", "high", "critical"), nullable=False, default="medium")
    status = Column(Enum("open", "fixing", "fixed", "closed", "wontfix"), nullable=False, default="open")
    submitted_by = Column(Integer, nullable=False)
    submitted_name = Column(String(255), nullable=True)
    fixed_by = Column(Integer, nullable=True)
    fixed_name = Column(String(255), nullable=True)
    fix_note = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    fixed_at = Column(DateTime, nullable=True)
