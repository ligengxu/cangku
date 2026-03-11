from sqlalchemy import Column, Integer, String, Text, Date
from app.database import Base


class PrintRequest(Base):
    __tablename__ = "print_requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    batch_id = Column(Integer, nullable=False)
    supplier_name = Column(String(255), nullable=False)
    fruit_name = Column(String(255), nullable=False)
    purchase_date = Column(Date, nullable=False)
    username = Column(String(255), nullable=False)
    user_id = Column(Integer, nullable=False)
    sku_name = Column(String(255), nullable=False)
    sku_id = Column(Integer, nullable=False)
    sku_description = Column(Text, nullable=False)
    quantity = Column(Integer, nullable=False)
