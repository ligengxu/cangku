from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, func
from app.database import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    username = Column(String(50), nullable=True)
    action = Column(String(255), nullable=False)
    login_ip = Column(String(45), nullable=False)
    user_agent = Column(Text, nullable=True)
    timestamp = Column(TIMESTAMP, server_default=func.now())
