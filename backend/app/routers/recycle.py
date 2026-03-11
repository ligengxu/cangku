from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from app.database import get_db
from app.models import FruitPurchase, CartonBoxPurchase, SimpleMaterialPurchase, Supplier, CartonBox
from app.models.user import User
from app.schemas.common import ApiResponse
from app.middleware.auth import require_admin
from app.utils.log_action import log_action

router = APIRouter(prefix="/recycle", tags=["回收站"])

MODEL_MAP = {
    "fruit_purchase": {
        "model": FruitPurchase,
        "label": "水果采购",
        "name_fn": lambda r: f"{r.fruit_name} - {r.supplier_name} ({r.purchase_weight}kg)",
    },
    "carton_purchase": {
        "model": CartonBoxPurchase,
        "label": "纸箱采购",
        "name_fn": lambda r: f"纸箱#{r.carton_box_id} x{r.purchase_quantity}",
    },
    "material_purchase": {
        "model": SimpleMaterialPurchase,
        "label": "材料采购",
        "name_fn": lambda r: f"{r.material_name or r.material_type or '材料'} - {r.supplier_name or ''}",
    },
    "supplier": {
        "model": Supplier,
        "label": "供应商",
        "name_fn": lambda r: f"{r.name} ({r.type})",
    },
}


@router.get("")
def list_recycled(
    category: str | None = None,
    page: int = 1,
    page_size: int = 20,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    items = []
    categories_to_check = [category] if category and category in MODEL_MAP else MODEL_MAP.keys()

    for cat_key in categories_to_check:
        cfg = MODEL_MAP[cat_key]
        model = cfg["model"]

        q = db.query(model).filter(model.deleted_at.isnot(None))
        rows = q.order_by(desc(model.deleted_at)).all()

        for r in rows:
            try:
                name = cfg["name_fn"](r)
            except Exception:
                name = f"#{r.id}"
            items.append({
                "id": r.id,
                "category": cat_key,
                "category_label": cfg["label"],
                "name": name,
                "deleted_at": r.deleted_at.isoformat() if r.deleted_at else None,
            })

    items.sort(key=lambda x: x["deleted_at"] or "", reverse=True)

    total = len(items)
    start = (page - 1) * page_size
    paged = items[start:start + page_size]

    counts = {}
    for cat_key in MODEL_MAP:
        cfg = MODEL_MAP[cat_key]
        model = cfg["model"]
        cnt = db.query(func.count(model.id)).filter(model.deleted_at.isnot(None)).scalar() or 0
        counts[cat_key] = cnt

    return ApiResponse(data={
        "items": paged,
        "total": total,
        "page": page,
        "page_size": page_size,
        "counts": counts,
    })


@router.post("/restore")
def restore_item(
    category: str,
    item_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    cfg = MODEL_MAP.get(category)
    if not cfg:
        raise HTTPException(status_code=400, detail="无效的分类")

    model = cfg["model"]
    record = db.query(model).filter(model.id == item_id, model.deleted_at.isnot(None)).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在或未被删除")

    record.deleted_at = None

    if category == "carton_purchase":
        box = db.query(CartonBox).filter(CartonBox.id == record.carton_box_id).first()
        if box:
            box.stock_quantity = (box.stock_quantity or 0) + record.purchase_quantity

    name = cfg["name_fn"](record) if callable(cfg["name_fn"]) else f"#{item_id}"
    log_action(db, user, f"恢复{cfg['label']} #{item_id} ({name})")
    db.commit()
    return ApiResponse(message="恢复成功")


@router.post("/restore-batch")
def restore_batch(
    items: list[dict],
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    restored = 0
    for item in items:
        cat = item.get("category")
        item_id = item.get("id")
        cfg = MODEL_MAP.get(cat)
        if not cfg:
            continue
        model = cfg["model"]
        record = db.query(model).filter(model.id == item_id, model.deleted_at.isnot(None)).first()
        if record:
            record.deleted_at = None
            if cat == "carton_purchase":
                box = db.query(CartonBox).filter(CartonBox.id == record.carton_box_id).first()
                if box:
                    box.stock_quantity = (box.stock_quantity or 0) + record.purchase_quantity
            restored += 1

    if restored:
        log_action(db, user, f"批量恢复 {restored} 条回收站记录")
        db.commit()
    return ApiResponse(message=f"成功恢复 {restored} 条记录")


@router.delete("/permanent")
def permanent_delete(
    category: str,
    item_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    cfg = MODEL_MAP.get(category)
    if not cfg:
        raise HTTPException(status_code=400, detail="无效的分类")

    model = cfg["model"]
    record = db.query(model).filter(model.id == item_id, model.deleted_at.isnot(None)).first()
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在或未在回收站中")

    name = cfg["name_fn"](record) if callable(cfg["name_fn"]) else f"#{item_id}"
    log_action(db, user, f"永久删除{cfg['label']} #{item_id} ({name})")
    db.delete(record)
    db.commit()
    return ApiResponse(message="永久删除成功")


@router.delete("/empty")
def empty_recycle_bin(
    category: str | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    deleted_total = 0
    categories_to_clear = [category] if category and category in MODEL_MAP else MODEL_MAP.keys()

    for cat_key in categories_to_clear:
        cfg = MODEL_MAP[cat_key]
        model = cfg["model"]
        cnt = db.query(model).filter(model.deleted_at.isnot(None)).delete(synchronize_session="fetch")
        deleted_total += cnt

    if deleted_total:
        scope = MODEL_MAP[category]["label"] if category and category in MODEL_MAP else "全部"
        log_action(db, user, f"清空回收站（{scope}），共 {deleted_total} 条")
        db.commit()

    return ApiResponse(message=f"已清空 {deleted_total} 条记录")
