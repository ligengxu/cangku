from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func as sa_func, case
from datetime import date, timedelta
from decimal import Decimal
from app.database import get_db
from app.models import Sku, CartonBox, Fruit, Supplier, CartonBoxInventoryLog, InventoryCheck, InventoryCheckDetail, CartonBoxPurchase, PrintedLabel
from app.models.user import User
from app.schemas.inventory import (
    SkuCreate, SkuUpdate, SkuOut,
    CartonBoxCreate, CartonBoxUpdate, CartonBoxOut,
    FruitCreate, FruitUpdate, FruitOut,
    SupplierCreate, SupplierUpdate, SupplierOut,
)
from app.schemas.inventory_check import (
    InventoryCheckCreate, InventoryCheckOut, InventoryCheckFullOut, InventoryCheckDetailOut,
)
from app.schemas.common import ApiResponse, PaginatedResponse
from app.middleware.auth import get_current_user, require_admin
from app.utils.cache import cache_get, cache_set, cache_clear_prefix
from app.utils.log_action import log_action

router = APIRouter(prefix="/inventory", tags=["库存管理"])


# ─── SKU ───
@router.get("/sku", response_model=PaginatedResponse[SkuOut])
def list_sku(
    page: int = 1,
    page_size: int = 50,
    fruit_name: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Sku)
    if fruit_name:
        q = q.filter(Sku.fruit_name.like(f"%{fruit_name}%"))
    total = q.count()
    items = q.order_by(desc(Sku.id)).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(data=items, total=total, page=page, page_size=page_size)


