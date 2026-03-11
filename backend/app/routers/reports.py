from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, desc, case, or_, String
from datetime import date, timedelta
from decimal import Decimal
from app.database import get_db
from app.models import PrintedLabel, FruitPurchase, Sku, WorkerProduction, Fruit, User, CartonBoxPurchase, SimpleMaterialPurchase, Supplier, CartonBox
from app.models.user import User as UserModel
from app.schemas.common import ApiResponse
from app.middleware.auth import get_current_user, require_admin
from app.utils.cache import cache_get, cache_set

router = APIRouter(prefix="/reports", tags=["报表中心"])


@router.get("/daily-outbound")
def daily_outbound(
    start_date: date | None = None,
    end_date: date | None = None,
    worker_id: int | None = None,
    sku_id: int | None = None,
    search: str | None = None,
    group_by: str = "date",
    page: int = 1,
    page_size: int = 50,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enhanced daily outbound report with multi-dimension grouping, filtering, pagination and caching.
    Old system used scanned_outbound > 0 (tinyint), keeping consistent."""
    if not start_date:
        start_date = date.today() - timedelta(days=7)
    if not end_date:
        end_date = date.today()

    cache_key = f"report:outbound:{start_date}:{end_date}:{worker_id}:{sku_id}:{search}:{group_by}:{page}:{page_size}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    base_filter = [
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(start_date, end_date),
    ]
    if worker_id:
        base_filter.append(PrintedLabel.u == worker_id)
    if sku_id:
        base_filter.append(PrintedLabel.s == sku_id)
    if search:
        base_filter.append(
            or_(
                func.cast(PrintedLabel.id, String).like(f"%{search}%"),
                func.cast(PrintedLabel.s, String).like(f"%{search}%"),
            )
        )

    # --- Workers list for filter dropdown ---
    worker_rows = db.query(
        PrintedLabel.u.label("wid"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(start_date, end_date),
    ).group_by(PrintedLabel.u).all()
    wids = [r.wid for r in worker_rows if r.wid]
    wname_map = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wname_map[w.id] = w.real_name or w.username
    workers_list = [{"id": wid, "name": wname_map.get(wid, f"#{wid}")} for wid in wids]

    # --- SKU list for filter dropdown ---
    sku_rows = db.query(
        func.distinct(PrintedLabel.s).label("sid"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(start_date, end_date),
    ).all()
    sids = [r.sid for r in sku_rows if r.sid]
    sku_info_map = {}
    if sids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name).filter(Sku.id.in_(sids)).all():
            sku_info_map[s.id] = {"sku_name": s.sku_name, "fruit_name": s.fruit_name}
    sku_list = [{"id": sid, "sku_name": sku_info_map.get(sid, {}).get("sku_name", f"#{sid}"), "fruit_name": sku_info_map.get(sid, {}).get("fruit_name", "")} for sid in sids]

    # --- Grouped data ---
    if group_by == "worker":
        q = db.query(
            PrintedLabel.u.label("worker_id"),
            func.count(PrintedLabel.id).label("total_count"),
            func.sum(PrintedLabel.actual_weight).label("total_weight"),
        ).filter(*base_filter).group_by(PrintedLabel.u).order_by(desc("total_count"))
        total = q.count()
        rows = q.offset((page - 1) * page_size).limit(page_size).all()
        items = []
        for r in rows:
            items.append({
                "worker_id": r.worker_id,
                "worker_name": wname_map.get(r.worker_id, f"#{r.worker_id}"),
                "count": r.total_count,
                "weight": round(_d(r.total_weight), 2),
            })

    elif group_by == "sku":
        q = db.query(
            PrintedLabel.s.label("sku_id"),
            func.count(PrintedLabel.id).label("total_count"),
            func.sum(PrintedLabel.actual_weight).label("total_weight"),
        ).filter(*base_filter).group_by(PrintedLabel.s).order_by(desc("total_count"))
        total = q.count()
        rows = q.offset((page - 1) * page_size).limit(page_size).all()
        items = []
        for r in rows:
            info = sku_info_map.get(r.sku_id, {})
            items.append({
                "sku_id": r.sku_id,
                "sku_name": info.get("sku_name", f"#{r.sku_id}"),
                "fruit_name": info.get("fruit_name", ""),
                "count": r.total_count,
                "weight": round(_d(r.total_weight), 2),
            })

    else:
        q = db.query(
            func.date(PrintedLabel.scanned_time).label("scan_date"),
            func.count(PrintedLabel.id).label("total_count"),
            func.sum(PrintedLabel.actual_weight).label("total_weight"),
        ).filter(*base_filter).group_by(func.date(PrintedLabel.scanned_time)).order_by("scan_date")
        total = q.count()
        rows = q.offset((page - 1) * page_size).limit(page_size).all()
        items = [{"date": str(r.scan_date), "count": r.total_count, "weight": round(_d(r.total_weight), 2)} for r in rows]

    # --- Fruit summary (always computed) ---
    sku_summary = db.query(
        Sku.fruit_name,
        func.count(PrintedLabel.id).label("cnt"),
        func.count(func.distinct(PrintedLabel.s)).label("sku_count"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(*base_filter).group_by(Sku.fruit_name).all()
    fruit_summary = [{"fruit_name": r.fruit_name, "count": r.cnt, "sku_count": r.sku_count} for r in sku_summary]

    # --- Aggregate stats ---
    agg = db.query(
        func.count(PrintedLabel.id).label("total_count"),
        func.coalesce(func.sum(PrintedLabel.actual_weight), 0).label("total_weight"),
        func.count(func.distinct(func.date(PrintedLabel.scanned_time))).label("active_days"),
        func.count(func.distinct(PrintedLabel.u)).label("worker_count"),
        func.count(func.distinct(PrintedLabel.s)).label("sku_count"),
    ).filter(*base_filter).first()

    active_days = agg.active_days or 1
    stats = {
        "total_count": agg.total_count,
        "total_weight": round(_d(agg.total_weight), 2),
        "active_days": agg.active_days,
        "daily_avg": round(agg.total_count / active_days, 1),
        "worker_count": agg.worker_count,
        "sku_count": agg.sku_count,
    }

    result = {
        "group_by": group_by,
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "fruit_summary": fruit_summary,
        "stats": stats,
        "workers": workers_list,
        "sku_list": sku_list,
    }
    cache_set(cache_key, result, ttl=600)
    return ApiResponse(data=result)


@router.get("/fruit-loss-rates")
def fruit_loss_rates(
    fruit_id: int | None = None,
    fruit_name: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enhanced fruit loss rates with date range/fruit filtering, batch-level data, trend data.
    consumed = SUM(estimated_weight - material_weight) for outbound labels (scanned_outbound > 0)."""
    cache_key = f"report:loss:{fruit_id}:{fruit_name}:{start_date}:{end_date}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    # --- Fruit-level summary ---
    purch_q = db.query(
        FruitPurchase.fruit_name,
        func.sum(FruitPurchase.purchase_weight).label("total_purchased"),
        func.sum(FruitPurchase.purchase_weight * FruitPurchase.purchase_price).label("total_cost"),
        func.count(FruitPurchase.id).label("purchase_count"),
    ).filter(FruitPurchase.deleted_at.is_(None))
    if fruit_id:
        purch_q = purch_q.filter(FruitPurchase.fruit_id == fruit_id)
    if fruit_name:
        purch_q = purch_q.filter(FruitPurchase.fruit_name.like(f"%{fruit_name}%"))
    if start_date:
        purch_q = purch_q.filter(FruitPurchase.purchase_date >= start_date)
    if end_date:
        purch_q = purch_q.filter(FruitPurchase.purchase_date <= end_date)
    purchased = {}
    for r in purch_q.group_by(FruitPurchase.fruit_name).all():
        purchased[r[0]] = {"weight": _d(r[1]), "cost": round(_d(r[2]), 2), "count": r[3]}

    out_filter = [PrintedLabel.scanned_outbound > 0]
    if start_date:
        out_filter.append(func.date(PrintedLabel.scanned_time) >= start_date)
    if end_date:
        out_filter.append(func.date(PrintedLabel.scanned_time) <= end_date)

    out_q = db.query(
        Sku.fruit_name,
        func.count(PrintedLabel.id).label("cnt"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed"),
        func.coalesce(func.sum(PrintedLabel.actual_weight), 0).label("actual_wt"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(*out_filter)
    if fruit_id:
        purch_ids = [p.id for p in db.query(FruitPurchase.id).filter(
            FruitPurchase.fruit_id == fruit_id, FruitPurchase.deleted_at.is_(None)).all()]
        if purch_ids:
            out_q = out_q.filter(PrintedLabel.b.in_(purch_ids))
        else:
            out_q = out_q.filter(False)
    if fruit_name:
        out_q = out_q.filter(Sku.fruit_name.like(f"%{fruit_name}%"))
    outbound = {}
    for r in out_q.group_by(Sku.fruit_name).all():
        outbound[r.fruit_name] = {
            "count": r.cnt, "consumed": round(_d(r.consumed), 2), "actual_weight": round(_d(r.actual_wt), 2),
        }

    data = []
    total_purchased_w = 0
    total_consumed_w = 0
    total_cost = 0
    for fname, pi in purchased.items():
        pw = pi["weight"]
        ob = outbound.get(fname, {"count": 0, "consumed": 0, "actual_weight": 0})
        consumed = ob["consumed"]
        remaining = pw - consumed if pw > consumed else 0
        loss_rate = round((remaining / pw) * 100, 2) if pw > 0 else 0
        total_purchased_w += pw
        total_consumed_w += consumed
        total_cost += pi["cost"]
        data.append({
            "fruit_name": fname, "purchased": pw, "outbound": consumed,
            "loss": round(remaining, 2), "loss_rate": loss_rate,
            "purchase_count": pi["count"], "outbound_count": ob["count"],
            "actual_weight": ob["actual_weight"], "cost": pi["cost"],
        })
    data.sort(key=lambda x: x["loss_rate"], reverse=True)

    total_remaining = total_purchased_w - total_consumed_w if total_purchased_w > total_consumed_w else 0
    summary = {
        "total_purchased": round(total_purchased_w, 2),
        "total_consumed": round(total_consumed_w, 2),
        "total_remaining": round(total_remaining, 2),
        "total_cost": round(total_cost, 2),
        "total_loss_rate": round((total_remaining / total_purchased_w * 100), 2) if total_purchased_w > 0 else 0,
        "fruit_count": len(data),
    }

    # --- Batch-level data ---
    batch_q = db.query(
        FruitPurchase.id.label("purchase_id"),
        FruitPurchase.fruit_name, FruitPurchase.supplier_name,
        FruitPurchase.purchase_date, FruitPurchase.purchase_weight,
        FruitPurchase.purchase_price,
    ).filter(FruitPurchase.deleted_at.is_(None))
    if fruit_id:
        batch_q = batch_q.filter(FruitPurchase.fruit_id == fruit_id)
    if fruit_name:
        batch_q = batch_q.filter(FruitPurchase.fruit_name.like(f"%{fruit_name}%"))
    if start_date:
        batch_q = batch_q.filter(FruitPurchase.purchase_date >= start_date)
    if end_date:
        batch_q = batch_q.filter(FruitPurchase.purchase_date <= end_date)
    batch_q = batch_q.order_by(desc(FruitPurchase.purchase_date))
    batches_raw = batch_q.all()

    batch_ids = [b.purchase_id for b in batches_raw]
    batch_consumed = {}
    if batch_ids:
        bc_q = db.query(
            PrintedLabel.b.label("bid"),
            func.count(PrintedLabel.id).label("cnt"),
            func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed"),
        ).join(Sku, Sku.id == PrintedLabel.s).filter(
            PrintedLabel.scanned_outbound > 0, PrintedLabel.b.in_(batch_ids),
        ).group_by(PrintedLabel.b).all()
        for r in bc_q:
            batch_consumed[r.bid] = {"count": r.cnt, "consumed": round(_d(r.consumed), 2)}

    batches = []
    for b in batches_raw:
        pw = _d(b.purchase_weight)
        bc = batch_consumed.get(b.purchase_id, {"count": 0, "consumed": 0})
        consumed = bc["consumed"]
        remaining = pw - consumed if pw > consumed else 0
        rate = round((remaining / pw * 100), 2) if pw > 0 else 0
        batches.append({
            "purchase_id": b.purchase_id, "fruit_name": b.fruit_name,
            "supplier_name": b.supplier_name, "purchase_date": str(b.purchase_date),
            "purchase_weight": pw, "purchase_price": _d(b.purchase_price),
            "consumed": consumed, "remaining": round(remaining, 2),
            "loss_rate": rate, "outbound_count": bc["count"],
        })

    # --- Loss trend by month (last 6 months) ---
    trend_months = []
    today = date.today()
    for i in range(5, -1, -1):
        m = today.replace(day=1) - timedelta(days=i * 30)
        trend_months.append(m.strftime("%Y-%m"))

    trend_data = []
    for ym in trend_months:
        y, m = int(ym.split("-")[0]), int(ym.split("-")[1])
        ms = date(y, m, 1)
        if m == 12:
            me = date(y + 1, 1, 1) - timedelta(days=1)
        else:
            me = date(y, m + 1, 1) - timedelta(days=1)

        p_row = db.query(func.coalesce(func.sum(FruitPurchase.purchase_weight), 0)).filter(
            FruitPurchase.deleted_at.is_(None), FruitPurchase.purchase_date.between(ms, me),
        ).scalar()
        o_row = db.query(
            func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0),
        ).join(Sku, Sku.id == PrintedLabel.s).filter(
            PrintedLabel.scanned_outbound > 0, func.date(PrintedLabel.scanned_time).between(ms, me),
        ).scalar()
        pw_m = _d(p_row)
        co_m = _d(o_row)
        rem_m = pw_m - co_m if pw_m > co_m else 0
        rate_m = round((rem_m / pw_m * 100), 2) if pw_m > 0 else 0
        trend_data.append({"month": ym, "purchased": round(pw_m, 2), "consumed": round(co_m, 2), "loss_rate": rate_m})

    # --- Fruit dropdown list ---
    fruit_list = [{"id": f.id, "name": f.name} for f in db.query(Fruit.id, Fruit.name).all()]

    result = {
        "items": data, "summary": summary, "batches": batches,
        "trend": trend_data, "fruit_list": fruit_list,
    }
    cache_set(cache_key, result, ttl=120)
    return ApiResponse(data=result)


@router.get("/batch-loss-detail/{purchase_id}")
def batch_loss_detail(
    purchase_id: int,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Batch-level loss detail: breakdown by SKU, worker, date.
    Mirrors old system view_loss.php functionality."""
    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    fp = db.query(FruitPurchase).filter(FruitPurchase.id == purchase_id).first()
    if not fp:
        return ApiResponse(code=404, message="批次不存在")

    pw = _d(fp.purchase_weight)

    total_row = db.query(
        func.count(PrintedLabel.id).label("cnt"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        PrintedLabel.b == purchase_id, PrintedLabel.scanned_outbound > 0,
    ).first()
    total_consumed = _d(total_row.consumed) if total_row else 0
    total_count = total_row.cnt if total_row else 0
    remaining = pw - total_consumed if pw > total_consumed else 0
    loss_rate = round((remaining / pw * 100), 2) if pw > 0 else 0

    details = db.query(
        Sku.sku_name, func.date(PrintedLabel.created_at).label("dt"),
        PrintedLabel.u.label("worker_id"),
        func.count(PrintedLabel.id).label("qty"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        PrintedLabel.b == purchase_id, PrintedLabel.scanned_outbound > 0,
    ).group_by(Sku.id, Sku.sku_name, func.date(PrintedLabel.created_at), PrintedLabel.u).order_by(
        Sku.sku_name, desc(func.date(PrintedLabel.created_at)),
    ).all()

    wids = list(set(d.worker_id for d in details if d.worker_id))
    wmap = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wmap[w.id] = w.real_name or w.username

    detail_list = [{
        "sku_name": d.sku_name, "date": str(d.dt), "worker_name": wmap.get(d.worker_id, f"#{d.worker_id}"),
        "quantity": d.qty, "consumed": round(_d(d.consumed), 2),
    } for d in details]

    by_sku = db.query(
        Sku.sku_name, func.count(PrintedLabel.id).label("qty"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        PrintedLabel.b == purchase_id, PrintedLabel.scanned_outbound > 0,
    ).group_by(Sku.id, Sku.sku_name).all()
    sku_summary = [{"sku_name": r.sku_name, "quantity": r.qty, "consumed": round(_d(r.consumed), 2)} for r in by_sku]

    by_worker = db.query(
        PrintedLabel.u.label("wid"), func.count(PrintedLabel.id).label("qty"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        PrintedLabel.b == purchase_id, PrintedLabel.scanned_outbound > 0,
    ).group_by(PrintedLabel.u).all()
    worker_summary = [{"worker_name": wmap.get(r.wid, f"#{r.wid}"), "quantity": r.qty, "consumed": round(_d(r.consumed), 2)} for r in by_worker]

    return ApiResponse(data={
        "purchase_id": purchase_id, "fruit_name": fp.fruit_name,
        "supplier_name": fp.supplier_name, "purchase_date": str(fp.purchase_date),
        "purchase_weight": pw, "purchase_price": _d(fp.purchase_price),
        "total_consumed": round(total_consumed, 2), "remaining": round(remaining, 2),
        "loss_rate": loss_rate, "outbound_count": total_count,
        "details": detail_list, "sku_summary": sku_summary, "worker_summary": worker_summary,
    })


@router.get("/fruit-pricing")
def fruit_pricing(
    fruit_name: str,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    purchases = db.query(FruitPurchase).filter(
        FruitPurchase.fruit_name == fruit_name
    ).order_by(desc(FruitPurchase.purchase_date)).limit(10).all()

    if not purchases:
        return ApiResponse(data={"factory_price": 0, "suggested_selling_price": 0, "history": []})

    highest = max(float(p.purchase_price) for p in purchases)
    total_weight = sum(float(p.purchase_weight) for p in purchases)
    total_cost = sum(float(p.purchase_price) * float(p.purchase_weight) for p in purchases)
    weighted_avg = round(total_cost / total_weight, 2) if total_weight > 0 else 0

    factory_price = highest
    suggested = round(factory_price * 1.15, 2)

    history = [
        {
            "date": str(p.purchase_date),
            "price": float(p.purchase_price),
            "weight": float(p.purchase_weight),
            "supplier": p.supplier_name,
        }
        for p in purchases
    ]

    return ApiResponse(data={
        "factory_price": factory_price,
        "weighted_avg": weighted_avg,
        "suggested_selling_price": suggested,
        "history": history,
    })


@router.get("/price-intelligence")
def price_intelligence(
    days: int = 90,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """价格智能分析 — 全水果价格对比、波动分析、采购成本洞察、供应商维度"""
    cache_key = f"price_intelligence_{days}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    cutoff = date.today() - timedelta(days=days)

    purchases = db.query(FruitPurchase).filter(
        FruitPurchase.purchase_date >= cutoff,
        FruitPurchase.deleted_at.is_(None),
    ).order_by(FruitPurchase.purchase_date).all()

    if not purchases:
        return ApiResponse(data={"fruits": [], "timeline": [], "summary": {}, "alerts": [], "supplier_ranking": [], "cost_distribution": []})

    def _f(v):
        return float(v) if isinstance(v, Decimal) else float(v or 0)

    fruit_data: dict = {}
    timeline_map: dict = {}
    supplier_agg: dict = {}

    for p in purchases:
        fn = p.fruit_name or "未知"
        price = _f(p.purchase_price)
        weight = _f(p.purchase_weight)
        dt = str(p.purchase_date) if p.purchase_date else ""
        sn = p.supplier_name or "未知"

        if fn not in fruit_data:
            fruit_data[fn] = {"prices": [], "weights": [], "costs": [], "dates": [], "suppliers": set(), "supplier_detail": {}}
        fruit_data[fn]["prices"].append(price)
        fruit_data[fn]["weights"].append(weight)
        fruit_data[fn]["costs"].append(round(price * weight, 2))
        fruit_data[fn]["dates"].append(dt)
        fruit_data[fn]["suppliers"].add(sn)

        if sn not in fruit_data[fn]["supplier_detail"]:
            fruit_data[fn]["supplier_detail"][sn] = {"prices": [], "weights": [], "costs": []}
        fruit_data[fn]["supplier_detail"][sn]["prices"].append(price)
        fruit_data[fn]["supplier_detail"][sn]["weights"].append(weight)
        fruit_data[fn]["supplier_detail"][sn]["costs"].append(round(price * weight, 2))

        if sn not in supplier_agg:
            supplier_agg[sn] = {"total_cost": 0, "total_weight": 0, "batch_count": 0, "fruits": set()}
        supplier_agg[sn]["total_cost"] += round(price * weight, 2)
        supplier_agg[sn]["total_weight"] += weight
        supplier_agg[sn]["batch_count"] += 1
        supplier_agg[sn]["fruits"].add(fn)

        if dt not in timeline_map:
            timeline_map[dt] = {}
        if fn not in timeline_map[dt]:
            timeline_map[dt][fn] = {"price": 0, "weight": 0, "count": 0, "total_cost": 0}
        timeline_map[dt][fn]["price"] = price
        timeline_map[dt][fn]["weight"] += weight
        timeline_map[dt][fn]["count"] += 1
        timeline_map[dt][fn]["total_cost"] += round(price * weight, 2)

    fruits = []
    alerts = []
    total_cost = 0
    total_weight = 0

    for fn, fd in fruit_data.items():
        prices = fd["prices"]
        weights = fd["weights"]
        costs = fd["costs"]
        avg_price = round(sum(p * w for p, w in zip(prices, weights)) / max(sum(weights), 0.01), 2)
        min_p = min(prices)
        max_p = max(prices)
        latest_p = prices[-1] if prices else 0
        first_p = prices[0] if prices else 0
        volatility = round((max_p - min_p) / max(avg_price, 0.01) * 100, 1)
        fc = sum(costs)
        fw = sum(weights)
        total_cost += fc
        total_weight += fw

        change_rate = round((latest_p - first_p) / max(first_p, 0.01) * 100, 1) if first_p > 0 else 0

        recent_3 = prices[-3:] if len(prices) >= 3 else prices
        trend = "stable"
        if len(recent_3) >= 2:
            if recent_3[-1] > recent_3[0] * 1.1:
                trend = "rising"
            elif recent_3[-1] < recent_3[0] * 0.9:
                trend = "falling"

        if volatility > 30:
            alerts.append({"fruit": fn, "type": "high_volatility", "message": f"{fn} 价格波动率 {volatility}%，需关注", "value": volatility})
        if trend == "rising" and len(prices) >= 3:
            alerts.append({"fruit": fn, "type": "price_rising", "message": f"{fn} 价格持续上涨", "value": latest_p})
        if trend == "falling" and len(prices) >= 3:
            alerts.append({"fruit": fn, "type": "price_falling", "message": f"{fn} 价格持续下降，可能是采购良机", "value": latest_p})

        supplier_breakdown = []
        for sn, sd in fd["supplier_detail"].items():
            s_prices = sd["prices"]
            s_weights = sd["weights"]
            s_avg = round(sum(p * w for p, w in zip(s_prices, s_weights)) / max(sum(s_weights), 0.01), 2)
            supplier_breakdown.append({
                "supplier_name": sn,
                "batch_count": len(s_prices),
                "avg_price": s_avg,
                "min_price": min(s_prices),
                "max_price": max(s_prices),
                "total_cost": round(sum(sd["costs"]), 2),
                "total_weight": round(sum(s_weights), 2),
            })
        supplier_breakdown.sort(key=lambda x: x["avg_price"])

        fruits.append({
            "fruit_name": fn,
            "batch_count": len(prices),
            "avg_price": avg_price,
            "min_price": min_p,
            "max_price": max_p,
            "latest_price": latest_p,
            "volatility": volatility,
            "trend": trend,
            "change_rate": change_rate,
            "total_cost": round(fc, 2),
            "total_weight": round(fw, 2),
            "supplier_count": len(fd["suppliers"] - {""}),
            "supplier_breakdown": supplier_breakdown,
            "price_history": [{"date": d, "price": p, "weight": w} for d, p, w in zip(fd["dates"], prices, weights)],
        })

    fruits.sort(key=lambda x: x["total_cost"], reverse=True)

    cost_distribution = [{"name": f["fruit_name"], "value": f["total_cost"], "percentage": round(f["total_cost"] / max(total_cost, 0.01) * 100, 1)} for f in fruits]

    supplier_ranking = []
    for sn, sa in supplier_agg.items():
        supplier_ranking.append({
            "supplier_name": sn,
            "total_cost": round(sa["total_cost"], 2),
            "total_weight": round(sa["total_weight"], 2),
            "avg_price": round(sa["total_cost"] / max(sa["total_weight"], 0.01), 2),
            "batch_count": sa["batch_count"],
            "fruit_count": len(sa["fruits"]),
            "fruits": list(sa["fruits"]),
        })
    supplier_ranking.sort(key=lambda x: x["total_cost"], reverse=True)

    timeline = []
    for dt in sorted(timeline_map.keys()):
        entry = {"date": dt}
        for fn in fruit_data.keys():
            if fn in timeline_map[dt]:
                entry[fn] = timeline_map[dt][fn]["price"]
        timeline.append(entry)

    result = {
        "fruits": fruits,
        "timeline": timeline,
        "fruit_names": list(fruit_data.keys()),
        "summary": {
            "total_cost": round(total_cost, 2),
            "total_weight": round(total_weight, 2),
            "avg_price_per_kg": round(total_cost / max(total_weight, 0.01), 2),
            "fruit_count": len(fruits),
            "batch_count": len(purchases),
            "alert_count": len(alerts),
            "supplier_count": len(supplier_agg),
        },
        "alerts": alerts,
        "cost_distribution": cost_distribution,
        "supplier_ranking": supplier_ranking,
    }

    cache_set(cache_key, result, ttl=300)
    return ApiResponse(data=result)


@router.get("/weight-difference")
def weight_difference_report(
    start_date: date | None = None,
    end_date: date | None = None,
    worker_id: int | None = None,
    sku_id: int | None = None,
    min_diff: float | None = None,
    max_diff: float | None = None,
    sort_by: str = "time",
    page: int = 1,
    page_size: int = 50,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not start_date:
        start_date = date.today() - timedelta(days=30)
    if not end_date:
        end_date = date.today()

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    base_filter = [
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(start_date, end_date),
    ]
    if worker_id:
        base_filter.append(PrintedLabel.u == worker_id)
    if sku_id:
        base_filter.append(PrintedLabel.s == sku_id)

    worker_rows = db.query(
        func.distinct(PrintedLabel.u).label("wid"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(start_date, end_date),
    ).all()
    wids = [r.wid for r in worker_rows if r.wid]
    wname_map = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wname_map[w.id] = w.real_name or w.username
    workers_list = [{"id": wid, "name": wname_map.get(wid, f"#{wid}")} for wid in wids]

    sku_rows = db.query(
        func.distinct(PrintedLabel.s).label("sid"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(start_date, end_date),
    ).all()
    sids = [r.sid for r in sku_rows if r.sid]
    sku_info_map = {}
    if sids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name).filter(Sku.id.in_(sids)).all():
            sku_info_map[s.id] = {"sku_name": s.sku_name, "fruit_name": s.fruit_name}
    sku_list = [{"id": sid, "sku_name": sku_info_map.get(sid, {}).get("sku_name", f"#{sid}"), "fruit_name": sku_info_map.get(sid, {}).get("fruit_name", "")} for sid in sids]

    results = db.query(
        PrintedLabel.id.label("label_id"),
        PrintedLabel.s.label("sku_id"),
        PrintedLabel.u.label("worker_id"),
        PrintedLabel.estimated_weight,
        PrintedLabel.actual_weight,
        PrintedLabel.weight_difference,
        PrintedLabel.scanned_time,
    ).filter(*base_filter).all()

    items = []
    for r in results:
        diff = _d(r.weight_difference) if r.weight_difference is not None else round(_d(r.actual_weight) - _d(r.estimated_weight), 3)
        if min_diff is not None and diff < min_diff:
            continue
        if max_diff is not None and diff > max_diff:
            continue
        si = sku_info_map.get(r.sku_id, {})
        items.append({
            "label_id": r.label_id,
            "sku_id": r.sku_id,
            "sku_name": si.get("sku_name", f"#{r.sku_id}"),
            "fruit_name": si.get("fruit_name", ""),
            "worker_id": r.worker_id,
            "worker_name": wname_map.get(r.worker_id, f"#{r.worker_id}"),
            "estimated_weight": round(_d(r.estimated_weight), 3),
            "actual_weight": round(_d(r.actual_weight), 3),
            "diff": round(diff, 3),
            "scanned_time": r.scanned_time.isoformat() if r.scanned_time else None,
        })

    if sort_by == "diff":
        items.sort(key=lambda x: abs(x["diff"]), reverse=True)
    elif sort_by == "weight":
        items.sort(key=lambda x: x["actual_weight"], reverse=True)
    else:
        items.sort(key=lambda x: x["scanned_time"] or "", reverse=True)

    total_count = len(items)
    diffs = [it["diff"] for it in items]
    avg_diff = round(sum(diffs) / total_count, 3) if total_count > 0 else 0
    max_diff_val = round(max((abs(d) for d in diffs), default=0), 3)
    positive_count = sum(1 for d in diffs if d > 0)
    negative_count = sum(1 for d in diffs if d < 0)

    from app.models import WeightSetting
    ws = db.query(WeightSetting).order_by(desc(WeightSetting.id)).first()
    threshold = float(ws.max_weight_difference) if ws else 0.5
    exceed_count = sum(1 for d in diffs if abs(d) > threshold)
    exceed_rate = round(exceed_count / total_count * 100, 1) if total_count > 0 else 0

    distribution = {}
    for d in diffs:
        bucket = int(d * 10) / 10
        distribution[bucket] = distribution.get(bucket, 0) + 1
    dist_list = sorted([{"bucket": k, "count": v} for k, v in distribution.items()], key=lambda x: x["bucket"])

    total = total_count
    paged_items = items[(page - 1) * page_size: page * page_size]

    summary = {
        "total_count": total_count,
        "avg_diff": avg_diff,
        "max_diff": max_diff_val,
        "exceed_rate": exceed_rate,
        "exceed_count": exceed_count,
        "positive_count": positive_count,
        "negative_count": negative_count,
        "threshold": threshold,
    }

    return ApiResponse(data={
        "items": paged_items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": summary,
        "distribution": dist_list,
        "workers": workers_list,
        "sku_list": sku_list,
    })


@router.get("/daily-sku-report")
def daily_sku_report(
    report_date: date | None = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not report_date:
        report_date = date.today()

    results = db.query(
        PrintedLabel.s.label("sku_id"),
        func.count(PrintedLabel.id).label("label_count"),
        func.sum(PrintedLabel.estimated_weight).label("est_weight"),
        func.sum(
            case((PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight), else_=0)
        ).label("act_weight"),
    ).filter(
        func.date(PrintedLabel.created_at) == report_date
    ).group_by(PrintedLabel.s).all()

    sku_ids = [r.sku_id for r in results if r.sku_id]
    skus = {s.id: s for s in db.query(Sku).filter(Sku.id.in_(sku_ids)).all()} if sku_ids else {}

    data = []
    for r in results:
        sku = skus.get(r.sku_id)
        data.append({
            "sku_id": r.sku_id,
            "sku_name": sku.sku_name if sku else "未知",
            "fruit_name": sku.fruit_name if sku else "未知",
            "label_count": r.label_count,
            "estimated_weight": float(r.est_weight or 0),
            "actual_weight": float(r.act_weight or 0),
        })
    return ApiResponse(data={"date": str(report_date), "items": data})


@router.get("/finance-summary")
def finance_summary(
    months: int = 6,
    start_date: date | None = None,
    end_date: date | None = None,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Comprehensive financial summary: totals, payment status, monthly trends.
    Supports either months (relative) or start_date+end_date (absolute range)."""
    today = date.today()

    if start_date and end_date:
        d_start = start_date
        d_end = end_date
    else:
        d_end = today
        d_start = (today.replace(day=1) - timedelta(days=(months - 1) * 28)).replace(day=1)

    cache_key = f"reports:finance:{d_start}:{d_end}:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _dec(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    def _fruit_q(q):
        return q.filter(FruitPurchase.purchase_date.between(d_start, d_end), FruitPurchase.deleted_at.is_(None))
    def _carton_q(q):
        return q.filter(func.date(CartonBoxPurchase.created_at).between(d_start, d_end))
    def _material_q(q):
        return q.filter(SimpleMaterialPurchase.purchase_date.between(d_start, d_end))

    fruit_total = _dec(_fruit_q(db.query(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight))).scalar())
    fruit_paid = _dec(_fruit_q(db.query(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight)).filter(FruitPurchase.payment_status == "paid")).scalar())
    fruit_unpaid = fruit_total - fruit_paid
    fruit_count = _fruit_q(db.query(func.count(FruitPurchase.id))).scalar() or 0
    fruit_unpaid_count = _fruit_q(db.query(func.count(FruitPurchase.id)).filter(FruitPurchase.payment_status == "unpaid")).scalar() or 0

    carton_total = _dec(_carton_q(db.query(func.sum(CartonBoxPurchase.purchase_price * CartonBoxPurchase.purchase_quantity))).scalar())
    carton_paid = _dec(_carton_q(db.query(func.sum(CartonBoxPurchase.purchase_price * CartonBoxPurchase.purchase_quantity)).filter(CartonBoxPurchase.payment_status == "paid")).scalar())
    carton_unpaid = carton_total - carton_paid
    carton_count = _carton_q(db.query(func.count(CartonBoxPurchase.id))).scalar() or 0
    carton_unpaid_count = _carton_q(db.query(func.count(CartonBoxPurchase.id)).filter(CartonBoxPurchase.payment_status == "unpaid")).scalar() or 0

    material_total = _dec(_material_q(db.query(func.sum(SimpleMaterialPurchase.purchase_amount))).scalar())
    material_paid = _dec(_material_q(db.query(func.sum(SimpleMaterialPurchase.purchase_amount)).filter(SimpleMaterialPurchase.payment_status == "paid")).scalar())
    material_unpaid = material_total - material_paid
    material_count = _material_q(db.query(func.count(SimpleMaterialPurchase.id))).scalar() or 0
    material_unpaid_count = _material_q(db.query(func.count(SimpleMaterialPurchase.id)).filter(SimpleMaterialPurchase.payment_status == "unpaid")).scalar() or 0

    grand_total = fruit_total + carton_total + material_total
    grand_paid = fruit_paid + carton_paid + material_paid
    grand_unpaid = fruit_unpaid + carton_unpaid + material_unpaid

    monthly = []
    m_cursor = d_start.replace(day=1)
    while m_cursor <= d_end:
        m_start = m_cursor
        if m_start.month == 12:
            m_end_month = m_start.replace(year=m_start.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            m_end_month = m_start.replace(month=m_start.month + 1, day=1) - timedelta(days=1)
        eff_start = max(m_start, d_start)
        eff_end = min(m_end_month, d_end)
        label = m_start.strftime("%Y-%m")

        f_amt = _dec(db.query(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight)).filter(
            FruitPurchase.purchase_date.between(eff_start, eff_end), FruitPurchase.deleted_at.is_(None)
        ).scalar())
        c_amt = _dec(db.query(func.sum(CartonBoxPurchase.purchase_price * CartonBoxPurchase.purchase_quantity)).filter(
            func.date(CartonBoxPurchase.created_at).between(eff_start, eff_end)
        ).scalar())
        mt_amt = _dec(db.query(func.sum(SimpleMaterialPurchase.purchase_amount)).filter(
            SimpleMaterialPurchase.purchase_date.between(eff_start, eff_end)
        ).scalar())

        monthly.append({
            "month": label,
            "fruit": round(f_amt, 2),
            "carton": round(c_amt, 2),
            "material": round(mt_amt, 2),
            "total": round(f_amt + c_amt + mt_amt, 2),
        })

        if m_start.month == 12:
            m_cursor = m_start.replace(year=m_start.year + 1, month=1, day=1)
        else:
            m_cursor = m_start.replace(month=m_start.month + 1, day=1)

    top_suppliers = _fruit_q(db.query(
        FruitPurchase.supplier_name,
        func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight).label("amt"),
        func.count(FruitPurchase.id).label("cnt"),
    )).group_by(FruitPurchase.supplier_name).order_by(desc("amt")).limit(10).all()

    top_supplier_list = [
        {"name": r.supplier_name or "未知", "amount": round(_dec(r.amt), 2), "count": r.cnt}
        for r in top_suppliers
    ]

    data = {
        "date_range": {"start": str(d_start), "end": str(d_end)},
        "overview": {
            "total": round(grand_total, 2),
            "paid": round(grand_paid, 2),
            "unpaid": round(grand_unpaid, 2),
            "paid_rate": round((grand_paid / grand_total * 100) if grand_total > 0 else 0, 1),
        },
        "by_category": [
            {"name": "水果采购", "key": "fruit", "total": round(fruit_total, 2), "paid": round(fruit_paid, 2), "unpaid": round(fruit_unpaid, 2), "count": fruit_count, "unpaid_count": fruit_unpaid_count},
            {"name": "纸箱采购", "key": "carton", "total": round(carton_total, 2), "paid": round(carton_paid, 2), "unpaid": round(carton_unpaid, 2), "count": carton_count, "unpaid_count": carton_unpaid_count},
            {"name": "材料采购", "key": "material", "total": round(material_total, 2), "paid": round(material_paid, 2), "unpaid": round(material_unpaid, 2), "count": material_count, "unpaid_count": material_unpaid_count},
        ],
        "monthly": monthly,
        "top_suppliers": top_supplier_list,
    }
    cache_set(cache_key, data, ttl=120)
    return ApiResponse(data=data)


@router.get("/analytics")
def analytics_dashboard(
    days: int = 30,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Comprehensive analytics: multi-dimensional business data for the analytics page."""
    cache_key = f"reports:analytics:{days}:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    today = date.today()
    start = today - timedelta(days=days - 1)
    date_list = [(start + timedelta(days=i)) for i in range(days)]
    dk = {d: d.strftime("%m-%d") for d in date_list}

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    # === 1. Purchase cost trend (daily, fruit + carton + material) ===
    fruit_daily = db.query(
        FruitPurchase.purchase_date.label("d"),
        func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight).label("amt"),
        func.count(FruitPurchase.id).label("cnt"),
    ).filter(
        FruitPurchase.purchase_date.between(start, today),
        FruitPurchase.deleted_at.is_(None),
    ).group_by(FruitPurchase.purchase_date).all()
    fruit_d = {r.d: {"amt": _d(r.amt), "cnt": r.cnt} for r in fruit_daily}

    carton_daily = db.query(
        func.date(CartonBoxPurchase.created_at).label("d"),
        func.sum(CartonBoxPurchase.purchase_price * CartonBoxPurchase.purchase_quantity).label("amt"),
        func.count(CartonBoxPurchase.id).label("cnt"),
    ).filter(
        func.date(CartonBoxPurchase.created_at).between(start, today),
        CartonBoxPurchase.deleted_at.is_(None),
    ).group_by(func.date(CartonBoxPurchase.created_at)).all()
    carton_d = {r.d: {"amt": _d(r.amt), "cnt": r.cnt} for r in carton_daily}

    material_daily = db.query(
        SimpleMaterialPurchase.purchase_date.label("d"),
        func.sum(SimpleMaterialPurchase.purchase_amount).label("amt"),
        func.count(SimpleMaterialPurchase.id).label("cnt"),
    ).filter(
        SimpleMaterialPurchase.purchase_date.between(start, today),
        SimpleMaterialPurchase.deleted_at.is_(None),
    ).group_by(SimpleMaterialPurchase.purchase_date).all()
    material_d = {r.d: {"amt": _d(r.amt), "cnt": r.cnt} for r in material_daily}

    cost_trend = []
    for d in date_list:
        f = fruit_d.get(d, {"amt": 0, "cnt": 0})
        c = carton_d.get(d, {"amt": 0, "cnt": 0})
        m = material_d.get(d, {"amt": 0, "cnt": 0})
        cost_trend.append({
            "date": dk[d],
            "fruit": round(f["amt"], 2),
            "carton": round(c["amt"], 2),
            "material": round(m["amt"], 2),
            "total": round(f["amt"] + c["amt"] + m["amt"], 2),
        })

    # === 2. Fruit category purchase distribution (pie) ===
    fruit_category = db.query(
        FruitPurchase.fruit_name,
        func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight).label("amt"),
        func.sum(FruitPurchase.purchase_weight).label("weight"),
        func.count(FruitPurchase.id).label("cnt"),
    ).filter(
        FruitPurchase.purchase_date.between(start, today),
        FruitPurchase.deleted_at.is_(None),
    ).group_by(FruitPurchase.fruit_name).order_by(desc("amt")).all()
    fruit_pie = [{"name": r.fruit_name, "amount": round(_d(r.amt), 2), "weight": round(_d(r.weight), 2), "count": r.cnt} for r in fruit_category]

    # === 3. Daily production output (label count + outbound) ===
    prod_daily = db.query(
        func.date(PrintedLabel.created_at).label("d"),
        func.count(PrintedLabel.id).label("printed"),
    ).filter(
        func.date(PrintedLabel.created_at).between(start, today),
    ).group_by(func.date(PrintedLabel.created_at)).all()
    prod_m = {r.d: r.printed for r in prod_daily}

    out_daily = db.query(
        func.date(PrintedLabel.scanned_time).label("d"),
        func.count(PrintedLabel.id).label("cnt"),
        func.sum(PrintedLabel.actual_weight).label("wt"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        PrintedLabel.scanned_time.isnot(None),
        func.date(PrintedLabel.scanned_time).between(start, today),
    ).group_by(func.date(PrintedLabel.scanned_time)).all()
    out_m = {r.d: {"cnt": r.cnt, "wt": _d(r.wt)} for r in out_daily}

    production_trend = [
        {
            "date": dk[d],
            "printed": prod_m.get(d, 0),
            "outbound": out_m.get(d, {}).get("cnt", 0),
            "outbound_weight": round(out_m.get(d, {}).get("wt", 0), 2),
        }
        for d in date_list
    ]

    # === 4. Top 10 SKU production ranking ===
    sku_rank = db.query(
        PrintedLabel.s.label("sku_id"),
        func.count(PrintedLabel.id).label("cnt"),
        func.sum(PrintedLabel.actual_weight).label("wt"),
    ).filter(
        func.date(PrintedLabel.created_at).between(start, today),
    ).group_by(PrintedLabel.s).order_by(desc("cnt")).limit(10).all()

    sku_ids = [r.sku_id for r in sku_rank if r.sku_id]
    sku_map = {}
    if sku_ids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name).filter(Sku.id.in_(sku_ids)).all():
            sku_map[s.id] = {"name": s.sku_name, "fruit": s.fruit_name}

    sku_ranking = [
        {
            "sku_id": r.sku_id,
            "name": sku_map.get(r.sku_id, {}).get("name", f"SKU#{r.sku_id}"),
            "fruit": sku_map.get(r.sku_id, {}).get("fruit", ""),
            "count": r.cnt,
            "weight": round(_d(r.wt), 2),
        }
        for r in sku_rank
    ]

    # === 5. Worker efficiency comparison (top 15) ===
    worker_eff = db.query(
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
        func.count(func.distinct(WorkerProduction.production_date)).label("days"),
    ).filter(
        WorkerProduction.production_date.between(start, today),
        WorkerProduction.audit_status == "approved",
    ).group_by(WorkerProduction.worker_id).order_by(desc("qty")).limit(15).all()

    wids = [r.worker_id for r in worker_eff]
    wname_map = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wname_map[w.id] = w.real_name or w.username

    worker_ranking = [
        {
            "id": r.worker_id,
            "name": wname_map.get(r.worker_id, f"工人#{r.worker_id}"),
            "total_qty": int(_d(r.qty)),
            "active_days": r.days,
            "daily_avg": round(int(_d(r.qty)) / max(r.days, 1), 1),
        }
        for r in worker_eff
    ]

    # === 6. Summary KPIs ===
    total_purchase_amt = sum(ct["total"] for ct in cost_trend)
    total_labels = sum(pt["printed"] for pt in production_trend)
    total_outbound = sum(pt["outbound"] for pt in production_trend)
    total_outbound_weight = sum(pt["outbound_weight"] for pt in production_trend)

    fruit_total_cnt = db.query(func.count(FruitPurchase.id)).filter(
        FruitPurchase.purchase_date.between(start, today), FruitPurchase.deleted_at.is_(None)
    ).scalar() or 0
    fruit_total_weight = _d(db.query(func.sum(FruitPurchase.purchase_weight)).filter(
        FruitPurchase.purchase_date.between(start, today), FruitPurchase.deleted_at.is_(None)
    ).scalar())

    active_worker_cnt = db.query(func.count(func.distinct(WorkerProduction.worker_id))).filter(
        WorkerProduction.production_date.between(start, today),
    ).scalar() or 0

    summary = {
        "total_purchase_amount": round(total_purchase_amt, 2),
        "total_labels": total_labels,
        "total_outbound": total_outbound,
        "total_outbound_weight": round(total_outbound_weight, 2),
        "fruit_purchase_count": fruit_total_cnt,
        "fruit_purchase_weight": round(fruit_total_weight, 2),
        "active_workers": active_worker_cnt,
        "days": days,
    }

    # === 7. Hourly production heatmap (for current week) ===
    week_start = today - timedelta(days=today.weekday())
    hourly_q = db.query(
        func.dayofweek(PrintedLabel.created_at).label("dow"),
        func.hour(PrintedLabel.created_at).label("hr"),
        func.count(PrintedLabel.id).label("cnt"),
    ).filter(
        func.date(PrintedLabel.created_at).between(week_start, today),
    ).group_by("dow", "hr").all()
    heatmap = [{"day": r.dow, "hour": r.hr, "value": r.cnt} for r in hourly_q]

    data = {
        "summary": summary,
        "cost_trend": cost_trend,
        "fruit_distribution": fruit_pie,
        "production_trend": production_trend,
        "sku_ranking": sku_ranking,
        "worker_ranking": worker_ranking,
        "heatmap": heatmap,
    }
    cache_set(cache_key, data, ttl=180)
    return ApiResponse(data=data)


@router.get("/supplier-statement")
def supplier_statement(
    supplier_id: int | None = None,
    supplier_type: str | None = None,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Supplier reconciliation: per-supplier unpaid summary + order details."""

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    q = db.query(Supplier).filter(Supplier.deleted_at.is_(None))
    if supplier_id:
        q = q.filter(Supplier.id == supplier_id)
    if supplier_type:
        q = q.filter(Supplier.type == supplier_type)
    suppliers_list = q.order_by(Supplier.name).all()

    result = []
    grand_unpaid = 0
    grand_total = 0

    for sup in suppliers_list:
        entry = {
            "supplier_id": sup.id, "supplier_name": sup.name, "supplier_type": sup.type,
            "contact_person": sup.contact_person or "", "phone": sup.phone or "",
            "alipay_account": sup.alipay_account or "", "bank_card": sup.bank_card or "",
            "orders": [], "total_amount": 0, "paid_amount": 0, "unpaid_amount": 0,
            "order_count": 0, "unpaid_count": 0,
        }

        if sup.type == "fruit":
            for o in db.query(FruitPurchase).filter(FruitPurchase.supplier_id == sup.id, FruitPurchase.deleted_at.is_(None)).order_by(desc(FruitPurchase.purchase_date)).all():
                amt = _d(o.purchase_price) * _d(o.purchase_weight)
                entry["orders"].append({"id": o.id, "type": "fruit", "date": str(o.purchase_date or ""), "description": f"{o.fruit_name} {_d(o.purchase_weight)}kg × ¥{_d(o.purchase_price)}", "amount": round(amt, 2), "payment_status": o.payment_status or "unpaid"})
                entry["total_amount"] += amt; entry["order_count"] += 1
                if o.payment_status != "paid": entry["unpaid_amount"] += amt; entry["unpaid_count"] += 1
                else: entry["paid_amount"] += amt

        elif sup.type == "box":
            for o in db.query(CartonBoxPurchase).filter(CartonBoxPurchase.supplier_id == sup.id, CartonBoxPurchase.deleted_at.is_(None)).order_by(desc(CartonBoxPurchase.created_at)).all():
                amt = _d(o.purchase_price) * o.purchase_quantity
                entry["orders"].append({"id": o.id, "type": "carton", "date": str(o.created_at.date()) if o.created_at else "", "description": f"纸箱 x{o.purchase_quantity} × ¥{_d(o.purchase_price)}", "amount": round(amt, 2), "payment_status": o.payment_status or "unpaid"})
                entry["total_amount"] += amt; entry["order_count"] += 1
                if o.payment_status != "paid": entry["unpaid_amount"] += amt; entry["unpaid_count"] += 1
                else: entry["paid_amount"] += amt

        elif sup.type == "material":
            for o in db.query(SimpleMaterialPurchase).filter(SimpleMaterialPurchase.supplier_id == sup.id, SimpleMaterialPurchase.deleted_at.is_(None)).order_by(desc(SimpleMaterialPurchase.purchase_date)).all():
                amt = _d(o.purchase_amount)
                entry["orders"].append({"id": o.id, "type": "material", "date": str(o.purchase_date or ""), "description": f"{o.material_name or o.material_type or '材料'} ¥{amt}", "amount": round(amt, 2), "payment_status": o.payment_status or "unpaid"})
                entry["total_amount"] += amt; entry["order_count"] += 1
                if o.payment_status != "paid": entry["unpaid_amount"] += amt; entry["unpaid_count"] += 1
                else: entry["paid_amount"] += amt

        entry["total_amount"] = round(entry["total_amount"], 2)
        entry["paid_amount"] = round(entry["paid_amount"], 2)
        entry["unpaid_amount"] = round(entry["unpaid_amount"], 2)

        if entry["order_count"] > 0:
            grand_total += entry["total_amount"]
            grand_unpaid += entry["unpaid_amount"]
            result.append(entry)

    result.sort(key=lambda x: x["unpaid_amount"], reverse=True)

    return ApiResponse(data={
        "suppliers": result,
        "summary": {
            "supplier_count": len(result),
            "grand_total": round(grand_total, 2),
            "grand_unpaid": round(grand_unpaid, 2),
            "grand_paid": round(grand_total - grand_unpaid, 2),
        },
    })


@router.get("/box-consumption")
def box_consumption_report(
    start_date: date | None = None,
    end_date: date | None = None,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Carton box consumption analysis based on outbound labels.
    Matches old system box.php: count outbound labels per carton box type with cost."""
    if not start_date:
        start_date = date.today() - timedelta(days=30)
    if not end_date:
        end_date = date.today()

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    results = db.query(
        CartonBox.id.label("box_id"),
        CartonBox.box_type,
        CartonBox.purchase_price,
        func.count(PrintedLabel.id).label("total_quantity"),
    ).join(
        Sku, Sku.carton_box_id == CartonBox.id
    ).join(
        PrintedLabel, PrintedLabel.s == Sku.id
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(start_date, end_date),
    ).group_by(
        CartonBox.id, CartonBox.box_type, CartonBox.purchase_price
    ).order_by(desc("total_quantity")).all()

    items = []
    grand_qty = 0
    grand_amount = 0.0
    for r in results:
        qty = r.total_quantity
        price = _d(r.purchase_price)
        amount = round(qty * price, 2)
        grand_qty += qty
        grand_amount += amount
        items.append({
            "box_id": r.box_id,
            "box_type": r.box_type,
            "unit_price": price,
            "quantity": qty,
            "amount": amount,
        })

    return ApiResponse(data={
        "start_date": str(start_date),
        "end_date": str(end_date),
        "items": items,
        "summary": {
            "total_types": len(items),
            "total_quantity": grand_qty,
            "total_amount": round(grand_amount, 2),
        },
    })


@router.get("/material-consumption")
def material_consumption_report(
    start_date: date | None = None,
    end_date: date | None = None,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Material consumption analysis: spending grouped by material_type within date range."""
    if not start_date:
        start_date = date.today() - timedelta(days=30)
    if not end_date:
        end_date = date.today()

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    rows = (
        db.query(
            SimpleMaterialPurchase.material_type,
            func.count(SimpleMaterialPurchase.id).label("order_count"),
            func.sum(SimpleMaterialPurchase.purchase_amount).label("total_amount"),
        )
        .filter(
            SimpleMaterialPurchase.deleted_at.is_(None),
            SimpleMaterialPurchase.purchase_date.between(start_date, end_date),
        )
        .group_by(SimpleMaterialPurchase.material_type)
        .order_by(desc(func.sum(SimpleMaterialPurchase.purchase_amount)))
        .all()
    )

    items = []
    grand_amount = 0.0
    grand_orders = 0
    for r in rows:
        amt = round(_d(r.total_amount), 2)
        cnt = r.order_count or 0
        grand_amount += amt
        grand_orders += cnt
        items.append({
            "material_type": r.material_type or "未分类",
            "order_count": cnt,
            "total_amount": amt,
        })

    for it in items:
        it["percentage"] = round(it["total_amount"] / grand_amount * 100, 1) if grand_amount > 0 else 0

    detail_rows = (
        db.query(SimpleMaterialPurchase)
        .filter(
            SimpleMaterialPurchase.deleted_at.is_(None),
            SimpleMaterialPurchase.purchase_date.between(start_date, end_date),
        )
        .order_by(desc(SimpleMaterialPurchase.purchase_date))
        .all()
    )
    details = [
        {
            "id": r.id,
            "material_type": r.material_type or "未分类",
            "material_name": r.material_name or "",
            "supplier_name": r.supplier_name or "",
            "purchase_amount": round(_d(r.purchase_amount), 2),
            "purchase_date": str(r.purchase_date or ""),
            "payment_status": r.payment_status or "unpaid",
        }
        for r in detail_rows
    ]

    return ApiResponse(data={
        "start_date": str(start_date),
        "end_date": str(end_date),
        "items": items,
        "details": details,
        "summary": {
            "total_types": len(items),
            "total_orders": grand_orders,
            "total_amount": round(grand_amount, 2),
        },
    })


@router.get("/sku-report-enhanced")
def sku_report_enhanced(
    start_date: date | None = None,
    end_date: date | None = None,
    view: str = "sku",
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Enhanced SKU report with two views: 'sku' (per-SKU with worker breakdown)
    and 'worker' (per-worker with SKU breakdown). Includes printed/outbound/production/commission."""
    sd = start_date or date.today()
    ed = end_date or date.today()

    from sqlalchemy import Integer as SaInt

    rows = db.query(
        PrintedLabel.s.label("sku_id"),
        PrintedLabel.u.label("worker_id"),
        func.count(PrintedLabel.id).label("printed"),
        func.sum(func.cast(PrintedLabel.scanned_outbound > 0, SaInt)).label("outbound"),
        func.sum(PrintedLabel.estimated_weight).label("est_w"),
        func.sum(
            func.case((PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight), else_=0)
        ).label("act_w"),
    ).filter(
        func.date(PrintedLabel.created_at).between(sd, ed)
    ).group_by(PrintedLabel.s, PrintedLabel.u).all()

    sku_ids = list({r.sku_id for r in rows if r.sku_id})
    worker_ids = list({r.worker_id for r in rows if r.worker_id})

    smap = {}
    if sku_ids:
        for s in db.query(Sku).filter(Sku.id.in_(sku_ids)).all():
            smap[s.id] = s
    wmap = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            wmap[w.id] = w.real_name or w.username

    wp_rows = db.query(
        WorkerProduction.sku_id,
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("actual_qty"),
    ).filter(
        WorkerProduction.production_date.between(sd, ed),
        WorkerProduction.audit_status.in_(["pending", "approved"]),
    ).group_by(WorkerProduction.sku_id, WorkerProduction.worker_id).all()
    wp_map = {(r.sku_id, r.worker_id): int(r.actual_qty or 0) for r in wp_rows}

    def cell(r):
        sku = smap.get(r.sku_id)
        perf = float(sku.production_performance) if sku else 0
        outbound = int(r.outbound or 0)
        actual = wp_map.get((r.sku_id, r.worker_id), 0)
        return {
            "sku_id": r.sku_id,
            "sku_name": sku.sku_name if sku else f"#{r.sku_id}",
            "fruit_name": sku.fruit_name if sku else "",
            "worker_id": r.worker_id,
            "worker_name": wmap.get(r.worker_id, f"#{r.worker_id}"),
            "printed": r.printed,
            "outbound": outbound,
            "actual_production": actual if actual > 0 else outbound,
            "estimated_weight": round(float(r.est_w or 0), 2),
            "actual_weight": round(float(r.act_w or 0), 2),
            "performance": perf,
            "commission": round(outbound * perf, 1),
        }

    cells = [cell(r) for r in rows]

    totals = {"printed": 0, "outbound": 0, "actual_production": 0, "est_weight": 0, "act_weight": 0, "commission": 0}
    for c in cells:
        totals["printed"] += c["printed"]
        totals["outbound"] += c["outbound"]
        totals["actual_production"] += c["actual_production"]
        totals["est_weight"] += c["estimated_weight"]
        totals["act_weight"] += c["actual_weight"]
        totals["commission"] += c["commission"]

    if view == "worker":
        grouped = {}
        for c in cells:
            wid = c["worker_id"]
            if wid not in grouped:
                grouped[wid] = {
                    "worker_id": wid, "worker_name": c["worker_name"],
                    "printed": 0, "outbound": 0, "actual_production": 0,
                    "commission": 0, "skus": [],
                }
            g = grouped[wid]
            g["printed"] += c["printed"]
            g["outbound"] += c["outbound"]
            g["actual_production"] += c["actual_production"]
            g["commission"] += c["commission"]
            g["skus"].append({
                "sku_id": c["sku_id"], "sku_name": c["sku_name"],
                "fruit_name": c["fruit_name"], "printed": c["printed"],
                "outbound": c["outbound"], "actual_production": c["actual_production"],
                "commission": c["commission"], "performance": c["performance"],
            })
        data = sorted(grouped.values(), key=lambda x: x["commission"], reverse=True)
    else:
        grouped = {}
        for c in cells:
            sid = c["sku_id"]
            if sid not in grouped:
                sku = smap.get(sid)
                grouped[sid] = {
                    "sku_id": sid, "sku_name": c["sku_name"], "fruit_name": c["fruit_name"],
                    "performance": c["performance"],
                    "printed": 0, "outbound": 0, "actual_production": 0,
                    "commission": 0, "workers": [],
                }
            g = grouped[sid]
            g["printed"] += c["printed"]
            g["outbound"] += c["outbound"]
            g["actual_production"] += c["actual_production"]
            g["commission"] += c["commission"]
            g["workers"].append({
                "worker_id": c["worker_id"], "worker_name": c["worker_name"],
                "printed": c["printed"], "outbound": c["outbound"],
                "actual_production": c["actual_production"], "commission": c["commission"],
            })
        data = sorted(grouped.values(), key=lambda x: x["commission"], reverse=True)

    return ApiResponse(data={
        "view": view,
        "date_range": {"start": str(sd), "end": str(ed)},
        "items": data,
        "totals": {k: round(v, 2) if isinstance(v, float) else v for k, v in totals.items()},
    })


@router.get("/inventory-query")
def inventory_query(
    filter_type: str = "day",
    selected_date: date | None = None,
    selected_month: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    worker_id: int | None = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """入库数据查询 - 对应老系统 inventory_query.php
    按日/月/区间查询已审核入库的生产数据，按工人分组展示。"""
    today = date.today()

    if filter_type == "month" and selected_month:
        import calendar
        parts = selected_month.split("-")
        y, m = int(parts[0]), int(parts[1])
        sd = date(y, m, 1)
        ed = date(y, m, calendar.monthrange(y, m)[1])
    elif filter_type == "range" and start_date and end_date:
        sd, ed = start_date, end_date
    else:
        sd = selected_date or today
        ed = sd

    base = db.query(
        WorkerProduction.id,
        WorkerProduction.worker_id,
        User.username.label("worker_name"),
        User.real_name.label("worker_real_name"),
        Sku.id.label("sku_id"),
        Sku.sku_name,
        Sku.sku_description,
        Fruit.name.label("fruit_name"),
        WorkerProduction.actual_packaging_quantity.label("warehouse_quantity"),
        WorkerProduction.printed_quantity,
        WorkerProduction.production_date,
        WorkerProduction.created_at,
        (WorkerProduction.actual_packaging_quantity * Sku.production_performance).label("commission"),
    ).join(User, WorkerProduction.worker_id == User.id
    ).join(Sku, WorkerProduction.sku_id == Sku.id
    ).join(Fruit, Sku.fruit_id == Fruit.id
    ).filter(
        WorkerProduction.production_date.between(sd, ed),
        WorkerProduction.audit_status == "approved",
    )

    if worker_id:
        base = base.filter(WorkerProduction.worker_id == worker_id)

    rows = base.order_by(WorkerProduction.production_date.desc()).all()

    workers_list = db.query(User.id, User.username, User.real_name).filter(
        User.role == "worker"
    ).order_by(User.username).all()
    worker_options = [{"id": w.id, "name": w.real_name or w.username} for w in workers_list]

    worker_groups: dict = {}
    grand = {"total_qty": 0, "total_printed": 0, "total_commission": 0.0}

    for r in rows:
        wid = r.worker_id
        if wid not in worker_groups:
            worker_groups[wid] = {
                "worker_id": wid,
                "worker_name": r.worker_real_name or r.worker_name,
                "total_qty": 0, "total_printed": 0, "total_commission": 0.0,
                "items": [],
            }
        wg = worker_groups[wid]
        qty = int(r.warehouse_quantity or 0)
        printed = int(r.printed_quantity or 0)
        comm = float(r.commission or 0)
        wg["total_qty"] += qty
        wg["total_printed"] += printed
        wg["total_commission"] += comm
        grand["total_qty"] += qty
        grand["total_printed"] += printed
        grand["total_commission"] += comm
        wg["items"].append({
            "id": r.id,
            "sku_id": r.sku_id,
            "sku_name": r.sku_name,
            "sku_description": r.sku_description or "",
            "fruit_name": r.fruit_name,
            "warehouse_quantity": qty,
            "printed_quantity": printed,
            "production_date": str(r.production_date),
            "commission": round(comm, 2),
        })

    for wg in worker_groups.values():
        wg["total_commission"] = round(wg["total_commission"], 2)
    grand["total_commission"] = round(grand["total_commission"], 2)

    return ApiResponse(data={
        "filter_type": filter_type,
        "date_range": {"start": str(sd), "end": str(ed)},
        "worker_count": len(worker_groups),
        "grand_totals": grand,
        "workers": list(worker_groups.values()),
        "worker_options": worker_options,
    })


@router.get("/label-aging")
def label_aging_analysis(
    fruit_name: str | None = None,
    sku_id: int | None = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Label aging analysis: how long printed labels stay in warehouse before outbound.
    Labels with scanned_outbound == 0 are still in warehouse."""
    from datetime import datetime

    cache_key = f"report:label-aging:{date.today()}:{fruit_name}:{sku_id}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    now = datetime.now()
    today = date.today()

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    base_q = db.query(PrintedLabel).filter(PrintedLabel.scanned_outbound == 0)
    if sku_id:
        base_q = base_q.filter(PrintedLabel.s == sku_id)

    sku_ids_filter = None
    if fruit_name:
        matching_skus = db.query(Sku.id).filter(Sku.fruit_name.like(f"%{fruit_name}%")).all()
        sku_ids_filter = [s.id for s in matching_skus]
        if not sku_ids_filter:
            return ApiResponse(data={"summary": {}, "age_distribution": [], "sku_breakdown": [], "fruit_breakdown": [], "daily_trend": [], "oldest_labels": []})
        base_q = base_q.filter(PrintedLabel.s.in_(sku_ids_filter))

    pending_labels = base_q.all()
    total_in_warehouse = len(pending_labels)

    buckets = {"0-1天": 0, "1-3天": 0, "3-5天": 0, "5-7天": 0, "7-14天": 0, "14天+": 0}
    bucket_keys = list(buckets.keys())
    total_age_hours = 0
    max_age_days = 0
    sku_age_map: dict = {}
    oldest_list = []

    for label in pending_labels:
        created = label.created_at
        if not created:
            continue
        age = now - created
        age_days = age.total_seconds() / 86400
        total_age_hours += age.total_seconds() / 3600

        if age_days > max_age_days:
            max_age_days = age_days

        if age_days <= 1:
            buckets["0-1天"] += 1
        elif age_days <= 3:
            buckets["1-3天"] += 1
        elif age_days <= 5:
            buckets["3-5天"] += 1
        elif age_days <= 7:
            buckets["5-7天"] += 1
        elif age_days <= 14:
            buckets["7-14天"] += 1
        else:
            buckets["14天+"] += 1

        sid = label.s or 0
        if sid not in sku_age_map:
            sku_age_map[sid] = {"count": 0, "total_hours": 0, "max_days": 0, "weight": 0}
        sku_age_map[sid]["count"] += 1
        sku_age_map[sid]["total_hours"] += age.total_seconds() / 3600
        sku_age_map[sid]["max_days"] = max(sku_age_map[sid]["max_days"], age_days)
        sku_age_map[sid]["weight"] += _d(label.estimated_weight)

        if age_days > 5:
            oldest_list.append({
                "id": label.id,
                "sku_id": label.s,
                "worker_id": label.u,
                "age_days": round(age_days, 1),
                "created_at": created.isoformat(),
                "estimated_weight": _d(label.estimated_weight),
            })

    oldest_list.sort(key=lambda x: x["age_days"], reverse=True)
    oldest_list = oldest_list[:50]

    age_distribution = [{"bucket": k, "count": buckets[k]} for k in bucket_keys]
    avg_age_hours = (total_age_hours / total_in_warehouse) if total_in_warehouse > 0 else 0

    all_sku_ids = list(sku_age_map.keys())
    sku_info_map = {}
    if all_sku_ids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.sku_description, Sku.fruit_name, Sku.fruit_id).filter(Sku.id.in_(all_sku_ids)).all():
            sku_info_map[s.id] = {"name": s.sku_name, "desc": s.sku_description or "", "fruit": s.fruit_name, "fruit_id": s.fruit_id}

    sku_breakdown = []
    fruit_agg: dict = {}
    for sid, info in sku_age_map.items():
        si = sku_info_map.get(sid, {"name": f"SKU#{sid}", "desc": "", "fruit": "未知", "fruit_id": 0})
        avg_days = (info["total_hours"] / info["count"] / 24) if info["count"] > 0 else 0
        health = "normal" if avg_days <= 3 else "warning" if avg_days <= 7 else "danger"
        sku_breakdown.append({
            "sku_id": sid,
            "sku_name": si["name"],
            "sku_description": si["desc"],
            "fruit_name": si["fruit"],
            "count": info["count"],
            "avg_age_days": round(avg_days, 1),
            "max_age_days": round(info["max_days"], 1),
            "total_weight": round(info["weight"], 2),
            "health": health,
        })
        fn = si["fruit"]
        if fn not in fruit_agg:
            fruit_agg[fn] = {"count": 0, "weight": 0, "total_hours": 0}
        fruit_agg[fn]["count"] += info["count"]
        fruit_agg[fn]["weight"] += info["weight"]
        fruit_agg[fn]["total_hours"] += info["total_hours"]

    sku_breakdown.sort(key=lambda x: x["avg_age_days"], reverse=True)

    fruit_breakdown = []
    for fn, agg in fruit_agg.items():
        avg_d = (agg["total_hours"] / agg["count"] / 24) if agg["count"] > 0 else 0
        fruit_breakdown.append({
            "fruit_name": fn,
            "count": agg["count"],
            "total_weight": round(agg["weight"], 2),
            "avg_age_days": round(avg_d, 1),
        })
    fruit_breakdown.sort(key=lambda x: x["count"], reverse=True)

    daily_trend = []
    for i in range(13, -1, -1):
        d = today - timedelta(days=i)
        d_next = d + timedelta(days=1)
        cnt_q = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.scanned_outbound == 0,
            func.date(PrintedLabel.created_at) <= d,
        )
        if sku_ids_filter:
            cnt_q = cnt_q.filter(PrintedLabel.s.in_(sku_ids_filter))
        elif sku_id:
            cnt_q = cnt_q.filter(PrintedLabel.s == sku_id)

        new_in = db.query(func.count(PrintedLabel.id)).filter(
            func.date(PrintedLabel.created_at) == d,
        )
        if sku_ids_filter:
            new_in = new_in.filter(PrintedLabel.s.in_(sku_ids_filter))
        elif sku_id:
            new_in = new_in.filter(PrintedLabel.s == sku_id)

        shipped = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.scanned_outbound > 0,
            func.date(PrintedLabel.scanned_time) == d,
        )
        if sku_ids_filter:
            shipped = shipped.filter(PrintedLabel.s.in_(sku_ids_filter))
        elif sku_id:
            shipped = shipped.filter(PrintedLabel.s == sku_id)

        daily_trend.append({
            "date": d.strftime("%m-%d"),
            "new_printed": new_in.scalar() or 0,
            "shipped": shipped.scalar() or 0,
        })

    wids = list({l.get("worker_id") for l in oldest_list if l.get("worker_id")})
    sids_oldest = list({l.get("sku_id") for l in oldest_list if l.get("sku_id")})
    w_map = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            w_map[w.id] = w.real_name or w.username
    s_map_oldest = {}
    if sids_oldest:
        for s in db.query(Sku.id, Sku.sku_name).filter(Sku.id.in_(sids_oldest)).all():
            s_map_oldest[s.id] = s.sku_name
    for l in oldest_list:
        l["worker_name"] = w_map.get(l["worker_id"], f"#{l['worker_id']}" if l["worker_id"] else "-")
        l["sku_name"] = s_map_oldest.get(l["sku_id"], f"#{l['sku_id']}" if l["sku_id"] else "-")

    total_weight = sum(info["weight"] for info in sku_age_map.values())
    warning_count = sum(1 for s in sku_breakdown if s["health"] == "warning")
    danger_count = sum(1 for s in sku_breakdown if s["health"] == "danger")

    total_outbound_today = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == today,
    ).scalar() or 0

    result = {
        "summary": {
            "total_in_warehouse": total_in_warehouse,
            "avg_age_hours": round(avg_age_hours, 1),
            "avg_age_days": round(avg_age_hours / 24, 1),
            "max_age_days": round(max_age_days, 1),
            "total_weight": round(total_weight, 2),
            "sku_count": len(sku_breakdown),
            "fruit_count": len(fruit_breakdown),
            "warning_count": warning_count,
            "danger_count": danger_count,
            "outbound_today": total_outbound_today,
        },
        "age_distribution": age_distribution,
        "sku_breakdown": sku_breakdown,
        "fruit_breakdown": fruit_breakdown,
        "daily_trend": daily_trend,
        "oldest_labels": oldest_list,
    }
    cache_set(cache_key, result, ttl=120)
    return ApiResponse(data=result)


