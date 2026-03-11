from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_, func, and_
from datetime import datetime, date, timedelta
from app.database import get_db
from app.models import (
    AdminNotice, ActionLog, User, Sku, Fruit, Supplier,
    SkuTransaction, WorkerProduction, WorkerProductionEdit,
    FruitPurchase, CartonBoxPurchase, SimpleMaterialPurchase,
    CartonBox, UserMessage, ActivityLog,
)
from app.schemas.system import NoticeCreate, NoticeOut, ActionLogOut, SearchResult
from app.schemas.common import ApiResponse, PaginatedResponse
from app.middleware.auth import get_current_user, require_admin, hash_password
from app.utils.cache import cache_get, cache_set
from pydantic import BaseModel

router = APIRouter(prefix="/system", tags=["系统管理"])


# ─── 通知 ───
@router.get("/notices/count", response_model=ApiResponse[dict])
def notices_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """返回有效通知数量，用于 Header Badge"""
    q = db.query(func.count(AdminNotice.id)).filter(AdminNotice.is_active == True)
    q = q.filter(or_(AdminNotice.expires_at.is_(None), AdminNotice.expires_at > datetime.now()))
    if user.role != "admin":
        q = q.filter(or_(AdminNotice.target_role == user.role, AdminNotice.target_role.is_(None)))
    cnt = q.scalar() or 0
    return ApiResponse(data={"count": min(cnt, 99)})


