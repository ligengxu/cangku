from sqlalchemy import Column, Integer, String, Float, Boolean, Text, DateTime, DECIMAL
from app.database import Base


class UploadRecord(Base):
    __tablename__ = "upload_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tickets_num = Column(String(255), nullable=True)
    weight = Column(Float, nullable=True)
    is_success = Column(Boolean, nullable=True)
    message = Column(Text, nullable=True)
    upload_time = Column(DateTime, nullable=True)
    weight_difference = Column(DECIMAL(10, 2), nullable=True)
    worker_name = Column(String(255), nullable=True)
    machine_number = Column(String(50), nullable=True)
    express_number = Column(String(50), nullable=True, comment="快递单号")
    express_carrier = Column(String(20), nullable=True, comment="快递公司")
    client_version = Column(String(20), nullable=True, comment="客户端版本号")
    decode_info = Column(Text, nullable=True, comment="解码详情JSON")