@router.get("/batch-efficiency")
def batch_efficiency_report(
    start_date: date | None = None,
    end_date: date | None = None,
    min_labels: int = 0,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Batch efficiency report: utilization rate, outbound speed, worker efficiency per purchase batch."""
    sd = start_date or (date.today() - timedelta(days=30))
    ed = end_date or date.today()

    cache_key = f"report:batch-eff:{sd}:{ed}:{min_labels}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    purchases = db.query(FruitPurchase).filter(
        FruitPurchase.deleted_at.is_(None),
        FruitPurchase.purchase_date.between(sd, ed),
    ).order_by(desc(FruitPurchase.purchase_date)).all()

    if not purchases:
        return ApiResponse(data={"batches": [], "summary": {}, "efficiency_distribution": [], "top_batches": [], "slow_batches": []})

    pids = [p.id for p in purchases]

    label_stats_q = db.query(
        PrintedLabel.b,
        func.count(PrintedLabel.id).label("total_labels"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound_count"),
        func.sum(PrintedLabel.estimated_weight).label("est_weight"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight), else_=0)).label("act_weight"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, PrintedLabel.estimated_weight), else_=0)).label("outbound_est_weight"),
        func.min(PrintedLabel.created_at).label("first_print"),
        func.max(case((PrintedLabel.scanned_outbound > 0, PrintedLabel.scanned_time), else_=None)).label("last_outbound"),
    ).filter(PrintedLabel.b.in_(pids)).group_by(PrintedLabel.b).all()
    label_map = {}
    for r in label_stats_q:
        label_map[r.b] = r

    from app.models import BatchAssignment
    assign_q = db.query(
        BatchAssignment.purchase_id,
        func.count(func.distinct(BatchAssignment.worker_id)).label("worker_count"),
    ).filter(BatchAssignment.purchase_id.in_(pids)).group_by(BatchAssignment.purchase_id).all()
    assign_map = {r.purchase_id: r.worker_count for r in assign_q}

    sku_consumption = db.query(
        PrintedLabel.b,
        func.sum(PrintedLabel.estimated_weight - Sku.material_weight).label("consumed"),
    ).join(Sku, PrintedLabel.s == Sku.id).filter(
        PrintedLabel.b.in_(pids),
        PrintedLabel.scanned_outbound > 0,
    ).group_by(PrintedLabel.b).all()
    consumed_map = {r.b: _d(r.consumed) for r in sku_consumption}

    batches = []
    total_purchase_weight = 0
    total_consumed = 0
    total_labels = 0
    total_outbound = 0
    eff_buckets = {"0-20%": 0, "20-40%": 0, "40-60%": 0, "60-80%": 0, "80-100%": 0, "100%+": 0}

    for p in purchases:
        ls = label_map.get(p.id)
        lbl_count = ls.total_labels if ls else 0
        if lbl_count < min_labels:
            continue

        out_count = int(ls.outbound_count or 0) if ls else 0
        est_w = _d(ls.est_weight) if ls else 0
        act_w = _d(ls.act_weight) if ls else 0
        pw = _d(p.purchase_weight)
        consumed_w = consumed_map.get(p.id, 0)

        utilization = round(consumed_w / pw * 100, 1) if pw > 0 else 0
        outbound_rate = round(out_count / lbl_count * 100, 1) if lbl_count > 0 else 0

        days_to_complete = None
        if ls and ls.first_print and ls.last_outbound:
            delta = ls.last_outbound - ls.first_print
            days_to_complete = round(delta.total_seconds() / 86400, 1)

        wc = assign_map.get(p.id, 0)
        per_worker = round(out_count / wc, 1) if wc > 0 else 0

        total_purchase_weight += pw
        total_consumed += consumed_w
        total_labels += lbl_count
        total_outbound += out_count

        if utilization <= 20: eff_buckets["0-20%"] += 1
        elif utilization <= 40: eff_buckets["20-40%"] += 1
        elif utilization <= 60: eff_buckets["40-60%"] += 1
        elif utilization <= 80: eff_buckets["60-80%"] += 1
        elif utilization <= 100: eff_buckets["80-100%"] += 1
        else: eff_buckets["100%+"] += 1

        batches.append({
            "purchase_id": p.id,
            "fruit_name": p.fruit_name,
            "supplier_name": p.supplier_name,
            "purchase_date": str(p.purchase_date),
            "purchase_weight": pw,
            "purchase_price": _d(p.purchase_price),
            "total_labels": lbl_count,
            "outbound_count": out_count,
            "outbound_rate": outbound_rate,
            "consumed_weight": round(consumed_w, 2),
            "utilization": utilization,
            "worker_count": wc,
            "per_worker_output": per_worker,
            "days_to_complete": days_to_complete,
            "estimated_weight": round(est_w, 2),
            "actual_weight": round(act_w, 2),
        })

    batches.sort(key=lambda x: x["utilization"], reverse=True)
    top_batches = sorted([b for b in batches if b["total_labels"] > 0], key=lambda x: x["utilization"], reverse=True)[:5]
    slow_batches = sorted([b for b in batches if b["total_labels"] > 0 and b["outbound_rate"] < 100], key=lambda x: x["outbound_rate"])[:5]

    avg_utilization = round(total_consumed / total_purchase_weight * 100, 1) if total_purchase_weight > 0 else 0
    avg_outbound_rate = round(total_outbound / total_labels * 100, 1) if total_labels > 0 else 0

    result = {
        "batches": batches,
        "summary": {
            "batch_count": len(batches),
            "total_purchase_weight": round(total_purchase_weight, 2),
            "total_consumed": round(total_consumed, 2),
            "total_labels": total_labels,
            "total_outbound": total_outbound,
            "avg_utilization": avg_utilization,
            "avg_outbound_rate": avg_outbound_rate,
            "date_range": {"start": str(sd), "end": str(ed)},
        },
        "efficiency_distribution": [{"bucket": k, "count": v} for k, v in eff_buckets.items()],
        "top_batches": top_batches,
        "slow_batches": slow_batches,
    }
    cache_set(cache_key, result, ttl=120)
    return ApiResponse(data=result)


@router.get("/supplier-performance")
def supplier_performance_report(
    supplier_type: str | None = None,
    days: int = 90,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Comprehensive supplier performance scoring: volume, price stability, quality, payment rate."""
    from app.models import Supplier as SupplierModel

    today = date.today()
    start = today - timedelta(days=days)

    cache_key = f"report:supplier-perf:{supplier_type}:{days}:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    suppliers_q = db.query(SupplierModel).filter(SupplierModel.deleted_at.is_(None))
    if supplier_type:
        suppliers_q = suppliers_q.filter(SupplierModel.type == supplier_type)
    suppliers = suppliers_q.all()

    results = []
    for sup in suppliers:
        metrics = {
            "id": sup.id,
            "name": sup.name,
            "type": sup.type,
            "contact_person": sup.contact_person or "",
            "phone": sup.phone or "",
        }

        if sup.type == "fruit":
            orders = db.query(FruitPurchase).filter(
                FruitPurchase.supplier_id == sup.id,
                FruitPurchase.deleted_at.is_(None),
                FruitPurchase.purchase_date >= start,
            ).all()

            if not orders:
                metrics.update({
                    "order_count": 0, "total_weight": 0, "total_cost": 0,
                    "avg_price": 0, "price_variance": 0, "paid_rate": 0,
                    "avg_utilization": 0, "avg_weight_diff": 0,
                    "score": 0, "grade": "N/A", "trend": "stable",
                })
                results.append(metrics)
                continue

            order_count = len(orders)
            total_weight = sum(_d(o.purchase_weight) for o in orders)
            prices = [_d(o.purchase_price) for o in orders if _d(o.purchase_price) > 0]
            avg_price = sum(prices) / len(prices) if prices else 0
            total_cost = sum(_d(o.purchase_weight) * _d(o.purchase_price) for o in orders)
            paid_count = sum(1 for o in orders if o.payment_status == "paid")
            paid_rate = round(paid_count / order_count * 100, 1) if order_count > 0 else 0

            import statistics
            price_variance = statistics.stdev(prices) if len(prices) > 1 else 0

            pids = [o.id for o in orders]
            if pids:
                consumed_q = db.query(
                    func.sum(PrintedLabel.estimated_weight - Sku.material_weight).label("consumed"),
                    func.sum(FruitPurchase.purchase_weight).label("purchased"),
                ).select_from(PrintedLabel).join(
                    Sku, PrintedLabel.s == Sku.id
                ).join(
                    FruitPurchase, PrintedLabel.b == FruitPurchase.id
                ).filter(
                    PrintedLabel.b.in_(pids),
                    PrintedLabel.scanned_outbound > 0,
                ).first()
                consumed = _d(consumed_q.consumed) if consumed_q and consumed_q.consumed else 0
                avg_utilization = round(consumed / total_weight * 100, 1) if total_weight > 0 else 0

                weight_diff_q = db.query(
                    func.avg(func.abs(PrintedLabel.weight_difference)).label("avg_diff"),
                ).filter(
                    PrintedLabel.b.in_(pids),
                    PrintedLabel.scanned_outbound > 0,
                    PrintedLabel.weight_difference.isnot(None),
                ).first()
                avg_weight_diff = round(_d(weight_diff_q.avg_diff), 3) if weight_diff_q else 0
            else:
                avg_utilization = 0
                avg_weight_diff = 0

            recent_prices = [_d(o.purchase_price) for o in sorted(orders, key=lambda x: x.purchase_date or today)[-5:]]
            if len(recent_prices) >= 2:
                trend = "up" if recent_prices[-1] > recent_prices[0] * 1.05 else "down" if recent_prices[-1] < recent_prices[0] * 0.95 else "stable"
            else:
                trend = "stable"

            volume_score = min(order_count * 5, 25)
            stability_score = max(25 - price_variance * 50, 0) if avg_price > 0 else 15
            quality_score = max(25 - avg_weight_diff * 100, 0)
            payment_score = paid_rate / 100 * 25
            total_score = round(volume_score + stability_score + quality_score + payment_score, 1)

            grade = "S" if total_score >= 85 else "A" if total_score >= 70 else "B" if total_score >= 50 else "C" if total_score >= 30 else "D"

            metrics.update({
                "order_count": order_count,
                "total_weight": round(total_weight, 2),
                "total_cost": round(total_cost, 2),
                "avg_price": round(avg_price, 2),
                "price_variance": round(price_variance, 4),
                "paid_rate": paid_rate,
                "avg_utilization": avg_utilization,
                "avg_weight_diff": avg_weight_diff,
                "score": total_score,
                "grade": grade,
                "trend": trend,
                "score_breakdown": {
                    "volume": round(volume_score, 1),
                    "stability": round(stability_score, 1),
                    "quality": round(quality_score, 1),
                    "payment": round(payment_score, 1),
                },
            })

        elif sup.type in ("box", "material"):
            PurchaseModel = CartonBoxPurchase if sup.type == "box" else SimpleMaterialPurchase
            date_field = PurchaseModel.created_at
            if sup.type == "material":
                date_field = PurchaseModel.purchase_date

            orders_q = db.query(PurchaseModel).filter(
                PurchaseModel.supplier_id == sup.id,
                PurchaseModel.deleted_at.is_(None),
            ).all()
            order_count = len(orders_q)

            if sup.type == "box":
                total_cost = sum(_d(o.purchase_price) * _d(o.purchase_quantity) for o in orders_q)
                total_qty = sum(_d(o.purchase_quantity) for o in orders_q)
                paid_count = sum(1 for o in orders_q if o.payment_status == "paid")
            else:
                total_cost = sum(_d(o.purchase_amount) for o in orders_q)
                total_qty = order_count
                paid_count = sum(1 for o in orders_q if o.payment_status == "paid")

            paid_rate = round(paid_count / order_count * 100, 1) if order_count > 0 else 0
            volume_score = min(order_count * 5, 25)
            payment_score = paid_rate / 100 * 25
            total_score = round(volume_score + 25 + payment_score + 12.5, 1)
            grade = "S" if total_score >= 85 else "A" if total_score >= 70 else "B" if total_score >= 50 else "C" if total_score >= 30 else "D"

            metrics.update({
                "order_count": order_count,
                "total_weight": round(total_qty, 2),
                "total_cost": round(total_cost, 2),
                "avg_price": round(total_cost / total_qty, 2) if total_qty > 0 else 0,
                "price_variance": 0,
                "paid_rate": paid_rate,
                "avg_utilization": 0,
                "avg_weight_diff": 0,
                "score": total_score,
                "grade": grade,
                "trend": "stable",
                "score_breakdown": {
                    "volume": round(volume_score, 1),
                    "stability": 25,
                    "quality": 12.5,
                    "payment": round(payment_score, 1),
                },
            })

        results.append(metrics)

    results.sort(key=lambda x: x.get("score", 0), reverse=True)

    grade_dist = {"S": 0, "A": 0, "B": 0, "C": 0, "D": 0, "N/A": 0}
    for r in results:
        g = r.get("grade", "N/A")
        grade_dist[g] = grade_dist.get(g, 0) + 1

    avg_score = round(sum(r["score"] for r in results) / len(results), 1) if results else 0

    result = {
        "suppliers": results,
        "summary": {
            "total_suppliers": len(results),
            "avg_score": avg_score,
            "grade_distribution": grade_dist,
            "days": days,
            "date_range": {"start": str(start), "end": str(today)},
        },
    }
    cache_set(cache_key, result, ttl=300)
    return ApiResponse(data=result)


@router.get("/supplier-performance-ai")
def supplier_performance_ai(
    days: int = 90,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """AI供应商评分分析"""
    from fastapi.responses import StreamingResponse
    import json
    today = date.today()
    start = today - timedelta(days=days)
    def _d(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    ctx = [f"分析周期: {start} ~ {today}"]
    rows = db.query(
        FruitPurchase.supplier_name,
        func.count(FruitPurchase.id).label("count"),
        func.avg(FruitPurchase.purchase_price).label("avg_price"),
        func.sum(FruitPurchase.purchase_weight).label("total_weight"),
        func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight).label("total_amount"),
    ).filter(FruitPurchase.deleted_at.is_(None), FruitPurchase.purchase_date >= start).group_by(
        FruitPurchase.supplier_name).all()

    ctx.append("供应商数据:")
    for r in rows:
        ctx.append(f"  {r.supplier_name or '未知'}: {int(r.count)}笔, 均价¥{_d(r.avg_price):.2f}, {_d(r.total_weight):.0f}kg, ¥{_d(r.total_amount):.0f}")

    prompt = f"""分析以下供应商数据，给出评价和建议。\n\n{chr(10).join(ctx)}\n\n用markdown，含：
1. **供应商评价**: 各供应商综合评价
2. **价格对比**: 价格竞争力分析
3. **合作建议**: 2-3条优化供应链建议\n简洁，不超200字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            for chunk in client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是供应链管理顾问。简体中文。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.2, max_tokens=1000):
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/sku-efficiency")
def sku_efficiency_report(
    days: int = 30,
    fruit_name: str | None = None,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Per-SKU production efficiency analysis: speed, waste, outbound rate, worker preference."""
    today = date.today()
    start = today - timedelta(days=days)

    cache_key = f"report:sku-eff:{days}:{fruit_name}:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    skus = db.query(Sku).all()
    if fruit_name:
        skus = [s for s in skus if fruit_name.lower() in (s.fruit_name or '').lower()]

    sku_ids = [s.id for s in skus]
    if not sku_ids:
        return ApiResponse(data={"skus": [], "summary": {}, "rankings": {}})

    sku_map = {s.id: s for s in skus}

    from app.models import WorkerProduction as WP

    prod_q = db.query(
        WP.sku_id,
        func.sum(WP.actual_packaging_quantity).label("total_production"),
        func.sum(WP.printed_quantity).label("total_printed"),
        func.count(WP.id).label("record_count"),
        func.count(func.distinct(WP.worker_id)).label("worker_count"),
        func.count(func.distinct(WP.production_date)).label("active_days"),
    ).filter(
        WP.sku_id.in_(sku_ids),
        WP.production_date >= start,
        WP.audit_status == "approved",
    ).group_by(WP.sku_id).all()
    prod_map = {r.sku_id: r for r in prod_q}

    label_q = db.query(
        PrintedLabel.s.label("sku_id"),
        func.count(PrintedLabel.id).label("total_labels"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound_count"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight), else_=0)).label("outbound_weight"),
        func.sum(PrintedLabel.estimated_weight).label("est_weight_sum"),
        func.avg(func.abs(case((PrintedLabel.scanned_outbound > 0, PrintedLabel.weight_difference), else_=None))).label("avg_weight_diff"),
    ).filter(
        PrintedLabel.s.in_(sku_ids),
        func.date(PrintedLabel.created_at) >= start,
    ).group_by(PrintedLabel.s).all()
    label_map = {r.sku_id: r for r in label_q}

    top_workers_q = db.query(
        WP.sku_id,
        WP.worker_id,
        func.sum(WP.actual_packaging_quantity).label("qty"),
    ).filter(
        WP.sku_id.in_(sku_ids),
        WP.production_date >= start,
        WP.audit_status == "approved",
    ).group_by(WP.sku_id, WP.worker_id).all()

    worker_ids_all = list({r.worker_id for r in top_workers_q})
    wname_map = {}
    if worker_ids_all:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids_all)).all():
            wname_map[w.id] = w.real_name or w.username

    sku_top_workers: dict = {}
    for r in top_workers_q:
        sku_top_workers.setdefault(r.sku_id, []).append({
            "worker_id": r.worker_id,
            "worker_name": wname_map.get(r.worker_id, f"#{r.worker_id}"),
            "qty": int(r.qty or 0),
        })
    for k in sku_top_workers:
        sku_top_workers[k].sort(key=lambda x: x["qty"], reverse=True)
        sku_top_workers[k] = sku_top_workers[k][:3]

    items = []
    for sid in sku_ids:
        sku = sku_map[sid]
        prod = prod_map.get(sid)
        lbl = label_map.get(sid)

        total_prod = int(prod.total_production or 0) if prod else 0
        total_printed = int(prod.total_printed or 0) if prod else 0
        record_count = int(prod.record_count or 0) if prod else 0
        worker_count = int(prod.worker_count or 0) if prod else 0
        active_days = int(prod.active_days or 0) if prod else 0

        total_labels = int(lbl.total_labels or 0) if lbl else 0
        outbound_count = int(lbl.outbound_count or 0) if lbl else 0
        avg_wd = round(_d(lbl.avg_weight_diff), 3) if lbl and lbl.avg_weight_diff else 0

        outbound_rate = round(outbound_count / total_labels * 100, 1) if total_labels > 0 else 0
        waste_rate = round((total_printed - total_prod) / total_printed * 100, 1) if total_printed > 0 else 0
        daily_avg = round(total_prod / active_days, 1) if active_days > 0 else 0
        per_worker = round(total_prod / worker_count, 1) if worker_count > 0 else 0

        efficiency_score = 0
        if total_labels > 0:
            outbound_s = min(outbound_rate / 100 * 30, 30)
            waste_s = max(20 - waste_rate * 2, 0)
            volume_s = min(total_labels / 100 * 10, 20)
            quality_s = max(30 - avg_wd * 100, 0)
            efficiency_score = round(outbound_s + waste_s + volume_s + quality_s, 1)

        if total_prod > 0 or total_labels > 0:
            items.append({
                "sku_id": sid,
                "sku_name": sku.sku_name,
                "sku_description": sku.sku_description or "",
                "fruit_name": sku.fruit_name or "",
                "performance": _d(sku.production_performance),
                "total_weight": _d(sku.total_weight),
                "total_production": total_prod,
                "total_labels": total_labels,
                "outbound_count": outbound_count,
                "outbound_rate": outbound_rate,
                "waste_rate": max(waste_rate, 0),
                "daily_avg": daily_avg,
                "worker_count": worker_count,
                "per_worker_avg": per_worker,
                "avg_weight_diff": avg_wd,
                "active_days": active_days,
                "efficiency_score": efficiency_score,
                "top_workers": sku_top_workers.get(sid, []),
            })

    items.sort(key=lambda x: x["efficiency_score"], reverse=True)

    total_production = sum(i["total_production"] for i in items)
    total_outbound = sum(i["outbound_count"] for i in items)
    total_labels = sum(i["total_labels"] for i in items)
    avg_outbound_rate = round(total_outbound / total_labels * 100, 1) if total_labels > 0 else 0
    avg_efficiency = round(sum(i["efficiency_score"] for i in items) / len(items), 1) if items else 0

    top_by_production = sorted([i for i in items], key=lambda x: x["total_production"], reverse=True)[:5]
    top_by_efficiency = sorted([i for i in items], key=lambda x: x["efficiency_score"], reverse=True)[:5]
    worst_outbound = sorted([i for i in items if i["total_labels"] > 0], key=lambda x: x["outbound_rate"])[:5]

    fruit_options = sorted(list(set(i["fruit_name"] for i in items if i["fruit_name"])))

    result = {
        "skus": items,
        "summary": {
            "total_skus": len(items),
            "total_production": total_production,
            "total_outbound": total_outbound,
            "total_labels": total_labels,
            "avg_outbound_rate": avg_outbound_rate,
            "avg_efficiency": avg_efficiency,
            "days": days,
        },
        "rankings": {
            "top_production": top_by_production,
            "top_efficiency": top_by_efficiency,
            "worst_outbound": worst_outbound,
        },
        "fruit_options": fruit_options,
    }
    cache_set(cache_key, result, ttl=120)
    return ApiResponse(data=result)


@router.get("/sku-efficiency-ai")
def sku_efficiency_ai(
    days: int = 30,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """AI分析SKU效率"""
    from fastapi.responses import StreamingResponse
    import json
    today = date.today()
    start = today - timedelta(days=days)
    def _d(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    ctx = [f"分析周期: {start} ~ {today} ({days}天)"]
    rows = db.query(
        Sku.sku_name, Sku.fruit_name, Sku.production_performance,
        func.count(PrintedLabel.id).label("labels"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound"),
    ).join(Sku, PrintedLabel.s == Sku.id).filter(
        func.date(PrintedLabel.created_at) >= start,
    ).group_by(Sku.id, Sku.sku_name, Sku.fruit_name, Sku.production_performance).all()

    ctx.append("SKU效率数据:")
    for r in sorted(rows, key=lambda x: int(x.outbound or 0), reverse=True)[:10]:
        rate = round(int(r.outbound or 0) / max(int(r.labels or 1), 1) * 100, 1)
        ctx.append(f"  {r.sku_name}({r.fruit_name}): 标签{r.labels} 出库{int(r.outbound or 0)} 出库率{rate}% 绩效{_d(r.production_performance)}")

    prompt = f"""分析以下SKU效率数据，给出优化建议。\n\n{chr(10).join(ctx)}\n\n用markdown，含：
1. **效率概况**: 整体SKU效率评价
2. **优势SKU**: 表现最好的SKU及原因
3. **问题SKU**: 出库率低或效率差的SKU
4. **优化建议**: 2-3条具体建议\n简洁，不超200字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            for chunk in client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是SKU效率分析专家。简体中文。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.2, max_tokens=1000):
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/daily-report")
def daily_operations_report(
    report_date: date | None = None,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate comprehensive daily operations report."""
    from app.models import (
        WorkerProduction, SkuTransaction, BatchAssignment,
        FailureLog, CartonBox,
    )

    d = report_date or date.today()
    yesterday = d - timedelta(days=1)

    cache_key = f"report:daily:{d}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    # Production
    prod_today = db.query(
        func.count(WorkerProduction.id).label("records"),
        func.sum(WorkerProduction.actual_packaging_quantity).label("total_qty"),
        func.count(func.distinct(WorkerProduction.worker_id)).label("workers"),
        func.count(func.distinct(WorkerProduction.sku_id)).label("skus"),
    ).filter(WorkerProduction.production_date == d).first()

    prod_yesterday = db.query(
        func.sum(WorkerProduction.actual_packaging_quantity).label("total_qty"),
    ).filter(WorkerProduction.production_date == yesterday).first()

    pending_audit = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "pending",
        WorkerProduction.production_date == d,
    ).scalar() or 0
    approved_today = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date == d,
    ).scalar() or 0

    # Labels
    labels_printed = db.query(func.count(PrintedLabel.id)).filter(
        func.date(PrintedLabel.created_at) == d,
    ).scalar() or 0

    # Outbound
    outbound_count = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).scalar() or 0
    outbound_weight = db.query(func.coalesce(func.sum(PrintedLabel.actual_weight), 0)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).scalar() or 0

    yesterday_outbound = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == yesterday,
    ).scalar() or 0

    # Transactions
    txn_count = db.query(func.count(SkuTransaction.id)).filter(
        func.date(SkuTransaction.transaction_date) == d,
    ).scalar() or 0
    txn_qty = db.query(func.coalesce(func.sum(SkuTransaction.quantity), 0)).filter(
        func.date(SkuTransaction.transaction_date) == d,
    ).scalar() or 0

    # Failures
    fail_count = db.query(func.count(FailureLog.id)).filter(
        func.date(FailureLog.failure_time) == d,
    ).scalar() or 0

    # Commission
    commission_today = db.query(
        func.sum(Sku.production_performance).label("comm"),
    ).select_from(PrintedLabel).join(Sku, PrintedLabel.s == Sku.id).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).scalar() or 0

    # Purchase
    purchases_today = db.query(
        func.count(FruitPurchase.id).label("cnt"),
        func.coalesce(func.sum(FruitPurchase.purchase_weight), 0).label("weight"),
        func.coalesce(func.sum(FruitPurchase.purchase_weight * FruitPurchase.purchase_price), 0).label("cost"),
    ).filter(
        FruitPurchase.purchase_date == d,
        FruitPurchase.deleted_at.is_(None),
    ).first()

    # Assignments
    assignments = db.query(
        func.count(func.distinct(BatchAssignment.purchase_id)).label("batches"),
        func.count(func.distinct(BatchAssignment.worker_id)).label("workers"),
    ).filter(BatchAssignment.assignment_date == d).first()

    # Inventory alerts
    low_stock = db.query(func.count(CartonBox.id)).filter(
        CartonBox.stock_quantity <= CartonBox.low_stock_threshold,
    ).scalar() or 0

    # Warehouse labels
    warehouse_labels = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound == 0,
    ).scalar() or 0

    # Top workers today
    top_workers_q = db.query(
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
    ).filter(
        WorkerProduction.production_date == d,
        WorkerProduction.audit_status == "approved",
    ).group_by(WorkerProduction.worker_id).order_by(desc(func.sum(WorkerProduction.actual_packaging_quantity))).limit(5).all()

    wids = [r.worker_id for r in top_workers_q]
    wnames = {}
    if wids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(wids)).all():
            wnames[w.id] = w.real_name or w.username
    top_workers = [{"name": wnames.get(r.worker_id, f"#{r.worker_id}"), "qty": int(r.qty or 0)} for r in top_workers_q]

    # Top SKUs today
    top_skus_q = db.query(
        PrintedLabel.s.label("sku_id"),
        func.count(PrintedLabel.id).label("cnt"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == d,
    ).group_by(PrintedLabel.s).order_by(desc(func.count(PrintedLabel.id))).limit(5).all()
    sku_ids_top = [r.sku_id for r in top_skus_q]
    snames = {}
    if sku_ids_top:
        for s in db.query(Sku.id, Sku.sku_name).filter(Sku.id.in_(sku_ids_top)).all():
            snames[s.id] = s.sku_name
    top_skus = [{"name": snames.get(r.sku_id, f"#{r.sku_id}"), "count": r.cnt} for r in top_skus_q]

    prod_qty = int(prod_today.total_qty or 0) if prod_today else 0
    prod_yest = int(prod_yesterday.total_qty or 0) if prod_yesterday else 0
    prod_change = prod_qty - prod_yest
    out_change = outbound_count - yesterday_outbound

    result = {
        "date": str(d),
        "production": {
            "records": int(prod_today.records or 0) if prod_today else 0,
            "total_qty": prod_qty,
            "workers": int(prod_today.workers or 0) if prod_today else 0,
            "skus": int(prod_today.skus or 0) if prod_today else 0,
            "change_vs_yesterday": prod_change,
            "pending_audit": pending_audit,
            "approved": approved_today,
        },
        "labels": {
            "printed": labels_printed,
            "outbound": outbound_count,
            "outbound_weight": round(_d(outbound_weight), 2),
            "outbound_change": out_change,
            "warehouse": warehouse_labels,
        },
        "transactions": {
            "count": txn_count,
            "quantity": int(txn_qty),
        },
        "purchase": {
            "count": int(purchases_today.cnt or 0) if purchases_today else 0,
            "weight": round(_d(purchases_today.weight), 2) if purchases_today else 0,
            "cost": round(_d(purchases_today.cost), 2) if purchases_today else 0,
        },
        "assignments": {
            "batches": int(assignments.batches or 0) if assignments else 0,
            "workers": int(assignments.workers or 0) if assignments else 0,
        },
        "alerts": {
            "low_stock": low_stock,
            "failures": fail_count,
        },
        "finance": {
            "commission": round(_d(commission_today), 2),
        },
        "top_workers": top_workers,
        "top_skus": top_skus,
    }
    cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


@router.get("/fruit-analytics")
def fruit_category_analytics(
    days: int = 30,
    user: UserModel = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Comprehensive per-fruit analytics: purchase to outbound full chain."""
    today = date.today()
    start = today - timedelta(days=days)

    cache_key = f"report:fruit-analytics:{days}:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    fruits = db.query(Fruit).order_by(Fruit.name).all()
    fruit_map = {f.id: f.name for f in fruits}

    purchase_q = db.query(
        FruitPurchase.fruit_id,
        func.count(FruitPurchase.id).label("order_count"),
        func.sum(FruitPurchase.purchase_weight).label("total_weight"),
        func.sum(FruitPurchase.purchase_weight * FruitPurchase.purchase_price).label("total_cost"),
        func.avg(FruitPurchase.purchase_price).label("avg_price"),
        func.count(func.distinct(FruitPurchase.supplier_id)).label("supplier_count"),
    ).filter(
        FruitPurchase.deleted_at.is_(None),
        FruitPurchase.purchase_date >= start,
    ).group_by(FruitPurchase.fruit_id).all()
    purchase_map = {r.fruit_id: r for r in purchase_q}

    sku_q = db.query(
        Sku.fruit_id,
        func.count(Sku.id).label("sku_count"),
    ).group_by(Sku.fruit_id).all()
    sku_count_map = {r.fruit_id: r.sku_count for r in sku_q}

    fruit_sku_ids: dict = {}
    for s in db.query(Sku.id, Sku.fruit_id).all():
        fruit_sku_ids.setdefault(s.fruit_id, []).append(s.id)

    label_q = db.query(
        Sku.fruit_id,
        func.count(PrintedLabel.id).label("total_labels"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound_count"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight), else_=0)).label("outbound_weight"),
        func.sum(PrintedLabel.estimated_weight).label("est_weight"),
    ).join(PrintedLabel, PrintedLabel.s == Sku.id).filter(
        func.date(PrintedLabel.created_at) >= start,
    ).group_by(Sku.fruit_id).all()
    label_map = {r.fruit_id: r for r in label_q}

    prod_q = db.query(
        Sku.fruit_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("prod_qty"),
        func.count(func.distinct(WorkerProduction.worker_id)).label("worker_count"),
    ).join(WorkerProduction, WorkerProduction.sku_id == Sku.id).filter(
        WorkerProduction.production_date >= start,
        WorkerProduction.audit_status == "approved",
    ).group_by(Sku.fruit_id).all()
    prod_map = {r.fruit_id: r for r in prod_q}

    consumed_q = db.query(
        Sku.fruit_id,
        func.sum(PrintedLabel.estimated_weight - Sku.material_weight).label("consumed"),
    ).join(PrintedLabel, PrintedLabel.s == Sku.id).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.created_at) >= start,
    ).group_by(Sku.fruit_id).all()
    consumed_map = {r.fruit_id: _d(r.consumed) for r in consumed_q}

    items = []
    for fid, fname in fruit_map.items():
        p = purchase_map.get(fid)
        l = label_map.get(fid)
        pr = prod_map.get(fid)
        consumed = consumed_map.get(fid, 0)

        pw = _d(p.total_weight) if p else 0
        cost = _d(p.total_cost) if p else 0
        labels = int(l.total_labels or 0) if l else 0
        outbound = int(l.outbound_count or 0) if l else 0
        prod_qty = int(pr.prod_qty or 0) if pr else 0

        if pw <= 0 and labels <= 0 and prod_qty <= 0:
            continue

        outbound_rate = round(outbound / labels * 100, 1) if labels > 0 else 0
        utilization = round(consumed / pw * 100, 1) if pw > 0 else 0
        waste = pw - consumed if pw > 0 and consumed > 0 else 0

        items.append({
            "fruit_id": fid,
            "fruit_name": fname,
            "sku_count": sku_count_map.get(fid, 0),
            "order_count": int(p.order_count) if p else 0,
            "purchase_weight": round(pw, 2),
            "purchase_cost": round(cost, 2),
            "avg_price": round(_d(p.avg_price), 2) if p else 0,
            "supplier_count": int(p.supplier_count) if p else 0,
            "total_labels": labels,
            "outbound_count": outbound,
            "outbound_rate": outbound_rate,
            "outbound_weight": round(_d(l.outbound_weight), 2) if l else 0,
            "production_qty": prod_qty,
            "worker_count": int(pr.worker_count) if pr else 0,
            "consumed_weight": round(consumed, 2),
            "utilization": utilization,
            "waste_weight": round(waste, 2),
        })

    items.sort(key=lambda x: x["purchase_weight"], reverse=True)

    total_weight = sum(i["purchase_weight"] for i in items)
    total_cost = sum(i["purchase_cost"] for i in items)
    total_labels = sum(i["total_labels"] for i in items)
    total_outbound = sum(i["outbound_count"] for i in items)
    total_production = sum(i["production_qty"] for i in items)

    daily_trend_q = db.query(
        func.date(FruitPurchase.purchase_date).label("d"),
        func.sum(FruitPurchase.purchase_weight).label("weight"),
        func.sum(FruitPurchase.purchase_weight * FruitPurchase.purchase_price).label("cost"),
    ).filter(
        FruitPurchase.deleted_at.is_(None),
        FruitPurchase.purchase_date >= start,
    ).group_by(func.date(FruitPurchase.purchase_date)).order_by(func.date(FruitPurchase.purchase_date)).all()

    daily_trend = [{"date": r.d.strftime("%m-%d") if r.d else "", "weight": round(_d(r.weight), 1), "cost": round(_d(r.cost), 1)} for r in daily_trend_q]

    result = {
        "fruits": items,
        "summary": {
            "fruit_count": len(items),
            "total_weight": round(total_weight, 2),
            "total_cost": round(total_cost, 2),
            "total_labels": total_labels,
            "total_outbound": total_outbound,
            "total_production": total_production,
            "avg_utilization": round(sum(i["consumed_weight"] for i in items) / total_weight * 100, 1) if total_weight > 0 else 0,
            "avg_outbound_rate": round(total_outbound / total_labels * 100, 1) if total_labels > 0 else 0,
            "days": days,
        },
        "daily_trend": daily_trend,
    }
    cache_set(cache_key, result, ttl=120)
    return ApiResponse(data=result)


@router.get("/material-analysis")
def material_purchase_analysis(
    days: int = 90,
    material_type: str | None = None,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Material purchase analysis: spending trends, type breakdown, supplier ranking."""
    today = date.today()
    start = today - timedelta(days=days)

    cache_key = f"report:material:{days}:{material_type}:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    q = db.query(SimpleMaterialPurchase).filter(
        SimpleMaterialPurchase.deleted_at.is_(None),
        SimpleMaterialPurchase.purchase_date >= start,
    )
    if material_type:
        q = q.filter(SimpleMaterialPurchase.material_type == material_type)

    purchases = q.order_by(desc(SimpleMaterialPurchase.purchase_date)).all()

    type_agg: dict = {}
    supplier_agg: dict = {}
    monthly_agg: dict = {}
    total_amount = 0
    paid_count = 0
    unpaid_amount = 0

    for p in purchases:
        amt = _d(p.purchase_amount)
        total_amount += amt
        if p.payment_status == "paid":
            paid_count += 1
        else:
            unpaid_amount += amt

        mt = p.material_type or "其他"
        type_agg.setdefault(mt, {"count": 0, "amount": 0, "names": set()})
        type_agg[mt]["count"] += 1
        type_agg[mt]["amount"] += amt
        if p.material_name:
            type_agg[mt]["names"].add(p.material_name)

        sn = p.supplier_name or f"供应商#{p.supplier_id}"
        supplier_agg.setdefault(sn, {"count": 0, "amount": 0, "supplier_id": p.supplier_id})
        supplier_agg[sn]["count"] += 1
        supplier_agg[sn]["amount"] += amt

        if p.purchase_date:
            month_key = p.purchase_date.strftime("%Y-%m")
            monthly_agg.setdefault(month_key, {"amount": 0, "count": 0})
            monthly_agg[month_key]["amount"] += amt
            monthly_agg[month_key]["count"] += 1

    type_breakdown = sorted([
        {"type": k, "count": v["count"], "amount": round(v["amount"], 2), "material_names": list(v["names"])[:5]}
        for k, v in type_agg.items()
    ], key=lambda x: x["amount"], reverse=True)

    supplier_ranking = sorted([
        {"name": k, "supplier_id": v["supplier_id"], "count": v["count"], "amount": round(v["amount"], 2)}
        for k, v in supplier_agg.items()
    ], key=lambda x: x["amount"], reverse=True)

    monthly_trend = sorted([
        {"month": k, "amount": round(v["amount"], 2), "count": v["count"]}
        for k, v in monthly_agg.items()
    ])

    type_options = sorted(list(type_agg.keys()))

    result = {
        "summary": {
            "total_orders": len(purchases),
            "total_amount": round(total_amount, 2),
            "paid_count": paid_count,
            "unpaid_count": len(purchases) - paid_count,
            "unpaid_amount": round(unpaid_amount, 2),
            "paid_rate": round(paid_count / len(purchases) * 100, 1) if purchases else 0,
            "type_count": len(type_agg),
            "supplier_count": len(supplier_agg),
            "days": days,
        },
        "type_breakdown": type_breakdown,
        "supplier_ranking": supplier_ranking,
        "monthly_trend": monthly_trend,
        "type_options": type_options,
    }
    cache_set(cache_key, result, ttl=120)
    return ApiResponse(data=result)


@router.get("/box-consumption-analysis")
def box_consumption_analysis(
    days: int = 30,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Carton box consumption analysis linked to SKU production."""
    today = date.today()
    start = today - timedelta(days=days)
    cache_key = f"report:box-consumption:{days}:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    boxes = db.query(CartonBox).all()
    sku_box_q = db.query(Sku).filter(Sku.carton_box_id.isnot(None)).all()
    box_sku_map: dict = {}
    for s in sku_box_q:
        box_sku_map.setdefault(s.carton_box_id, []).append(
            {"sku_id": s.id, "sku_name": s.sku_name, "fruit_name": s.fruit_name or ""})

    label_cons = db.query(
        Sku.carton_box_id,
        func.count(PrintedLabel.id).label("total"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound"),
    ).join(Sku, PrintedLabel.s == Sku.id).filter(
        Sku.carton_box_id.isnot(None), func.date(PrintedLabel.created_at) >= start,
    ).group_by(Sku.carton_box_id).all()
    cons_map = {r.carton_box_id: {"total": int(r.total or 0), "outbound": int(r.outbound or 0)} for r in label_cons}

    pur_q = db.query(
        CartonBoxPurchase.carton_box_id,
        func.sum(CartonBoxPurchase.purchase_quantity).label("qty"),
        func.sum(CartonBoxPurchase.purchase_quantity * CartonBoxPurchase.purchase_price).label("cost"),
    ).filter(CartonBoxPurchase.deleted_at.is_(None), func.date(CartonBoxPurchase.created_at) >= start,
    ).group_by(CartonBoxPurchase.carton_box_id).all()
    pur_map = {r.carton_box_id: {"qty": int(r.qty or 0), "cost": round(_d(r.cost), 2)} for r in pur_q}

    items = []
    ts, tc, tco = 0, 0, 0.0
    for box in boxes:
        c = cons_map.get(box.id, {"total": 0, "outbound": 0})
        p = pur_map.get(box.id, {"qty": 0, "cost": 0})
        skus = box_sku_map.get(box.id, [])
        stk = box.stock_quantity or 0
        thr = box.low_stock_threshold or 50
        dr = round(c["total"] / days, 1) if c["total"] > 0 else 0
        rem = round(stk / dr, 1) if dr > 0 else 999
        h = "critical" if stk == 0 else "danger" if stk <= thr // 2 else "warning" if stk <= thr else "healthy"
        ts += stk; tc += c["total"]; tco += p["cost"]
        items.append({
            "box_id": box.id, "box_type": box.box_type, "stock": stk,
            "threshold": thr, "price": _d(box.purchase_price),
            "stock_value": round(stk * _d(box.purchase_price), 2),
            "health": h, "sku_count": len(skus), "skus": skus[:5],
            "consumed": c["total"], "outbound_consumed": c["outbound"],
            "daily_rate": dr, "days_remaining": min(rem, 999),
            "purchased": p["qty"], "purchase_cost": p["cost"],
            "net_change": p["qty"] - c["total"],
        })
    items.sort(key=lambda x: ({"critical": 0, "danger": 1, "warning": 2, "healthy": 3}[x["health"]], x["days_remaining"]))
    result = {
        "boxes": items,
        "summary": {"total_types": len(items), "total_stock": ts, "total_consumed": tc,
                     "total_purchase_cost": round(tco, 2), "total_daily_rate": round(tc / days, 1) if tc > 0 else 0, "days": days},
    }
    cache_set(cache_key, result, ttl=120)
    return ApiResponse(data=result)


@router.get("/production-diagnosis")
def production_diagnosis(
    days: int = 7,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """生产效率诊断 — 全链路各环节数据汇总"""
    from app.models import BatchAssignment, SkuTransaction, FailureLog
    today = date.today()
    start = today - timedelta(days=days - 1)

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    purchases = db.query(
        func.count(FruitPurchase.id).label("count"),
        func.coalesce(func.sum(FruitPurchase.purchase_weight), 0).label("weight"),
        func.coalesce(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight), 0).label("amount"),
    ).filter(FruitPurchase.purchase_date.between(start, today), FruitPurchase.deleted_at.is_(None)).first()

    assignments = db.query(
        func.count(func.distinct(BatchAssignment.purchase_id)).label("batch_count"),
        func.count(func.distinct(BatchAssignment.worker_id)).label("worker_count"),
        func.count(BatchAssignment.id).label("total_assignments"),
    ).filter(BatchAssignment.assignment_date.between(start, today)).first()

    sku_txns = db.query(
        func.count(SkuTransaction.id).label("count"),
        func.coalesce(func.sum(SkuTransaction.quantity), 0).label("quantity"),
        func.sum(case((SkuTransaction.is_printed == True, 1), else_=0)).label("printed_txns"),
    ).filter(func.date(SkuTransaction.transaction_date).between(start, today)).first()

    labels = db.query(
        func.count(PrintedLabel.id).label("total"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound"),
    ).filter(func.date(PrintedLabel.created_at).between(start, today)).first()

    audits = db.query(
        func.count(WorkerProduction.id).label("total"),
        func.sum(case((WorkerProduction.audit_status == 'approved', 1), else_=0)).label("approved"),
        func.sum(case((WorkerProduction.audit_status == 'pending', 1), else_=0)).label("pending"),
        func.sum(case((WorkerProduction.audit_status == 'rejected', 1), else_=0)).label("rejected"),
    ).filter(WorkerProduction.production_date.between(start, today)).first()

    total_labels = int(labels.total or 0) if labels else 0
    outbound_labels = int(labels.outbound or 0) if labels else 0
    approved_count = int(audits.approved or 0) if audits else 0
    pending_count = int(audits.pending or 0) if audits else 0
    rejected_count = int(audits.rejected or 0) if audits else 0

    failures = db.query(func.count(FailureLog.id)).filter(
        func.date(FailureLog.created_at).between(start, today)).scalar() or 0

    weight_anomalies = db.query(func.count(PrintedLabel.id)).filter(
        func.date(PrintedLabel.created_at).between(start, today),
        PrintedLabel.scanned_outbound > 0, func.abs(PrintedLabel.weight_difference) > 50).scalar() or 0

    daily_trend = []
    for r in db.query(
        func.date(PrintedLabel.created_at).label("d"),
        func.count(PrintedLabel.id).label("printed"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound"),
    ).filter(func.date(PrintedLabel.created_at).between(start, today)).group_by(
        func.date(PrintedLabel.created_at)).all():
        daily_trend.append({"date": str(r.d), "printed": int(r.printed or 0), "outbound": int(r.outbound or 0)})
    daily_trend.sort(key=lambda x: x["date"])

    worker_eff = db.query(
        PrintedLabel.u.label("worker_id"),
        func.count(PrintedLabel.id).label("printed"),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).label("outbound"),
    ).filter(func.date(PrintedLabel.created_at).between(start, today)).group_by(PrintedLabel.u).all()
    wids = [r.worker_id for r in worker_eff]
    wname_map = {w.id: w.real_name or w.username for w in db.query(User).filter(User.id.in_(wids)).all()} if wids else {}
    worker_ranking = sorted([{
        "worker_id": r.worker_id, "worker_name": wname_map.get(r.worker_id, f"#{r.worker_id}"),
        "printed": int(r.printed or 0), "outbound": int(r.outbound or 0),
        "outbound_rate": round(int(r.outbound or 0) / int(r.printed or 1) * 100, 1),
    } for r in worker_eff], key=lambda x: x["outbound"], reverse=True)[:10]

    sku_ranking = sorted([{
        "sku_name": r[0], "printed": int(r[1] or 0), "outbound": int(r[2] or 0),
        "outbound_rate": round(int(r[2] or 0) / max(int(r[1] or 1), 1) * 100, 1),
    } for r in db.query(Sku.sku_name, func.count(PrintedLabel.id), func.sum(
        case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).join(
        Sku, PrintedLabel.s == Sku.id).filter(
        func.date(PrintedLabel.created_at).between(start, today)).group_by(Sku.id, Sku.sku_name).all()
    ], key=lambda x: x["outbound"], reverse=True)[:10]

    outbound_rate = round(outbound_labels / total_labels * 100, 1) if total_labels > 0 else 0
    audit_pass_rate = round(approved_count / max(approved_count + rejected_count, 1) * 100, 1)

    pipeline = [
        {"stage": "采购入库", "icon": "shopping", "value": int(purchases.count or 0) if purchases else 0,
         "detail": f"{_f(purchases.weight):.0f}kg / ¥{_f(purchases.amount):.0f}" if purchases else "0", "status": "healthy" if (purchases and purchases.count) else "idle"},
        {"stage": "批次分配", "icon": "team", "value": int(assignments.total_assignments or 0) if assignments else 0,
         "detail": f"{int(assignments.batch_count or 0)}批次 → {int(assignments.worker_count or 0)}工人" if assignments else "0", "status": "healthy" if (assignments and assignments.total_assignments) else "idle"},
        {"stage": "SKU申请", "icon": "form", "value": int(sku_txns.count or 0) if sku_txns else 0,
         "detail": f"{int(sku_txns.quantity or 0)}件, {int(sku_txns.printed_txns or 0)}已打印" if sku_txns else "0", "status": "healthy" if (sku_txns and sku_txns.count) else "idle"},
        {"stage": "标签打印", "icon": "printer", "value": total_labels, "detail": f"已打印 {total_labels} 张", "status": "healthy" if total_labels > 0 else "idle"},
        {"stage": "生产审核", "icon": "audit", "value": approved_count, "detail": f"通过{approved_count} 待审{pending_count} 驳回{rejected_count}",
         "status": "warning" if pending_count > 10 else ("error" if rejected_count > approved_count else "healthy")},
        {"stage": "出库扫码", "icon": "scan", "value": outbound_labels, "detail": f"出库率 {outbound_rate}%",
         "status": "healthy" if outbound_rate >= 70 else ("warning" if outbound_rate >= 40 else "idle")},
    ]

    scores = []
    if total_labels > 0: scores.append(min(outbound_rate / 80 * 100, 100))
    if (approved_count + rejected_count) > 0: scores.append(min(audit_pass_rate / 90 * 100, 100))
    scores.append(100 if failures == 0 else (70 if failures < 10 else max(0, 100 - failures * 3)))
    scores.append(100 if weight_anomalies == 0 else (80 if weight_anomalies < 5 else max(0, 100 - weight_anomalies * 5)))
    health_score = round(sum(scores) / max(len(scores), 1), 0)

    alerts = []
    if pending_count > 20: alerts.append({"type": "warning", "message": f"待审核积压 {pending_count} 条"})
    if outbound_rate < 50 and total_labels > 100: alerts.append({"type": "error", "message": f"出库率仅 {outbound_rate}%"})
    if failures > 5: alerts.append({"type": "warning", "message": f"近{days}天 {failures} 条扫码失败"})
    if weight_anomalies > 3: alerts.append({"type": "warning", "message": f"{weight_anomalies} 个重量异常标签"})

    return ApiResponse(data={
        "days": days, "date_range": {"start": str(start), "end": str(today)},
        "health_score": health_score, "pipeline": pipeline, "alerts": alerts,
        "daily_trend": daily_trend, "worker_ranking": worker_ranking, "sku_ranking": sku_ranking,
        "summary": {
            "total_purchases": int(purchases.count or 0) if purchases else 0,
            "total_weight": round(_f(purchases.weight), 1) if purchases else 0,
            "total_labels": total_labels, "total_outbound": outbound_labels,
            "outbound_rate": outbound_rate, "audit_pass_rate": audit_pass_rate,
            "failures": failures, "weight_anomalies": weight_anomalies,
        },
    })


@router.get("/production-diagnosis-ai")
def production_diagnosis_ai(
    days: int = 7,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """AI生产效率诊断 — 流式分析"""
    from fastapi.responses import StreamingResponse
    import json
    today = date.today()
    start = today - timedelta(days=days - 1)
    def _f(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    ctx = [f"诊断周期: {start} ~ {today} ({days}天)"]
    p = db.query(func.count(FruitPurchase.id), func.coalesce(func.sum(FruitPurchase.purchase_weight), 0),
        func.coalesce(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight), 0)).filter(
        FruitPurchase.purchase_date.between(start, today), FruitPurchase.deleted_at.is_(None)).first()
    ctx.append(f"采购: {int(p[0] or 0)}笔, {_f(p[1]):.0f}kg, ¥{_f(p[2]):.0f}")

    l = db.query(func.count(PrintedLabel.id), func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).filter(
        func.date(PrintedLabel.created_at).between(start, today)).first()
    tl, ob = int(l[0] or 0), int(l[1] or 0)
    ctx.append(f"标签: 打印{tl}, 出库{ob}, 出库率{round(ob/max(tl,1)*100,1)}%")

    a = db.query(func.sum(case((WorkerProduction.audit_status == 'approved', 1), else_=0)),
        func.sum(case((WorkerProduction.audit_status == 'pending', 1), else_=0)),
        func.sum(case((WorkerProduction.audit_status == 'rejected', 1), else_=0))).filter(
        WorkerProduction.production_date.between(start, today)).first()
    ctx.append(f"审核: 通过{int(a[0] or 0)}, 待审{int(a[1] or 0)}, 驳回{int(a[2] or 0)}")

    ctx.append("每日趋势:")
    for r in db.query(func.date(PrintedLabel.created_at).label("d"), func.count(PrintedLabel.id),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).filter(
        func.date(PrintedLabel.created_at).between(start, today)).group_by(func.date(PrintedLabel.created_at)).all():
        ctx.append(f"  {r[0]}: 打印{r[1]} 出库{int(r[2] or 0)}")

    prompt = f"""请根据以下生产线数据，生成一份生产效率诊断报告。

{chr(10).join(ctx)}

请用markdown格式回复，包含：
1. **整体评估**: 1-2句话评价生产线健康度
2. **关键指标**: 3-4个核心指标及健康状态
3. **瓶颈分析**: 生产链路中的瓶颈环节
4. **异常检测**: 日产量骤降、出库率异常等
5. **优化建议**: 3条具体可操作的改善措施

保持简洁专业，不超过300字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333",
                          base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            resp = client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是果管系统的生产效率诊断专家。回复使用简体中文，简洁专业。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.2, max_tokens=2000)
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    data = json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/batch-profit")
def batch_profit_analysis(
    fruit_id: int | None = None,
    days: int = 90,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """批次利润分析 — 每个采购批次的成本、消耗、损耗、利润率"""
    today = date.today()
    start = today - timedelta(days=days)

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    q = db.query(FruitPurchase).filter(
        FruitPurchase.purchase_date >= start,
        FruitPurchase.deleted_at.is_(None),
    )
    if fruit_id:
        q = q.filter(FruitPurchase.fruit_id == fruit_id)
    purchases = q.order_by(desc(FruitPurchase.purchase_date)).all()

    if not purchases:
        return ApiResponse(data={"batches": [], "summary": {}, "fruit_options": []})

    purchase_ids = [p.id for p in purchases]

    consumed_q = db.query(
        PrintedLabel.b.label("purchase_id"),
        func.count(PrintedLabel.id).label("label_count"),
        func.coalesce(func.sum(PrintedLabel.estimated_weight - Sku.material_weight), 0).label("consumed_weight"),
        func.coalesce(func.sum(Sku.production_performance), 0).label("commission"),
    ).join(Sku, PrintedLabel.s == Sku.id).filter(
        PrintedLabel.b.in_(purchase_ids),
        PrintedLabel.scanned_outbound > 0,
    ).group_by(PrintedLabel.b).all()
    consumed_map = {r.purchase_id: {
        "labels": int(r.label_count or 0),
        "consumed": round(_f(r.consumed_weight), 2),
        "commission": round(_f(r.commission), 2),
    } for r in consumed_q}

    total_labels_q = db.query(
        PrintedLabel.b.label("purchase_id"),
        func.count(PrintedLabel.id).label("total"),
    ).filter(PrintedLabel.b.in_(purchase_ids)).group_by(PrintedLabel.b).all()
    total_labels_map = {r.purchase_id: int(r.total or 0) for r in total_labels_q}

    batches = []
    totals = {"cost": 0.0, "weight": 0.0, "consumed": 0.0, "remaining": 0.0, "commission": 0.0, "labels": 0, "outbound": 0}

    for p in purchases:
        cost = round(_f(p.purchase_price) * _f(p.purchase_weight), 2)
        weight = round(_f(p.purchase_weight), 2)
        c = consumed_map.get(p.id, {"labels": 0, "consumed": 0, "commission": 0})
        total_lbl = total_labels_map.get(p.id, 0)
        consumed = round(c["consumed"] / 1000, 2) if c["consumed"] > 100 else round(c["consumed"], 2)
        remaining = round(weight - consumed, 2)
        loss_rate = round(remaining / weight * 100, 1) if weight > 0 else 0
        outbound_rate = round(c["labels"] / total_lbl * 100, 1) if total_lbl > 0 else 0

        batch = {
            "id": p.id,
            "fruit_name": p.fruit_name or "未知",
            "supplier": p.supplier_name or "未知",
            "purchase_date": str(p.purchase_date),
            "weight": weight,
            "price": round(_f(p.purchase_price), 2),
            "cost": cost,
            "total_labels": total_lbl,
            "outbound_labels": c["labels"],
            "outbound_rate": outbound_rate,
            "consumed_weight": consumed,
            "remaining_weight": remaining,
            "loss_rate": loss_rate,
            "commission": round(c["commission"], 2),
            "status": "completed" if outbound_rate >= 80 else ("active" if total_lbl > 0 else "new"),
        }
        batches.append(batch)

        totals["cost"] += cost
        totals["weight"] += weight
        totals["consumed"] += consumed
        totals["remaining"] += remaining
        totals["commission"] += c["commission"]
        totals["labels"] += total_lbl
        totals["outbound"] += c["labels"]

    avg_loss = round(totals["remaining"] / totals["weight"] * 100, 1) if totals["weight"] > 0 else 0
    avg_outbound = round(totals["outbound"] / totals["labels"] * 100, 1) if totals["labels"] > 0 else 0

    fruits = db.query(Fruit.id, Fruit.name).order_by(Fruit.name).all()
    fruit_options = [{"id": f.id, "name": f.name} for f in fruits]

    return ApiResponse(data={
        "batches": batches,
        "summary": {
            "batch_count": len(batches),
            "total_cost": round(totals["cost"], 2),
            "total_weight": round(totals["weight"], 2),
            "total_consumed": round(totals["consumed"], 2),
            "total_remaining": round(totals["remaining"], 2),
            "avg_loss_rate": avg_loss,
            "total_labels": totals["labels"],
            "total_outbound": totals["outbound"],
            "avg_outbound_rate": avg_outbound,
            "total_commission": round(totals["commission"], 2),
        },
        "fruit_options": fruit_options,
    })


@router.get("/batch-profit-ai")
def batch_profit_ai(
    days: int = 30,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """AI批次利润分析"""
    from fastapi.responses import StreamingResponse
    import json
    today = date.today()
    start = today - timedelta(days=days)
    def _f(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    ctx = [f"分析周期: {start} ~ {today} ({days}天)"]

    fruit_stats = db.query(
        FruitPurchase.fruit_name,
        func.count(FruitPurchase.id),
        func.sum(FruitPurchase.purchase_weight),
        func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight),
    ).filter(FruitPurchase.purchase_date >= start, FruitPurchase.deleted_at.is_(None)).group_by(
        FruitPurchase.fruit_name).all()

    ctx.append("水果采购汇总:")
    for r in fruit_stats:
        ctx.append(f"  {r[0] or '未知'}: {int(r[1])}笔, {_f(r[2]):.0f}kg, ¥{_f(r[3]):.0f}")

    label_stats = db.query(
        func.count(PrintedLabel.id),
        func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)),
    ).filter(func.date(PrintedLabel.created_at) >= start).first()
    ctx.append(f"标签: 打印{int(label_stats[0] or 0)}, 出库{int(label_stats[1] or 0)}")

    prompt = f"""请分析以下水果采购批次的利润数据，给出采购优化建议。

{chr(10).join(ctx)}

请用markdown回复，包含：
1. **成本概况**: 总采购成本和各品类占比
2. **损耗分析**: 哪些品类损耗率偏高
3. **采购建议**: 2-3条优化采购策略的建议
4. **风险提示**: 需要关注的问题

保持简洁，不超过250字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333",
                          base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            resp = client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是果管系统的采购利润分析顾问。回复使用简体中文，简洁专业。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.2, max_tokens=1500)
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/daily-brief")
def daily_brief(
    target_date: date | None = None,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """运营日报数据汇总"""
    from app.models import BatchAssignment, FailureLog
    d = target_date or date.today()
    yesterday = d - timedelta(days=1)
    def _f(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    def _day_stats(day):
        l = db.query(func.count(PrintedLabel.id), func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).filter(func.date(PrintedLabel.created_at) == day).first()
        a = db.query(func.sum(case((WorkerProduction.audit_status == 'approved', 1), else_=0)),
            func.sum(case((WorkerProduction.audit_status == 'pending', 1), else_=0)),
            func.sum(case((WorkerProduction.audit_status == 'rejected', 1), else_=0))).filter(WorkerProduction.production_date == day).first()
        p = db.query(func.count(FruitPurchase.id), func.coalesce(func.sum(FruitPurchase.purchase_weight), 0),
            func.coalesce(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight), 0)).filter(FruitPurchase.purchase_date == day, FruitPurchase.deleted_at.is_(None)).first()
        assigns = db.query(func.count(BatchAssignment.id)).filter(BatchAssignment.assignment_date == day).scalar() or 0
        fails = db.query(func.count(FailureLog.id)).filter(func.date(FailureLog.created_at) == day).scalar() or 0
        workers = db.query(func.count(func.distinct(PrintedLabel.u))).filter(func.date(PrintedLabel.created_at) == day).scalar() or 0
        return {"printed": int(l[0] or 0), "outbound": int(l[1] or 0), "approved": int(a[0] or 0), "pending": int(a[1] or 0), "rejected": int(a[2] or 0),
                "purchases": int(p[0] or 0), "purchase_weight": round(_f(p[1]), 1), "purchase_amount": round(_f(p[2]), 0),
                "assignments": assigns, "failures": fails, "active_workers": workers}

    ts = _day_stats(d)
    ys = _day_stats(yesterday)
    def _chg(t, y): return round((t - y) / y * 100, 1) if y > 0 else (100 if t > 0 else 0)

    wt = db.query(PrintedLabel.u, func.count(PrintedLabel.id), func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).filter(
        func.date(PrintedLabel.created_at) == d).group_by(PrintedLabel.u).order_by(func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0)).desc()).limit(5).all()
    wids = [r[0] for r in wt]
    wm = {w.id: w.real_name or w.username for w in db.query(User).filter(User.id.in_(wids)).all()} if wids else {}
    top_workers = [{"name": wm.get(r[0], f"#{r[0]}"), "printed": int(r[1] or 0), "outbound": int(r[2] or 0)} for r in wt]

    st = db.query(Sku.sku_name, func.count(PrintedLabel.id), func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).join(
        Sku, PrintedLabel.s == Sku.id).filter(func.date(PrintedLabel.created_at) == d).group_by(Sku.id, Sku.sku_name).order_by(func.count(PrintedLabel.id).desc()).limit(5).all()
    top_skus = [{"name": r[0], "printed": int(r[1] or 0), "outbound": int(r[2] or 0)} for r in st]

    return ApiResponse(data={
        "date": str(d), "yesterday": str(yesterday), "today": ts, "yesterday_stats": ys,
        "changes": {"printed": _chg(ts["printed"], ys["printed"]), "outbound": _chg(ts["outbound"], ys["outbound"]), "active_workers": _chg(ts["active_workers"], ys["active_workers"])},
        "outbound_rate": round(ts["outbound"] / ts["printed"] * 100, 1) if ts["printed"] > 0 else 0,
        "top_workers": top_workers, "top_skus": top_skus,
    })


@router.get("/daily-brief-ai")
def daily_brief_ai(target_date: date | None = None, user: UserModel = Depends(require_admin), db: Session = Depends(get_db)):
    """AI生成运营日报"""
    from fastapi.responses import StreamingResponse
    import json
    d = target_date or date.today()
    yesterday = d - timedelta(days=1)
    def _f(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    ctx = [f"日报日期: {d}"]
    l = db.query(func.count(PrintedLabel.id), func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).filter(func.date(PrintedLabel.created_at) == d).first()
    ctx.append(f"标签: 打印{int(l[0] or 0)}, 出库{int(l[1] or 0)}")
    a = db.query(func.sum(case((WorkerProduction.audit_status == 'approved', 1), else_=0)),
        func.sum(case((WorkerProduction.audit_status == 'pending', 1), else_=0)),
        func.sum(case((WorkerProduction.audit_status == 'rejected', 1), else_=0))).filter(WorkerProduction.production_date == d).first()
    ctx.append(f"审核: 通过{int(a[0] or 0)}, 待审{int(a[1] or 0)}, 驳回{int(a[2] or 0)}")
    p = db.query(func.count(FruitPurchase.id), func.coalesce(func.sum(FruitPurchase.purchase_weight), 0),
        func.coalesce(func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight), 0)).filter(FruitPurchase.purchase_date == d, FruitPurchase.deleted_at.is_(None)).first()
    ctx.append(f"采购: {int(p[0] or 0)}笔, {_f(p[1]):.0f}kg, ¥{_f(p[2]):.0f}")
    yl = db.query(func.count(PrintedLabel.id), func.sum(case((PrintedLabel.scanned_outbound > 0, 1), else_=0))).filter(func.date(PrintedLabel.created_at) == yesterday).first()
    ctx.append(f"昨日: 打印{int(yl[0] or 0)}, 出库{int(yl[1] or 0)}")
    w = db.query(func.count(func.distinct(PrintedLabel.u))).filter(func.date(PrintedLabel.created_at) == d).scalar() or 0
    ctx.append(f"活跃工人: {w}人")

    prompt = f"""请根据以下数据生成运营日报。\n\n{chr(10).join(ctx)}\n\n用markdown格式，包含：
1. **今日概况**: 2-3句话总结
2. **关键数据**: 核心指标及环比
3. **亮点与问题**: 亮点和需关注问题
4. **明日建议**: 1-2条建议\n\n简洁专业，不超过200字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            resp = client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是果管系统运营分析师。生成简洁专业的运营日报。使用简体中文。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.3, max_tokens=1500)
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
