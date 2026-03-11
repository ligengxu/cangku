from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, and_, Integer, case
from datetime import date, datetime, timedelta
from app.database import get_db
from app.models import (
    BatchAssignment, SkuTransaction, PrintedLabel, WorkerProduction,
    Sku, FruitPurchase, User, ManualOutboundLog, FailureLog, WeightSetting,
    Fruit,
)
from app.schemas.production import (
    BatchAssignmentCreate, BatchAssignmentOut,
    SkuTransactionCreate, SkuTransactionOut,
    ProductionAuditAction, BatchAuditAction, BatchEditAuditAction, CheckChangesAction,
    PrintLabelAction,
    ReprintLabelAction, PrintWithLabelsAction, BatchLookupAction,
    WorkerProductionCreate, WorkerProductionOut,
    BatchWorkerInputAction,
)
from app.schemas.common import ApiResponse, PaginatedResponse
from app.middleware.auth import get_current_user, require_admin
from app.utils.cache import cache_clear_prefix
from app.utils.log_action import log_action

router = APIRouter(prefix="/production", tags=["生产管理"])


# ─── 批次分配 ───
@router.post("/assign", response_model=ApiResponse)
def assign_workers(
    req: BatchAssignmentCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    assign_date = req.assignment_date or date.today()

    db.query(BatchAssignment).filter(
        BatchAssignment.purchase_id == req.purchase_id,
        BatchAssignment.assignment_date == assign_date,
    ).delete()

    for worker_id in req.worker_ids:
        assignment = BatchAssignment(
            purchase_id=req.purchase_id,
            worker_id=worker_id,
            assignment_date=assign_date,
        )
        db.add(assignment)
    date_label = str(assign_date)
    log_action(db, user, f"批次分配：采购#{req.purchase_id} → {len(req.worker_ids)} 名工人（{date_label}）")

    fruit_name = db.query(FruitPurchase.fruit_name).filter(FruitPurchase.id == req.purchase_id).scalar() or f"批次#{req.purchase_id}"
    from app.utils.notify import notify_batch_assigned
    notify_batch_assigned(db, req.worker_ids, req.purchase_id, fruit_name, date_label)

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message=f"已分配 {len(req.worker_ids)} 名工人（{date_label}）")


