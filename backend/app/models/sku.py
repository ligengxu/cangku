from sqlalchemy import Column, Integer, String, Text, DECIMAL
from app.database import Base


class Sku(Base):
    __tablename__ = "sku"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fruit_id = Column(Integer, nullable=False)
    fruit_name = Column(String(255), nullable=False)
    sku_name = Column(String(255), nullable=False)
    sku_description = Column(Text, nullable=True)
    fruit_weight = Column(DECIMAL(10, 2), nullable=False)
    material_weight = Column(DECIMAL(10, 2), nullable=False)
    total_weight = Column(DECIMAL(10, 2), nullable=False)
    production_performance = Column(DECIMAL(10, 1), nullable=False)
    carton_box_id = Column(Integer, nullable=True)
