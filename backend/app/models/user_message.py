from sqlalchemy import Column, Integer, String, Text, Boolean, TIMESTAMP, func
from app.database import Base


class UserMessage(Base):
    __tablename__ = "user_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)
    msg_type = Column(String(50), nullable=False, default="system")
    is_read = Column(Boolean, default=False, index=True)
    link = Column(String(255), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