@router.get("/assignments")
def get_assignments(
    purchase_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(BatchAssignment)
    if purchase_id:
        q = q.filter(BatchAssignment.purchase_id == purchase_id)
    items = q.order_by(desc(BatchAssignment.id)).all()
    return ApiResponse(data=[BatchAssignmentOut.model_validate(i) for i in items])


@router.get("/assignment-history")
def assignment_history(
    start_date: date | None = None,
    end_date: date | None = None,
    purchase_id: int | None = None,
    worker_id: int | None = None,
    page: int = 1,
    page_size: int = 20,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    sd = start_date or (date.today() - timedelta(days=30))
    ed = end_date or date.today()
    q = db.query(BatchAssignment).filter(
        BatchAssignment.assignment_date.between(sd, ed)
    )
    if purchase_id:
        q = q.filter(BatchAssignment.purchase_id == purchase_id)
    if worker_id:
        q = q.filter(BatchAssignment.worker_id == worker_id)
    total = q.count()
    items = q.order_by(desc(BatchAssignment.assignment_date), desc(BatchAssignment.id)).offset((page - 1) * page_size).limit(page_size).all()

    pids = list({a.purchase_id for a in items})
    wids = list({a.worker_id for a in items})
    fp_map = {}
    if pids:
        for fp in db.query(FruitPurchase).filter(FruitPurchase.id.in_(pids), FruitPurchase.deleted_at.is_(None)).all():
            fp_map[fp.id] = fp
    wmap = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wmap[w.id] = w.real_name or w.username

    result = []
    for a in items:
        fp = fp_map.get(a.purchase_id)
        result.append({
            "id": a.id,
            "purchase_id": a.purchase_id,
            "fruit_name": fp.fruit_name if fp else f"采购#{a.purchase_id}",
            "supplier_name": fp.supplier_name if fp else "",
            "purchase_weight": float(fp.purchase_weight) if fp else 0,
            "worker_id": a.worker_id,
            "worker_name": wmap.get(a.worker_id, f"#{a.worker_id}"),
            "assignment_date": str(a.assignment_date) if a.assignment_date else None,
        })

    return ApiResponse(data={"items": result, "total": total, "page": page, "page_size": page_size})


@router.get("/my-batches")
def my_assigned_batches(
    include_history: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Worker endpoint: list batches assigned to the current user (today only by default)."""
    q = db.query(BatchAssignment).filter(BatchAssignment.worker_id == user.id)
    if not include_history:
        q = q.filter(BatchAssignment.assignment_date == date.today())
    assignments = q.order_by(desc(BatchAssignment.assignment_date), desc(BatchAssignment.id)).all()

    purchase_ids = list({a.purchase_id for a in assignments})
    fp_map = {}
    if purchase_ids:
        for fp in db.query(FruitPurchase).filter(
            FruitPurchase.id.in_(purchase_ids), FruitPurchase.deleted_at.is_(None)
        ).all():
            fp_map[fp.id] = fp

    result = []
    for a in assignments:
        fp = fp_map.get(a.purchase_id)
        if not fp:
            continue
        is_today = a.assignment_date == date.today() if a.assignment_date else False
        result.append({
            "assignment_id": a.id,
            "purchase_id": fp.id,
            "fruit_id": fp.fruit_id,
            "fruit_name": fp.fruit_name,
            "supplier_name": fp.supplier_name,
            "purchase_date": str(fp.purchase_date),
            "purchase_weight": float(fp.purchase_weight),
            "assignment_date": str(a.assignment_date) if a.assignment_date else None,
            "is_today": is_today,
        })
    return ApiResponse(data=result)


@router.get("/batch-skus/{purchase_id}")
def batch_skus(
    purchase_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get SKUs available for a given fruit purchase batch."""
    fp = db.query(FruitPurchase).filter(
        FruitPurchase.id == purchase_id, FruitPurchase.deleted_at.is_(None)
    ).first()
    if not fp:
        raise HTTPException(status_code=404, detail="采购批次不存在")

    skus = db.query(Sku).filter(Sku.fruit_id == fp.fruit_id).all()

    existing_txns = db.query(
        SkuTransaction.sku_id,
        func.sum(SkuTransaction.quantity).label("qty"),
    ).filter(
        SkuTransaction.fruit_purchase_id == purchase_id,
        SkuTransaction.worker_id == user.id,
        func.date(SkuTransaction.transaction_date) == date.today(),
    ).group_by(SkuTransaction.sku_id).all()
    txn_map = {t.sku_id: int(t.qty) for t in existing_txns}

    result = []
    for s in skus:
        result.append({
            "id": s.id,
            "sku_name": s.sku_name,
            "sku_description": s.sku_description,
            "fruit_name": s.fruit_name,
            "fruit_weight": float(s.fruit_weight),
            "material_weight": float(s.material_weight),
            "total_weight": float(s.total_weight),
            "production_performance": float(s.production_performance),
            "today_submitted": txn_map.get(s.id, 0),
        })
    return ApiResponse(data=result)


@router.get("/my-transactions")
def my_transactions(
    page: int = 1,
    page_size: int = 30,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Worker: list own sku transactions."""
    q = db.query(SkuTransaction).filter(SkuTransaction.worker_id == user.id)
    total = q.count()
    items = q.order_by(desc(SkuTransaction.id)).offset((page - 1) * page_size).limit(page_size).all()
    return {"success": True, "data": [
        {
            "id": t.id,
            "fruit_purchase_id": t.fruit_purchase_id,
            "sku_id": t.sku_id,
            "sku_name": t.sku_name,
            "fruit_name": t.fruit_name,
            "quantity": t.quantity,
            "is_printed": t.is_printed,
            "transaction_date": t.transaction_date.isoformat() if t.transaction_date else None,
        } for t in items
    ], "total": total, "page": page, "page_size": page_size}


@router.delete("/assignments/{assignment_id}", response_model=ApiResponse)
def delete_assignment(
    assignment_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    a = db.query(BatchAssignment).filter(BatchAssignment.id == assignment_id).first()
    if not a:
        raise HTTPException(status_code=404, detail="分配记录不存在")
    db.delete(a)
    db.commit()
    return ApiResponse(message="删除成功")


# ─── SKU 生产录入（工人端） ───
@router.post("/sku-transaction", response_model=ApiResponse[SkuTransactionOut])
def create_sku_transaction(
    req: SkuTransactionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sku = db.query(Sku).filter(Sku.id == req.sku_id).first()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU 不存在")

    if req.quantity <= 0:
        raise HTTPException(status_code=400, detail="数量必须大于0")

    today = date.today()
    assignment = db.query(BatchAssignment).filter(
        BatchAssignment.purchase_id == req.fruit_purchase_id,
        BatchAssignment.worker_id == user.id,
        BatchAssignment.assignment_date == today,
    ).first()
    if not assignment and user.role != "admin":
        raise HTTPException(status_code=403, detail="该批次今天未分配给您，无法提交")

    one_minute_ago = datetime.now() - timedelta(minutes=1)
    dup = db.query(SkuTransaction).filter(
        SkuTransaction.fruit_purchase_id == req.fruit_purchase_id,
        SkuTransaction.sku_id == req.sku_id,
        SkuTransaction.worker_id == user.id,
        SkuTransaction.quantity == req.quantity,
        SkuTransaction.transaction_date >= one_minute_ago,
    ).first()
    if dup:
        raise HTTPException(status_code=400, detail="检测到重复提交（1分钟内相同请求），请勿重复操作")

    txn = SkuTransaction(
        fruit_purchase_id=req.fruit_purchase_id,
        sku_id=req.sku_id,
        worker_id=user.id,
        worker_name=user.real_name or user.username,
        sku_name=sku.sku_name,
        sku_description=sku.sku_description or "",
        fruit_name=req.fruit_name or sku.fruit_name,
        quantity=req.quantity,
    )
    db.add(txn)

    from app.utils.notify import notify_sku_request
    admin_ids = [u.id for u in db.query(User.id).filter(User.role == "admin").all()]
    notify_sku_request(db, admin_ids, user.real_name or user.username, sku.sku_name, req.quantity)

    db.commit()
    db.refresh(txn)
    return ApiResponse(data=txn)


@router.get("/transactions", response_model=PaginatedResponse[SkuTransactionOut])
def list_transactions(
    page: int = 1,
    page_size: int = 20,
    is_printed: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(SkuTransaction)
    if user.role == "worker":
        q = q.filter(SkuTransaction.worker_id == user.id)
    if is_printed is not None:
        q = q.filter(SkuTransaction.is_printed == is_printed)
    total = q.count()
    items = q.order_by(desc(SkuTransaction.id)).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(data=items, total=total, page=page, page_size=page_size)


# ─── 标签打印 ───
@router.post("/print", response_model=ApiResponse)
def print_labels(
    req: PrintLabelAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    txn = db.query(SkuTransaction).filter(SkuTransaction.id == req.transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="交易记录不存在")
    if txn.is_printed:
        raise HTTPException(status_code=400, detail="该交易已打印")

    sku = db.query(Sku).filter(Sku.id == txn.sku_id).first()
    labels_created = 0
    for _ in range(txn.quantity):
        label = PrintedLabel(
            u=txn.worker_id,
            b=txn.fruit_purchase_id,
            s=txn.sku_id,
            estimated_weight=float(sku.total_weight) if sku else 0,
        )
        db.add(label)
        labels_created += 1

    txn.is_printed = True
    log_action(db, user, f"打印标签：交易#{req.transaction_id} 生成 {labels_created} 个标签")
    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message=f"已生成 {labels_created} 个标签", data={"labels_created": labels_created})


@router.post("/print-with-labels", response_model=ApiResponse)
def print_with_labels(
    req: PrintWithLabelsAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    today_dd = datetime.now().strftime("%d")
    all_labels = []

    for tid in req.transaction_ids:
        txn = db.query(SkuTransaction).filter(SkuTransaction.id == tid).first()
        if not txn:
            raise HTTPException(status_code=404, detail=f"交易记录 #{tid} 不存在")
        if txn.is_printed:
            raise HTTPException(status_code=400, detail=f"交易 #{tid} 已打印")

        sku = db.query(Sku).filter(Sku.id == txn.sku_id).first()
        for _ in range(txn.quantity):
            label = PrintedLabel(
                u=txn.worker_id,
                b=txn.fruit_purchase_id,
                s=txn.sku_id,
                estimated_weight=float(sku.total_weight) if sku else 0,
            )
            db.add(label)
            all_labels.append((label, txn, sku))

        txn.is_printed = True

    db.flush()

    label_results = []
    for label, txn, sku in all_labels:
        barcode = f"{today_dd}{label.id}"
        worker = db.query(User).filter(User.id == txn.worker_id).first()
        label_results.append({
            "id": label.id,
            "barcode": barcode,
            "sku_name": sku.sku_name if sku else "",
            "worker_name": worker.real_name or worker.username if worker else "",
            "estimated_weight": float(label.estimated_weight) if label.estimated_weight else 0,
        })

    log_action(db, user, f"批量打印标签：{len(unique_tids)} 笔交易，生成 {len(label_results)} 个标签")
    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(
        message=f"已生成 {len(label_results)} 个标签",
        data={"labels": label_results, "total_created": len(label_results)},
    )


@router.delete("/transactions/{transaction_id}", response_model=ApiResponse)
def delete_transaction(
    transaction_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    txn = db.query(SkuTransaction).filter(SkuTransaction.id == transaction_id).first()
    if not txn:
        raise HTTPException(status_code=404, detail="交易记录不存在")
    if txn.is_printed:
        raise HTTPException(status_code=400, detail="已打印的交易不能删除")

    log_action(db, user, f"删除交易记录 #{transaction_id}（SKU: {txn.sku_name}, 工人: {txn.worker_name}, 数量: {txn.quantity}）")
    db.delete(txn)
    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message="交易记录已删除")


@router.post("/batch-lookup", response_model=ApiResponse)
def batch_lookup(
    req: BatchLookupAction,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    results = []
    for barcode in req.barcodes:
        if len(barcode) <= 2:
            results.append({"barcode": barcode, "status": "not_found"})
            continue

        try:
            label_id = int(barcode[2:])
        except ValueError:
            results.append({"barcode": barcode, "status": "not_found"})
            continue

        label = db.query(PrintedLabel).filter(PrintedLabel.id == label_id).first()
        if not label:
            results.append({"barcode": barcode, "status": "not_found"})
            continue

        sku_info = db.query(Sku.sku_name, Sku.fruit_name).filter(Sku.id == label.s).first()
        worker_info = db.query(User.real_name, User.username).filter(User.id == label.u).first()

        results.append({
            "barcode": barcode,
            "status": "found",
            "id": label.id,
            "sku_name": sku_info.sku_name if sku_info else "",
            "fruit_name": sku_info.fruit_name if sku_info else "",
            "worker_name": (worker_info.real_name or worker_info.username) if worker_info else "",
            "estimated_weight": float(label.estimated_weight) if label.estimated_weight else 0,
            "actual_weight": float(label.actual_weight) if label.actual_weight else 0,
            "scanned_outbound": label.scanned_outbound,
            "created_at": label.created_at.isoformat() if label.created_at else None,
        })

    return ApiResponse(data={"results": results, "total": len(results)})


@router.get("/label-search")
def label_search(
    search: str | None = None,
    worker_id: int | None = None,
    sku_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    outbound_status: str | None = None,
    page: int = 1,
    page_size: int = 20,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """标签高级搜索 — 支持多条件筛选"""
    from sqlalchemy import or_

    q = db.query(PrintedLabel)

    if search:
        search = search.strip()
        try:
            label_id = int(search.replace(" ", ""))
            q = q.filter(PrintedLabel.id == label_id)
        except ValueError:
            if search.isdigit() and len(search) > 2:
                try:
                    q = q.filter(PrintedLabel.id == int(search[2:]))
                except ValueError:
                    pass

    if worker_id:
        q = q.filter(PrintedLabel.u == worker_id)
    if sku_id:
        q = q.filter(PrintedLabel.s == sku_id)
    if start_date:
        q = q.filter(func.date(PrintedLabel.created_at) >= start_date)
    if end_date:
        q = q.filter(func.date(PrintedLabel.created_at) <= end_date)
    if outbound_status == "outbound":
        q = q.filter(PrintedLabel.scanned_outbound > 0)
    elif outbound_status == "instock":
        q = q.filter(PrintedLabel.scanned_outbound == 0)

    total = q.count()
    labels = q.order_by(desc(PrintedLabel.id)).offset((page - 1) * page_size).limit(page_size).all()

    sku_ids = list(set(l.s for l in labels if l.s))
    worker_ids = list(set(l.u for l in labels if l.u))
    purchase_ids = list(set(l.b for l in labels if l.b))

    sku_map = {}
    if sku_ids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name, Sku.production_performance).filter(Sku.id.in_(sku_ids)).all():
            sku_map[s.id] = {"sku_name": s.sku_name, "fruit_name": s.fruit_name, "performance": float(s.production_performance or 0)}

    worker_map = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            worker_map[w.id] = w.real_name or w.username

    purchase_map = {}
    if purchase_ids:
        for p in db.query(FruitPurchase.id, FruitPurchase.fruit_name, FruitPurchase.supplier_name, FruitPurchase.purchase_date).filter(FruitPurchase.id.in_(purchase_ids)).all():
            purchase_map[p.id] = {"fruit_name": p.fruit_name, "supplier": p.supplier_name, "date": p.purchase_date.isoformat() if p.purchase_date else ""}

    items = []
    for l in labels:
        si = sku_map.get(l.s, {})
        pi = purchase_map.get(l.b, {})
        day_prefix = l.created_at.strftime("%d") if l.created_at else "00"
        items.append({
            "id": l.id,
            "barcode": f"{day_prefix}{l.id}",
            "sku_name": si.get("sku_name", ""),
            "fruit_name": si.get("fruit_name", ""),
            "performance": si.get("performance", 0),
            "worker_name": worker_map.get(l.u, ""),
            "worker_id": l.u,
            "supplier": pi.get("supplier", ""),
            "purchase_date": pi.get("date", ""),
            "purchase_id": l.b,
            "estimated_weight": float(l.estimated_weight) if l.estimated_weight else 0,
            "actual_weight": float(l.actual_weight) if l.actual_weight else 0,
            "weight_diff": float(l.weight_difference) if l.weight_difference else 0,
            "scanned_outbound": l.scanned_outbound or 0,
            "scanned_time": l.scanned_time.isoformat() if l.scanned_time else None,
            "created_at": l.created_at.isoformat() if l.created_at else None,
        })

    summary = {
        "total": total,
        "outbound": sum(1 for i in items if i["scanned_outbound"] > 0),
        "instock": sum(1 for i in items if i["scanned_outbound"] == 0),
    }

    return ApiResponse(data={"items": items, "total": total, "page": page, "page_size": page_size, "summary": summary})


@router.get("/print-queue")
def get_print_queue(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    count = db.query(func.count(SkuTransaction.id)).filter(
        SkuTransaction.is_printed == False
    ).scalar() or 0
    return ApiResponse(data={"count": count})


# ─── 已打印标签查询 ───
@router.get("/printed-labels")
def list_printed_labels(
    page: int = 1,
    page_size: int = 20,
    sku_id: int | None = None,
    worker_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(PrintedLabel)
    if sku_id:
        q = q.filter(PrintedLabel.s == sku_id)
    if worker_id:
        q = q.filter(PrintedLabel.u == worker_id)
    if start_date:
        q = q.filter(func.date(PrintedLabel.created_at) >= start_date)
    if end_date:
        q = q.filter(func.date(PrintedLabel.created_at) <= end_date)
    total = q.count()
    items = q.order_by(desc(PrintedLabel.id)).offset((page - 1) * page_size).limit(page_size).all()

    label_list = []
    sku_ids = list({i.s for i in items if i.s})
    worker_ids = list({i.u for i in items if i.u})
    smap = {}
    if sku_ids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name).filter(Sku.id.in_(sku_ids)).all():
            smap[s.id] = {"name": s.sku_name, "fruit": s.fruit_name}
    wmap = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            wmap[w.id] = w.real_name or w.username

    for i in items:
        sku_info = smap.get(i.s, {})
        label_list.append({
            "id": i.id,
            "sku_id": i.s,
            "sku_name": sku_info.get("name", f"SKU#{i.s}"),
            "fruit_name": sku_info.get("fruit", ""),
            "worker_id": i.u,
            "worker_name": wmap.get(i.u, f"#{i.u}"),
            "estimated_weight": float(i.estimated_weight or 0),
            "actual_weight": float(i.actual_weight or 0),
            "scanned_outbound": i.scanned_outbound,
            "created_at": i.created_at.isoformat() if i.created_at else None,
        })

    return {"success": True, "data": label_list, "total": total, "page": page, "page_size": page_size}


# ─── 标签补打 ───
@router.post("/reprint", response_model=ApiResponse)
def reprint_labels(
    req: ReprintLabelAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Reprint labels: copy from existing label or create new ones for a given SKU + worker."""
    if req.quantity < 1 or req.quantity > 100:
        raise HTTPException(status_code=400, detail="补打数量需在 1-100 之间")

    if req.label_id:
        original = db.query(PrintedLabel).filter(PrintedLabel.id == req.label_id).first()
        if not original:
            raise HTTPException(status_code=404, detail="原始标签不存在")
        sku_id = original.s
        worker_id = original.u
        batch_id = original.b
        est_weight = float(original.estimated_weight or 0)
    elif req.sku_id:
        sku = db.query(Sku).filter(Sku.id == req.sku_id).first()
        if not sku:
            raise HTTPException(status_code=404, detail="SKU 不存在")
        sku_id = req.sku_id
        worker_id = req.worker_id
        batch_id = None
        est_weight = float(sku.total_weight or 0)
    else:
        raise HTTPException(status_code=400, detail="需提供 label_id 或 sku_id")

    created = 0
    for _ in range(req.quantity):
        label = PrintedLabel(
            u=worker_id,
            b=batch_id,
            s=sku_id,
            estimated_weight=est_weight,
        )
        db.add(label)
        created += 1

    reason_text = f"（原因：{req.reason}）" if req.reason else ""
    log_action(db, user, f"标签补打：SKU#{sku_id} × {created}{reason_text}")
    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(
        message=f"已补打 {created} 个标签",
        data={"labels_created": created},
    )


# ─── 生产审核 ───
@router.get("/audit")
def list_production_for_audit(
    page: int = 1,
    page_size: int = 20,
    status: str | None = None,
    worker_id: int | None = None,
    sku_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(WorkerProduction)
    if status:
        q = q.filter(WorkerProduction.audit_status == status)
    if worker_id:
        q = q.filter(WorkerProduction.worker_id == worker_id)
    if sku_id:
        q = q.filter(WorkerProduction.sku_id == sku_id)
    if start_date:
        q = q.filter(WorkerProduction.production_date >= start_date)
    if end_date:
        q = q.filter(WorkerProduction.production_date <= end_date)
    total = q.count()
    items = q.order_by(desc(WorkerProduction.id)).offset((page - 1) * page_size).limit(page_size).all()

    worker_ids = list({i.worker_id for i in items if i.worker_id})
    sku_ids_list = list({i.sku_id for i in items if i.sku_id})
    wmap = {}
    if worker_ids:
        for u in db.query(User.id, User.username, User.real_name).filter(User.id.in_(worker_ids)).all():
            wmap[u.id] = u.real_name or u.username
    smap = {}
    if sku_ids_list:
        for s in db.query(Sku.id, Sku.sku_name, Sku.sku_description, Sku.fruit_name).filter(Sku.id.in_(sku_ids_list)).all():
            smap[s.id] = (s.sku_description or '').strip() or f"{s.fruit_name} {s.sku_name}"

    result = []
    for i in items:
        d = {c.name: getattr(i, c.name) for c in i.__table__.columns}
        d["worker_name"] = wmap.get(i.worker_id, f"#{i.worker_id}")
        d["sku_name"] = smap.get(i.sku_id, f"#{i.sku_id}")
        result.append(d)

    return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}


@router.get("/audit/stats")
def audit_statistics(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Audit overview: counts by status, today's stats, top workers."""
    from app.utils.cache import cache_get, cache_set

    cache_key = f"audit:stats:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    pending = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "pending"
    ).scalar() or 0
    approved = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "approved"
    ).scalar() or 0
    rejected = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "rejected"
    ).scalar() or 0

    today = date.today()
    today_pending = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "pending",
        WorkerProduction.production_date == today,
    ).scalar() or 0
    today_approved = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date == today,
    ).scalar() or 0

    total_qty_pending = db.query(func.coalesce(func.sum(WorkerProduction.actual_packaging_quantity), 0)).filter(
        WorkerProduction.audit_status == "pending"
    ).scalar() or 0

    d7 = today - timedelta(days=6)
    daily_audit = db.query(
        WorkerProduction.production_date.label("d"),
        func.count(WorkerProduction.id).label("cnt"),
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
    ).filter(
        WorkerProduction.production_date.between(d7, today),
        WorkerProduction.audit_status == "approved",
    ).group_by(WorkerProduction.production_date).all()

    date_list = [(d7 + timedelta(days=i)) for i in range(7)]
    daily_map = {r.d: {"count": r.cnt, "qty": int(r.qty or 0)} for r in daily_audit}
    daily_trend = [
        {"date": d.strftime("%m-%d"), "count": daily_map.get(d, {}).get("count", 0), "qty": daily_map.get(d, {}).get("qty", 0)}
        for d in date_list
    ]

    top_workers = db.query(
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
        func.count(WorkerProduction.id).label("cnt"),
    ).filter(
        WorkerProduction.audit_status == "pending",
    ).group_by(WorkerProduction.worker_id).order_by(desc("qty")).limit(5).all()

    wids = [r.worker_id for r in top_workers]
    wname = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wname[w.id] = w.real_name or w.username

    top_pending_workers = [
        {"worker_id": r.worker_id, "name": wname.get(r.worker_id, f"#{r.worker_id}"), "qty": int(r.qty or 0), "count": r.cnt}
        for r in top_workers
    ]

    from app.models import WorkerProductionEdit
    pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(
        WorkerProductionEdit.audit_status == "pending"
    ).scalar() or 0
    today_pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(
        WorkerProductionEdit.audit_status == "pending",
        func.date(WorkerProductionEdit.edit_date) == today,
    ).scalar() or 0

    data = {
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "today_pending": today_pending,
        "today_approved": today_approved,
        "total_qty_pending": int(total_qty_pending),
        "pending_edits": pending_edits,
        "today_pending_edits": today_pending_edits,
        "daily_trend": daily_trend,
        "top_pending_workers": top_pending_workers,
    }
    cache_set(cache_key, data, ttl=30)
    return ApiResponse(data=data)