@router.post("/sku", response_model=ApiResponse[SkuOut])
def create_sku(
    req: SkuCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    total_weight = req.fruit_weight + req.material_weight
    sku = Sku(**req.model_dump(), total_weight=total_weight)
    db.add(sku)
    log_action(db, user, f"新建 SKU：{req.sku_name}")
    db.commit()
    db.refresh(sku)
    return ApiResponse(data=sku)


@router.put("/sku/{sku_id}", response_model=ApiResponse[SkuOut])
def update_sku(
    sku_id: int,
    req: SkuUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    sku = db.query(Sku).filter(Sku.id == sku_id).first()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU 不存在")
    update_data = req.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(sku, k, v)
    if "fruit_weight" in update_data or "material_weight" in update_data:
        sku.total_weight = sku.fruit_weight + sku.material_weight
    db.commit()
    db.refresh(sku)
    return ApiResponse(data=sku)


@router.delete("/sku/{sku_id}", response_model=ApiResponse)
def delete_sku(
    sku_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    sku = db.query(Sku).filter(Sku.id == sku_id).first()
    if not sku:
        raise HTTPException(status_code=404, detail="SKU 不存在")
    log_action(db, user, f"删除 SKU #{sku_id} ({sku.sku_name})")
    db.delete(sku)
    db.commit()
    return ApiResponse(message="删除成功")


# ─── SKU 产量统计 ───
@router.get("/sku/stats")
def sku_production_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-SKU production stats: total labels, outbound count, total weight."""
    from decimal import Decimal as D

    cache_key = f"sku:stats:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, D) else (v or 0)

    label_stats = db.query(
        PrintedLabel.s.label("sku_id"),
        sa_func.count(PrintedLabel.id).label("total_labels"),
        sa_func.sum(
            case((PrintedLabel.scanned_outbound > 0, 1), else_=0)
        ).label("outbound_count"),
        sa_func.coalesce(sa_func.sum(
            case((PrintedLabel.scanned_outbound > 0, PrintedLabel.actual_weight), else_=0)
        ), 0).label("outbound_weight"),
    ).group_by(PrintedLabel.s).all()

    today = date.today()
    d7 = today - timedelta(days=6)
    recent_stats = db.query(
        PrintedLabel.s.label("sku_id"),
        sa_func.count(PrintedLabel.id).label("week_labels"),
    ).filter(
        sa_func.date(PrintedLabel.created_at) >= d7,
    ).group_by(PrintedLabel.s).all()
    recent_map = {r.sku_id: r.week_labels for r in recent_stats}

    result = {}
    for r in label_stats:
        result[r.sku_id] = {
            "total_labels": r.total_labels,
            "outbound_count": r.outbound_count,
            "outbound_weight": round(_d(r.outbound_weight), 2),
            "outbound_rate": round(r.outbound_count / r.total_labels * 100, 1) if r.total_labels > 0 else 0,
            "week_labels": recent_map.get(r.sku_id, 0),
        }

    cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


@router.get("/sku/inventory")
def sku_realtime_inventory(
    fruit_name: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """SKU real-time inventory: approved production (inbound) - outbound = current stock.
    Mirrors old system sku_inventory.php: daily_production(approved) - daily_outbound."""
    from decimal import Decimal as D
    from app.models import WorkerProduction

    cache_key = f"sku:inventory:{date.today()}:{fruit_name or 'all'}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, D) else (v or 0)

    skus = db.query(Sku).all()
    if fruit_name:
        skus = [s for s in skus if fruit_name.lower() in (s.fruit_name or '').lower()]
    sku_map = {s.id: s for s in skus}

    inbound_q = db.query(
        WorkerProduction.sku_id,
        sa_func.sum(WorkerProduction.actual_packaging_quantity).label("total_inbound"),
    ).filter(
        WorkerProduction.audit_status == 'approved',
    ).group_by(WorkerProduction.sku_id).all()
    inbound_map = {r.sku_id: r.total_inbound or 0 for r in inbound_q}

    outbound_q = db.query(
        PrintedLabel.s.label("sku_id"),
        sa_func.count(PrintedLabel.id).label("total_outbound"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
    ).group_by(PrintedLabel.s).all()
    outbound_map = {r.sku_id: r.total_outbound for r in outbound_q}

    today = date.today()
    d7 = today - timedelta(days=6)
    d30 = today - timedelta(days=29)

    recent_out_7 = db.query(
        PrintedLabel.s.label("sku_id"),
        sa_func.count(PrintedLabel.id).label("cnt"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        sa_func.date(PrintedLabel.scanned_time) >= d7,
    ).group_by(PrintedLabel.s).all()
    out7_map = {r.sku_id: r.cnt for r in recent_out_7}

    recent_out_30 = db.query(
        PrintedLabel.s.label("sku_id"),
        sa_func.count(PrintedLabel.id).label("cnt"),
    ).filter(
        PrintedLabel.scanned_outbound > 0,
        sa_func.date(PrintedLabel.scanned_time) >= d30,
    ).group_by(PrintedLabel.s).all()
    out30_map = {r.sku_id: r.cnt for r in recent_out_30}

    items = []
    total_stock = 0
    total_inbound_all = 0
    total_outbound_all = 0
    for sku_id, sku in sku_map.items():
        inb = inbound_map.get(sku_id, 0)
        outb = outbound_map.get(sku_id, 0)
        stock = max(inb - outb, 0)
        out_7d = out7_map.get(sku_id, 0)
        out_30d = out30_map.get(sku_id, 0)
        daily_rate = round(out_30d / 30, 1) if out_30d > 0 else 0
        days_remaining = int(stock / daily_rate) if daily_rate > 0 else 999

        total_stock += stock
        total_inbound_all += inb
        total_outbound_all += outb

        if inb > 0 or outb > 0 or stock > 0:
            items.append({
                "sku_id": sku_id,
                "sku_name": sku.sku_name,
                "sku_description": sku.sku_description,
                "fruit_name": sku.fruit_name,
                "estimated_weight": _d(sku.estimated_weight) if hasattr(sku, 'estimated_weight') else _d(sku.total_weight),
                "inbound": inb,
                "outbound": outb,
                "stock": stock,
                "outbound_7d": out_7d,
                "outbound_30d": out_30d,
                "daily_rate": daily_rate,
                "days_remaining": days_remaining,
            })

    items.sort(key=lambda x: x["stock"], reverse=True)

    fruit_groups = {}
    for item in items:
        fn = item["fruit_name"] or "未分类"
        if fn not in fruit_groups:
            fruit_groups[fn] = {"fruit_name": fn, "total_stock": 0, "sku_count": 0, "items": []}
        fruit_groups[fn]["total_stock"] += item["stock"]
        fruit_groups[fn]["sku_count"] += 1
        fruit_groups[fn]["items"].append(item)

    result = {
        "items": items,
        "groups": list(fruit_groups.values()),
        "summary": {
            "total_sku_count": len(items),
            "total_stock": total_stock,
            "total_inbound": total_inbound_all,
            "total_outbound": total_outbound_all,
            "stock_rate": round((total_stock / total_inbound_all * 100), 1) if total_inbound_all > 0 else 0,
        },
    }
    cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


# ─── 水果 ───
@router.get("/fruits", response_model=ApiResponse[list[FruitOut]])
def list_fruits(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    fruits = db.query(Fruit).order_by(Fruit.name).all()
    return ApiResponse(data=fruits)


@router.post("/fruits", response_model=ApiResponse[FruitOut])
def create_fruit(
    req: FruitCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    existing = db.query(Fruit).filter(Fruit.name == req.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="该水果已存在")
    fruit = Fruit(name=req.name)
    db.add(fruit)
    log_action(db, user, f"新建水果品类：{req.name}")
    db.commit()
    db.refresh(fruit)
    return ApiResponse(data=fruit)


@router.put("/fruits/{fruit_id}", response_model=ApiResponse[FruitOut])
def update_fruit(
    fruit_id: int,
    req: FruitUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    fruit = db.query(Fruit).filter(Fruit.id == fruit_id).first()
    if not fruit:
        raise HTTPException(status_code=404, detail="水果不存在")
    dup = db.query(Fruit).filter(Fruit.name == req.name, Fruit.id != fruit_id).first()
    if dup:
        raise HTTPException(status_code=400, detail="该水果名称已存在")
    old_name = fruit.name
    fruit.name = req.name
    log_action(db, user, f"编辑水果品类 #{fruit_id}：{old_name} → {req.name}")
    db.commit()
    db.refresh(fruit)
    return ApiResponse(data=fruit)


@router.delete("/fruits/{fruit_id}", response_model=ApiResponse)
def delete_fruit(
    fruit_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    fruit = db.query(Fruit).filter(Fruit.id == fruit_id).first()
    if not fruit:
        raise HTTPException(status_code=404, detail="水果不存在")
    in_use = db.query(Sku).filter(Sku.fruit_id == fruit_id).first()
    if in_use:
        raise HTTPException(status_code=400, detail="该水果已被 SKU 引用，无法删除")
    log_action(db, user, f"删除水果品类 #{fruit_id} ({fruit.name})")
    db.delete(fruit)
    db.commit()
    return ApiResponse(message="删除成功")


# ─── 水果采购统计 ───
@router.get("/fruits/stats")
def fruits_purchase_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-fruit purchase stats: total weight, total cost, avg price, order count, last purchase."""
    from app.models import FruitPurchase
    from decimal import Decimal as D

    cache_key = f"fruits:stats:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, D) else (v or 0)

    rows = db.query(
        FruitPurchase.fruit_id,
        sa_func.sum(FruitPurchase.purchase_weight).label("total_weight"),
        sa_func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight).label("total_cost"),
        sa_func.avg(FruitPurchase.purchase_price).label("avg_price"),
        sa_func.count(FruitPurchase.id).label("order_count"),
        sa_func.max(FruitPurchase.purchase_date).label("last_date"),
        sa_func.count(sa_func.distinct(FruitPurchase.supplier_id)).label("supplier_count"),
    ).filter(
        FruitPurchase.deleted_at.is_(None),
    ).group_by(FruitPurchase.fruit_id).all()

    sku_counts = {}
    for r in db.query(Sku.fruit_id, sa_func.count(Sku.id).label("cnt")).group_by(Sku.fruit_id).all():
        sku_counts[r.fruit_id] = r.cnt

    result = {}
    for r in rows:
        result[r.fruit_id] = {
            "total_weight": round(_d(r.total_weight), 2),
            "total_cost": round(_d(r.total_cost), 2),
            "avg_price": round(_d(r.avg_price), 2),
            "order_count": r.order_count,
            "last_date": str(r.last_date) if r.last_date else None,
            "supplier_count": r.supplier_count,
            "sku_count": sku_counts.get(r.fruit_id, 0),
        }

    cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


# ─── 供应商 ───
@router.get("/suppliers", response_model=PaginatedResponse[SupplierOut])
def list_suppliers(
    page: int = 1,
    page_size: int = 50,
    type: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Supplier).filter(Supplier.deleted_at.is_(None))
    if type:
        q = q.filter(Supplier.type == type)
    total = q.count()
    items = q.order_by(desc(Supplier.id)).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(data=items, total=total, page=page, page_size=page_size)


@router.post("/suppliers", response_model=ApiResponse[SupplierOut])
def create_supplier(
    req: SupplierCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    existing = db.query(Supplier).filter(Supplier.name == req.name, Supplier.type == req.type).first()
    if existing:
        raise HTTPException(status_code=400, detail="该供应商已存在")
    supplier = Supplier(**req.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return ApiResponse(data=supplier)


@router.put("/suppliers/{supplier_id}", response_model=ApiResponse[SupplierOut])
def update_supplier(
    supplier_id: int,
    req: SupplierUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    update_data = req.model_dump(exclude_unset=True)
    if "name" in update_data:
        dup = db.query(Supplier).filter(
            Supplier.name == update_data["name"],
            Supplier.type == (update_data.get("type") or supplier.type),
            Supplier.id != supplier_id,
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="该供应商名称已存在")
    for k, v in update_data.items():
        setattr(supplier, k, v)
    log_action(db, user, f"编辑供应商 #{supplier_id} ({supplier.name})")
    db.commit()
    db.refresh(supplier)
    return ApiResponse(data=supplier)


@router.delete("/suppliers/{supplier_id}", response_model=ApiResponse)
def delete_supplier(
    supplier_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id, Supplier.deleted_at.is_(None)).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="供应商不存在")
    from datetime import datetime
    supplier.deleted_at = datetime.now()
    log_action(db, user, f"删除供应商 #{supplier_id} ({supplier.name})（移入回收站）")
    db.commit()
    return ApiResponse(message="已移入回收站")


# ─── 供应商交易统计 ───
@router.get("/suppliers/stats")
def supplier_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-supplier transaction stats: total amount, unpaid, order count, last order date."""
    from app.models import FruitPurchase, CartonBoxPurchase, SimpleMaterialPurchase
    from decimal import Decimal

    cache_key = f"supplier:stats:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    suppliers = db.query(Supplier).filter(Supplier.deleted_at.is_(None)).all()
    result = {}

    for sup in suppliers:
        total_amount = 0.0
        unpaid_amount = 0.0
        order_count = 0
        unpaid_count = 0
        last_order_date = None

        if sup.type == "fruit":
            orders = db.query(
                sa_func.count(FruitPurchase.id).label("cnt"),
                sa_func.coalesce(sa_func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight), 0).label("total"),
            ).filter(
                FruitPurchase.supplier_id == sup.id,
                FruitPurchase.deleted_at.is_(None),
            ).first()
            unpaid = db.query(
                sa_func.count(FruitPurchase.id).label("cnt"),
                sa_func.coalesce(sa_func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight), 0).label("total"),
            ).filter(
                FruitPurchase.supplier_id == sup.id,
                FruitPurchase.deleted_at.is_(None),
                FruitPurchase.payment_status == "unpaid",
            ).first()
            last = db.query(sa_func.max(FruitPurchase.purchase_date)).filter(
                FruitPurchase.supplier_id == sup.id,
                FruitPurchase.deleted_at.is_(None),
            ).scalar()
            order_count = orders.cnt if orders else 0
            total_amount = _d(orders.total) if orders else 0
            unpaid_count = unpaid.cnt if unpaid else 0
            unpaid_amount = _d(unpaid.total) if unpaid else 0
            last_order_date = str(last) if last else None

        elif sup.type == "box":
            orders = db.query(
                sa_func.count(CartonBoxPurchase.id).label("cnt"),
                sa_func.coalesce(sa_func.sum(CartonBoxPurchase.purchase_price * CartonBoxPurchase.purchase_quantity), 0).label("total"),
            ).filter(
                CartonBoxPurchase.supplier_id == sup.id,
                CartonBoxPurchase.deleted_at.is_(None),
            ).first()
            unpaid = db.query(
                sa_func.count(CartonBoxPurchase.id).label("cnt"),
                sa_func.coalesce(sa_func.sum(CartonBoxPurchase.purchase_price * CartonBoxPurchase.purchase_quantity), 0).label("total"),
            ).filter(
                CartonBoxPurchase.supplier_id == sup.id,
                CartonBoxPurchase.deleted_at.is_(None),
                CartonBoxPurchase.payment_status == "unpaid",
            ).first()
            last = db.query(sa_func.max(CartonBoxPurchase.created_at)).filter(
                CartonBoxPurchase.supplier_id == sup.id,
                CartonBoxPurchase.deleted_at.is_(None),
            ).scalar()
            order_count = orders.cnt if orders else 0
            total_amount = _d(orders.total) if orders else 0
            unpaid_count = unpaid.cnt if unpaid else 0
            unpaid_amount = _d(unpaid.total) if unpaid else 0
            last_order_date = str(last.date()) if last else None

        elif sup.type == "material":
            orders = db.query(
                sa_func.count(SimpleMaterialPurchase.id).label("cnt"),
                sa_func.coalesce(sa_func.sum(SimpleMaterialPurchase.purchase_amount), 0).label("total"),
            ).filter(
                SimpleMaterialPurchase.supplier_id == sup.id,
                SimpleMaterialPurchase.deleted_at.is_(None),
            ).first()
            unpaid = db.query(
                sa_func.count(SimpleMaterialPurchase.id).label("cnt"),
                sa_func.coalesce(sa_func.sum(SimpleMaterialPurchase.purchase_amount), 0).label("total"),
            ).filter(
                SimpleMaterialPurchase.supplier_id == sup.id,
                SimpleMaterialPurchase.deleted_at.is_(None),
                SimpleMaterialPurchase.payment_status == "unpaid",
            ).first()
            last = db.query(sa_func.max(SimpleMaterialPurchase.purchase_date)).filter(
                SimpleMaterialPurchase.supplier_id == sup.id,
                SimpleMaterialPurchase.deleted_at.is_(None),
            ).scalar()
            order_count = orders.cnt if orders else 0
            total_amount = _d(orders.total) if orders else 0
            unpaid_count = unpaid.cnt if unpaid else 0
            unpaid_amount = _d(unpaid.total) if unpaid else 0
            last_order_date = str(last) if last else None

        result[sup.id] = {
            "total_amount": round(total_amount, 2),
            "unpaid_amount": round(unpaid_amount, 2),
            "paid_amount": round(total_amount - unpaid_amount, 2),
            "order_count": order_count,
            "unpaid_count": unpaid_count,
            "last_order_date": last_order_date,
            "payment_rate": round((total_amount - unpaid_amount) / total_amount * 100, 1) if total_amount > 0 else 100,
        }

    cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


# ─── 库存预警仪表板 ───
@router.get("/stock-dashboard")
def stock_dashboard(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Smart inventory dashboard: consumption rate, predicted stockout, purchase suggestions."""
    cache_key = f"inventory:dashboard:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    today = date.today()
    boxes = db.query(CartonBox).all()

    sku_box_map = {}
    for s in db.query(Sku.carton_box_id, sa_func.count(Sku.id).label("cnt")).filter(
        Sku.carton_box_id.isnot(None)
    ).group_by(Sku.carton_box_id).all():
        sku_box_map[s.carton_box_id] = s.cnt

    box_items = []
    total_stock_value = 0
    healthy_count = 0
    warning_count = 0
    danger_count = 0
    total_stock_qty = 0

    for box in boxes:
        qty = box.stock_quantity or 0
        threshold = box.low_stock_threshold or 50
        price = _d(box.purchase_price)
        total_stock_qty += qty
        total_stock_value += qty * price

        consumption_7d = 0
        consumption_30d = 0

        labels_7d = db.query(sa_func.count(PrintedLabel.id)).join(
            Sku, Sku.id == PrintedLabel.s
        ).filter(
            Sku.carton_box_id == box.id,
            sa_func.date(PrintedLabel.created_at) >= today - timedelta(days=7),
        ).scalar() or 0

        labels_30d = db.query(sa_func.count(PrintedLabel.id)).join(
            Sku, Sku.id == PrintedLabel.s
        ).filter(
            Sku.carton_box_id == box.id,
            sa_func.date(PrintedLabel.created_at) >= today - timedelta(days=30),
        ).scalar() or 0

        consumption_7d = labels_7d
        consumption_30d = labels_30d

        daily_rate_7d = round(consumption_7d / 7, 2) if consumption_7d > 0 else 0
        daily_rate_30d = round(consumption_30d / 30, 2) if consumption_30d > 0 else 0
        daily_rate = daily_rate_7d if daily_rate_7d > 0 else daily_rate_30d

        days_remaining = round(qty / daily_rate, 1) if daily_rate > 0 else 999
        predicted_stockout = str(today + timedelta(days=int(days_remaining))) if days_remaining < 999 else None

        if qty == 0:
            health = "critical"
            danger_count += 1
        elif qty <= threshold // 2:
            health = "danger"
            danger_count += 1
        elif qty <= threshold:
            health = "warning"
            warning_count += 1
        else:
            health = "healthy"
            healthy_count += 1

        suggest_qty = 0
        suggest_days = 14
        if daily_rate > 0:
            target_stock = int(daily_rate * suggest_days)
            if qty < target_stock:
                suggest_qty = target_stock - qty
        elif qty <= threshold:
            suggest_qty = max(threshold * 2 - qty, 0)

        purchase_30d = db.query(
            sa_func.coalesce(sa_func.sum(CartonBoxPurchase.purchase_quantity), 0)
        ).filter(
            CartonBoxPurchase.carton_box_id == box.id,
            CartonBoxPurchase.deleted_at.is_(None),
            sa_func.date(CartonBoxPurchase.created_at) >= today - timedelta(days=30),
        ).scalar() or 0

        daily_consumption = []
        for i in range(6, -1, -1):
            d = today - timedelta(days=i)
            cnt = db.query(sa_func.count(PrintedLabel.id)).join(
                Sku, Sku.id == PrintedLabel.s
            ).filter(
                Sku.carton_box_id == box.id,
                sa_func.date(PrintedLabel.created_at) == d,
            ).scalar() or 0
            daily_consumption.append({"date": d.strftime("%m-%d"), "count": cnt})

        box_items.append({
            "id": box.id,
            "box_type": box.box_type,
            "stock_quantity": qty,
            "threshold": threshold,
            "price": price,
            "stock_value": round(qty * price, 2),
            "health": health,
            "sku_count": sku_box_map.get(box.id, 0),
            "consumption_7d": consumption_7d,
            "consumption_30d": consumption_30d,
            "daily_rate": daily_rate,
            "days_remaining": min(days_remaining, 999),
            "predicted_stockout": predicted_stockout,
            "suggest_purchase_qty": suggest_qty,
            "suggest_purchase_cost": round(suggest_qty * price, 2),
            "purchase_30d": int(purchase_30d),
            "daily_consumption": daily_consumption,
        })

    box_items.sort(key=lambda x: (
        {"critical": 0, "danger": 1, "warning": 2, "healthy": 3}.get(x["health"], 4),
        x["days_remaining"],
    ))

    total_suggest_cost = sum(b["suggest_purchase_cost"] for b in box_items)
    total_suggest_qty = sum(b["suggest_purchase_qty"] for b in box_items)

    total_consumption_7d = sum(b["consumption_7d"] for b in box_items)
    total_consumption_30d = sum(b["consumption_30d"] for b in box_items)

    purchase_trend = []
    for i in range(29, -1, -1):
        d = today - timedelta(days=i)
        p_qty = db.query(
            sa_func.coalesce(sa_func.sum(CartonBoxPurchase.purchase_quantity), 0)
        ).filter(
            CartonBoxPurchase.deleted_at.is_(None),
            sa_func.date(CartonBoxPurchase.created_at) == d,
        ).scalar() or 0
        c_qty = db.query(sa_func.count(PrintedLabel.id)).filter(
            sa_func.date(PrintedLabel.created_at) == d,
        ).scalar() or 0
        purchase_trend.append({
            "date": d.strftime("%m-%d"),
            "purchase": int(p_qty),
            "consumption": int(c_qty),
        })

    data = {
        "summary": {
            "total_types": len(boxes),
            "total_stock_qty": total_stock_qty,
            "total_stock_value": round(total_stock_value, 2),
            "healthy_count": healthy_count,
            "warning_count": warning_count,
            "danger_count": danger_count,
            "total_consumption_7d": total_consumption_7d,
            "total_consumption_30d": total_consumption_30d,
            "total_suggest_qty": total_suggest_qty,
            "total_suggest_cost": round(total_suggest_cost, 2),
        },
        "boxes": box_items,
        "purchase_trend": purchase_trend,
    }

    cache_set(cache_key, data, ttl=60)
    return ApiResponse(data=data)


# ─── 库存预警 ───
@router.get("/stock-alerts")
def stock_alerts(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    boxes = db.query(CartonBox).all()
    alerts = []
    for b in boxes:
        threshold = b.low_stock_threshold or 50
        qty = b.stock_quantity or 0
        if qty <= threshold:
            level = "danger" if qty == 0 else "warning" if qty <= threshold // 2 else "info"
            alerts.append({
                "id": b.id,
                "box_type": b.box_type,
                "stock_quantity": qty,
                "threshold": threshold,
                "level": level,
                "message": f"{b.box_type} 库存{'已耗尽' if qty == 0 else '不足'}（{qty}/{threshold}）",
            })
    alerts.sort(key=lambda x: x["stock_quantity"])
    return ApiResponse(data={"alerts": alerts, "count": len(alerts)})


@router.put("/carton-boxes/{box_id}/threshold", response_model=ApiResponse)
def update_carton_threshold(
    box_id: int,
    threshold: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    box = db.query(CartonBox).filter(CartonBox.id == box_id).first()
    if not box:
        raise HTTPException(status_code=404, detail="纸箱类型不存在")
    box.low_stock_threshold = max(0, threshold)
    db.commit()
    return ApiResponse(message=f"预警阈值已更新为 {threshold}")


# ─── 纸箱库存 ───
@router.get("/carton-boxes", response_model=ApiResponse[list[CartonBoxOut]])
def list_carton_boxes(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    boxes = db.query(CartonBox).order_by(CartonBox.id).all()
    return ApiResponse(data=boxes)


@router.post("/carton-boxes", response_model=ApiResponse[CartonBoxOut])
def create_carton_box(
    req: CartonBoxCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    existing = db.query(CartonBox).filter(CartonBox.box_type == req.box_type).first()
    if existing:
        raise HTTPException(status_code=400, detail="该纸箱类型已存在")
    box = CartonBox(**req.model_dump())
    db.add(box)
    log_action(db, user, f"新建纸箱类型：{req.box_type}")
    db.commit()
    db.refresh(box)
    return ApiResponse(data=box)


@router.put("/carton-boxes/{box_id}", response_model=ApiResponse[CartonBoxOut])
def update_carton_box(
    box_id: int,
    req: CartonBoxUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    box = db.query(CartonBox).filter(CartonBox.id == box_id).first()
    if not box:
        raise HTTPException(status_code=404, detail="纸箱类型不存在")
    update_data = req.model_dump(exclude_unset=True)
    if "box_type" in update_data:
        dup = db.query(CartonBox).filter(
            CartonBox.box_type == update_data["box_type"], CartonBox.id != box_id
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="该纸箱类型名称已存在")
    for k, v in update_data.items():
        setattr(box, k, v)
    log_action(db, user, f"编辑纸箱类型 #{box_id} ({box.box_type})")
    db.commit()
    db.refresh(box)
    return ApiResponse(data=box)


@router.delete("/carton-boxes/{box_id}", response_model=ApiResponse)
def delete_carton_box(
    box_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    box = db.query(CartonBox).filter(CartonBox.id == box_id).first()
    if not box:
        raise HTTPException(status_code=404, detail="纸箱类型不存在")
    in_use = db.query(Sku).filter(Sku.carton_box_id == box_id).first()
    if in_use:
        raise HTTPException(status_code=400, detail="该纸箱已被 SKU 引用，无法删除")
    log_action(db, user, f"删除纸箱类型 #{box_id} ({box.box_type})")
    db.delete(box)
    db.commit()
    return ApiResponse(message="删除成功")


# ─── 纸箱库存变动日志 ───

@router.get("/carton-boxes/{box_id}/logs")
def carton_box_inventory_logs(
    box_id: int,
    start_date: date | None = None,
    end_date: date | None = None,
    page: int = 1,
    page_size: int = 20,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查询指定纸箱的库存变动日志，含日汇总"""
    box = db.query(CartonBox).filter(CartonBox.id == box_id).first()
    if not box:
        raise HTTPException(status_code=404, detail="纸箱不存在")

    q = db.query(CartonBoxInventoryLog).filter(CartonBoxInventoryLog.carton_box_id == box_id)
    if start_date:
        q = q.filter(sa_func.date(CartonBoxInventoryLog.changed_at) >= start_date)
    if end_date:
        q = q.filter(sa_func.date(CartonBoxInventoryLog.changed_at) <= end_date)

    total = q.count()
    logs = q.order_by(desc(CartonBoxInventoryLog.changed_at)).offset((page - 1) * page_size).limit(page_size).all()

    items = [{
        "id": l.id,
        "original_stock": l.original_stock,
        "change_quantity": l.change_quantity,
        "after_stock": l.original_stock + l.change_quantity,
        "reason": l.reason,
        "changed_at": str(l.changed_at) if l.changed_at else None,
    } for l in logs]

    return ApiResponse(data={
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "box_type": box.box_type,
        "current_stock": box.stock_quantity or 0,
    })


@router.get("/carton-inventory-logs")
def all_carton_inventory_logs(
    start_date: date | None = None,
    end_date: date | None = None,
    carton_box_id: int | None = None,
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查询所有纸箱库存变动日志，含纸箱名称、按日汇总"""
    if not start_date:
        start_date = date.today() - timedelta(days=30)
    if not end_date:
        end_date = date.today()

    q = db.query(CartonBoxInventoryLog).filter(
        sa_func.date(CartonBoxInventoryLog.changed_at) >= start_date,
        sa_func.date(CartonBoxInventoryLog.changed_at) <= end_date,
    )
    if carton_box_id:
        q = q.filter(CartonBoxInventoryLog.carton_box_id == carton_box_id)

    total = q.count()
    logs = q.order_by(desc(CartonBoxInventoryLog.changed_at)).offset((page - 1) * page_size).limit(page_size).all()

    box_ids = list({l.carton_box_id for l in logs})
    box_map = {}
    if box_ids:
        boxes = db.query(CartonBox.id, CartonBox.box_type).filter(CartonBox.id.in_(box_ids)).all()
        box_map = {b.id: b.box_type for b in boxes}

    items = [{
        "id": l.id,
        "carton_box_id": l.carton_box_id,
        "box_type": box_map.get(l.carton_box_id, "未知"),
        "original_stock": l.original_stock,
        "change_quantity": l.change_quantity,
        "after_stock": l.original_stock + l.change_quantity,
        "reason": l.reason,
        "changed_at": str(l.changed_at) if l.changed_at else None,
    } for l in logs]

    summary_q = db.query(
        sa_func.date(CartonBoxInventoryLog.changed_at).label("log_date"),
        sa_func.sum(case((CartonBoxInventoryLog.change_quantity > 0, CartonBoxInventoryLog.change_quantity), else_=0)).label("total_in"),
        sa_func.sum(case((CartonBoxInventoryLog.change_quantity < 0, sa_func.abs(CartonBoxInventoryLog.change_quantity)), else_=0)).label("total_out"),
        sa_func.sum(CartonBoxInventoryLog.change_quantity).label("net_change"),
        sa_func.count(CartonBoxInventoryLog.id).label("log_count"),
    ).filter(
        sa_func.date(CartonBoxInventoryLog.changed_at) >= start_date,
        sa_func.date(CartonBoxInventoryLog.changed_at) <= end_date,
    )
    if carton_box_id:
        summary_q = summary_q.filter(CartonBoxInventoryLog.carton_box_id == carton_box_id)
    daily_summary = summary_q.group_by(sa_func.date(CartonBoxInventoryLog.changed_at)).order_by(sa_func.date(CartonBoxInventoryLog.changed_at)).all()

    price_map = {b.id: float(b.purchase_price or 0) for b in db.query(CartonBox.id, CartonBox.purchase_price).all()}

    daily = []
    for ds in daily_summary:
        out_val = int(ds.total_out or 0)
        if carton_box_id:
            cost = round(out_val * price_map.get(carton_box_id, 0), 2)
        else:
            day_logs = db.query(
                CartonBoxInventoryLog.carton_box_id,
                sa_func.sum(sa_func.abs(CartonBoxInventoryLog.change_quantity)).label("qty"),
            ).filter(
                sa_func.date(CartonBoxInventoryLog.changed_at) == ds.log_date,
                CartonBoxInventoryLog.change_quantity < 0,
            ).group_by(CartonBoxInventoryLog.carton_box_id).all()
            cost = round(sum(int(dl.qty or 0) * price_map.get(dl.carton_box_id, 0) for dl in day_logs), 2)
        daily.append({
            "date": str(ds.log_date),
            "total_in": int(ds.total_in or 0),
            "total_out": out_val,
            "net_change": int(ds.net_change or 0),
            "log_count": int(ds.log_count or 0),
            "total_cost": cost,
        })

    for it in items:
        bid = it.get("carton_box_id")
        cq = it.get("change_quantity", 0)
        it["item_cost"] = round(abs(cq) * price_map.get(bid, 0), 2) if cq < 0 else 0

    box_options = [{"id": b.id, "name": b.box_type} for b in db.query(CartonBox.id, CartonBox.box_type).order_by(CartonBox.id).all()]

    grand_totals = {
        "total_in": sum(d["total_in"] for d in daily),
        "total_out": sum(d["total_out"] for d in daily),
        "net_change": sum(d["net_change"] for d in daily),
        "total_cost": round(sum(d["total_cost"] for d in daily), 2),
    }

    return ApiResponse(data={
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "daily_summary": daily,
        "box_options": box_options,
        "grand_totals": grand_totals,
    })


# ─── 库存盘点 ───

@router.get("/checks", response_model=PaginatedResponse[InventoryCheckOut])
def list_inventory_checks(
    page: int = 1,
    page_size: int = 20,
    status: str | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(InventoryCheck)
    if status:
        q = q.filter(InventoryCheck.status == status)
    total = q.count()
    checks = q.order_by(desc(InventoryCheck.id)).offset((page - 1) * page_size).limit(page_size).all()

    user_ids = list({c.check_user_id for c in checks if c.check_user_id})
    user_map = {}
    if user_ids:
        users = db.query(User.id, User.real_name, User.username).filter(User.id.in_(user_ids)).all()
        user_map = {u.id: u.real_name or u.username for u in users}

    detail_stats = (
        db.query(
            InventoryCheckDetail.check_id,
            sa_func.count(InventoryCheckDetail.id).label("cnt"),
            sa_func.coalesce(sa_func.sum(InventoryCheckDetail.difference), 0).label("total_diff"),
        )
        .filter(InventoryCheckDetail.check_id.in_([c.id for c in checks]))
        .group_by(InventoryCheckDetail.check_id)
        .all()
    )
    stats_map = {s.check_id: (s.cnt, int(s.total_diff)) for s in detail_stats}

    items = []
    for c in checks:
        cnt, total_diff = stats_map.get(c.id, (0, 0))
        items.append(InventoryCheckOut(
            id=c.id,
            check_date=c.check_date,
            check_user_id=c.check_user_id,
            check_user_name=user_map.get(c.check_user_id),
            check_note=c.check_note,
            status=c.status,
            detail_count=cnt,
            total_difference=total_diff,
            created_at=c.created_at,
            updated_at=c.updated_at,
        ))

    return PaginatedResponse(data=items, total=total, page=page, page_size=page_size)


@router.get("/checks/{check_id}", response_model=ApiResponse[InventoryCheckFullOut])
def get_inventory_check(
    check_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    check = db.query(InventoryCheck).filter(InventoryCheck.id == check_id).first()
    if not check:
        raise HTTPException(status_code=404, detail="盘点单不存在")

    details = db.query(InventoryCheckDetail).filter(InventoryCheckDetail.check_id == check_id).all()

    box_ids = list({d.carton_box_id for d in details})
    box_map = {}
    if box_ids:
        boxes = db.query(CartonBox.id, CartonBox.box_type).filter(CartonBox.id.in_(box_ids)).all()
        box_map = {b.id: b.box_type for b in boxes}

    check_user_name = None
    if check.check_user_id:
        u = db.query(User).filter(User.id == check.check_user_id).first()
        if u:
            check_user_name = u.real_name or u.username

    detail_items = [
        InventoryCheckDetailOut(
            id=d.id, check_id=d.check_id, carton_box_id=d.carton_box_id,
            box_type=box_map.get(d.carton_box_id),
            system_quantity=d.system_quantity, actual_quantity=d.actual_quantity,
            difference=d.difference, created_at=d.created_at,
        )
        for d in details
    ]

    total_diff = sum(d.difference or 0 for d in details)

    return ApiResponse(data=InventoryCheckFullOut(
        id=check.id, check_date=check.check_date, check_user_id=check.check_user_id,
        check_user_name=check_user_name, check_note=check.check_note,
        status=check.status, detail_count=len(details), total_difference=total_diff,
        created_at=check.created_at, updated_at=check.updated_at,
        details=detail_items,
    ))


@router.post("/checks", response_model=ApiResponse[InventoryCheckOut])
def create_inventory_check(
    req: InventoryCheckCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not req.details:
        raise HTTPException(status_code=400, detail="盘点明细不能为空")

    check = InventoryCheck(
        check_date=req.check_date,
        check_user_id=user.id,
        check_note=req.check_note,
        status="draft",
    )
    db.add(check)
    db.flush()

    box_ids = list({d.carton_box_id for d in req.details})
    boxes = db.query(CartonBox).filter(CartonBox.id.in_(box_ids)).all()
    box_stock_map = {b.id: b.stock_quantity or 0 for b in boxes}

    for d in req.details:
        sys_qty = box_stock_map.get(d.carton_box_id, 0)
        detail = InventoryCheckDetail(
            check_id=check.id,
            carton_box_id=d.carton_box_id,
            system_quantity=sys_qty,
            actual_quantity=d.actual_quantity,
            difference=d.actual_quantity - sys_qty,
        )
        db.add(detail)

    log_action(db, user, f"新建盘点单 #{check.id}，日期 {req.check_date}，共 {len(req.details)} 项")
    db.commit()
    db.refresh(check)

    return ApiResponse(data=InventoryCheckOut(
        id=check.id, check_date=check.check_date, check_user_id=check.check_user_id,
        check_user_name=user.real_name or user.username,
        check_note=check.check_note, status=check.status,
        detail_count=len(req.details), total_difference=0,
        created_at=check.created_at, updated_at=check.updated_at,
    ))


@router.put("/checks/{check_id}/confirm", response_model=ApiResponse)
def confirm_inventory_check(
    check_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Confirm a draft check: applies stock adjustments to carton boxes."""
    check = db.query(InventoryCheck).filter(InventoryCheck.id == check_id).first()
    if not check:
        raise HTTPException(status_code=404, detail="盘点单不存在")
    if check.status != "draft":
        raise HTTPException(status_code=400, detail="只能确认草稿状态的盘点单")

    details = db.query(InventoryCheckDetail).filter(InventoryCheckDetail.check_id == check_id).all()
    adjusted = 0
    for d in details:
        if d.difference and d.difference != 0:
            box = db.query(CartonBox).filter(CartonBox.id == d.carton_box_id).first()
            if box:
                original = box.stock_quantity or 0
                box.stock_quantity = d.actual_quantity
                db.add(CartonBoxInventoryLog(
                    carton_box_id=box.id,
                    original_stock=original,
                    change_quantity=d.actual_quantity - original,
                    reason=f"盘点调整 #{check_id}",
                ))
                adjusted += 1

    check.status = "confirmed"
    log_action(db, user, f"确认盘点单 #{check_id}，调整了 {adjusted} 项库存")
    db.commit()

    return ApiResponse(message=f"盘点已确认，调整了 {adjusted} 项库存")


@router.put("/checks/{check_id}/cancel", response_model=ApiResponse)
def cancel_inventory_check(
    check_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    check = db.query(InventoryCheck).filter(InventoryCheck.id == check_id).first()
    if not check:
        raise HTTPException(status_code=404, detail="盘点单不存在")
    if check.status == "confirmed":
        raise HTTPException(status_code=400, detail="已确认的盘点单不能作废")

    check.status = "cancelled"
    log_action(db, user, f"作废盘点单 #{check_id}")
    db.commit()

    return ApiResponse(message="盘点单已作废")


@router.delete("/checks/{check_id}", response_model=ApiResponse)
def delete_inventory_check(
    check_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    check = db.query(InventoryCheck).filter(InventoryCheck.id == check_id).first()
    if not check:
        raise HTTPException(status_code=404, detail="盘点单不存在")
    if check.status == "confirmed":
        raise HTTPException(status_code=400, detail="已确认的盘点单不能删除")

    db.query(InventoryCheckDetail).filter(InventoryCheckDetail.check_id == check_id).delete()
    db.delete(check)
    log_action(db, user, f"删除盘点单 #{check_id}")
    db.commit()

    return ApiResponse(message="删除成功")


@router.get("/forecast")
def inventory_forecast(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """库存预测 — 基于历史消耗预测纸箱库存耗尽时间"""
    today = date.today()
    d7 = today - timedelta(days=7)
    d14 = today - timedelta(days=14)
    d30 = today - timedelta(days=30)
    def _f(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    boxes = db.query(CartonBox).all()
    def _box_consumption(since):
        result = {}
        for r in db.query(Sku.carton_box_id, sa_func.count(PrintedLabel.id).label("cnt")).join(
            Sku, PrintedLabel.s == Sku.id).filter(Sku.carton_box_id.isnot(None),
            sa_func.date(PrintedLabel.created_at) >= since).group_by(Sku.carton_box_id).all():
            result[r.carton_box_id] = int(r.cnt or 0)
        return result

    c7 = _box_consumption(d7)
    c14 = _box_consumption(d14)
    c30 = _box_consumption(d30)

    trend_rows = db.query(sa_func.date(PrintedLabel.created_at).label("d"), sa_func.count(PrintedLabel.id).label("cnt")).filter(
        sa_func.date(PrintedLabel.created_at) >= d14).group_by(sa_func.date(PrintedLabel.created_at)).all()
    daily_trend = {str(r.d): int(r.cnt or 0) for r in trend_rows}

    items = []
    for box in boxes:
        stock = box.stock_quantity or 0
        threshold = box.low_stock_threshold or 50
        dr7 = round(c7.get(box.id, 0) / 7, 1)
        dr14 = round(c14.get(box.id, 0) / 14, 1)
        dr30 = round(c30.get(box.id, 0) / 30, 1)
        best = dr7 or dr14 or dr30
        dte = round(stock / best, 0) if best > 0 else 999
        dtt = round((stock - threshold) / best, 0) if best > 0 and stock > threshold else (0 if stock <= threshold else 999)
        trend = "increasing" if dr7 > dr14 * 1.2 and dr14 > 0 else ("decreasing" if dr7 < dr14 * 0.8 and dr14 > 0 else "stable")
        urgency = "critical" if stock == 0 or dte <= 3 else ("warning" if dtt <= 0 or dte <= 7 else ("attention" if dte <= 14 else "safe"))
        sug = max(round(best * 14 - stock, 0), 0) if best > 0 else 0
        items.append({"box_id": box.id, "box_type": box.box_type, "stock": stock, "threshold": threshold,
            "price": round(_f(box.purchase_price), 2), "daily_rate_7d": dr7, "daily_rate_14d": dr14, "daily_rate_30d": dr30,
            "days_until_empty": min(int(dte), 999), "days_until_threshold": min(int(dtt), 999),
            "trend": trend, "urgency": urgency, "suggested_order": int(sug),
            "suggested_cost": round(sug * _f(box.purchase_price), 2)})

    items.sort(key=lambda x: {"critical": 0, "warning": 1, "attention": 2, "safe": 3}[x["urgency"]])
    trend_data = [{"date": str(d14 + timedelta(days=i)), "count": daily_trend.get(str(d14 + timedelta(days=i)), 0)} for i in range(15)]
    ts = sum(i["stock"] for i in items)
    td = sum(i["daily_rate_7d"] for i in items)

    return ApiResponse(data={"items": items, "trend": trend_data, "summary": {
        "total_types": len(items), "total_stock": ts, "total_daily_rate": round(td, 1),
        "critical": sum(1 for i in items if i["urgency"] == "critical"),
        "warning": sum(1 for i in items if i["urgency"] == "warning"),
        "estimated_days": round(ts / td, 0) if td > 0 else 999,
        "total_suggested_cost": round(sum(i["suggested_cost"] for i in items), 2)}})


@router.get("/forecast-ai")
def forecast_ai(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """AI库存预测分析"""
    from fastapi.responses import StreamingResponse
    import json
    today = date.today()
    d7 = today - timedelta(days=7)
    def _f(v): return float(v) if isinstance(v, Decimal) else (v or 0)
    ctx = [f"日期: {today}"]
    for box in db.query(CartonBox).all():
        c = db.query(sa_func.count(PrintedLabel.id)).join(Sku, PrintedLabel.s == Sku.id).filter(
            Sku.carton_box_id == box.id, sa_func.date(PrintedLabel.created_at) >= d7).scalar() or 0
        dr = round(c / 7, 1) if c > 0 else 0
        dl = round((box.stock_quantity or 0) / dr, 0) if dr > 0 else 999
        ctx.append(f"  {box.box_type}: 库存{box.stock_quantity or 0}, 日消耗{dr}, 预计{int(min(dl, 999))}天")

    prompt = f"""根据以下纸箱库存数据生成补货建议。\n\n{chr(10).join(ctx)}\n\n用markdown，含：
1. **库存概况** 2. **紧急补货** 3. **补货计划** 4. **成本预估**\n简洁，不超200字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            for chunk in client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是库存管理顾问。简体中文。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.2, max_tokens=1000):
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
