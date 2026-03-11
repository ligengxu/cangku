from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, TIMESTAMP, func
from app.database import Base


class AdminNotice(Base):
    __tablename__ = "admin_notices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(String(200), nullable=True)
    content = Column(Text, nullable=False)
    type = Column(String(50), nullable=True)
    target_role = Column(String(20), nullable=True)
    created_by = Column(Integer, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