@router.post("/audit", response_model=ApiResponse)
def audit_production(
    req: ProductionAuditAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    wp = db.query(WorkerProduction).filter(WorkerProduction.id == req.id).first()
    if not wp:
        raise HTTPException(status_code=404, detail="生产记录不存在")

    original_qty = wp.actual_packaging_quantity
    adjusted = False

    if req.action == "approved" and req.adjusted_quantity is not None:
        if req.adjusted_quantity < 0:
            raise HTTPException(status_code=400, detail="调整数量不能为负数")
        printed_qty = db.query(func.count(PrintedLabel.id)).filter(
            and_(PrintedLabel.u == wp.worker_id, PrintedLabel.s == wp.sku_id,
                 func.date(PrintedLabel.created_at) == wp.production_date)
        ).scalar() or 0
        if req.adjusted_quantity > printed_qty:
            raise HTTPException(status_code=400, detail=f"调整数量不能超过打印数量({printed_qty})")
        if req.adjusted_quantity != original_qty:
            wp.actual_packaging_quantity = req.adjusted_quantity
            adjusted = True

    wp.audit_status = req.action
    wp.audit_by = user.id
    wp.audit_at = datetime.now()
    if req.reject_reason and req.action == "rejected":
        wp.reject_reason = req.reject_reason

    action_text = "通过" if req.action == "approved" else "驳回"
    adjust_note = f"（数量 {original_qty}→{req.adjusted_quantity}）" if adjusted else ""
    reason_note = f"，原因：{req.reject_reason}" if req.reject_reason and req.action == "rejected" else ""
    log_action(db, user, f"审核生产记录 #{req.id}：{action_text}{adjust_note}{reason_note}")

    from app.models import UserMessage
    sku_row = db.query(Sku.sku_name, Sku.sku_description, Sku.fruit_name).filter(Sku.id == wp.sku_id).first()
    sku_name = ((sku_row.sku_description or '').strip() or f"{sku_row.fruit_name} {sku_row.sku_name}") if sku_row else f"SKU#{wp.sku_id}"
    msg_detail = f"（数量已由 {original_qty} 调整为 {req.adjusted_quantity}）" if adjusted else f"（{wp.actual_packaging_quantity}件）"
    reject_detail = f"，原因：{req.reject_reason}" if req.reject_reason and req.action == "rejected" else ""
    db.add(UserMessage(
        user_id=wp.worker_id,
        title=f"生产审核{'通过' if req.action == 'approved' else '被驳回'}",
        content=f"您 {wp.production_date} 的 {sku_name} 记录{msg_detail}已{'通过审核' if req.action == 'approved' else '被驳回'}{reject_detail}",
        msg_type="audit",
        link="/workers/performance",
    ))

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message=f"审核已{action_text}{adjust_note}")


@router.post("/audit/revoke", response_model=ApiResponse)
def revoke_audit(
    req: ProductionAuditAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """管理员撤回审核 — 将已审核记录恢复为待审核状态，允许重新修改"""
    wp = db.query(WorkerProduction).filter(WorkerProduction.id == req.id).first()
    if not wp:
        raise HTTPException(status_code=404, detail="生产记录不存在")
    if wp.audit_status == "pending":
        raise HTTPException(status_code=400, detail="该记录已经是待审核状态")

    old_status = "已通过" if wp.audit_status == "approved" else "已驳回"
    wp.audit_status = "pending"
    wp.audit_by = None
    wp.audit_at = None
    wp.reject_reason = None

    log_action(db, user, f"撤回审核 #{req.id}：{old_status} → 待审核" + (f"，备注：{req.note}" if req.note else ""))

    from app.models import UserMessage
    db.add(UserMessage(
        user_id=wp.worker_id,
        title="审核已撤回",
        content=f"您 {wp.production_date} 的生产记录审核已被管理员撤回，可重新修改提交",
        msg_type="audit",
        link="/production/input",
    ))

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message="已撤回审核，记录恢复为待审核状态")


@router.post("/audit/batch-revoke", response_model=ApiResponse)
def batch_revoke_audit(
    req: BatchAuditAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """批量撤回审核"""
    if not req.ids:
        raise HTTPException(status_code=400, detail="请选择要撤回的记录")
    if len(req.ids) > 200:
        raise HTTPException(status_code=400, detail="单次最多撤回 200 条")

    records = db.query(WorkerProduction).filter(
        WorkerProduction.id.in_(req.ids),
        WorkerProduction.audit_status.in_(["approved", "rejected"]),
    ).all()
    if not records:
        raise HTTPException(status_code=400, detail="没有可撤回的记录")

    from app.models import UserMessage
    worker_ids = set()
    for wp in records:
        wp.audit_status = "pending"
        wp.audit_by = None
        wp.audit_at = None
        wp.reject_reason = None
        worker_ids.add(wp.worker_id)

    log_action(db, user, f"批量撤回审核 {len(records)} 条记录：{req.ids}")

    for wid in worker_ids:
        db.add(UserMessage(
            user_id=wid,
            title="审核已撤回",
            content=f"您有 {sum(1 for r in records if r.worker_id == wid)} 条生产记录审核已被管理员撤回",
            msg_type="audit",
            link="/production/input",
        ))

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message=f"已撤回 {len(records)} 条记录", data={"processed": len(records)})


@router.post("/audit/batch", response_model=ApiResponse)
def batch_audit_production(
    req: BatchAuditAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not req.ids:
        raise HTTPException(status_code=400, detail="请选择要审核的记录")
    if len(req.ids) > 200:
        raise HTTPException(status_code=400, detail="单次最多审核 200 条")

    records = db.query(WorkerProduction).filter(
        WorkerProduction.id.in_(req.ids),
        WorkerProduction.audit_status == "pending",
    ).all()

    if not records:
        raise HTTPException(status_code=400, detail="没有可审核的待处理记录")

    from app.models import UserMessage

    now = datetime.now()
    count = 0
    worker_msgs: dict[int, int] = {}
    for wp in records:
        wp.audit_status = req.action
        wp.audit_by = user.id
        wp.audit_at = now
        count += 1
        worker_msgs[wp.worker_id] = worker_msgs.get(wp.worker_id, 0) + 1

    action_text = "通过" if req.action == "approved" else "驳回"
    reason_note = f"，原因：{req.reject_reason}" if req.reject_reason and req.action == "rejected" else ""
    log_action(db, user, f"批量审核 {count} 条生产记录：{action_text}{reason_note}")

    for wid, cnt in worker_msgs.items():
        reject_info = f"，驳回原因：{req.reject_reason}" if req.reject_reason and req.action == "rejected" else ""
        db.add(UserMessage(
            user_id=wid,
            title=f"{cnt} 条生产记录已{action_text}",
            content=f"您有 {cnt} 条生产记录已被管理员{'审核通过' if req.action == 'approved' else '驳回'}{reject_info}",
            msg_type="audit",
            link="/workers/performance",
        ))

    if req.reject_reason and req.action == "rejected":
        for wp in records:
            wp.reject_reason = req.reject_reason

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(
        message=f"已批量{action_text} {count} 条记录",
        data={"processed": count, "total": len(req.ids)},
    )


@router.post("/audit/check-changes", response_model=ApiResponse)
def check_has_changes(
    req: CheckChangesAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """批量检查生产记录是否有变更申请"""
    from app.models import WorkerProductionEdit
    if not req.production_ids:
        return ApiResponse(data={"changes": {}})
    edits = db.query(
        WorkerProductionEdit.original_id,
        func.count(WorkerProductionEdit.id).label("edit_count"),
        func.sum(case((WorkerProductionEdit.audit_status == "pending", 1), else_=0)).label("pending_count"),
    ).filter(
        WorkerProductionEdit.original_id.in_(req.production_ids),
    ).group_by(WorkerProductionEdit.original_id).all()

    changes = {}
    for e in edits:
        changes[e.original_id] = {
            "has_edits": True,
            "edit_count": int(e.edit_count),
            "has_pending": int(e.pending_count) > 0,
        }
    return ApiResponse(data={"changes": changes})


@router.get("/audit/smart-scan")
def audit_smart_scan(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """智能审核扫描 — 分析所有待审核记录，给出异常评分"""

    pending = db.query(WorkerProduction).filter(
        WorkerProduction.audit_status == "pending"
    ).order_by(desc(WorkerProduction.id)).limit(200).all()

    if not pending:
        return ApiResponse(data={"records": [], "summary": {"total": 0, "normal": 0, "warning": 0, "danger": 0}})

    worker_ids = list({p.worker_id for p in pending})
    sku_ids_list = list({p.sku_id for p in pending})

    wmap = {}
    if worker_ids:
        for u2 in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            wmap[u2.id] = u2.real_name or u2.username
    smap = {}
    if sku_ids_list:
        for s in db.query(Sku.id, Sku.sku_name, Sku.production_performance).filter(Sku.id.in_(sku_ids_list)).all():
            smap[s.id] = {"name": s.sku_name, "perf": float(s.production_performance or 0)}

    worker_history = {}
    for wid in worker_ids:
        rows = db.query(
            WorkerProduction.sku_id,
            func.avg(WorkerProduction.actual_packaging_quantity).label("avg_qty"),
            func.stddev(WorkerProduction.actual_packaging_quantity).label("std_qty"),
            func.count(WorkerProduction.id).label("cnt"),
        ).filter(
            WorkerProduction.worker_id == wid,
            WorkerProduction.audit_status == "approved",
        ).group_by(WorkerProduction.sku_id).all()
        worker_history[wid] = {
            r.sku_id: {
                "avg": float(r.avg_qty or 0),
                "std": float(r.std_qty or 0),
                "cnt": int(r.cnt or 0),
            } for r in rows
        }

    records = []
    normal_count = 0
    warning_count = 0
    danger_count = 0

    for p in pending:
        anomaly_score = 0
        reasons = []
        sku_info = smap.get(p.sku_id, {"name": f"#{p.sku_id}", "perf": 0})

        qty = p.actual_packaging_quantity or 0
        printed = p.printed_quantity or 0

        if printed > 0 and qty > printed:
            anomaly_score += 3
            reasons.append(f"超过打印数({qty}>{printed})")

        completion = (qty / printed * 100) if printed > 0 else 0
        if printed > 0 and completion < 30 and qty > 0:
            anomaly_score += 1
            reasons.append(f"完成率极低({completion:.0f}%)")

        hist = worker_history.get(p.worker_id, {}).get(p.sku_id)
        if hist and hist["cnt"] >= 3:
            avg = hist["avg"]
            std = max(hist["std"], 1)
            if avg > 0:
                z_score = abs(qty - avg) / std
                if z_score > 3:
                    anomaly_score += 2
                    reasons.append(f"偏离历史均值(avg:{avg:.0f} ±{std:.0f})")
                elif z_score > 2:
                    anomaly_score += 1
                    reasons.append(f"偏离历史均值(z={z_score:.1f})")

        if qty == 0 and printed > 0:
            anomaly_score += 1
            reasons.append("录入为0但有打印标签")

        if anomaly_score >= 3:
            level = "danger"
            danger_count += 1
        elif anomaly_score >= 1:
            level = "warning"
            warning_count += 1
        else:
            level = "normal"
            normal_count += 1

        records.append({
            "id": p.id,
            "worker_id": p.worker_id,
            "worker_name": wmap.get(p.worker_id, f"#{p.worker_id}"),
            "sku_id": p.sku_id,
            "sku_name": sku_info["name"],
            "production_date": p.production_date.isoformat() if p.production_date else "",
            "printed_quantity": printed,
            "actual_quantity": qty,
            "completion_rate": round(completion, 1),
            "anomaly_score": anomaly_score,
            "anomaly_level": level,
            "anomaly_reasons": reasons,
        })

    records.sort(key=lambda x: x["anomaly_score"], reverse=True)

    return ApiResponse(data={
        "records": records,
        "summary": {
            "total": len(records),
            "normal": normal_count,
            "warning": warning_count,
            "danger": danger_count,
        },
    })


@router.post("/audit/approve-normal")
def approve_all_normal(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """一键审核全部正常记录（异常评分为0的待审核记录）"""
    pending = db.query(WorkerProduction).filter(
        WorkerProduction.audit_status == "pending"
    ).all()

    approved_ids = []
    for p in pending:
        qty = p.actual_packaging_quantity or 0
        printed = p.printed_quantity or 0

        if printed > 0 and qty > printed:
            continue
        if qty == 0 and printed > 0:
            continue

        worker_hist = db.query(
            func.avg(WorkerProduction.actual_packaging_quantity).label("avg_qty"),
            func.stddev(WorkerProduction.actual_packaging_quantity).label("std_qty"),
            func.count(WorkerProduction.id).label("cnt"),
        ).filter(
            WorkerProduction.worker_id == p.worker_id,
            WorkerProduction.sku_id == p.sku_id,
            WorkerProduction.audit_status == "approved",
        ).first()

        if worker_hist and int(worker_hist.cnt or 0) >= 3:
            avg = float(worker_hist.avg_qty or 0)
            std = max(float(worker_hist.std_qty or 0), 1)
            if avg > 0 and abs(qty - avg) / std > 2:
                continue

        completion = (qty / printed * 100) if printed > 0 else 100
        if printed > 0 and completion < 30 and qty > 0:
            continue

        p.audit_status = "approved"
        p.audit_by = user.id
        p.audit_at = datetime.now()
        approved_ids.append(p.id)

    if approved_ids:
        db.commit()
        log_action(db, user.id, user.username, "batch_auto_approve",
                   data_after={"approved_ids": approved_ids[:20], "total": len(approved_ids)})
        cache_clear_prefix("audit:")
        cache_clear_prefix("dashboard:")

    return ApiResponse(
        data={"approved_count": len(approved_ids)},
        message=f"已自动审核通过 {len(approved_ids)} 条正常记录"
    )


@router.get("/audit/efficiency")
def audit_efficiency(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """审核效率统计 — 今日/本周/本月审核数据"""
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)

    today_approved = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "approved",
        func.date(WorkerProduction.audit_at) == today,
    ).scalar() or 0

    today_rejected = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "rejected",
        func.date(WorkerProduction.audit_at) == today,
    ).scalar() or 0

    week_approved = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "approved",
        func.date(WorkerProduction.audit_at) >= week_start,
    ).scalar() or 0

    month_approved = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "approved",
        func.date(WorkerProduction.audit_at) >= month_start,
    ).scalar() or 0

    pending_total = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "pending",
    ).scalar() or 0

    daily_trend = db.query(
        func.date(WorkerProduction.audit_at).label("d"),
        func.count(WorkerProduction.id).label("cnt"),
    ).filter(
        WorkerProduction.audit_status == "approved",
        func.date(WorkerProduction.audit_at) >= today - timedelta(days=6),
    ).group_by(func.date(WorkerProduction.audit_at)).all()

    trend = []
    for i in range(7):
        d = today - timedelta(days=6 - i)
        cnt = next((int(r.cnt) for r in daily_trend if r.d == d), 0)
        trend.append({"date": d.isoformat(), "count": cnt})

    return ApiResponse(data={
        "today_approved": today_approved,
        "today_rejected": today_rejected,
        "today_total": today_approved + today_rejected,
        "week_approved": week_approved,
        "month_approved": month_approved,
        "pending_total": pending_total,
        "daily_trend": trend,
    })


