from sqlalchemy import Column, Integer, String, Enum
from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(255), unique=True, nullable=False)
    password = Column(String(255), nullable=False)
    role = Column(Enum("worker", "admin"), nullable=False)
    real_name = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    alipay_account = Column(String(255), nullable=True)
