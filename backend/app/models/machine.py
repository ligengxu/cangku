from sqlalchemy import Column, Integer, String, Enum, TIMESTAMP, func
from app.database import Base


class Machine(Base):
    __tablename__ = "machines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    machine_number = Column(String(20), nullable=False, unique=True, comment="机器编号(纯数字)")
    name = Column(String(100), default="", comment="机器名称/备注")
    status = Column(Enum("online", "offline", "disabled"), default="online", comment="状态")
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
