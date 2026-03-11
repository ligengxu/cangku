from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, func
from app.database import Base


class ActionLog(Base):
    __tablename__ = "action_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    username = Column(String(255), nullable=False)
    action = Column(String(255), nullable=False)
    data_before = Column(Text, nullable=True)
    data_after = Column(Text, nullable=True)
    ip_address = Column(String(45), nullable=True)
    timestamp = Column(TIMESTAMP, server_default=func.now())