# ─── 工人生产录入 ───
@router.post("/worker-input", response_model=ApiResponse[WorkerProductionOut])
def worker_production_input(
    req: WorkerProductionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.models import WorkerProductionEdit

    if req.actual_packaging_quantity <= 0:
        raise HTTPException(status_code=400, detail="包装数量必须大于0")
    if req.actual_packaging_quantity > 50000:
        raise HTTPException(status_code=400, detail="包装数量异常（超过50000），请检查输入")

    printed_qty = db.query(func.count(PrintedLabel.id)).filter(
        and_(PrintedLabel.u == user.id, PrintedLabel.s == req.sku_id,
             func.date(PrintedLabel.created_at) == req.production_date)
    ).scalar() or 0

    # Validate: actual packaging cannot exceed printed quantity
    if printed_qty > 0 and req.actual_packaging_quantity > printed_qty:
        raise HTTPException(
            status_code=400,
            detail=f"实际包装数量（{req.actual_packaging_quantity}）不能超过打印数量（{printed_qty}）"
        )

    existing = db.query(WorkerProduction).filter(
        WorkerProduction.sku_id == req.sku_id,
        WorkerProduction.worker_id == user.id,
        WorkerProduction.production_date == req.production_date,
    ).first()

    if existing:
        if existing.audit_status == "approved":
            # Check for existing pending edit request (prevent stacking)
            pending_edit = db.query(WorkerProductionEdit).filter(
                WorkerProductionEdit.original_id == existing.id,
                WorkerProductionEdit.audit_status == "pending",
            ).first()
            if pending_edit:
                raise HTTPException(
                    status_code=400,
                    detail="您已有一条待审核的修改申请，请等待管理员审批后再提交"
                )
            edit = WorkerProductionEdit(
                original_id=existing.id,
                worker_id=user.id,
                sku_id=req.sku_id,
                production_date=req.production_date,
                actual_packaging_quantity=req.actual_packaging_quantity,
            )
            db.add(edit)
            db.commit()
            db.refresh(existing)
            return ApiResponse(data=existing, message="该记录已审核通过，已提交修改申请等待管理员审批")
        elif existing.audit_status == "rejected":
            # Rejected: allow re-submit as a fresh pending entry
            existing.actual_packaging_quantity = req.actual_packaging_quantity
            existing.printed_quantity = max(printed_qty, existing.printed_quantity or 0)
            existing.audit_status = "pending"
            existing.reject_reason = None
            db.commit()
            db.refresh(existing)
            return ApiResponse(data=existing, message="已重新提交，等待审核")
        else:
            existing.actual_packaging_quantity = req.actual_packaging_quantity
            existing.printed_quantity = printed_qty
            db.commit()
            db.refresh(existing)
            return ApiResponse(data=existing, message="已更新生产数量")
    else:
        txn_qty = db.query(func.coalesce(func.sum(SkuTransaction.quantity), 0)).filter(
            SkuTransaction.sku_id == req.sku_id,
            SkuTransaction.worker_id == user.id,
            func.date(SkuTransaction.transaction_date) == req.production_date,
        ).scalar() or 0

        wp = WorkerProduction(
            worker_id=user.id,
            sku_id=req.sku_id,
            production_date=req.production_date,
            printed_quantity=printed_qty if printed_qty > 0 else int(txn_qty),
            actual_packaging_quantity=req.actual_packaging_quantity,
        )
        db.add(wp)
        db.commit()
        db.refresh(wp)
        return ApiResponse(data=wp)


@router.post("/batch-worker-input")
def batch_worker_input(
    req: BatchWorkerInputAction,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """批量工人生产录入 — 一次保存多个SKU的实际包装数量"""
    from app.models import WorkerProductionEdit

    if not req.items:
        raise HTTPException(status_code=400, detail="没有需要保存的数据")
    if len(req.items) > 50:
        raise HTTPException(status_code=400, detail="单次最多保存50条")

    saved = []
    skipped = []
    errors = []

    for item in req.items:
        try:
            if item.actual_packaging_quantity < 0:
                errors.append({"sku_id": item.sku_id, "error": "数量不能为负数"})
                continue

            printed_qty = db.query(func.count(PrintedLabel.id)).filter(
                and_(PrintedLabel.u == user.id, PrintedLabel.s == item.sku_id,
                     func.date(PrintedLabel.created_at) == item.production_date)
            ).scalar() or 0

            if printed_qty > 0 and item.actual_packaging_quantity > printed_qty:
                errors.append({"sku_id": item.sku_id, "error": f"不能超过打印数量({printed_qty})"})
                continue

            existing = db.query(WorkerProduction).filter(
                WorkerProduction.sku_id == item.sku_id,
                WorkerProduction.worker_id == user.id,
                WorkerProduction.production_date == item.production_date,
            ).first()

            if existing:
                if existing.audit_status == "approved":
                    pending_edit = db.query(WorkerProductionEdit).filter(
                        WorkerProductionEdit.original_id == existing.id,
                        WorkerProductionEdit.audit_status == "pending",
                    ).first()
                    if pending_edit:
                        skipped.append({"sku_id": item.sku_id, "reason": "已有待审核修改申请"})
                        continue
                    edit = WorkerProductionEdit(
                        original_id=existing.id,
                        worker_id=user.id,
                        sku_id=item.sku_id,
                        production_date=item.production_date,
                        actual_packaging_quantity=item.actual_packaging_quantity,
                    )
                    db.add(edit)
                    saved.append({"sku_id": item.sku_id, "type": "edit_request"})
                elif existing.audit_status == "rejected":
                    existing.actual_packaging_quantity = item.actual_packaging_quantity
                    existing.printed_quantity = max(printed_qty, existing.printed_quantity or 0)
                    existing.audit_status = "pending"
                    existing.reject_reason = None
                    saved.append({"sku_id": item.sku_id, "type": "resubmit"})
                else:
                    if existing.actual_packaging_quantity == item.actual_packaging_quantity:
                        skipped.append({"sku_id": item.sku_id, "reason": "数量未变化"})
                        continue
                    existing.actual_packaging_quantity = item.actual_packaging_quantity
                    existing.printed_quantity = printed_qty
                    saved.append({"sku_id": item.sku_id, "type": "update"})
            else:
                txn_qty = db.query(func.coalesce(func.sum(SkuTransaction.quantity), 0)).filter(
                    SkuTransaction.sku_id == item.sku_id,
                    SkuTransaction.worker_id == user.id,
                    func.date(SkuTransaction.transaction_date) == item.production_date,
                ).scalar() or 0

                wp = WorkerProduction(
                    worker_id=user.id,
                    sku_id=item.sku_id,
                    production_date=item.production_date,
                    printed_quantity=printed_qty if printed_qty > 0 else int(txn_qty),
                    actual_packaging_quantity=item.actual_packaging_quantity,
                )
                db.add(wp)
                saved.append({"sku_id": item.sku_id, "type": "create"})

        except Exception as e:
            errors.append({"sku_id": item.sku_id, "error": str(e)})

    if saved:
        db.commit()

    return ApiResponse(data={
        "saved_count": len(saved),
        "skipped_count": len(skipped),
        "error_count": len(errors),
        "saved": saved,
        "skipped": skipped,
        "errors": errors,
    }, message=f"批量保存完成：成功{len(saved)}条，跳过{len(skipped)}条，失败{len(errors)}条")


@router.get("/label-lifecycle/{label_id}")
def label_lifecycle(
    label_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """标签全生命周期追踪 — 从打印到出库的完整时间线"""
    from app.models import WorkerProductionEdit, UploadRecord

    label = db.query(PrintedLabel).filter(PrintedLabel.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="标签不存在")

    sku = db.query(Sku).filter(Sku.id == label.s).first()
    worker = db.query(User).filter(User.id == label.u).first()
    purchase = db.query(FruitPurchase).filter(FruitPurchase.id == label.b).first()

    day_prefix = label.created_at.strftime("%d") if label.created_at else "00"
    barcode = f"{day_prefix}{label.id}"

    events = []

    if purchase:
        events.append({
            "stage": "purchase",
            "title": "采购入库",
            "description": f"{purchase.fruit_name} · {purchase.supplier_name}",
            "time": purchase.purchase_date.isoformat() if purchase.purchase_date else None,
            "status": "completed",
        })

    if label.created_at:
        events.append({
            "stage": "printed",
            "title": "标签打印",
            "description": f"SKU: {sku.sku_name if sku else '未知'} · 预估{float(label.estimated_weight or 0):.0f}g",
            "time": label.created_at.isoformat() if label.created_at else None,
            "status": "completed",
        })

    prod = db.query(WorkerProduction).filter(
        WorkerProduction.worker_id == label.u,
        WorkerProduction.sku_id == label.s,
        WorkerProduction.production_date == (label.created_at.date() if label.created_at else None),
    ).first()

    if prod:
        audit_map = {"pending": "待审核", "approved": "已通过", "rejected": "已驳回"}
        events.append({
            "stage": "production_input",
            "title": "生产录入",
            "description": f"实际包装: {prod.actual_packaging_quantity} · 打印: {prod.printed_quantity}",
            "time": prod.created_at.isoformat() if prod.created_at else None,
            "status": "completed",
        })
        events.append({
            "stage": "audit",
            "title": "生产审核",
            "description": audit_map.get(prod.audit_status, prod.audit_status or ""),
            "time": prod.audit_at.isoformat() if hasattr(prod, 'audit_at') and prod.audit_at else None,
            "status": "completed" if prod.audit_status == "approved" else ("error" if prod.audit_status == "rejected" else "pending"),
        })
    else:
        events.append({
            "stage": "production_input",
            "title": "生产录入",
            "description": "尚未录入",
            "time": None,
            "status": "waiting",
        })
        events.append({
            "stage": "audit",
            "title": "生产审核",
            "description": "等待生产录入",
            "time": None,
            "status": "waiting",
        })

    events.append({
        "stage": "warehouse",
        "title": "仓库存放",
        "description": "标签在仓库等待出库" if label.scanned_outbound == 0 else "已从仓库出库",
        "time": None,
        "status": "current" if label.scanned_outbound == 0 and prod and prod.audit_status == "approved" else (
            "completed" if label.scanned_outbound > 0 else "waiting"
        ),
    })

    if label.scanned_outbound > 0:
        scan_upload = db.query(UploadRecord).filter(
            UploadRecord.tickets_num == barcode
        ).order_by(desc(UploadRecord.id)).first()

        events.append({
            "stage": "outbound",
            "title": "出库扫码",
            "description": f"实际{float(label.actual_weight or 0):.0f}g · 差异{float(label.weight_difference or 0):.1f}g"
                + (f" · 设备{scan_upload.machine_number}" if scan_upload and scan_upload.machine_number else ""),
            "time": label.scanned_time.isoformat() if label.scanned_time else None,
            "status": "completed",
        })
    else:
        events.append({
            "stage": "outbound",
            "title": "出库扫码",
            "description": "等待出库",
            "time": None,
            "status": "waiting",
        })

    commission = 0.0
    if label.scanned_outbound > 0 and sku:
        commission = float(sku.production_performance or 0)

    return ApiResponse(data={
        "label_id": label.id,
        "barcode": barcode,
        "sku_name": sku.sku_name if sku else "",
        "fruit_name": sku.fruit_name if sku else "",
        "worker_name": worker.real_name or worker.username if worker else "",
        "estimated_weight": float(label.estimated_weight or 0),
        "actual_weight": float(label.actual_weight or 0),
        "weight_difference": float(label.weight_difference or 0),
        "scanned_outbound": label.scanned_outbound or 0,
        "commission": commission,
        "events": events,
    })


@router.get("/my-production", response_model=PaginatedResponse[WorkerProductionOut])
def my_production(
    page: int = 1,
    page_size: int = 20,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(WorkerProduction).filter(WorkerProduction.worker_id == user.id)
    total = q.count()
    items = q.order_by(desc(WorkerProduction.id)).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(data=items, total=total, page=page, page_size=page_size)


@router.get("/my-daily-summary")
def my_daily_summary(
    production_date: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Worker's daily production summary: for each SKU with printed labels,
    show printed qty, submitted qty, audit status, pending edits.
    Mirrors old system worker_production_input.php getData()."""
    from app.models import WorkerProductionEdit, Sku as SkuModel

    target_date = production_date or date.today()

    label_rows = db.query(
        PrintedLabel.s.label("sku_id"),
        func.count(PrintedLabel.id).label("printed_quantity"),
    ).filter(
        PrintedLabel.u == user.id,
        func.date(PrintedLabel.created_at) == target_date,
    ).group_by(PrintedLabel.s).all()

    if not label_rows:
        return ApiResponse(data={"date": str(target_date), "items": [], "summary": {"total_printed": 0, "total_actual": 0, "total_skus": 0}})

    sku_ids = [r.sku_id for r in label_rows]
    sku_map = {s.id: s for s in db.query(SkuModel).filter(SkuModel.id.in_(sku_ids)).all()}

    prod_rows = db.query(WorkerProduction).filter(
        WorkerProduction.worker_id == user.id,
        WorkerProduction.production_date == target_date,
        WorkerProduction.sku_id.in_(sku_ids),
    ).all()
    prod_map = {p.sku_id: p for p in prod_rows}

    edit_rows = db.query(WorkerProductionEdit).filter(
        WorkerProductionEdit.worker_id == user.id,
        WorkerProductionEdit.production_date == target_date,
        WorkerProductionEdit.sku_id.in_(sku_ids),
        WorkerProductionEdit.audit_status == "pending",
    ).all()
    edit_map = {e.sku_id: e for e in edit_rows}

    items = []
    total_printed = 0
    total_actual = 0
    for r in label_rows:
        sku = sku_map.get(r.sku_id)
        prod = prod_map.get(r.sku_id)
        edit = edit_map.get(r.sku_id)
        printed = r.printed_quantity
        actual = prod.actual_packaging_quantity if prod else 0
        total_printed += printed
        total_actual += actual

        items.append({
            "sku_id": r.sku_id,
            "sku_name": sku.sku_name if sku else f"#{r.sku_id}",
            "sku_description": sku.sku_description if sku else "",
            "fruit_name": sku.fruit_name if sku else "",
            "production_performance": float(sku.production_performance) if sku else 0,
            "printed_quantity": printed,
            "actual_quantity": actual,
            "audit_status": prod.audit_status if prod else "none",
            "production_id": prod.id if prod else None,
            "has_pending_edit": edit is not None,
            "pending_edit_quantity": edit.actual_packaging_quantity if edit else None,
        })

    items.sort(key=lambda x: x["sku_name"])

    return ApiResponse(data={
        "date": str(target_date),
        "items": items,
        "summary": {
            "total_printed": total_printed,
            "total_actual": total_actual,
            "total_skus": len(items),
            "completion_rate": round(total_actual / total_printed * 100, 1) if total_printed > 0 else 0,
        },
    })


# ─── 修改申请 ───
@router.get("/edit-requests")
def list_edit_requests(
    page: int = 1,
    page_size: int = 20,
    status: str | None = None,
    worker_id: int | None = None,
    sku_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models import WorkerProductionEdit
    q = db.query(WorkerProductionEdit)
    if status:
        q = q.filter(WorkerProductionEdit.audit_status == status)
    if worker_id:
        q = q.filter(WorkerProductionEdit.worker_id == worker_id)
    if sku_id:
        q = q.filter(WorkerProductionEdit.sku_id == sku_id)
    if start_date:
        q = q.filter(WorkerProductionEdit.production_date >= start_date)
    if end_date:
        q = q.filter(WorkerProductionEdit.production_date <= end_date)

    total = q.count()
    items = q.order_by(desc(WorkerProductionEdit.id)).offset((page - 1) * page_size).limit(page_size).all()

    wids = list({i.worker_id for i in items if i.worker_id})
    sids = list({i.sku_id for i in items if i.sku_id})
    oIds = list({i.original_id for i in items if i.original_id})
    wmap = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wmap[w.id] = w.real_name or w.username
    smap = {}
    if sids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.sku_description, Sku.fruit_name).filter(Sku.id.in_(sids)).all():
            smap[s.id] = (s.sku_description or '').strip() or f"{s.fruit_name} {s.sku_name}"
    orig_map = {}
    if oIds:
        for wp in db.query(WorkerProduction.id, WorkerProduction.actual_packaging_quantity).filter(WorkerProduction.id.in_(oIds)).all():
            orig_map[wp.id] = wp.actual_packaging_quantity

    result = []
    for i in items:
        result.append({
            "id": i.id,
            "original_id": i.original_id,
            "worker_id": i.worker_id,
            "worker_name": wmap.get(i.worker_id, f"#{i.worker_id}"),
            "sku_id": i.sku_id,
            "sku_name": smap.get(i.sku_id, f"#{i.sku_id}"),
            "production_date": str(i.production_date) if i.production_date else None,
            "new_quantity": i.actual_packaging_quantity,
            "old_quantity": int(orig_map.get(i.original_id, 0)),
            "audit_status": i.audit_status,
            "edit_date": i.edit_date.isoformat() if i.edit_date else None,
        })
    return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}


@router.post("/edit-requests/{edit_id}/audit", response_model=ApiResponse)
def audit_edit_request(
    edit_id: int,
    req: ProductionAuditAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models import WorkerProductionEdit

    edit = db.query(WorkerProductionEdit).filter(WorkerProductionEdit.id == edit_id).first()
    if not edit:
        raise HTTPException(status_code=404, detail="修改申请不存在")
    if edit.audit_status != "pending":
        raise HTTPException(status_code=400, detail="该申请已处理")

    from app.models import UserMessage

    if req.action == "approved":
        orig = db.query(WorkerProduction).filter(WorkerProduction.id == edit.original_id).first()
        if orig:
            orig.actual_packaging_quantity = edit.actual_packaging_quantity
            orig.audit_status = "pending"
        edit.audit_status = "approved"
        log_action(db, user, f"通过修改申请 #{edit_id}：原记录#{edit.original_id} 数量改为 {edit.actual_packaging_quantity}")
    else:
        edit.audit_status = "rejected"
        log_action(db, user, f"驳回修改申请 #{edit_id}")

    action_text = "通过" if req.action == "approved" else "驳回"
    db.add(UserMessage(
        user_id=edit.worker_id,
        title=f"修改申请已{action_text}",
        content=f"您的生产数据修改申请（改为 {edit.actual_packaging_quantity} 件）已{action_text}",
        msg_type="audit",
        link="/production/input",
    ))

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message=f"修改申请已{action_text}")


@router.post("/edit-requests/batch", response_model=ApiResponse)
def batch_audit_edit_requests(
    req: BatchEditAuditAction,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models import WorkerProductionEdit, UserMessage

    if not req.ids:
        raise HTTPException(status_code=400, detail="请选择要处理的修改申请")
    if len(req.ids) > 200:
        raise HTTPException(status_code=400, detail="单次最多处理 200 条")

    edits = db.query(WorkerProductionEdit).filter(
        WorkerProductionEdit.id.in_(req.ids),
        WorkerProductionEdit.audit_status == "pending",
    ).all()
    if not edits:
        raise HTTPException(status_code=400, detail="没有可处理的待审核修改申请")

    count = 0
    worker_msgs: dict[int, int] = {}
    for edit in edits:
        if req.action == "approved":
            orig = db.query(WorkerProduction).filter(WorkerProduction.id == edit.original_id).first()
            if orig:
                orig.actual_packaging_quantity = edit.actual_packaging_quantity
                orig.audit_status = "pending"
            edit.audit_status = "approved"
        else:
            edit.audit_status = "rejected"
        count += 1
        worker_msgs[edit.worker_id] = worker_msgs.get(edit.worker_id, 0) + 1

    action_text = "通过" if req.action == "approved" else "驳回"
    log_action(db, user, f"批量{action_text} {count} 条修改申请")

    for wid, cnt in worker_msgs.items():
        db.add(UserMessage(
            user_id=wid,
            title=f"{cnt} 条修改申请已{action_text}",
            content=f"您有 {cnt} 条生产数据修改申请已被管理员{action_text}",
            msg_type="audit",
            link="/production/input",
        ))

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(
        message=f"已批量{action_text} {count} 条修改申请",
        data={"processed": count, "total": len(req.ids)},
    )


@router.get("/audit/change-history/{production_id}")
def get_change_history(
    production_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    from app.models import WorkerProductionEdit

    wp = db.query(WorkerProduction).filter(WorkerProduction.id == production_id).first()
    if not wp:
        raise HTTPException(status_code=404, detail="生产记录不存在")

    edits = db.query(WorkerProductionEdit).filter(
        WorkerProductionEdit.original_id == production_id
    ).order_by(desc(WorkerProductionEdit.edit_date)).limit(50).all()

    worker_name = db.query(User.real_name, User.username).filter(User.id == wp.worker_id).first()
    sku_row = db.query(Sku.sku_name, Sku.sku_description, Sku.fruit_name).filter(Sku.id == wp.sku_id).first()
    sku_name = ((sku_row.sku_description or '').strip() or f"{sku_row.fruit_name} {sku_row.sku_name}") if sku_row else f"#{wp.sku_id}"
    w_display = (worker_name.real_name or worker_name.username) if worker_name else f"#{wp.worker_id}"

    history = []
    for e in edits:
        history.append({
            "id": e.id,
            "new_quantity": e.actual_packaging_quantity,
            "audit_status": e.audit_status,
            "edit_date": e.edit_date.isoformat() if e.edit_date else None,
        })

    return ApiResponse(data={
        "production_id": production_id,
        "worker_name": w_display,
        "sku_name": sku_name,
        "production_date": str(wp.production_date),
        "current_quantity": wp.actual_packaging_quantity,
        "printed_quantity": wp.printed_quantity,
        "audit_status": wp.audit_status,
        "history": history,
    })


# ─── 出库扫码 ───
@router.post("/outbound/scan", response_model=ApiResponse)
def scan_outbound(
    label_id: int,
    actual_weight: float = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """External device calls this to mark a label as outbound-scanned."""
    label = db.query(PrintedLabel).filter(PrintedLabel.id == label_id).first()
    if not label:
        db.add(FailureLog(
            tickets_num=label_id, user_id=user.id, worker_id=0,
            sku_id=0, batch_id=0,
            failure_reason=f"标签#{label_id}不存在",
            scanned_weight=actual_weight,
        ))
        db.commit()
        raise HTTPException(status_code=404, detail="标签不存在")

    if label.scanned_outbound:
        db.add(FailureLog(
            tickets_num=label_id, user_id=user.id,
            worker_id=label.u or 0, sku_id=label.s or 0, batch_id=label.b or 0,
            failure_reason=f"标签#{label_id}重复扫码，已于{label.scanned_time}出库",
            scanned_weight=actual_weight,
        ))
        db.commit()
        raise HTTPException(status_code=400, detail="该标签已出库，请勿重复扫码")

    label.scanned_outbound = True
    label.scanned_time = datetime.now()
    if actual_weight > 0:
        label.actual_weight = actual_weight

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(
        message="出库扫码成功",
        data={
            "label_id": label.id,
            "sku_id": label.s,
            "estimated_weight": float(label.estimated_weight or 0),
            "actual_weight": float(label.actual_weight or 0),
            "weight_difference": float(label.weight_difference or 0),
        },
    )


@router.post("/outbound/manual", response_model=ApiResponse)
def manual_outbound(
    label_id: int,
    notes: str = "",
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin manually marks a label as outbound (no weight)."""
    label = db.query(PrintedLabel).filter(PrintedLabel.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="标签不存在")
    if label.scanned_outbound:
        raise HTTPException(status_code=400, detail="该标签已出库")

    label.scanned_outbound = True
    label.scanned_time = datetime.now()

    log_entry = ManualOutboundLog(
        ticket_id=label.id,
        operator_id=user.id,
        estimated_weight=label.estimated_weight,
        notes=notes,
    )
    db.add(log_entry)
    log_action(db, user, f"手动出库：标签#{label_id}")
    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(message="手动出库成功")


@router.get("/outbound/stats")
def outbound_stats(
    view_date: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Daily outbound statistics."""
    d = view_date or date.today()
    total = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).scalar() or 0
    total_weight = float(db.query(func.coalesce(func.sum(PrintedLabel.actual_weight), 0)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).scalar() or 0)
    worker_count = db.query(func.count(func.distinct(PrintedLabel.u))).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).scalar() or 0
    sku_count = db.query(func.count(func.distinct(PrintedLabel.s))).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).scalar() or 0
    return ApiResponse(data={
        "date": str(d),
        "total_outbound": total,
        "total_weight": round(total_weight, 2),
        "worker_count": worker_count,
        "sku_count": sku_count,
    })


# ─── 出库扫码增强 (JSON body) ───
class ScanRequest(BaseModel):
    label_id: int
    actual_weight: float = 0

class ManualOutboundRequest(BaseModel):
    label_id: int
    notes: str = ""

@router.post("/outbound/scan-json", response_model=ApiResponse)
def scan_outbound_json(
    req: ScanRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """JSON body version of outbound scan with weight validation."""
    label = db.query(PrintedLabel).filter(PrintedLabel.id == req.label_id).first()

    sku_info = None
    worker_name = ""
    if label:
        sku = db.query(Sku.sku_name, Sku.fruit_name).filter(Sku.id == label.s).first()
        sku_info = {"name": sku.sku_name if sku else f"SKU#{label.s}", "fruit": sku.fruit_name if sku else ""}
        w = db.query(User.real_name, User.username).filter(User.id == label.u).first()
        worker_name = (w.real_name or w.username) if w else f"#{label.u}"

    if not label:
        db.add(FailureLog(
            tickets_num=req.label_id, user_id=user.id, worker_id=0,
            sku_id=0, batch_id=0,
            failure_reason=f"标签#{req.label_id}不存在",
            scanned_weight=req.actual_weight,
        ))
        db.commit()
        raise HTTPException(status_code=404, detail=f"标签 #{req.label_id} 不存在")

    is_rescan = False
    if label.scanned_outbound:
        if label.weight_abnormal:
            is_rescan = True
        else:
            db.add(FailureLog(
                tickets_num=req.label_id, user_id=user.id,
                worker_id=label.u or 0, sku_id=label.s or 0, batch_id=label.b or 0,
                failure_reason=f"标签#{req.label_id}重复扫码，已于{label.scanned_time}出库",
                scanned_weight=req.actual_weight,
            ))
            db.commit()
            raise HTTPException(status_code=400, detail=f"该标签已于 {label.scanned_time.strftime('%m-%d %H:%M') if label.scanned_time else '未知时间'} 出库，请勿重复扫码")

    weight_diff = 0.0
    weight_warning = None
    weight_exceeded = False
    est = float(label.estimated_weight or 0)
    if req.actual_weight > 0:
        weight_diff = round(req.actual_weight - est, 2)
        ws = db.query(WeightSetting).order_by(desc(WeightSetting.id)).first()
        max_diff = float(ws.max_weight_difference) if ws else 999
        max_pct = float(ws.max_weight_percentage) if ws and ws.max_weight_percentage else None
        diff_abs = abs(weight_diff)
        weight_exceeded = diff_abs > max_diff
        if max_pct and est > 0:
            weight_exceeded = weight_exceeded or (diff_abs / est) * 100 > max_pct
        if weight_exceeded:
            db.add(FailureLog(
                tickets_num=req.label_id, user_id=user.id,
                worker_id=label.u or 0, sku_id=label.s or 0, batch_id=label.b or 0,
                failure_reason=f"重量差值过大：预估{est}kg 实际{req.actual_weight}kg 差值{weight_diff}kg",
                scanned_weight=req.actual_weight,
            ))
            weight_warning = f"重量差异超标：差值 {weight_diff}kg（限制 {max_diff}kg）"

    if is_rescan and not weight_exceeded:
        label.actual_weight = req.actual_weight if req.actual_weight > 0 else label.actual_weight
        label.weight_abnormal = False
        label.weight_fixed = True
        label.weight_fixed_time = datetime.now()
        label.scanned_time = datetime.now()
        db.commit()
        cache_clear_prefix("dashboard")
        return ApiResponse(
            message="重新扫码成功，重量已修正",
            data={
                "label_id": label.id, "sku_id": label.s,
                "sku_name": sku_info.get("name", "") if sku_info else "",
                "fruit_name": sku_info.get("fruit", "") if sku_info else "",
                "worker_id": label.u, "worker_name": worker_name, "batch_id": label.b,
                "estimated_weight": est,
                "actual_weight": float(label.actual_weight or 0),
                "weight_difference": weight_diff,
                "scanned_time": label.scanned_time.isoformat() if label.scanned_time else None,
                "weight_warning": None, "weight_fixed": True,
            },
        )

    if is_rescan and weight_exceeded:
        label.actual_weight = req.actual_weight if req.actual_weight > 0 else label.actual_weight
        label.scanned_time = datetime.now()
        db.commit()
        return ApiResponse(
            message=f"重新扫码但重量仍异常（{weight_warning}）",
            data={
                "label_id": label.id, "sku_id": label.s,
                "sku_name": sku_info.get("name", "") if sku_info else "",
                "fruit_name": sku_info.get("fruit", "") if sku_info else "",
                "worker_id": label.u, "worker_name": worker_name, "batch_id": label.b,
                "estimated_weight": est,
                "actual_weight": float(label.actual_weight or 0),
                "weight_difference": weight_diff,
                "scanned_time": label.scanned_time.isoformat() if label.scanned_time else None,
                "weight_warning": weight_warning, "weight_abnormal": True,
            },
        )

    label.scanned_outbound = True
    label.scanned_time = datetime.now()
    if req.actual_weight > 0:
        label.actual_weight = req.actual_weight
    if weight_exceeded:
        label.weight_abnormal = True
        label.weight_fixed = False

    db.commit()
    cache_clear_prefix("dashboard")
    return ApiResponse(
        message="出库扫码成功" + (f"（{weight_warning}，已标记异常）" if weight_warning else ""),
        data={
            "label_id": label.id, "sku_id": label.s,
            "sku_name": sku_info.get("name", "") if sku_info else "",
            "fruit_name": sku_info.get("fruit", "") if sku_info else "",
            "worker_id": label.u, "worker_name": worker_name, "batch_id": label.b,
            "estimated_weight": est,
            "actual_weight": float(label.actual_weight or 0),
            "weight_difference": float(label.weight_difference or 0),
            "scanned_time": label.scanned_time.isoformat() if label.scanned_time else None,
            "weight_warning": weight_warning, "weight_abnormal": weight_exceeded,
        },
    )


# ─── 重量异常记录查询 ───
@router.get("/outbound/weight-abnormal")
def weight_abnormal_list(
    page: int = 1,
    page_size: int = 20,
    status: str = "all",
    days: int = 30,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    cutoff = date.today() - timedelta(days=days)
    q = db.query(PrintedLabel).filter(
        PrintedLabel.weight_abnormal == True,
        PrintedLabel.scanned_time >= cutoff,
    )
    if status == "unfixed":
        q = q.filter(PrintedLabel.weight_fixed == False)
    elif status == "fixed":
        q = q.filter(PrintedLabel.weight_fixed == True)
    elif status == "swapped":
        q = q.filter(PrintedLabel.weight_fixed == False)

    total = q.count()
    labels = q.order_by(desc(PrintedLabel.scanned_time)).offset((page - 1) * page_size).limit(page_size).all()

    base_q = db.query(PrintedLabel).filter(
        PrintedLabel.weight_abnormal == True,
        PrintedLabel.scanned_time >= cutoff,
    )
    unfixed_total = base_q.filter(PrintedLabel.weight_fixed == False).count()
    fixed_total = base_q.filter(PrintedLabel.weight_fixed == True).count()
    all_total = unfixed_total + fixed_total

    worker_ids = list({l.u for l in labels if l.u})
    sku_ids = list({l.s for l in labels if l.s})
    worker_map = {}
    sku_map = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            worker_map[w.id] = w.real_name or w.username
    if sku_ids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.sku_description, Sku.fruit_name).filter(Sku.id.in_(sku_ids)).all():
            sku_map[s.id] = (s.sku_description or '').strip() or f"{s.fruit_name} {s.sku_name}"

    items = []
    swapped_count = 0
    for l in labels:
        suspect_swapped = False
        swap_label_id = None
        if not l.weight_fixed and l.scanned_time:
            swap_candidate = db.query(PrintedLabel.id, PrintedLabel.scanned_time, PrintedLabel.actual_weight).filter(
                PrintedLabel.u == l.u,
                PrintedLabel.s == l.s,
                PrintedLabel.b == l.b,
                PrintedLabel.id != l.id,
                PrintedLabel.scanned_outbound == True,
                PrintedLabel.weight_abnormal == False,
                PrintedLabel.scanned_time > l.scanned_time,
                PrintedLabel.scanned_time <= l.scanned_time + timedelta(hours=4),
            ).order_by(PrintedLabel.scanned_time.asc()).first()
            if swap_candidate:
                suspect_swapped = True
                swap_label_id = swap_candidate.id

        if suspect_swapped:
            swapped_count += 1

        item = {
            "id": l.id,
            "worker_id": l.u,
            "worker_name": worker_map.get(l.u, f"#{l.u}"),
            "sku_id": l.s,
            "sku_name": sku_map.get(l.s, f"#{l.s}"),
            "batch_id": l.b,
            "estimated_weight": float(l.estimated_weight or 0),
            "actual_weight": float(l.actual_weight or 0),
            "weight_difference": float(l.weight_difference or 0) if l.weight_difference else 0,
            "scanned_time": l.scanned_time.isoformat() if l.scanned_time else None,
            "weight_fixed": bool(l.weight_fixed),
            "weight_fixed_time": l.weight_fixed_time.isoformat() if l.weight_fixed_time else None,
            "suspect_swapped": suspect_swapped,
            "swap_label_id": swap_label_id,
        }
        items.append(item)

    if status == "swapped":
        items = [i for i in items if i["suspect_swapped"]]
        total = len(items)

    swapped_global = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.weight_abnormal == True,
        PrintedLabel.weight_fixed == False,
        PrintedLabel.scanned_time >= cutoff,
    ).scalar() or 0

    return ApiResponse(data={
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "stats": {
            "total_abnormal": all_total,
            "unfixed": unfixed_total,
            "fixed": fixed_total,
            "suspect_swapped": swapped_count,
        },
    })


# ─── 今日扫码流水 ───
@router.get("/outbound/recent-scans")
def recent_scans(
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    today = date.today()
    labels = db.query(PrintedLabel).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == today,
    ).order_by(desc(PrintedLabel.scanned_time)).limit(limit).all()

    sku_ids = list({l.s for l in labels if l.s})
    worker_ids = list({l.u for l in labels if l.u})
    smap = {}
    if sku_ids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name).filter(Sku.id.in_(sku_ids)).all():
            smap[s.id] = {"name": s.sku_name, "fruit": s.fruit_name}
    wmap = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            wmap[w.id] = w.real_name or w.username

    result = []
    for l in labels:
        si = smap.get(l.s, {})
        result.append({
            "id": l.id,
            "sku_id": l.s,
            "sku_name": si.get("name", f"SKU#{l.s}"),
            "fruit_name": si.get("fruit", ""),
            "worker_id": l.u,
            "worker_name": wmap.get(l.u, f"#{l.u}"),
            "estimated_weight": float(l.estimated_weight or 0),
            "actual_weight": float(l.actual_weight or 0),
            "weight_difference": float(l.weight_difference or 0),
            "scanned_time": l.scanned_time.isoformat() if l.scanned_time else None,
        })
    return ApiResponse(data=result)


# ─── 失败日志查询 ───
@router.get("/failure-logs")
def list_failure_logs(
    page: int = 1,
    page_size: int = 50,
    category: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    worker_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(FailureLog)
    if start_date:
        q = q.filter(func.date(FailureLog.failure_time) >= start_date)
    if end_date:
        q = q.filter(func.date(FailureLog.failure_time) <= end_date)
    if worker_id:
        q = q.filter(FailureLog.worker_id == worker_id)

    if category == "duplicate":
        q = q.filter(FailureLog.failure_reason.like("%已经扫码%") | FailureLog.failure_reason.like("%重复扫码%"))
    elif category == "weight":
        q = q.filter(FailureLog.failure_reason.like("%重量差值过大%") | FailureLog.failure_reason.like("%重量相差过大%"))
    elif category == "stock":
        q = q.filter(
            (FailureLog.failure_reason.like("%库存不足%") | FailureLog.failure_reason.like("%库存:-%") | FailureLog.failure_reason.like("%库存:0%"))
            & ~FailureLog.failure_reason.like("%已经扫码%")
        )
    elif category == "mismatch":
        q = q.filter(FailureLog.failure_reason.like("%未找到%") | FailureLog.failure_reason.like("%不存在%"))
    elif category == "other":
        q = q.filter(
            ~FailureLog.failure_reason.like("%已经扫码%")
            & ~FailureLog.failure_reason.like("%重复扫码%")
            & ~FailureLog.failure_reason.like("%重量差值过大%")
            & ~FailureLog.failure_reason.like("%重量相差过大%")
            & ~FailureLog.failure_reason.like("%库存不足%")
            & ~FailureLog.failure_reason.like("%未找到%")
            & ~FailureLog.failure_reason.like("%不存在%")
        )

    total = q.count()
    items = q.order_by(desc(FailureLog.failure_time)).offset((page - 1) * page_size).limit(page_size).all()

    wids = list({i.worker_id for i in items if i.worker_id})
    sids = list({i.sku_id for i in items if i.sku_id})
    wmap = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wmap[w.id] = w.real_name or w.username
    smap = {}
    if sids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name).filter(Sku.id.in_(sids)).all():
            smap[s.id] = {"name": s.sku_name, "fruit": s.fruit_name}

    result = []
    for i in items:
        si = smap.get(i.sku_id, {})
        result.append({
            "id": i.id,
            "tickets_num": i.tickets_num,
            "worker_id": i.worker_id,
            "worker_name": wmap.get(i.worker_id, f"#{i.worker_id}" if i.worker_id else "-"),
            "sku_id": i.sku_id,
            "sku_name": si.get("name", f"#{i.sku_id}" if i.sku_id else "-"),
            "fruit_name": si.get("fruit", ""),
            "failure_reason": i.failure_reason,
            "failure_time": i.failure_time.isoformat() if i.failure_time else None,
            "scanned_weight": float(i.scanned_weight) if i.scanned_weight else None,
        })
    return {"success": True, "data": result, "total": total, "page": page, "page_size": page_size}


@router.get("/failure-logs/stats")
def failure_logs_stats(
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sd = start_date or date.today()
    ed = end_date or date.today()

    base = db.query(FailureLog).filter(
        func.date(FailureLog.failure_time).between(sd, ed)
    )

    total = base.count()
    dup = base.filter(
        FailureLog.failure_reason.like("%已经扫码%") | FailureLog.failure_reason.like("%重复扫码%")
    ).count()
    weight = base.filter(
        FailureLog.failure_reason.like("%重量差值过大%") | FailureLog.failure_reason.like("%重量相差过大%")
    ).count()
    stock = base.filter(
        (FailureLog.failure_reason.like("%库存不足%") | FailureLog.failure_reason.like("%库存:-%"))
        & ~FailureLog.failure_reason.like("%已经扫码%")
    ).count()
    mismatch = base.filter(
        FailureLog.failure_reason.like("%未找到%") | FailureLog.failure_reason.like("%不存在%")
    ).count()
    other = total - dup - weight - stock - mismatch

    weight_not_shipped = db.query(func.count(FailureLog.id)).join(
        PrintedLabel, FailureLog.tickets_num == PrintedLabel.id
    ).filter(
        FailureLog.failure_reason.like("%重量差值过大%"),
        PrintedLabel.scanned_outbound == 0,
        func.date(FailureLog.failure_time).between(sd, ed),
    ).scalar() or 0

    return ApiResponse(data={
        "total": total,
        "duplicate": dup,
        "weight": weight,
        "stock": stock,
        "mismatch": mismatch,
        "other": max(other, 0),
        "weight_not_shipped": weight_not_shipped,
        "date_range": {"start": str(sd), "end": str(ed)},
    })


# ─── 称重设置 ───
class WeightSettingUpdate(BaseModel):
    max_weight_difference: float
    max_weight_percentage: float | None = None
    mode: str | None = None

@router.get("/weight-settings")
def get_weight_settings(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ws = db.query(WeightSetting).order_by(desc(WeightSetting.id)).first()
    if not ws:
        return ApiResponse(data={
            "max_weight_difference": 0.5,
            "max_weight_percentage": None,
            "mode": "absolute",
        })
    return ApiResponse(data={
        "id": ws.id,
        "max_weight_difference": float(ws.max_weight_difference),
        "max_weight_percentage": float(ws.max_weight_percentage) if ws.max_weight_percentage else None,
        "mode": ws.mode or "absolute",
        "updated_at": ws.updated_at.isoformat() if ws.updated_at else None,
    })


@router.put("/weight-settings", response_model=ApiResponse)
def update_weight_settings(
    req: WeightSettingUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    ws = db.query(WeightSetting).order_by(desc(WeightSetting.id)).first()
    if ws:
        ws.max_weight_difference = req.max_weight_difference
        ws.max_weight_percentage = req.max_weight_percentage
        ws.mode = req.mode
    else:
        ws = WeightSetting(
            max_weight_difference=req.max_weight_difference,
            max_weight_percentage=req.max_weight_percentage,
            mode=req.mode,
        )
        db.add(ws)
    log_action(db, user, f"更新称重设置：最大差值={req.max_weight_difference}kg")
    db.commit()
    return ApiResponse(message="称重设置已更新")


# ─── 批次详情追踪 ───
@router.get("/batch-detail/{purchase_id}")
def batch_detail(
    purchase_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Comprehensive batch tracking: assignments, labels, outbound, worker stats."""
    fp = db.query(FruitPurchase).filter(
        FruitPurchase.id == purchase_id, FruitPurchase.deleted_at.is_(None)
    ).first()
    if not fp:
        raise HTTPException(status_code=404, detail="采购批次不存在")

    assignments = db.query(BatchAssignment).filter(
        BatchAssignment.purchase_id == purchase_id
    ).all()
    worker_ids = list({a.worker_id for a in assignments})
    wmap = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            wmap[w.id] = w.real_name or w.username

    total_labels = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.b == purchase_id
    ).scalar() or 0
    outbound_labels = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.b == purchase_id, PrintedLabel.scanned_outbound > 0
    ).scalar() or 0
    total_est_weight = float(db.query(func.coalesce(func.sum(PrintedLabel.estimated_weight), 0)).filter(
        PrintedLabel.b == purchase_id
    ).scalar() or 0)
    total_actual_weight = float(db.query(func.coalesce(func.sum(PrintedLabel.actual_weight), 0)).filter(
        PrintedLabel.b == purchase_id, PrintedLabel.scanned_outbound > 0
    ).scalar() or 0)

    skus_for_fruit = db.query(Sku).filter(Sku.fruit_id == fp.fruit_id).all()
    sku_map = {s.id: s for s in skus_for_fruit}

    sku_label_stats = db.query(
        PrintedLabel.s,
        func.count(PrintedLabel.id).label("total"),
        func.sum(func.cast(PrintedLabel.scanned_outbound > 0, Integer)).label("outbound"),
        func.sum(PrintedLabel.estimated_weight).label("est_w"),
        func.sum(
            func.case(
                (PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight),
                else_=0
            )
        ).label("act_w"),
    ).filter(PrintedLabel.b == purchase_id).group_by(PrintedLabel.s).all()

    sku_summary = []
    for row in sku_label_stats:
        s = sku_map.get(row.s)
        sku_summary.append({
            "sku_id": row.s,
            "sku_name": ((s.sku_description or '').strip() or f"{s.fruit_name} {s.sku_name}") if s else f"SKU#{row.s}",
            "total_labels": row.total,
            "outbound_labels": int(row.outbound or 0),
            "estimated_weight": round(float(row.est_w or 0), 2),
            "actual_weight": round(float(row.act_w or 0), 2),
            "performance": float(s.production_performance) if s else 0,
        })

    worker_label_stats = db.query(
        PrintedLabel.u,
        func.count(PrintedLabel.id).label("total"),
        func.sum(func.cast(PrintedLabel.scanned_outbound > 0, Integer)).label("outbound"),
        func.sum(PrintedLabel.estimated_weight).label("est_w"),
        func.sum(
            func.case(
                (PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight),
                else_=0
            )
        ).label("act_w"),
    ).filter(PrintedLabel.b == purchase_id).group_by(PrintedLabel.u).all()

    worker_summary = []
    for row in worker_label_stats:
        worker_summary.append({
            "worker_id": row.u,
            "worker_name": wmap.get(row.u, f"#{row.u}"),
            "total_labels": row.total,
            "outbound_labels": int(row.outbound or 0),
            "estimated_weight": round(float(row.est_w or 0), 2),
            "actual_weight": round(float(row.act_w or 0), 2),
            "share": round(int(row.outbound or 0) / outbound_labels * 100, 1) if outbound_labels > 0 else 0,
        })
    worker_summary.sort(key=lambda x: x["outbound_labels"], reverse=True)

    net_consumed_weight = 0.0
    if outbound_labels > 0:
        consumed = db.query(
            func.sum(PrintedLabel.estimated_weight - func.coalesce(
                db.query(Sku.material_weight).filter(Sku.id == PrintedLabel.s).correlate(PrintedLabel).scalar_subquery(), 0
            ))
        ).filter(
            PrintedLabel.b == purchase_id, PrintedLabel.scanned_outbound > 0
        ).scalar()
        net_consumed_weight = round(float(consumed or 0), 2)

    txn_stats = db.query(
        func.count(SkuTransaction.id).label("total"),
        func.sum(SkuTransaction.quantity).label("qty"),
        func.sum(func.cast(SkuTransaction.is_printed, Integer)).label("printed"),
    ).filter(SkuTransaction.fruit_purchase_id == purchase_id).first()

    return ApiResponse(data={
        "purchase": {
            "id": fp.id,
            "fruit_id": fp.fruit_id,
            "fruit_name": fp.fruit_name,
            "supplier_name": fp.supplier_name,
            "purchase_date": str(fp.purchase_date),
            "purchase_weight": float(fp.purchase_weight),
            "purchase_price": float(fp.purchase_price),
        },
        "assignments": [
            {"worker_id": a.worker_id, "worker_name": wmap.get(a.worker_id, f"#{a.worker_id}"), "date": str(a.assignment_date) if a.assignment_date else None}
            for a in assignments
        ],
        "labels": {
            "total": total_labels,
            "outbound": outbound_labels,
            "pending": total_labels - outbound_labels,
            "progress": round(outbound_labels / total_labels * 100, 1) if total_labels > 0 else 0,
        },
        "weight": {
            "purchase": float(fp.purchase_weight),
            "estimated_total": total_est_weight,
            "actual_outbound": total_actual_weight,
            "net_consumed": net_consumed_weight,
            "remaining": round(float(fp.purchase_weight) - net_consumed_weight, 2),
        },
        "transactions": {
            "total": txn_stats.total if txn_stats else 0,
            "total_qty": int(txn_stats.qty or 0) if txn_stats else 0,
            "printed": int(txn_stats.printed or 0) if txn_stats else 0,
        },
        "sku_summary": sku_summary,
        "worker_summary": worker_summary,
    })


@router.get("/batch-overview")
def batch_overview(
    view_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Overview of all batches with assignments on a given date."""
    d = view_date or date.today()

    assignment_groups = db.query(
        BatchAssignment.purchase_id,
        func.count(BatchAssignment.worker_id).label("worker_count"),
    ).filter(
        BatchAssignment.assignment_date == d
    ).group_by(BatchAssignment.purchase_id).all()

    purchase_ids = [a.purchase_id for a in assignment_groups]
    if not purchase_ids:
        return ApiResponse(data=[])

    fp_map = {}
    for fp in db.query(FruitPurchase).filter(
        FruitPurchase.id.in_(purchase_ids), FruitPurchase.deleted_at.is_(None)
    ).all():
        fp_map[fp.id] = fp

    label_stats = db.query(
        PrintedLabel.b,
        func.count(PrintedLabel.id).label("total"),
        func.sum(func.cast(PrintedLabel.scanned_outbound > 0, Integer)).label("outbound"),
    ).filter(PrintedLabel.b.in_(purchase_ids)).group_by(PrintedLabel.b).all()
    label_map = {r.b: {"total": r.total, "outbound": int(r.outbound or 0)} for r in label_stats}

    result = []
    for ag in assignment_groups:
        fp = fp_map.get(ag.purchase_id)
        if not fp:
            continue
        ls = label_map.get(ag.purchase_id, {"total": 0, "outbound": 0})
        result.append({
            "purchase_id": fp.id,
            "fruit_name": fp.fruit_name,
            "supplier_name": fp.supplier_name,
            "purchase_date": str(fp.purchase_date),
            "purchase_weight": float(fp.purchase_weight),
            "worker_count": ag.worker_count,
            "total_labels": ls["total"],
            "outbound_labels": ls["outbound"],
            "progress": round(ls["outbound"] / ls["total"] * 100, 1) if ls["total"] > 0 else 0,
        })
    result.sort(key=lambda x: x["progress"])
    return ApiResponse(data=result)


# ─── 称重机轮询 API（等效老系统 server.py） ───
@router.get("/device/latest-records/{machine_number}/{last_id}")
def device_latest_records(
    machine_number: str,
    last_id: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Polling API for weighing machines. Returns new upload_records since last_id.
    Equivalent to old system's Flask server.py GET /api/latest_record/<machine_number>/<last_id>."""
    from app.models import UploadRecord

    records = (
        db.query(UploadRecord)
        .filter(
            UploadRecord.machine_number == machine_number,
            UploadRecord.id > last_id,
        )
        .order_by(UploadRecord.id.asc())
        .limit(50)
        .all()
    )

    scan_count = db.query(func.count(UploadRecord.id)).filter(
        UploadRecord.machine_number == machine_number,
        UploadRecord.is_success == True,
        func.date(UploadRecord.upload_time) == date.today(),
    ).scalar() or 0

    items = []
    for r in records:
        items.append({
            "id": r.id,
            "tickets_num": r.tickets_num,
            "weight": float(r.weight) if r.weight else 0,
            "is_success": bool(r.is_success),
            "message": r.message or "",
            "upload_time": r.upload_time.isoformat() if r.upload_time else None,
            "weight_difference": float(r.weight_difference) if r.weight_difference else 0,
            "worker_name": r.worker_name or "",
            "scan_count": scan_count,
        })

    return ApiResponse(data={
        "records": items,
        "scan_count": scan_count,
        "machine_number": machine_number,
    })


@router.get("/device/machines")
def list_machines(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all known machine numbers from upload_records."""
    from app.models import UploadRecord
    machines = db.query(
        UploadRecord.machine_number,
        func.count(UploadRecord.id).label("total_scans"),
        func.max(UploadRecord.upload_time).label("last_active"),
    ).filter(
        UploadRecord.machine_number.isnot(None),
    ).group_by(UploadRecord.machine_number).all()

    return ApiResponse(data=[{
        "machine_number": m.machine_number,
        "total_scans": m.total_scans,
        "last_active": m.last_active.isoformat() if m.last_active else None,
    } for m in machines])


# ─── 海康威视扫码机数据接收（无需认证） ───
@router.post("/device/scan-push")
async def device_scan_push(
    request: Request,
    db: Session = Depends(get_db),
):
    """Receive scan data pushed from Hikvision scanner device.
    Supports both JSON and form-encoded POST.
    No auth required (device pushes directly)."""
    from app.models import UploadRecord
    import json as _json

    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid JSON body")
    else:
        form = await request.form()
        body = {k: v for k, v in form.items()}

    barcode = str(body.get("barcode") or body.get("tickets_num") or "").strip()
    weight_raw = body.get("weight", 0)
    machine_number = str(body.get("machine_number") or body.get("machine", "unknown")).strip()

    try:
        weight = float(weight_raw)
    except (ValueError, TypeError):
        weight = 0.0

    if not barcode:
        raise HTTPException(status_code=400, detail="Missing barcode/tickets_num")

    label_id = None
    if barcode.isdigit() and len(barcode) > 2:
        label_id = int(barcode[2:]) if len(barcode) > 4 else int(barcode)
    elif barcode.isdigit():
        label_id = int(barcode)

    is_success = False
    msg = ""
    weight_diff = 0.0
    worker_name = ""

    if label_id and label_id > 0:
        label = db.query(PrintedLabel).filter(PrintedLabel.id == label_id).first()
        if not label:
            msg = f"标签#{label_id}不存在"
            db.add(FailureLog(
                tickets_num=label_id, user_id=0, worker_id=0,
                sku_id=0, batch_id=0,
                failure_reason=msg, scanned_weight=weight,
            ))
        elif label.scanned_outbound:
            msg = f"标签#{label_id}重复扫码，已于{label.scanned_time}出库"
            db.add(FailureLog(
                tickets_num=label_id, user_id=0,
                worker_id=label.u or 0, sku_id=label.s or 0, batch_id=label.b or 0,
                failure_reason=msg, scanned_weight=weight,
            ))
        else:
            est = float(label.estimated_weight or 0)
            weight_diff = round(weight - est, 2) if weight > 0 else 0.0

            weight_warning = False
            if weight > 0:
                ws = db.query(WeightSetting).order_by(desc(WeightSetting.id)).first()
                max_diff = float(ws.max_weight_difference) if ws else 999
                max_pct = float(ws.max_weight_percentage) if ws and ws.max_weight_percentage else None
                diff_abs = abs(weight_diff)
                exceeded = diff_abs > max_diff
                if max_pct and est > 0:
                    pct = (diff_abs / est) * 100
                    exceeded = exceeded or pct > max_pct
                if exceeded:
                    weight_warning = True
                    db.add(FailureLog(
                        tickets_num=label_id, user_id=0,
                        worker_id=label.u or 0, sku_id=label.s or 0, batch_id=label.b or 0,
                        failure_reason=f"重量差值过大：预估{est}kg 实际{weight}kg 差值{weight_diff}kg",
                        scanned_weight=weight,
                    ))

            label.scanned_outbound = True
            label.scanned_time = datetime.now()
            if weight > 0:
                label.actual_weight = weight

            w = db.query(User.real_name, User.username).filter(User.id == label.u).first()
            worker_name = (w.real_name or w.username) if w else ""
            is_success = True
            msg = "出库成功" + ("（重量异常）" if weight_warning else "")
    else:
        msg = f"条码无效: {barcode}"

    record = UploadRecord(
        tickets_num=barcode,
        weight=weight,
        is_success=is_success,
        message=msg,
        upload_time=datetime.now(),
        weight_difference=weight_diff,
        worker_name=worker_name,
        machine_number=machine_number,
    )
    db.add(record)
    db.commit()

    if is_success:
        cache_clear_prefix("dashboard")

    return {
        "success": is_success,
        "message": msg,
        "data": {
            "barcode": barcode,
            "label_id": label_id,
            "weight": weight,
            "weight_difference": weight_diff,
            "worker_name": worker_name,
            "machine_number": machine_number,
        },
    }


@router.get("/assignment-details")
def assignment_details(
    assignment_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """派工详情 — 对应老系统 assignment_details.php
    按日期查询派工记录，按水果/批次分组，含每个工人的出库消耗重量。"""
    from decimal import Decimal
    sel_date = assignment_date or date.today()

    assignments = db.query(
        BatchAssignment.id,
        BatchAssignment.purchase_id,
        BatchAssignment.worker_id,
        BatchAssignment.assignment_date,
        User.username.label("worker_name"),
        User.real_name.label("worker_real_name"),
        FruitPurchase.fruit_name,
        FruitPurchase.supplier_name,
        FruitPurchase.purchase_date,
        FruitPurchase.purchase_weight,
        FruitPurchase.fruit_id,
    ).join(User, BatchAssignment.worker_id == User.id
    ).join(FruitPurchase, BatchAssignment.purchase_id == FruitPurchase.id
    ).filter(
        BatchAssignment.assignment_date == sel_date,
        FruitPurchase.deleted_at.is_(None),
    ).order_by(FruitPurchase.fruit_name, FruitPurchase.id).all()

    if not assignments:
        avail = db.query(BatchAssignment.assignment_date).distinct().order_by(
            desc(BatchAssignment.assignment_date)
        ).limit(30).all()
        return ApiResponse(data={
            "date": str(sel_date),
            "fruits": [],
            "summary": {"worker_count": 0, "batch_count": 0, "fruit_count": 0, "total_weight": 0, "total_items": 0},
            "worker_stats": [],
            "available_dates": [str(d[0]) for d in avail],
        })

    purchase_ids = list({a.purchase_id for a in assignments})
    worker_ids = list({a.worker_id for a in assignments})

    consumed_rows = db.query(
        PrintedLabel.b.label("purchase_id"),
        PrintedLabel.u.label("worker_id"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed_weight"),
        func.count(PrintedLabel.id).label("item_count"),
    ).join(Sku, PrintedLabel.s == Sku.id
    ).filter(
        PrintedLabel.b.in_(purchase_ids),
        PrintedLabel.scanned_outbound > 0,
    ).group_by(PrintedLabel.b, PrintedLabel.u).all()

    consumed_map: dict = {}
    for r in consumed_rows:
        consumed_map[(r.purchase_id, r.worker_id)] = {
            "weight": float(r.consumed_weight) if isinstance(r.consumed_weight, Decimal) else float(r.consumed_weight or 0),
            "items": int(r.item_count or 0),
        }

    batch_consumed = db.query(
        PrintedLabel.b.label("purchase_id"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("total_consumed"),
        func.count(PrintedLabel.id).label("total_items"),
    ).join(Sku, PrintedLabel.s == Sku.id
    ).filter(
        PrintedLabel.b.in_(purchase_ids),
        PrintedLabel.scanned_outbound > 0,
    ).group_by(PrintedLabel.b).all()

    batch_consumed_map = {
        r.purchase_id: {
            "weight": float(r.total_consumed) if isinstance(r.total_consumed, Decimal) else float(r.total_consumed or 0),
            "items": int(r.total_items or 0),
        }
        for r in batch_consumed
    }

    fruits: dict = {}
    for a in assignments:
        fn = a.fruit_name or "未知"
        pid = a.purchase_id
        if fn not in fruits:
            fruits[fn] = {}
        if pid not in fruits[fn]:
            bc = batch_consumed_map.get(pid, {"weight": 0, "items": 0})
            fruits[fn][pid] = {
                "purchase_id": pid,
                "supplier_name": a.supplier_name or "",
                "purchase_date": str(a.purchase_date) if a.purchase_date else "",
                "purchase_weight": float(a.purchase_weight or 0),
                "total_consumed_weight": bc["weight"],
                "total_items": bc["items"],
                "usage_pct": round(bc["weight"] / float(a.purchase_weight) * 100, 1) if float(a.purchase_weight or 0) > 0 else 0,
                "workers": [],
            }
        wc = consumed_map.get((pid, a.worker_id), {"weight": 0, "items": 0})
        fruits[fn][pid]["workers"].append({
            "worker_id": a.worker_id,
            "worker_name": a.worker_real_name or a.worker_name,
            "consumed_weight": round(wc["weight"], 2),
            "item_count": wc["items"],
        })

    fruit_list = []
    for fn, batches in fruits.items():
        batch_list = list(batches.values())
        total_w = sum(b["total_consumed_weight"] for b in batch_list)
        fruit_list.append({
            "fruit_name": fn,
            "batches": batch_list,
            "total_consumed": round(total_w, 2),
            "batch_count": len(batch_list),
        })

    worker_stat_rows = db.query(
        User.id.label("worker_id"),
        (func.coalesce(User.real_name, User.username)).label("worker_name"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("total_weight"),
        func.count(func.distinct(PrintedLabel.b)).label("batch_count"),
        func.count(PrintedLabel.id).label("item_count"),
    ).select_from(BatchAssignment
    ).join(User, BatchAssignment.worker_id == User.id
    ).outerjoin(
        PrintedLabel,
        and_(
            BatchAssignment.worker_id == PrintedLabel.u,
            BatchAssignment.purchase_id == PrintedLabel.b,
            PrintedLabel.scanned_outbound > 0,
        ),
    ).outerjoin(Sku, PrintedLabel.s == Sku.id
    ).filter(BatchAssignment.assignment_date == sel_date
    ).group_by(User.id, User.real_name, User.username
    ).order_by(desc(func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0))
    ).all()

    worker_stats = [{
        "worker_id": w.worker_id,
        "worker_name": w.worker_name,
        "total_weight": round(float(w.total_weight) if isinstance(w.total_weight, Decimal) else float(w.total_weight or 0), 2),
        "batch_count": int(w.batch_count or 0),
        "item_count": int(w.item_count or 0),
    } for w in worker_stat_rows]

    avail = db.query(BatchAssignment.assignment_date).distinct().order_by(
        desc(BatchAssignment.assignment_date)
    ).limit(30).all()

    summary = {
        "worker_count": len(set(a.worker_id for a in assignments)),
        "batch_count": len(purchase_ids),
        "fruit_count": len(fruits),
        "total_weight": round(sum(f["total_consumed"] for f in fruit_list), 2),
        "total_items": sum(batch_consumed_map.get(pid, {"items": 0})["items"] for pid in purchase_ids),
    }

    return ApiResponse(data={
        "date": str(sel_date),
        "fruits": fruit_list,
        "summary": summary,
        "worker_stats": worker_stats,
        "available_dates": [str(d[0]) for d in avail],
    })


@router.get("/pipeline")
def production_pipeline(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """生产管线实时数据 — 从采购到出库的完整流程状态"""
    from app.utils.cache import cache_get, cache_set
    today = date.today()
    cache_key = f"pipeline:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    active_purchases = db.query(func.count(FruitPurchase.id)).filter(
        FruitPurchase.deleted_at.is_(None),
        FruitPurchase.purchase_date >= today - timedelta(days=30),
    ).scalar() or 0

    today_assignments = db.query(
        func.count(func.distinct(BatchAssignment.worker_id)),
        func.count(func.distinct(BatchAssignment.purchase_id)),
    ).filter(BatchAssignment.assignment_date == today).first()
    assigned_workers = today_assignments[0] if today_assignments else 0
    assigned_batches = today_assignments[1] if today_assignments else 0

    today_txn = db.query(
        func.count(SkuTransaction.id),
        func.coalesce(func.sum(SkuTransaction.quantity), 0),
    ).filter(func.date(SkuTransaction.transaction_date) == today).first()
    today_requests = int(today_txn[0] or 0) if today_txn else 0
    today_request_qty = int(today_txn[1] or 0) if today_txn else 0

    pending_print = db.query(func.count(SkuTransaction.id)).filter(
        SkuTransaction.is_printed == False
    ).scalar() or 0

    today_printed = db.query(func.count(PrintedLabel.id)).filter(
        func.date(PrintedLabel.created_at) == today
    ).scalar() or 0

    today_production = db.query(
        func.count(WorkerProduction.id),
        func.coalesce(func.sum(WorkerProduction.actual_packaging_quantity), 0),
    ).filter(WorkerProduction.production_date == today).first()
    today_prod_count = int(today_production[0] or 0) if today_production else 0
    today_prod_qty = int(today_production[1] or 0) if today_production else 0

    pending_audit = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "pending"
    ).scalar() or 0

    today_approved = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "approved",
        func.date(WorkerProduction.audit_at) == today,
    ).scalar() or 0

    seven_days_ago = today - timedelta(days=7)

    recent_produced = db.query(
        func.coalesce(func.sum(WorkerProduction.actual_packaging_quantity), 0)
    ).filter(
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= seven_days_ago,
    ).scalar() or 0

    recent_outbound = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) >= seven_days_ago,
    ).scalar() or 0

    total_instock = max(0, int(recent_produced) - int(recent_outbound))

    total_labels_7d = int(recent_produced)
    total_outbound_7d = int(recent_outbound)

    today_outbound = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == today,
    ).scalar() or 0

    yesterday = today - timedelta(days=1)
    yesterday_outbound = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == yesterday,
    ).scalar() or 0

    daily_flow = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        printed_d = db.query(func.count(PrintedLabel.id)).filter(
            func.date(PrintedLabel.created_at) == d
        ).scalar() or 0
        outbound_d = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.scanned_outbound > 0,
            func.date(PrintedLabel.scanned_time) == d,
        ).scalar() or 0
        daily_flow.append({"date": d.isoformat(), "printed": printed_d, "outbound": outbound_d})

    pipeline = {
        "stages": [
            {"key": "purchase", "title": "采购入库", "value": active_purchases, "unit": "批次(30天)", "color": "#1677ff"},
            {"key": "assign", "title": "批次分配", "value": assigned_batches, "sub_value": f"{assigned_workers}工人", "unit": "今日批次", "color": "#fa8c16"},
            {"key": "request", "title": "SKU申请", "value": today_requests, "sub_value": f"{today_request_qty}件", "unit": "今日申请", "color": "#722ed1", "warning": pending_print, "warning_label": "待打印"},
            {"key": "print", "title": "标签打印", "value": today_printed, "unit": "今日打印", "color": "#13c2c2"},
            {"key": "production", "title": "生产录入", "value": today_prod_count, "sub_value": f"{today_prod_qty}件", "unit": "今日录入", "color": "#00b96b", "warning": pending_audit, "warning_label": "待审核"},
            {"key": "audit", "title": "生产审核", "value": today_approved, "unit": "今日通过", "color": "#eb2f96"},
            {"key": "warehouse", "title": "仓库在库", "value": total_instock, "unit": "在库(7天)", "color": "#2f54eb"},
            {"key": "outbound", "title": "出库扫码", "value": today_outbound, "sub_value": f"昨日{yesterday_outbound}", "unit": "今日出库", "color": "#52c41a"},
        ],
        "totals": {
            "total_labels": total_labels_7d,
            "total_instock": total_instock,
            "total_outbound": total_outbound_7d,
            "outbound_rate": round(total_outbound_7d / max(total_labels_7d, 1) * 100, 1),
        },
        "daily_flow": daily_flow,
    }

    cache_set(cache_key, pipeline, ttl=60)
    return ApiResponse(data=pipeline)


