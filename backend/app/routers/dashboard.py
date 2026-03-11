from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, case
from datetime import date, timedelta
from decimal import Decimal
from app.database import get_db
from app.models import (
    FruitPurchase, BatchAssignment, SkuTransaction, PrintedLabel,
    WorkerProduction, WorkerProductionEdit, User, ActivityLog,
    CartonBoxPurchase, SimpleMaterialPurchase, AdminNotice, Sku,
    CartonBox,
)
from app.middleware.auth import get_current_user
from app.schemas.common import ApiResponse
from app.utils.cache import cache_get, cache_set

router = APIRouter(prefix="/dashboard", tags=["仪表盘"])


@router.get("/stats")
def get_dashboard_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cache_key = f"dashboard:stats:{user.role}:{user.id}:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    today = date.today()

    if user.role == "admin":
        purchases = db.query(func.count(FruitPurchase.id)).filter(
            FruitPurchase.purchase_date == today
        ).scalar() or 0

        assignments = db.query(func.count(BatchAssignment.id)).filter(
            BatchAssignment.assignment_date == today
        ).scalar() or 0

        pending_print = db.query(func.count(SkuTransaction.id)).filter(
            SkuTransaction.is_printed == False
        ).scalar() or 0

        pending_audit = db.query(func.count(WorkerProduction.id)).filter(
            WorkerProduction.audit_status == "pending"
        ).scalar() or 0

        active_workers = db.query(func.count(User.id)).filter(
            User.role == "worker"
        ).scalar() or 0

        today_outbound = db.query(func.count(PrintedLabel.id)).filter(
            and_(PrintedLabel.scanned_outbound > 0, func.date(PrintedLabel.scanned_time) == today)
        ).scalar() or 0

        today_printed = db.query(func.count(PrintedLabel.id)).filter(
            func.date(PrintedLabel.created_at) == today
        ).scalar() or 0

        data = {
            "purchases": purchases,
            "assignments": assignments,
            "pending_print": pending_print,
            "pending_audit": pending_audit,
            "active_workers": active_workers,
            "today_outbound": today_outbound,
            "today_printed": today_printed,
            "date": str(today),
        }
    else:
        printed = db.query(func.count(PrintedLabel.id)).filter(
            and_(PrintedLabel.u == user.id, func.date(PrintedLabel.created_at) == today)
        ).scalar() or 0

        recorded = db.query(func.count(WorkerProduction.id)).filter(
            and_(WorkerProduction.worker_id == user.id, WorkerProduction.production_date == today)
        ).scalar() or 0

        data = {
            "printed": printed,
            "recorded": recorded,
            "date": str(today),
        }

    cache_set(cache_key, data, ttl=30)
    return ApiResponse(data=data)


@router.get("/today-stats")
def get_today_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    cache_key = f"dashboard:today:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    printed_qty = db.query(func.count(PrintedLabel.id)).filter(
        func.date(PrintedLabel.created_at) == today
    ).scalar() or 0

    produced_qty = db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(
        WorkerProduction.production_date == today
    ).scalar() or 0

    pending_qty = db.query(func.count(SkuTransaction.id)).filter(
        SkuTransaction.is_printed == False
    ).scalar() or 0

    worker_count = db.query(func.count(func.distinct(WorkerProduction.worker_id))).filter(
        WorkerProduction.production_date == today
    ).scalar() or 0

    data = {
        "printed_qty": printed_qty,
        "produced_qty": int(produced_qty),
        "pending_qty": pending_qty,
        "worker_count": worker_count,
        "date": str(today),
    }
    cache_set(cache_key, data, ttl=30)
    return ApiResponse(data=data)


