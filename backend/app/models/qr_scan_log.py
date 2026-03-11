from sqlalchemy import Column, Integer, String, Text, TIMESTAMP, func
from app.database import Base


class QrScanLog(Base):
    __tablename__ = "qr_scan_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=True)
    username = Column(String(255), nullable=True)
    role = Column(String(20), nullable=True)
    qr_data = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
