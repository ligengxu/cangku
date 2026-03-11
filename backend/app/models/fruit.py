from sqlalchemy import Column, Integer, String, TIMESTAMP, func
from app.database import Base


class Fruit(Base):
    __tablename__ = "fruits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
