from sqlalchemy import Column, Integer, String, DECIMAL, TIMESTAMP, func
from app.database import Base


class WeightSetting(Base):
    __tablename__ = "weight_settings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    mode = Column(String(50), nullable=True)
    max_weight_difference = Column(DECIMAL(10, 2), nullable=False)
    max_weight_percentage = Column(DECIMAL(10, 2), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
