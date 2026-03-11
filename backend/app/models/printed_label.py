from sqlalchemy import Column, Integer, DECIMAL, Boolean, TIMESTAMP, DateTime, String, func, Computed
from app.database import Base


class PrintedLabel(Base):
    __tablename__ = "printed_labels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    u = Column(Integer, nullable=True, comment="工人id")
    b = Column(Integer, nullable=True, comment="水果批次ID")
    s = Column(Integer, nullable=True, comment="SKU ID")
    scanned_outbound = Column(Boolean, nullable=False, default=False, comment="是否已出库扫码")
    estimated_weight = Column(DECIMAL(10, 2), default=0)
    actual_weight = Column(DECIMAL(10, 2), default=0)
    weight_difference = Column(DECIMAL(10, 2), Computed("actual_weight - estimated_weight"), comment="重量差异")
    scanned_time = Column(DateTime, nullable=True)
    weight_abnormal = Column(Boolean, nullable=False, default=False, comment="重量异常标记")
    weight_fixed = Column(Boolean, nullable=False, default=False, comment="重量异常已修正（重新扫码通过）")
    weight_fixed_time = Column(DateTime, nullable=True, comment="修正时间")
    express_number = Column(String(50), nullable=True, comment="快递单号")
    express_carrier = Column(String(20), nullable=True, comment="快递公司")
