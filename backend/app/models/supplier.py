from sqlalchemy import Column, Integer, String, Enum, Text, TIMESTAMP, func
from app.database import Base


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    type = Column(Enum("fruit", "box", "material", "tape", "net", "filling", "printing", "fruit_supplier", "carton_supplier", "material_supplier"), nullable=False)
    contact = Column(String(255), nullable=True, default="")
    contact_person = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    alipay_account = Column(String(255), nullable=True)
    bank_card = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(TIMESTAMP, nullable=True, default=None)
