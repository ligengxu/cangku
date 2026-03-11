from sqlalchemy import Column, Integer, String, TIMESTAMP, func
from app.database import Base


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ip_address = Column(String(45), nullable=False)
    attempt_time = Column(TIMESTAMP, server_default=func.now())
    username = Column(String(255), nullable=True)