@router.get("/notices/stats")
def notices_stats(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    """通知统计：总数、有效、各类型、各目标"""
    total = db.query(func.count(AdminNotice.id)).scalar() or 0
    active = db.query(func.count(AdminNotice.id)).filter(
        AdminNotice.is_active == True,
        or_(AdminNotice.expires_at.is_(None), AdminNotice.expires_at > datetime.now()),
    ).scalar() or 0
    expired = db.query(func.count(AdminNotice.id)).filter(
        AdminNotice.is_active == True,
        AdminNotice.expires_at.isnot(None),
        AdminNotice.expires_at <= datetime.now(),
    ).scalar() or 0

    type_counts = {}
    for row in db.query(AdminNotice.type, func.count(AdminNotice.id)).filter(AdminNotice.is_active == True).group_by(AdminNotice.type).all():
        type_counts[row[0] or "info"] = row[1]

    return ApiResponse(data={
        "total": total,
        "active": active,
        "inactive": total - active,
        "expired": expired,
        "by_type": type_counts,
    })


@router.get("/notices", response_model=ApiResponse[list[NoticeOut]])
def list_notices(
    show_all: bool = False,
    notice_type: str | None = None,
    target_role: str | None = None,
    page: int = 1,
    page_size: int = 20,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(AdminNotice)
    if not show_all or user.role != "admin":
        q = q.filter(AdminNotice.is_active == True)
        if user.role != "admin":
            q = q.filter(or_(AdminNotice.target_role == user.role, AdminNotice.target_role.is_(None)))
        q = q.filter(or_(AdminNotice.expires_at.is_(None), AdminNotice.expires_at > datetime.now()))
    if notice_type:
        q = q.filter(AdminNotice.type == notice_type)
    if target_role:
        q = q.filter(or_(AdminNotice.target_role == target_role, AdminNotice.target_role.is_(None)))

    total = q.count()
    notices = q.order_by(desc(AdminNotice.id)).offset((page - 1) * page_size).limit(page_size).all()

    creator_ids = list({n.created_by for n in notices if n.created_by})
    creator_map = {}
    if creator_ids:
        creators = db.query(User.id, User.username).filter(User.id.in_(creator_ids)).all()
        creator_map = {c.id: c.username for c in creators}

    items = []
    for n in notices:
        out = NoticeOut.model_validate(n)
        items.append({
            **out.model_dump(),
            "creator_name": creator_map.get(n.created_by, "系统"),
            "is_expired": bool(n.expires_at and n.expires_at <= datetime.now()),
        })

    return ApiResponse(data=items)


@router.post("/notices", response_model=ApiResponse[NoticeOut])
def create_notice(
    req: NoticeCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    expires_at = None
    if req.expires_hours:
        expires_at = datetime.now() + timedelta(hours=req.expires_hours)

    notice = AdminNotice(
        title=req.title,
        content=req.content,
        type=req.type,
        target_role=req.target_role,
        created_by=user.id,
        expires_at=expires_at,
    )
    db.add(notice)
    db.commit()
    db.refresh(notice)
    return ApiResponse(data=notice)


@router.put("/notices/{notice_id}/toggle", response_model=ApiResponse)
def toggle_notice(
    notice_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    notice = db.query(AdminNotice).filter(AdminNotice.id == notice_id).first()
    if not notice:
        raise HTTPException(status_code=404, detail="通知不存在")
    notice.is_active = not notice.is_active
    db.commit()
    return ApiResponse(message=f"通知已{'启用' if notice.is_active else '停用'}")


@router.delete("/notices/{notice_id}", response_model=ApiResponse)
def delete_notice(
    notice_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    notice = db.query(AdminNotice).filter(AdminNotice.id == notice_id).first()
    if not notice:
        raise HTTPException(status_code=404, detail="通知不存在")
    notice.is_active = False
    db.commit()
    return ApiResponse(message="删除成功")


# ─── 操作日志 ───
@router.get("/action-logs", response_model=PaginatedResponse[ActionLogOut])
def list_action_logs(
    page: int = 1,
    page_size: int = 20,
    username: str | None = None,
    keyword: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(ActionLog)
    if username:
        q = q.filter(ActionLog.username.like(f"%{username}%"))
    if keyword:
        q = q.filter(ActionLog.action.like(f"%{keyword}%"))
    if start_date:
        q = q.filter(func.date(ActionLog.timestamp) >= start_date)
    if end_date:
        q = q.filter(func.date(ActionLog.timestamp) <= end_date)
    total = q.count()
    items = q.order_by(desc(ActionLog.id)).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(data=items, total=total, page=page, page_size=page_size)


@router.get("/action-logs/stats")
def action_log_stats(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Return log stats: today count, 7-day count, top users, hourly distribution."""
    today = date.today()
    d7 = today - timedelta(days=6)

    total = db.query(func.count(ActionLog.id)).scalar() or 0
    today_count = db.query(func.count(ActionLog.id)).filter(
        func.date(ActionLog.timestamp) == today
    ).scalar() or 0
    week_count = db.query(func.count(ActionLog.id)).filter(
        func.date(ActionLog.timestamp) >= d7
    ).scalar() or 0

    top_users = db.query(
        ActionLog.username,
        func.count(ActionLog.id).label("cnt"),
    ).filter(
        func.date(ActionLog.timestamp) >= d7
    ).group_by(ActionLog.username).order_by(desc("cnt")).limit(5).all()
    top_users_list = [{"username": r.username, "count": r.cnt} for r in top_users]

    daily = db.query(
        func.date(ActionLog.timestamp).label("d"),
        func.count(ActionLog.id).label("cnt"),
    ).filter(
        func.date(ActionLog.timestamp) >= d7
    ).group_by("d").all()
    date_list = [(d7 + timedelta(days=i)) for i in range(7)]
    daily_map = {r.d: r.cnt for r in daily}
    daily_trend = [{"date": d.strftime("%m-%d"), "count": daily_map.get(d, 0)} for d in date_list]

    return ApiResponse(data={
        "total": total,
        "today": today_count,
        "week": week_count,
        "top_users": top_users_list,
        "daily_trend": daily_trend,
    })


# ─── 全局搜索 ───
@router.get("/search", response_model=ApiResponse[list[SearchResult]])
def global_search(
    q: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not q or len(q) < 1:
        return ApiResponse(data=[])

    results: list[SearchResult] = []
    keyword = f"%{q}%"

    workers = db.query(User).filter(
        User.role == "worker",
        or_(User.username.like(keyword), User.real_name.like(keyword)),
    ).limit(5).all()
    for w in workers:
        results.append(SearchResult(type="worker", id=w.id, label=w.real_name or w.username, description=f"工人 - {w.username}"))

    skus = db.query(Sku).filter(
        or_(Sku.sku_name.like(keyword), Sku.fruit_name.like(keyword)),
    ).limit(5).all()
    for s in skus:
        results.append(SearchResult(type="sku", id=s.id, label=s.sku_name, description=f"SKU - {s.fruit_name}"))

    fruits = db.query(Fruit).filter(Fruit.name.like(keyword)).limit(5).all()
    for f in fruits:
        results.append(SearchResult(type="fruit", id=f.id, label=f.name, description="水果"))

    suppliers = db.query(Supplier).filter(
        or_(Supplier.name.like(keyword), Supplier.contact_person.like(keyword)),
    ).limit(5).all()
    for s in suppliers:
        results.append(SearchResult(type="supplier", id=s.id, label=s.name, description=f"供应商 - {s.type}"))

    if q.isdigit():
        results.append(SearchResult(type="ticket", id=int(q), label=f"标签 #{q}", description="标签/票据搜索"))

    return ApiResponse(data=results[:20])


# ─── 待办事项中心 ───
@router.get("/todo-items")
def get_todo_items(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Aggregate all pending items across the system for the current user."""
    cache_key = f"todo-items:{user.role}:{user.id}:{date.today()}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    items = []
    today = date.today()

    if user.role == "admin":
        pending_print = db.query(func.count(SkuTransaction.id)).filter(
            SkuTransaction.is_printed == False
        ).scalar() or 0
        if pending_print > 0:
            items.append({
                "id": "pending_print",
                "title": f"{pending_print} 个标签待打印",
                "description": "有生产录入尚未打印标签",
                "count": pending_print,
                "priority": "high" if pending_print > 10 else "medium",
                "icon": "printer",
                "color": "#fa8c16",
                "link": "/production/print",
                "category": "production",
            })

        pending_audit = db.query(func.count(WorkerProduction.id)).filter(
            WorkerProduction.audit_status == "pending"
        ).scalar() or 0
        if pending_audit > 0:
            items.append({
                "id": "pending_audit",
                "title": f"{pending_audit} 条生产记录待审核",
                "description": "工人提交的生产数据需要审核确认",
                "count": pending_audit,
                "priority": "high" if pending_audit > 5 else "medium",
                "icon": "audit",
                "color": "#ff4d4f",
                "link": "/production/audit",
                "category": "production",
            })

        pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(
            WorkerProductionEdit.audit_status == "pending"
        ).scalar() or 0
        if pending_edits > 0:
            items.append({
                "id": "pending_edits",
                "title": f"{pending_edits} 条修改申请待审批",
                "description": "工人提交的生产数据修改请求",
                "count": pending_edits,
                "priority": "medium",
                "icon": "edit",
                "color": "#722ed1",
                "link": "/production/audit",
                "category": "production",
            })

        unpaid_fruit = db.query(func.count(FruitPurchase.id)).filter(
            FruitPurchase.payment_status == "unpaid",
            FruitPurchase.deleted_at.is_(None),
        ).scalar() or 0
        if unpaid_fruit > 0:
            unpaid_fruit_amt = db.query(
                func.sum(FruitPurchase.purchase_price * FruitPurchase.purchase_weight)
            ).filter(
                FruitPurchase.payment_status == "unpaid",
                FruitPurchase.deleted_at.is_(None),
            ).scalar() or 0
            items.append({
                "id": "unpaid_fruit",
                "title": f"{unpaid_fruit} 笔水果采购未付款",
                "description": f"未付总额 ¥{round(float(unpaid_fruit_amt)):,}",
                "count": unpaid_fruit,
                "priority": "high" if unpaid_fruit > 10 else "low",
                "icon": "dollar",
                "color": "#f5222d",
                "link": "/orders/fruit",
                "category": "finance",
            })

        unpaid_carton = db.query(func.count(CartonBoxPurchase.id)).filter(
            CartonBoxPurchase.payment_status == "unpaid",
            CartonBoxPurchase.deleted_at.is_(None),
        ).scalar() or 0
        if unpaid_carton > 0:
            items.append({
                "id": "unpaid_carton",
                "title": f"{unpaid_carton} 笔纸箱采购未付款",
                "description": "纸箱采购订单待付款",
                "count": unpaid_carton,
                "priority": "low",
                "icon": "inbox",
                "color": "#1677ff",
                "link": "/orders/carton",
                "category": "finance",
            })

        unpaid_material = db.query(func.count(SimpleMaterialPurchase.id)).filter(
            SimpleMaterialPurchase.payment_status == "unpaid",
            SimpleMaterialPurchase.deleted_at.is_(None),
        ).scalar() or 0
        if unpaid_material > 0:
            items.append({
                "id": "unpaid_material",
                "title": f"{unpaid_material} 笔材料采购未付款",
                "description": "材料采购订单待付款",
                "count": unpaid_material,
                "priority": "low",
                "icon": "experiment",
                "color": "#722ed1",
                "link": "/orders/material",
                "category": "finance",
            })

        low_stock_boxes = db.query(CartonBox).all()
        low_stock_count = 0
        for box in low_stock_boxes:
            threshold = box.low_stock_threshold or 50
            qty = box.stock_quantity or 0
            if qty <= threshold:
                low_stock_count += 1
        if low_stock_count > 0:
            items.append({
                "id": "low_stock",
                "title": f"{low_stock_count} 种纸箱库存不足",
                "description": "纸箱库存低于警戒线，请及时补货",
                "count": low_stock_count,
                "priority": "medium",
                "icon": "warning",
                "color": "#faad14",
                "link": "/inventory/carton",
                "category": "inventory",
            })
    else:
        pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(
            and_(
                WorkerProductionEdit.worker_id == user.id,
                WorkerProductionEdit.audit_status == "pending",
            )
        ).scalar() or 0
        if pending_edits > 0:
            items.append({
                "id": "my_pending_edits",
                "title": f"{pending_edits} 条修改申请审核中",
                "description": "你提交的生产数据修改正在等待管理员审核",
                "count": pending_edits,
                "priority": "medium",
                "icon": "edit",
                "color": "#722ed1",
                "link": "/workers/performance",
                "category": "production",
            })

    priority_order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda x: priority_order.get(x["priority"], 9))

    data = {
        "items": items,
        "total": len(items),
        "total_count": sum(i["count"] for i in items),
    }

    cache_set(cache_key, data, ttl=20)
    return ApiResponse(data=data)


# ─── 系统健康 ───
@router.get("/health")
def system_health(db: Session = Depends(get_db)):
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        db_status = "ok"
    except Exception:
        db_status = "error"

    return ApiResponse(data={
        "status": "ok" if db_status == "ok" else "degraded",
        "database": db_status,
        "version": "2.0.0",
    })


# ─── Personal Messages ───
@router.get("/messages")
def list_messages(
    page: int = 1,
    page_size: int = 30,
    unread_only: bool = False,
    msg_type: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(UserMessage).filter(UserMessage.user_id == user.id)
    if unread_only:
        q = q.filter(UserMessage.is_read == False)
    if msg_type:
        q = q.filter(UserMessage.msg_type == msg_type)
    total = q.count()
    unread = db.query(func.count(UserMessage.id)).filter(UserMessage.user_id == user.id, UserMessage.is_read == False).scalar() or 0
    items = q.order_by(desc(UserMessage.id)).offset((page - 1) * page_size).limit(page_size).all()

    type_counts = {}
    for row in db.query(UserMessage.msg_type, func.count(UserMessage.id)).filter(UserMessage.user_id == user.id).group_by(UserMessage.msg_type).all():
        type_counts[row[0] or "system"] = row[1]

    return {
        "success": True,
        "data": [{
            "id": m.id, "title": m.title, "content": m.content,
            "msg_type": m.msg_type, "is_read": m.is_read,
            "link": m.link,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        } for m in items],
        "total": total, "unread": unread, "page": page, "page_size": page_size,
        "type_counts": type_counts,
    }


@router.get("/messages/unread-count")
def unread_message_count(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    count = db.query(func.count(UserMessage.id)).filter(
        UserMessage.user_id == user.id, UserMessage.is_read == False
    ).scalar() or 0
    return ApiResponse(data={"count": count})


@router.post("/messages/{message_id}/read", response_model=ApiResponse)
def mark_message_read(
    message_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(UserMessage).filter(
        UserMessage.id == message_id, UserMessage.user_id == user.id
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")
    msg.is_read = True
    db.commit()
    return ApiResponse(message="已标记已读")


@router.post("/messages/read-all", response_model=ApiResponse)
def mark_all_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(UserMessage).filter(
        UserMessage.user_id == user.id, UserMessage.is_read == False
    ).update({"is_read": True})
    db.commit()
    return ApiResponse(message="全部已读")


@router.delete("/messages/{message_id}", response_model=ApiResponse)
def delete_message(
    message_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    msg = db.query(UserMessage).filter(
        UserMessage.id == message_id, UserMessage.user_id == user.id
    ).first()
    if not msg:
        raise HTTPException(status_code=404, detail="消息不存在")
    db.delete(msg)
    db.commit()
    return ApiResponse(message="删除成功")


class BatchDeleteRequest(BaseModel):
    ids: list[int]


@router.post("/messages/batch-delete", response_model=ApiResponse)
def batch_delete_messages(
    req: BatchDeleteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not req.ids:
        return ApiResponse(message="无消息可删除")
    count = db.query(UserMessage).filter(
        UserMessage.id.in_(req.ids), UserMessage.user_id == user.id
    ).delete(synchronize_session=False)
    db.commit()
    return ApiResponse(message=f"删除了 {count} 条消息")


@router.get("/login-logs")
def login_logs(
    search: str | None = None,
    log_date: date | None = None,
    page: int = 1,
    page_size: int = 20,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """登录日志查询 - 对应老系统 login_logs.php"""
    import re
    q = db.query(ActivityLog).filter(
        or_(
            ActivityLog.action.like("%登录%"),
            ActivityLog.action.like("%login%"),
        )
    )
    if search:
        q = q.filter(or_(
            ActivityLog.username.like(f"%{search}%"),
            ActivityLog.login_ip.like(f"%{search}%"),
        ))
    if log_date:
        q = q.filter(func.date(ActivityLog.timestamp) == log_date)

    total = q.count()
    rows = q.order_by(desc(ActivityLog.timestamp)).offset(
        (page - 1) * page_size
    ).limit(page_size).all()

    def parse_ua(ua: str | None) -> dict:
        if not ua:
            return {"browser": "未知", "os": "未知", "device": "desktop"}
        browser = "未知"
        if m := re.search(r"Chrome/(\d+)", ua):
            browser = f"Chrome {m.group(1)}"
        elif m := re.search(r"Firefox/(\d+)", ua):
            browser = f"Firefox {m.group(1)}"
        elif m := re.search(r"Edge/(\d+)", ua):
            browser = f"Edge {m.group(1)}"
        elif "Safari" in ua and "Chrome" not in ua:
            browser = "Safari"

        os_name = "未知"
        if "Windows" in ua:
            os_name = "Windows"
        elif "Macintosh" in ua:
            os_name = "macOS"
        elif "Linux" in ua and "Android" not in ua:
            os_name = "Linux"
        elif "Android" in ua:
            os_name = "Android"
        elif re.search(r"iPhone|iPad|iPod", ua):
            os_name = "iOS"

        device = "desktop"
        if re.search(r"Mobile|Android|iPhone", ua):
            device = "mobile"
        elif re.search(r"iPad|Tablet", ua):
            device = "tablet"

        return {"browser": browser, "os": os_name, "device": device}

    def is_internal_ip(ip: str) -> bool:
        return bool(re.match(
            r"^(127\.|10\.|172\.1[6-9]\.|172\.2[0-9]\.|172\.3[0-1]\.|192\.168\.)", ip
        ))

    items = []
    for r in rows:
        ua_info = parse_ua(r.user_agent)
        items.append({
            "id": r.id,
            "user_id": r.user_id,
            "username": r.username or f"User#{r.user_id}",
            "action": r.action,
            "ip": r.login_ip,
            "is_internal": is_internal_ip(r.login_ip) if r.login_ip else False,
            "browser": ua_info["browser"],
            "os": ua_info["os"],
            "device": ua_info["device"],
            "timestamp": r.timestamp.strftime("%Y-%m-%d %H:%M:%S") if r.timestamp else "",
        })

    today_count = db.query(func.count(ActivityLog.id)).filter(
        or_(ActivityLog.action.like("%登录%"), ActivityLog.action.like("%login%")),
        func.date(ActivityLog.timestamp) == date.today(),
    ).scalar() or 0

    return ApiResponse(data={
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "today_count": today_count,
    })


class AdminUserCreate(BaseModel):
    username: str
    password: str
    real_name: str | None = None
    phone: str | None = None

class AdminUserUpdate(BaseModel):
    real_name: str | None = None
    phone: str | None = None
    alipay_account: str | None = None


@router.get("/users")
def list_all_users(
    role: str | None = None,
    keyword: str | None = None,
    page: int = 1,
    page_size: int = 50,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """全量用户管理 - 对应老系统 manage_users.php + manage_workers.php"""
    q = db.query(User)
    if role:
        q = q.filter(User.role == role)
    if keyword:
        q = q.filter(or_(User.username.like(f"%{keyword}%"), User.real_name.like(f"%{keyword}%")))
    total = q.count()
    items = q.order_by(User.role, desc(User.id)).offset((page - 1) * page_size).limit(page_size).all()

    admin_count = db.query(func.count(User.id)).filter(User.role == "admin").scalar() or 0
    worker_count = db.query(func.count(User.id)).filter(User.role == "worker").scalar() or 0

    return ApiResponse(data={
        "items": [{
            "id": u.id, "username": u.username, "role": u.role,
            "real_name": u.real_name, "phone": u.phone,
            "alipay_account": u.alipay_account,
        } for u in items],
        "total": total, "page": page, "page_size": page_size,
        "admin_count": admin_count, "worker_count": worker_count,
    })


@router.post("/users")
def create_admin_user(
    req: AdminUserCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """创建管理员用户"""
    username = req.username.strip()
    if not username or len(username) > 50:
        raise HTTPException(status_code=400, detail="用户名不合法")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="密码至少4位")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="用户名已存在")

    admin = User(
        username=username,
        password=hash_password(req.password),
        role="admin",
        real_name=req.real_name.strip() if req.real_name else None,
        phone=req.phone.strip() if req.phone else None,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)
    from app.utils.log_action import log_action
    log_action(db, user, "创建管理员", data_after=f"username={username}")
    return ApiResponse(message=f"管理员 {username} 创建成功", data={"id": admin.id, "username": admin.username})


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    req: AdminUserUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if req.real_name is not None:
        target.real_name = req.real_name.strip() if req.real_name else None
    if req.phone is not None:
        target.phone = req.phone.strip() if req.phone else None
    if req.alipay_account is not None:
        target.alipay_account = req.alipay_account.strip() if req.alipay_account else None
    db.commit()
    return ApiResponse(message="更新成功")


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账户")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role == "admin":
        admin_count = db.query(func.count(User.id)).filter(User.role == "admin").scalar() or 0
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="不能删除最后一个管理员")
    from app.utils.log_action import log_action
    log_action(db, user, f"删除用户", data_before=f"username={target.username},role={target.role}")
    db.delete(target)
    db.commit()
    return ApiResponse(message=f"用户 {target.username} 已删除")


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    user_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    target.password = hash_password("123456")
    db.commit()
    return ApiResponse(message=f"密码已重置为 123456")


def send_user_message(db, user_id: int, title: str, content: str = "", msg_type: str = "system", link: str = ""):
    """Helper to send a message to a user."""
    msg = UserMessage(user_id=user_id, title=title, content=content, msg_type=msg_type, link=link)
    db.add(msg)


@router.get("/anomaly-scan")
def anomaly_scan(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Run comprehensive anomaly scan across the system."""
    from datetime import datetime, timedelta, date
    from sqlalchemy import func
    from app.models import (
        PrintedLabel, CartonBox, WorkerProduction, FailureLog,
        SkuTransaction,
    )
    from app.models.worker_production_edit import WorkerProductionEdit

    today = date.today()
    now = datetime.now()
    anomalies = []

    # 1. Carton box stock alerts
    low_boxes = db.query(CartonBox).all()
    for box in low_boxes:
        qty = box.stock_quantity or 0
        threshold = box.low_stock_threshold or 50
        if qty <= threshold:
            level = "critical" if qty == 0 else "warning"
            anomalies.append({
                "category": "inventory",
                "level": level,
                "title": f"纸箱库存{'已耗尽' if qty == 0 else '不足'}",
                "detail": f"{box.box_type} 当前库存 {qty}（预警阈值 {threshold}）",
                "link": "/inventory/carton",
            })

    # 2. Label aging (labels in warehouse > 7 days)
    aging_7d = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound == 0,
        func.date(PrintedLabel.created_at) <= today - timedelta(days=7),
    ).scalar() or 0
    if aging_7d > 0:
        aging_14d = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.scanned_outbound == 0,
            func.date(PrintedLabel.created_at) <= today - timedelta(days=14),
        ).scalar() or 0
        level = "critical" if aging_14d > 50 else "warning" if aging_7d > 100 else "info"
        anomalies.append({
            "category": "production",
            "level": level,
            "title": "标签仓库滞留告警",
            "detail": f"超过7天未出库标签 {aging_7d} 个（其中超14天 {aging_14d} 个）",
            "link": "/reports/aging",
        })

    # 3. Pending audits backlog
    pending_audits = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "pending",
    ).scalar() or 0
    old_pending = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.audit_status == "pending",
        WorkerProduction.production_date <= today - timedelta(days=2),
    ).scalar() or 0
    if old_pending > 0:
        anomalies.append({
            "category": "audit",
            "level": "warning" if old_pending > 10 else "info",
            "title": "审核积压告警",
            "detail": f"待审核 {pending_audits} 条（超2天未审核 {old_pending} 条）",
            "link": "/production/audit",
        })

    # 4. Pending edit requests
    pending_edits = db.query(func.count(WorkerProductionEdit.id)).filter(
        WorkerProductionEdit.audit_status == "pending",
    ).scalar() or 0
    if pending_edits > 0:
        anomalies.append({
            "category": "audit",
            "level": "info",
            "title": "修改申请待处理",
            "detail": f"有 {pending_edits} 条工人修改申请等待审核",
            "link": "/production/audit",
        })

    # 5. Failed scans in last 24 hours
    failed_24h = db.query(func.count(FailureLog.id)).filter(
        FailureLog.failure_time >= now - timedelta(hours=24),
    ).scalar() or 0
    if failed_24h > 10:
        weight_fails = db.query(func.count(FailureLog.id)).filter(
            FailureLog.failure_time >= now - timedelta(hours=24),
            FailureLog.failure_reason.like("%重量%"),
        ).scalar() or 0
        anomalies.append({
            "category": "scan",
            "level": "warning" if failed_24h > 50 else "info",
            "title": "扫码失败频繁",
            "detail": f"过去24小时内 {failed_24h} 次失败（其中重量异常 {weight_fails} 次）",
            "link": "/production/failures",
        })

    # 6. Unprinted transactions
    unprinted = db.query(func.count(SkuTransaction.id)).filter(
        SkuTransaction.is_printed == False,
    ).scalar() or 0
    if unprinted > 0:
        old_unprinted = db.query(func.count(SkuTransaction.id)).filter(
            SkuTransaction.is_printed == False,
            func.date(SkuTransaction.transaction_date) <= today - timedelta(days=1),
        ).scalar() or 0
        anomalies.append({
            "category": "production",
            "level": "warning" if old_unprinted > 20 else "info",
            "title": "待打印交易积压",
            "detail": f"共 {unprinted} 笔交易未打印（超1天 {old_unprinted} 笔）",
            "link": "/production/print",
        })

    # 7. Today's production summary
    today_production = db.query(func.count(WorkerProduction.id)).filter(
        WorkerProduction.production_date == today,
    ).scalar() or 0
    today_outbound = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time) == today,
    ).scalar() or 0
    today_printed = db.query(func.count(PrintedLabel.id)).filter(
        func.date(PrintedLabel.created_at) == today,
    ).scalar() or 0

    # Category counts
    cat_counts = {}
    for a in anomalies:
        cat = a["category"]
        cat_counts[cat] = cat_counts.get(cat, 0) + 1

    level_counts = {"critical": 0, "warning": 0, "info": 0}
    for a in anomalies:
        level_counts[a["level"]] = level_counts.get(a["level"], 0) + 1

    anomalies.sort(key=lambda x: {"critical": 0, "warning": 1, "info": 2}.get(x["level"], 3))

    health_score = 100
    health_score -= level_counts["critical"] * 20
    health_score -= level_counts["warning"] * 10
    health_score -= level_counts["info"] * 3
    health_score = max(health_score, 0)
    health_grade = "A+" if health_score >= 90 else "A" if health_score >= 80 else "B" if health_score >= 60 else "C" if health_score >= 40 else "D"

    return ApiResponse(data={
        "anomalies": anomalies,
        "summary": {
            "total_anomalies": len(anomalies),
            "level_counts": level_counts,
            "category_counts": cat_counts,
            "health_score": health_score,
            "health_grade": health_grade,
        },
        "today": {
            "production_records": today_production,
            "outbound_count": today_outbound,
            "printed_labels": today_printed,
            "pending_audits": pending_audits,
        },
        "scan_time": now.isoformat(),
    })
