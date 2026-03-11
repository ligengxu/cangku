from sqlalchemy import Column, Integer, String, Numeric, DateTime, Text, ForeignKey, Enum
from sqlalchemy.sql import func
from app.database import Base


class WorkerSettlement(Base):
    __tablename__ = "worker_settlements"

    id = Column(Integer, primary_key=True, autoincrement=True)
    worker_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    settlement_month = Column(String(7), nullable=False, index=True, comment="结算月份 YYYY-MM")
    system_amount = Column(Numeric(10, 2), default=0, comment="系统计算金额（参考）")
    adjusted_amount = Column(Numeric(10, 2), default=0, comment="库管核算后金额")
    adjustment_reason = Column(Text, nullable=True, comment="调整原因")
    status = Column(
        Enum("draft", "submitted", "finance_approved", "finance_rejected", "paid", name="settlement_status"),
        default="draft",
        nullable=False,
        comment="draft=草稿 submitted=已提交 finance_approved=财务审核通过 finance_rejected=财务驳回 paid=已付款",
    )
    submitted_by = Column(Integer, nullable=True, comment="提交人ID")
    submitted_at = Column(DateTime, nullable=True, comment="提交时间")
    finance_payment_id = Column(Integer, nullable=True, comment="财务系统 salary_payments.id")
    paid_at = Column(DateTime, nullable=True, comment="付款时间")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