@router.get("/trends")
def get_dashboard_trends(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Daily production, purchases, and outbound counts for the last 7 days."""
    cache_key = f"dashboard:trends:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    end_date = date.today()
    start_date = end_date - timedelta(days=6)  # 7 days including today

    # Build date list for consistent ordering (oldest first)
    date_list = [(start_date + timedelta(days=i)) for i in range(7)]
    date_keys = {d: d.strftime("%m-%d") for d in date_list}

    # 1. Daily production (printed_labels count by created_at date)
    prod_q = (
        db.query(func.date(PrintedLabel.created_at).label("d"), func.count(PrintedLabel.id).label("cnt"))
        .filter(func.date(PrintedLabel.created_at) >= start_date)
        .filter(func.date(PrintedLabel.created_at) <= end_date)
        .group_by(func.date(PrintedLabel.created_at))
    )
    prod_map = {r.d: r.cnt for r in prod_q}

    # 2. Daily purchase count (fruit_purchases)
    purch_q = (
        db.query(FruitPurchase.purchase_date.label("d"), func.count(FruitPurchase.id).label("cnt"))
        .filter(FruitPurchase.purchase_date >= start_date)
        .filter(FruitPurchase.purchase_date <= end_date)
        .group_by(FruitPurchase.purchase_date)
    )
    purch_map = {r.d: r.cnt for r in purch_q}

    # 3. Daily outbound count (printed_labels where scanned_outbound=True, by scanned_time date)
    out_q = (
        db.query(func.date(PrintedLabel.scanned_time).label("d"), func.count(PrintedLabel.id).label("cnt"))
        .filter(PrintedLabel.scanned_outbound > 0)
        .filter(PrintedLabel.scanned_time.isnot(None))
        .filter(func.date(PrintedLabel.scanned_time) >= start_date)
        .filter(func.date(PrintedLabel.scanned_time) <= end_date)
        .group_by(func.date(PrintedLabel.scanned_time))
    )
    out_map = {r.d: r.cnt for r in out_q}

    production = [{"date": date_keys[d], "value": int(prod_map.get(d, 0))} for d in date_list]
    purchases = [{"date": date_keys[d], "value": int(purch_map.get(d, 0))} for d in date_list]
    outbound = [{"date": date_keys[d], "value": int(out_map.get(d, 0))} for d in date_list]

    data = {
        "production": production,
        "purchases": purchases,
        "outbound": outbound,
    }
    cache_set(cache_key, data, ttl=60)
    return ApiResponse(data=data)


@router.get("/recent-activity")
def get_recent_activity(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Last 8 activity log entries with id, action, username, timestamp."""
    rows = (
        db.query(ActivityLog, User.username)
        .outerjoin(User, ActivityLog.user_id == User.id)
        .order_by(ActivityLog.timestamp.desc())
        .limit(8)
        .all()
    )
    items = [
        {
            "id": r.ActivityLog.id,
            "action": r.ActivityLog.action,
            "username": r.username or "",
            "timestamp": r.ActivityLog.timestamp.isoformat() if r.ActivityLog.timestamp else None,
        }
        for r in rows
    ]
    return ApiResponse(data=items)


def _dec(v):
    return float(v) if isinstance(v, Decimal) else (v or 0)


@router.get("/full")
def get_full_dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Comprehensive dashboard data for rich UI."""
    cache_key = f"dashboard:full:{user.role}:{user.id}:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    today = date.today()
    d7 = today - timedelta(days=6)

    if user.role == "admin":
        # === Core stats ===
        purchases = db.query(func.count(FruitPurchase.id)).filter(FruitPurchase.purchase_date == today).scalar() or 0
        assignments = db.query(func.count(BatchAssignment.id)).filter(BatchAssignment.assignment_date == today).scalar() or 0
        pending_print = db.query(func.count(SkuTransaction.id)).filter(SkuTransaction.is_printed == False).scalar() or 0
        pending_audit = db.query(func.count(WorkerProduction.id)).filter(WorkerProduction.audit_status == "pending").scalar() or 0
        pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(WorkerProductionEdit.audit_status == "pending").scalar() or 0
        total_workers = db.query(func.count(User.id)).filter(User.role == "worker").scalar() or 0
        today_active = db.query(func.count(func.distinct(WorkerProduction.worker_id))).filter(WorkerProduction.production_date == today).scalar() or 0
        today_outbound = db.query(func.count(PrintedLabel.id)).filter(and_(PrintedLabel.scanned_outbound > 0, func.date(PrintedLabel.scanned_time) == today)).scalar() or 0
        today_printed = db.query(func.count(PrintedLabel.id)).filter(func.date(PrintedLabel.created_at) == today).scalar() or 0

        # === Yesterday comparison ===
        yesterday = today - timedelta(days=1)
        yest_purchases = db.query(func.count(FruitPurchase.id)).filter(FruitPurchase.purchase_date == yesterday).scalar() or 0
        yest_assignments = db.query(func.count(BatchAssignment.id)).filter(BatchAssignment.assignment_date == yesterday).scalar() or 0
        yest_active = db.query(func.count(func.distinct(WorkerProduction.worker_id))).filter(WorkerProduction.production_date == yesterday).scalar() or 0
        yest_outbound = db.query(func.count(PrintedLabel.id)).filter(and_(PrintedLabel.scanned_outbound > 0, func.date(PrintedLabel.scanned_time) == yesterday)).scalar() or 0
        yest_printed = db.query(func.count(PrintedLabel.id)).filter(func.date(PrintedLabel.created_at) == yesterday).scalar() or 0

        # === Unpaid totals ===
        unpaid_fruit_cnt = db.query(func.count(FruitPurchase.id)).filter(FruitPurchase.payment_status == "unpaid").scalar() or 0
        unpaid_fruit_amt = _dec(db.query(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight)).filter(FruitPurchase.payment_status == "unpaid").scalar())
        unpaid_carton_cnt = db.query(func.count(CartonBoxPurchase.id)).filter(CartonBoxPurchase.payment_status == "unpaid").scalar() or 0
        unpaid_material_cnt = db.query(func.count(SimpleMaterialPurchase.id)).filter(SimpleMaterialPurchase.payment_status == "unpaid").scalar() or 0
        unpaid_material_amt = _dec(db.query(func.sum(SimpleMaterialPurchase.purchase_amount)).filter(SimpleMaterialPurchase.payment_status == "unpaid").scalar())

        # === 7-day trends ===
        date_list = [(d7 + timedelta(days=i)) for i in range(7)]
        dk = {d: d.strftime("%m-%d") for d in date_list}

        prod_q = db.query(func.date(PrintedLabel.created_at).label("d"), func.count(PrintedLabel.id).label("c")).filter(func.date(PrintedLabel.created_at).between(d7, today)).group_by("d")
        prod_m = {r.d: r.c for r in prod_q}

        purch_q = db.query(FruitPurchase.purchase_date.label("d"), func.count(FruitPurchase.id).label("c")).filter(FruitPurchase.purchase_date.between(d7, today)).group_by("d")
        purch_m = {r.d: r.c for r in purch_q}

        out_q = db.query(func.date(PrintedLabel.scanned_time).label("d"), func.count(PrintedLabel.id).label("c")).filter(PrintedLabel.scanned_outbound > 0, PrintedLabel.scanned_time.isnot(None), func.date(PrintedLabel.scanned_time).between(d7, today)).group_by("d")
        out_m = {r.d: r.c for r in out_q}

        trends = {
            "production": [{"date": dk[d], "value": int(prod_m.get(d, 0))} for d in date_list],
            "purchases": [{"date": dk[d], "value": int(purch_m.get(d, 0))} for d in date_list],
            "outbound": [{"date": dk[d], "value": int(out_m.get(d, 0))} for d in date_list],
        }

        # === Top 5 SKU by label count (today only) ===
        sku_top = db.query(
            PrintedLabel.s, func.count(PrintedLabel.id).label("cnt")
        ).filter(func.date(PrintedLabel.created_at) == today).group_by(PrintedLabel.s).order_by(func.count(PrintedLabel.id).desc()).limit(5).all()
        sku_ids = [r.s for r in sku_top]
        sku_names = {}
        if sku_ids:
            for s in db.query(Sku.id, Sku.sku_name, Sku.sku_description, Sku.fruit_name).filter(Sku.id.in_(sku_ids)).all():
                sku_names[s.id] = (s.sku_description or '').strip() or f"{s.fruit_name} {s.sku_name}"
        top_skus = [{"sku_id": r.s, "name": sku_names.get(r.s, f"SKU#{r.s}"), "count": r.cnt} for r in sku_top]

        # === Top 5 workers by production (today only) ===
        worker_top = db.query(
            WorkerProduction.worker_id, func.sum(WorkerProduction.actual_packaging_quantity).label("qty")
        ).filter(WorkerProduction.production_date == today).group_by(WorkerProduction.worker_id).order_by(func.sum(WorkerProduction.actual_packaging_quantity).desc()).limit(5).all()
        wids = [r.worker_id for r in worker_top]
        wnames = {}
        if wids:
            for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
                wnames[w.id] = w.real_name or w.username
        top_workers = [{"id": r.worker_id, "name": wnames.get(r.worker_id, ""), "qty": int(_dec(r.qty))} for r in worker_top]

        # === Active notices ===
        notices = db.query(AdminNotice).filter(AdminNotice.is_active == True).order_by(AdminNotice.id.desc()).limit(5).all()
        notice_list = [{"id": n.id, "content": n.content, "type": n.type} for n in notices]

        # === Alerts ===
        alerts = []
        if pending_print > 0:
            alerts.append({"type": "warning", "text": f"{pending_print} 个标签待打印", "link": "/production/print"})
        if pending_audit > 0:
            alerts.append({"type": "warning", "text": f"{pending_audit} 条生产记录待审核", "link": "/production/audit"})
        if pending_edits > 0:
            alerts.append({"type": "info", "text": f"{pending_edits} 条修改申请待审批", "link": "/production/audit"})
        if unpaid_fruit_cnt > 10:
            alerts.append({"type": "danger", "text": f"{unpaid_fruit_cnt} 笔水果采购未付款", "link": "/orders/fruit"})
        if unpaid_carton_cnt > 5:
            alerts.append({"type": "danger", "text": f"{unpaid_carton_cnt} 笔纸箱采购未付款", "link": "/orders/carton"})

        low_stock_boxes = db.query(CartonBox).all()
        for box in low_stock_boxes:
            threshold = box.low_stock_threshold or 50
            qty = box.stock_quantity or 0
            if qty == 0:
                alerts.append({"type": "danger", "text": f"纸箱 {box.box_type} 库存已耗尽", "link": "/inventory/carton"})
            elif qty <= threshold:
                alerts.append({"type": "warning", "text": f"纸箱 {box.box_type} 库存不足（{qty}/{threshold}）", "link": "/inventory/carton"})

        # === Production efficiency (today) ===
        today_outbound_weight = _dec(db.query(func.sum(PrintedLabel.actual_weight)).filter(
            and_(PrintedLabel.scanned_outbound > 0, func.date(PrintedLabel.scanned_time) == today)
        ).scalar())
        outbound_rate = round(today_outbound / today_printed * 100, 1) if today_printed > 0 else 0
        avg_weight = round(today_outbound_weight / today_outbound, 2) if today_outbound > 0 else 0

        # === Today production summary (by SKU) ===
        today_sku_rows = db.query(
            PrintedLabel.s.label("sku_id"),
            Sku.sku_name,
            Sku.sku_description,
            Sku.fruit_name,
            func.count(PrintedLabel.id).label("printed_count"),
            func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound_count"),
        ).join(Sku, Sku.id == PrintedLabel.s).filter(
            func.date(PrintedLabel.created_at) == today,
        ).group_by(PrintedLabel.s, Sku.sku_name, Sku.sku_description, Sku.fruit_name).order_by(func.count(PrintedLabel.id).desc()).limit(20).all()
        today_production_summary = [
            {"sku_id": r.sku_id, "sku_name": (r.sku_description or '').strip() or f"{r.fruit_name} {r.sku_name}", "printed_count": int(r.printed_count), "outbound_count": int(r.outbound_count or 0)}
            for r in today_sku_rows
        ]

        # === Loss warning (batches with >15% weight loss) ===
        loss_rows = db.query(
            PrintedLabel.b.label("batch_id"),
            func.sum(PrintedLabel.estimated_weight).label("total_estimated"),
            func.sum(PrintedLabel.actual_weight).label("total_actual"),
            func.count(PrintedLabel.id).label("label_count"),
        ).filter(
            PrintedLabel.scanned_outbound > 0,
            PrintedLabel.estimated_weight > 0,
            PrintedLabel.actual_weight > 0,
            func.date(PrintedLabel.scanned_time) >= today - timedelta(days=7),
        ).group_by(PrintedLabel.b).all()
        loss_warning = []
        for r in loss_rows:
            est = _dec(r.total_estimated)
            act = _dec(r.total_actual)
            if est > 0:
                loss_rate = round((est - act) / est * 100, 1)
                if loss_rate > 15:
                    loss_warning.append({
                        "batch_id": r.batch_id,
                        "estimated_weight": round(est, 2),
                        "actual_weight": round(act, 2),
                        "loss_rate": loss_rate,
                        "label_count": r.label_count,
                    })
        loss_warning.sort(key=lambda x: x["loss_rate"], reverse=True)

        # === Todo items (actionable) ===
        from app.models import FailureLog
        low_stock_count = sum(1 for b in low_stock_boxes if (b.stock_quantity or 0) <= (b.low_stock_threshold or 50))
        today_failures = db.query(func.count(FailureLog.id)).filter(
            func.date(FailureLog.failure_time) == today
        ).scalar() or 0

        todo_items = []
        if pending_print > 0:
            todo_items.append({"key": "print", "label": "标签待打印", "count": pending_print, "link": "/production/print", "color": "#fa8c16", "icon": "printer"})
        if pending_audit > 0:
            todo_items.append({"key": "audit", "label": "生产待审核", "count": pending_audit, "link": "/production/audit", "color": "#1677ff", "icon": "audit"})
        if pending_edits > 0:
            todo_items.append({"key": "edits", "label": "修改待审批", "count": pending_edits, "link": "/production/audit", "color": "#722ed1", "icon": "edit"})
        if low_stock_count > 0:
            todo_items.append({"key": "stock", "label": "库存预警", "count": low_stock_count, "link": "/inventory/alerts", "color": "#ff4d4f", "icon": "warning"})
        if today_failures > 0:
            todo_items.append({"key": "failures", "label": "今日扫码异常", "count": today_failures, "link": "/production/failures", "color": "#eb2f96", "icon": "bug"})

        # === Recent activity ===
        rows = db.query(ActivityLog, User.username).outerjoin(User, ActivityLog.user_id == User.id).order_by(ActivityLog.timestamp.desc()).limit(6).all()
        activity = [{"id": r.ActivityLog.id, "action": r.ActivityLog.action, "username": r.username or "", "ts": r.ActivityLog.timestamp.isoformat() if r.ActivityLog.timestamp else None} for r in rows]

        data = {
            "stats": {
                "purchases": purchases, "assignments": assignments,
                "pending_print": pending_print, "pending_audit": pending_audit,
                "pending_edits": pending_edits,
                "total_workers": total_workers, "today_active": today_active,
                "today_outbound": today_outbound, "today_printed": today_printed,
            },
            "yesterday": {
                "purchases": yest_purchases, "assignments": yest_assignments,
                "today_active": yest_active,
                "today_outbound": yest_outbound, "today_printed": yest_printed,
            },
            "finance": {
                "unpaid_fruit_cnt": unpaid_fruit_cnt,
                "unpaid_fruit_amt": round(unpaid_fruit_amt, 2),
                "unpaid_carton_cnt": unpaid_carton_cnt,
                "unpaid_material_cnt": unpaid_material_cnt,
                "unpaid_material_amt": round(unpaid_material_amt, 2),
                "unpaid_total_cnt": unpaid_fruit_cnt + unpaid_carton_cnt + unpaid_material_cnt,
            },
            "production_efficiency": {
                "today_printed": today_printed,
                "today_outbound": today_outbound,
                "outbound_rate": outbound_rate,
                "outbound_weight": round(today_outbound_weight, 2),
                "avg_weight": avg_weight,
            },
            "today_production_summary": today_production_summary,
            "loss_warning": loss_warning,
            "todo_items": todo_items,
            "trends": trends,
            "top_skus": top_skus,
            "top_workers": top_workers,
            "notices": notice_list,
            "alerts": alerts,
            "activity": activity,
            "date": str(today),
        }
    else:
        # Worker dashboard
        printed = db.query(func.count(PrintedLabel.id)).filter(and_(PrintedLabel.u == user.id, func.date(PrintedLabel.created_at) == today)).scalar() or 0
        recorded = db.query(func.count(WorkerProduction.id)).filter(and_(WorkerProduction.worker_id == user.id, WorkerProduction.production_date == today)).scalar() or 0
        month_start = today.replace(day=1)
        month_qty = _dec(db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(and_(WorkerProduction.worker_id == user.id, WorkerProduction.production_date >= month_start, WorkerProduction.audit_status == "approved")).scalar())
        pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(and_(WorkerProductionEdit.worker_id == user.id, WorkerProductionEdit.audit_status == "pending")).scalar() or 0

        data = {
            "stats": {
                "today_printed": printed,
                "today_recorded": recorded,
                "month_qty": int(month_qty),
                "pending_edits": pending_edits,
            },
            "date": str(today),
        }

    cache_set(cache_key, data, ttl=25)
    return ApiResponse(data=data)


@router.get("/worker-dashboard")
def worker_dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Comprehensive worker dashboard: batches, stats, trend, commission."""
    from app.models import BatchAssignment, SkuTransaction, WorkerProductionEdit

    today = date.today()
    uid = user.id

    cache_key = f"dashboard:worker:{uid}:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    today_printed = db.query(func.count(PrintedLabel.id)).filter(
        and_(PrintedLabel.u == uid, func.date(PrintedLabel.created_at) == today)
    ).scalar() or 0

    today_recorded = db.query(func.count(WorkerProduction.id)).filter(
        and_(WorkerProduction.worker_id == uid, WorkerProduction.production_date == today)
    ).scalar() or 0

    today_outbound = db.query(func.count(PrintedLabel.id)).filter(
        and_(PrintedLabel.u == uid, PrintedLabel.scanned_outbound > 0, func.date(PrintedLabel.scanned_time) == today)
    ).scalar() or 0

    month_start = today.replace(day=1)
    month_qty = db.query(func.coalesce(func.sum(WorkerProduction.actual_packaging_quantity), 0)).filter(
        and_(WorkerProduction.worker_id == uid, WorkerProduction.production_date >= month_start,
             WorkerProduction.audit_status.in_(["pending", "approved"]))
    ).scalar() or 0

    pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(
        and_(WorkerProductionEdit.worker_id == uid, WorkerProductionEdit.audit_status == "pending")
    ).scalar() or 0

    pending_audit = db.query(func.count(WorkerProduction.id)).filter(
        and_(WorkerProduction.worker_id == uid, WorkerProduction.audit_status == "pending")
    ).scalar() or 0

    rejected_count = db.query(func.count(WorkerProduction.id)).filter(
        and_(WorkerProduction.worker_id == uid, WorkerProduction.audit_status == "rejected")
    ).scalar() or 0

    # Today's assigned batches
    assignments = db.query(BatchAssignment).filter(
        and_(BatchAssignment.worker_id == uid, BatchAssignment.assignment_date == today)
    ).all()
    batch_ids = [a.purchase_id for a in assignments]
    today_batches = []
    if batch_ids:
        for fp in db.query(FruitPurchase).filter(
            FruitPurchase.id.in_(batch_ids), FruitPurchase.deleted_at.is_(None)
        ).all():
            today_batches.append({
                "purchase_id": fp.id,
                "fruit_name": fp.fruit_name,
                "supplier_name": fp.supplier_name,
                "purchase_weight": float(fp.purchase_weight),
            })

    # Today's transactions
    today_txns = db.query(
        SkuTransaction.sku_name,
        func.sum(SkuTransaction.quantity).label("qty"),
        func.max(SkuTransaction.is_printed).label("printed"),
    ).filter(
        and_(SkuTransaction.worker_id == uid, func.date(SkuTransaction.transaction_date) == today)
    ).group_by(SkuTransaction.sku_name).all()

    txn_summary = [{"sku_name": t.sku_name, "quantity": int(t.qty), "is_printed": bool(t.printed)} for t in today_txns]

    # 7-day trend
    d7 = today - timedelta(days=6)
    daily = db.query(
        WorkerProduction.production_date.label("d"),
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
    ).filter(
        and_(WorkerProduction.worker_id == uid,
             WorkerProduction.production_date.between(d7, today))
    ).group_by(WorkerProduction.production_date).all()
    daily_map = {r.d: int(r.qty or 0) for r in daily}
    trend = [
        {"date": (d7 + timedelta(days=i)).strftime("%m-%d"), "qty": daily_map.get(d7 + timedelta(days=i), 0)}
        for i in range(7)
    ]

    # Commission estimate (outbound × performance)
    from sqlalchemy import text
    commission_result = db.query(
        func.sum(Sku.production_performance).label("total")
    ).join(
        PrintedLabel, PrintedLabel.s == Sku.id
    ).filter(
        PrintedLabel.u == uid,
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) >= month_start,
    ).first()
    month_commission = float(commission_result.total or 0) if commission_result else 0

    data = {
        "today_printed": today_printed,
        "today_recorded": today_recorded,
        "today_outbound": today_outbound,
        "month_qty": int(month_qty),
        "month_commission": round(month_commission, 1),
        "pending_audit": pending_audit,
        "pending_edits": pending_edits,
        "rejected_count": rejected_count,
        "today_batches": today_batches,
        "today_transactions": txn_summary,
        "trend": trend,
    }
    cache_set(cache_key, data, ttl=20)
    return ApiResponse(data=data)
