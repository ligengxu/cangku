from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel
from app.database import get_db
from app.models.user import User
from app.models.worker_settlement import WorkerSettlement
from app.models.printed_label import PrintedLabel
from app.models.sku import Sku
from app.middleware.auth import require_admin
from app.utils.log_action import log_action
from app.services.finance_bridge import push_salary_sync
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/worker-settlements", tags=["工人结算"])


class SettlementAdjust(BaseModel):
    adjusted_amount: Decimal
    adjustment_reason: str | None = None


class SettlementSubmit(BaseModel):
    settlement_ids: list[int]


class SettlementCallbackRequest(BaseModel):
    source_settlement_id: int
    status: str
    api_key: str
    trade_no: str | None = None


@router.get("")
def list_settlements(
    month: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(WorkerSettlement)
    if month:
        q = q.filter(WorkerSettlement.settlement_month == month)
    if status:
        q = q.filter(WorkerSettlement.status == status)

    total = q.count()
    settlements = q.order_by(desc(WorkerSettlement.id)).offset((page - 1) * page_size).limit(page_size).all()

    worker_ids = list({s.worker_id for s in settlements})
    workers = {}
    if worker_ids:
        for w in db.query(User).filter(User.id.in_(worker_ids)).all():
            workers[w.id] = {"real_name": w.real_name, "phone": w.phone, "alipay_account": w.alipay_account}

    items = []
    for s in settlements:
        w = workers.get(s.worker_id, {})
        items.append({
            "id": s.id,
            "worker_id": s.worker_id,
            "worker_name": w.get("real_name", ""),
            "phone": w.get("phone", ""),
            "alipay_account": w.get("alipay_account", ""),
            "settlement_month": s.settlement_month,
            "system_amount": float(s.system_amount or 0),
            "adjusted_amount": float(s.adjusted_amount or 0),
            "adjustment_reason": s.adjustment_reason,
            "status": s.status,
            "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
            "paid_at": s.paid_at.isoformat() if s.paid_at else None,
            "finance_payment_id": s.finance_payment_id,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    return {"success": True, "data": items, "total": total, "page": page, "page_size": page_size}


@router.get("/summary")
def settlement_summary(
    month: str | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(WorkerSettlement)
    if month:
        q = q.filter(WorkerSettlement.settlement_month == month)

    total = q.count()
    total_system = float(q.with_entities(func.coalesce(func.sum(WorkerSettlement.system_amount), 0)).scalar() or 0)
    total_adjusted = float(q.with_entities(func.coalesce(func.sum(WorkerSettlement.adjusted_amount), 0)).scalar() or 0)

    by_status = {}
    for row in q.with_entities(
        WorkerSettlement.status,
        func.count(WorkerSettlement.id),
        func.coalesce(func.sum(WorkerSettlement.adjusted_amount), 0),
    ).group_by(WorkerSettlement.status).all():
        by_status[row[0]] = {"count": row[1], "amount": float(row[2])}

    months = [r[0] for r in db.query(WorkerSettlement.settlement_month).distinct().order_by(desc(WorkerSettlement.settlement_month)).limit(12).all()]

    return {
        "success": True,
        "data": {
            "total": total,
            "total_system_amount": total_system,
            "total_adjusted_amount": total_adjusted,
            "by_status": by_status,
            "available_months": months,
        },
    }


@router.post("/generate")
def generate_settlements(
    month: str = Query(..., description="结算月份 YYYY-MM"),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Generate settlement records for a given month based on system data (reference only)"""
    existing = db.query(WorkerSettlement).filter(WorkerSettlement.settlement_month == month).count()
    if existing > 0:
        raise HTTPException(status_code=409, detail=f"{month} 的结算单已生成，如需重新生成请先删除现有记录")

    try:
        year, m = month.split("-")
        month_start = date(int(year), int(m), 1)
        if int(m) == 12:
            month_end = date(int(year) + 1, 1, 1)
        else:
            month_end = date(int(year), int(m) + 1, 1)
    except Exception:
        raise HTTPException(status_code=400, detail="月份格式错误，请使用 YYYY-MM")

    workers = db.query(User).filter(User.role == "worker").all()
    if not workers:
        raise HTTPException(status_code=404, detail="没有找到活跃工人")

    created = 0
    for worker in workers:
        commission = db.query(
            func.coalesce(
                func.sum(PrintedLabel.scanned_outbound * Sku.production_performance), 0
            )
        ).join(
            Sku, PrintedLabel.s == Sku.id
        ).filter(
            PrintedLabel.u == worker.id,
            PrintedLabel.scanned_outbound > 0,
            func.date(PrintedLabel.created_at) >= month_start,
            func.date(PrintedLabel.created_at) < month_end,
        ).scalar() or 0

        system_amount = round(float(commission), 2)

        settlement = WorkerSettlement(
            worker_id=worker.id,
            settlement_month=month,
            system_amount=system_amount,
            adjusted_amount=system_amount,
            status="draft",
        )
        db.add(settlement)
        created += 1

    log_action(db, user, f"生成{month}工人结算单 {created} 条")
    db.commit()

    return {"success": True, "message": f"已生成 {created} 条结算记录", "data": {"created": created, "month": month}}


@router.put("/callback")
def settlement_callback(
    req: SettlementCallbackRequest,
    db: Session = Depends(get_db),
):
    """Finance system callback when salary payment is completed"""
    if req.api_key != "fruit-admin-bridge-2026":
        raise HTTPException(status_code=403, detail="Invalid API key")

    s = db.query(WorkerSettlement).filter(WorkerSettlement.id == req.source_settlement_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Settlement not found")

    if req.status == "paid":
        s.status = "paid"
        s.paid_at = datetime.now()
    elif req.status == "approved":
        s.status = "finance_approved"
    elif req.status == "rejected":
        s.status = "finance_rejected"

    db.commit()
    return {"success": True, "message": f"Settlement #{req.source_settlement_id} updated to {req.status}"}


@router.put("/{settlement_id}")
def update_settlement(
    settlement_id: int,
    req: SettlementAdjust,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(WorkerSettlement).filter(WorkerSettlement.id == settlement_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="结算记录不存在")
    if s.status not in ("draft", "finance_rejected"):
        raise HTTPException(status_code=400, detail="只有草稿或驳回状态的记录可以修改")

    s.adjusted_amount = req.adjusted_amount
    s.adjustment_reason = req.adjustment_reason
    if s.status == "finance_rejected":
        s.status = "draft"
    log_action(db, user, f"修改工人结算 #{settlement_id} 金额为 ¥{req.adjusted_amount}")
    db.commit()
    return {"success": True, "message": "修改成功"}


@router.post("/submit")
def submit_settlements(
    req: SettlementSubmit,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Submit settlements and push to finance system"""
    if not req.settlement_ids:
        raise HTTPException(status_code=400, detail="请选择要提交的结算记录")

    settlements = db.query(WorkerSettlement).filter(
        WorkerSettlement.id.in_(req.settlement_ids),
        WorkerSettlement.status.in_(["draft", "finance_rejected"]),
    ).all()

    if not settlements:
        raise HTTPException(status_code=400, detail="没有可提交的结算记录（只有草稿或驳回状态可提交）")

    worker_ids = [s.worker_id for s in settlements]
    workers = {w.id: w for w in db.query(User).filter(User.id.in_(worker_ids)).all()}

    now = datetime.now()
    submitted = 0
    push_results = []

    for s in settlements:
        worker = workers.get(s.worker_id)
        if not worker:
            continue

        s.status = "submitted"
        s.submitted_by = user.id
        s.submitted_at = now

        try:
            result = push_salary_sync(
                worker_name=worker.real_name or worker.username,
                amount=float(s.adjusted_amount or 0),
                settlement_month=s.settlement_month,
                settlement_id=s.id,
                alipay_account=worker.alipay_account,
            )
            if result.get("success"):
                s.finance_payment_id = result.get("salary_id")
                push_results.append({"id": s.id, "worker": worker.real_name, "status": "pushed"})
            else:
                push_results.append({"id": s.id, "worker": worker.real_name, "status": "push_failed", "error": result.get("message")})
        except Exception as e:
            logger.error(f"Push salary #{s.id} failed: {e}")
            push_results.append({"id": s.id, "worker": worker.real_name, "status": "push_failed", "error": str(e)})

        submitted += 1

    log_action(db, user, f"提交工人结算 {submitted} 条至财务系统")
    db.commit()

    return {"success": True, "message": f"已提交 {submitted} 条结算记录", "data": {"submitted": submitted, "results": push_results}}


@router.delete("/{settlement_id}")
def delete_settlement(
    settlement_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    s = db.query(WorkerSettlement).filter(WorkerSettlement.id == settlement_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="结算记录不存在")
    if s.status not in ("draft",):
        raise HTTPException(status_code=400, detail="只有草稿状态的记录可以删除")
    db.delete(s)
    log_action(db, user, f"删除工人结算 #{settlement_id}")
    db.commit()
    return {"success": True, "message": "删除成功"}


@router.delete("/batch/{month}")
def delete_month_settlements(
    month: str,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    count = db.query(WorkerSettlement).filter(
        WorkerSettlement.settlement_month == month,
        WorkerSettlement.status == "draft",
    ).delete(synchronize_session="fetch")
    non_draft = db.query(WorkerSettlement).filter(
        WorkerSettlement.settlement_month == month,
        WorkerSettlement.status != "draft",
    ).count()
    log_action(db, user, f"批量删除{month}草稿结算单 {count} 条")
    db.commit()
    msg = f"已删除 {count} 条草稿记录"
    if non_draft > 0:
        msg += f"（{non_draft} 条非草稿记录未删除）"
    return {"success": True, "message": msg}
