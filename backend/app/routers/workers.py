from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, and_
from datetime import date, timedelta
from decimal import Decimal
from app.database import get_db
from app.models import User, WorkerProduction, PrintedLabel, Sku
from app.schemas.workers import (
    WorkerCreate, WorkerUpdate, WorkerOut,
)
from app.schemas.common import ApiResponse, PaginatedResponse
from app.middleware.auth import get_current_user, require_admin, hash_password
from app.utils.cache import cache_get, cache_set

router = APIRouter(prefix="/workers", tags=["人员管理"])


# ─── 工人 CRUD ───
@router.get("", response_model=PaginatedResponse[WorkerOut])
def list_workers(
    page: int = 1,
    page_size: int = 50,
    keyword: str | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = db.query(User).filter(User.role == "worker")
    if keyword:
        q = q.filter(
            (User.username.like(f"%{keyword}%")) | (User.real_name.like(f"%{keyword}%"))
        )
    total = q.count()
    items = q.order_by(desc(User.id)).offset((page - 1) * page_size).limit(page_size).all()
    return PaginatedResponse(data=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=ApiResponse[WorkerOut])
def create_worker(
    req: WorkerCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not req.username or not req.username.strip():
        raise HTTPException(status_code=400, detail="用户名不能为空")
    req.username = req.username.strip()
    if len(req.username) < 2:
        raise HTTPException(status_code=400, detail="用户名至少2个字符")
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    worker = User(
        username=req.username,
        password=hash_password(req.password),
        role="worker",
        real_name=req.real_name.strip() if req.real_name and req.real_name.strip() else req.username,
        phone=req.phone,
        alipay_account=req.alipay_account,
    )
    db.add(worker)
    db.commit()
    db.refresh(worker)
    return ApiResponse(data=worker)


class BatchWorkerCreate(BaseModel):
    usernames: str
    default_password: str = "123456"

@router.post("/batch-create", response_model=ApiResponse)
def batch_create_workers(
    req: BatchWorkerCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Batch create workers from newline-separated usernames."""
    lines = [l.strip() for l in req.usernames.strip().split('\n') if l.strip()]
    if not lines:
        raise HTTPException(status_code=400, detail="请输入至少一个用户名")
    if len(lines) > 100:
        raise HTTPException(status_code=400, detail="单次最多创建100个工人")

    created = []
    skipped = []
    pwd_hash = hash_password(req.default_password)

    for uname in lines:
        if len(uname) < 2 or len(uname) > 50:
            skipped.append({"username": uname, "reason": "用户名长度需2-50字符"})
            continue
        existing = db.query(User).filter(User.username == uname).first()
        if existing:
            skipped.append({"username": uname, "reason": "用户名已存在"})
            continue
        w = User(username=uname, password=pwd_hash, role="worker", real_name=uname)
        db.add(w)
        created.append(uname)

    if created:
        from app.utils.log_action import log_action
        log_action(db, user, f"批量添加 {len(created)} 名工人：{', '.join(created[:5])}{'...' if len(created) > 5 else ''}")
        db.commit()

    return ApiResponse(
        message=f"成功创建 {len(created)} 名工人" + (f"，跳过 {len(skipped)} 名" if skipped else ""),
        data={"created": created, "skipped": skipped, "total_created": len(created), "total_skipped": len(skipped)},
    )


class BatchResetPassword(BaseModel):
    worker_ids: list[int]
    new_password: str = "123456"

@router.post("/batch-reset-password", response_model=ApiResponse)
def batch_reset_password(
    req: BatchResetPassword,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if not req.worker_ids:
        raise HTTPException(status_code=400, detail="请选择要重置的工人")
    if len(req.worker_ids) > 100:
        raise HTTPException(status_code=400, detail="单次最多重置100人")

    pwd_hash = hash_password(req.new_password)
    workers = db.query(User).filter(User.id.in_(req.worker_ids), User.role == "worker").all()
    count = 0
    names = []
    for w in workers:
        w.password = pwd_hash
        count += 1
        names.append(w.real_name or w.username)

    if count > 0:
        from app.utils.log_action import log_action
        log_action(db, user, f"批量重置 {count} 名工人密码：{', '.join(names[:5])}{'...' if len(names) > 5 else ''}")
        db.commit()

    return ApiResponse(message=f"已重置 {count} 名工人的密码", data={"count": count})


@router.put("/{worker_id}", response_model=ApiResponse[WorkerOut])
def update_worker(
    worker_id: int,
    req: WorkerUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    worker = db.query(User).filter(User.id == worker_id, User.role == "worker").first()
    if not worker:
        raise HTTPException(status_code=404, detail="工人不存在")
    for k, v in req.model_dump(exclude_unset=True).items():
        setattr(worker, k, v)
    db.commit()
    db.refresh(worker)
    return ApiResponse(data=worker)


@router.delete("/{worker_id}", response_model=ApiResponse)
def delete_worker(
    worker_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    worker = db.query(User).filter(User.id == worker_id, User.role == "worker").first()
    if not worker:
        raise HTTPException(status_code=404, detail="工人不存在")
    db.delete(worker)
    db.commit()
    return ApiResponse(message="删除成功")


@router.post("/{worker_id}/reset-password", response_model=ApiResponse)
def reset_worker_password(
    worker_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    worker = db.query(User).filter(User.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="用户不存在")
    worker.password = hash_password("123456")
    db.commit()
    return ApiResponse(message="密码已重置为 123456")


# ─── 工人批量统计 ───
@router.get("/batch-stats")
def worker_batch_stats(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Batch stats for all workers: month production, 7-day production."""
    today = date.today()
    month_start = today.replace(day=1)
    d7 = today - timedelta(days=6)

    cache_key = f"worker_batch_stats:{today}"
    cached = cache_get(cache_key)
    if cached:
        return ApiResponse(data=cached)

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    workers = db.query(User).filter(User.role == "worker").all()

    prod_month = db.query(
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
        func.count(WorkerProduction.id).label("records"),
    ).filter(
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= month_start,
    ).group_by(WorkerProduction.worker_id).all()
    prod_m_map = {r.worker_id: {"qty": int(_f(r.qty)), "records": r.records} for r in prod_month}

    prod_7d = db.query(
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
    ).filter(
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= d7,
    ).group_by(WorkerProduction.worker_id).all()
    prod_7d_map = {r.worker_id: int(_f(r.qty)) for r in prod_7d}

    label_month = db.query(
        PrintedLabel.u,
        func.count(PrintedLabel.id).label("cnt"),
    ).filter(
        func.date(PrintedLabel.created_at) >= month_start,
    ).group_by(PrintedLabel.u).all()
    label_map = {r.u: r.cnt for r in label_month}

    result = {}
    for w in workers:
        pm = prod_m_map.get(w.id, {"qty": 0, "records": 0})
        result[w.id] = {
            "month_production": pm["qty"],
            "month_records": pm["records"],
            "week_production": prod_7d_map.get(w.id, 0),
            "month_labels": label_map.get(w.id, 0),
        }

    cache_set(cache_key, result, ttl=60)
    return ApiResponse(data=result)


# ─── 工人档案 ───
@router.get("/{worker_id}/profile")
def worker_profile(
    worker_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Comprehensive worker profile with production and performance data."""
    worker = db.query(User).filter(User.id == worker_id, User.role == "worker").first()
    if not worker:
        raise HTTPException(status_code=404, detail="工人不存在")

    today = date.today()
    d30 = today - timedelta(days=29)
    month_start = today.replace(day=1)

    # --- Production stats ---
    total_qty = db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(
        WorkerProduction.worker_id == worker_id,
        WorkerProduction.audit_status == "approved",
    ).scalar() or 0

    month_qty = db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(
        WorkerProduction.worker_id == worker_id,
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= month_start,
    ).scalar() or 0

    today_qty = db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(
        WorkerProduction.worker_id == worker_id,
        WorkerProduction.production_date == today,
    ).scalar() or 0

    working_days = db.query(func.count(func.distinct(WorkerProduction.production_date))).filter(
        WorkerProduction.worker_id == worker_id,
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= d30,
    ).scalar() or 0

    daily_avg = round(int(total_qty) / max(working_days, 1), 1) if total_qty else 0

    # --- 30-day production trend ---
    daily_prod = db.query(
        WorkerProduction.production_date.label("d"),
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
    ).filter(
        WorkerProduction.worker_id == worker_id,
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= d30,
    ).group_by(WorkerProduction.production_date).all()
    daily_map = {r.d: int(r.qty) for r in daily_prod}

    production_trend = []
    d = d30
    while d <= today:
        production_trend.append({"date": d.strftime("%m-%d"), "qty": daily_map.get(d, 0)})
        d += timedelta(days=1)

    # --- SKU breakdown ---
    sku_breakdown = db.query(
        WorkerProduction.sku_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
    ).filter(
        WorkerProduction.worker_id == worker_id,
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= d30,
    ).group_by(WorkerProduction.sku_id).order_by(desc("qty")).limit(10).all()

    sku_ids = [r.sku_id for r in sku_breakdown]
    sku_names = {}
    if sku_ids:
        for s in db.query(Sku.id, Sku.sku_name, Sku.fruit_name).filter(Sku.id.in_(sku_ids)).all():
            sku_names[s.id] = {"name": s.sku_name, "fruit": s.fruit_name}

    sku_data = [
        {
            "sku_id": r.sku_id,
            "name": sku_names.get(r.sku_id, {}).get("name", f"SKU#{r.sku_id}"),
            "fruit": sku_names.get(r.sku_id, {}).get("fruit", ""),
            "qty": int(r.qty),
        }
        for r in sku_breakdown
    ]

    # --- Ranking ---
    all_ranking = db.query(
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("tq"),
    ).filter(
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= d30,
    ).group_by(WorkerProduction.worker_id).order_by(desc("tq")).all()

    rank = 0
    total_workers = len(all_ranking)
    for i, row in enumerate(all_ranking, 1):
        if row.worker_id == worker_id:
            rank = i
            break

    # --- Labels ---
    total_labels = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.u == worker_id,
    ).scalar() or 0

    return ApiResponse(data={
        "worker": {
            "id": worker.id,
            "username": worker.username,
            "real_name": worker.real_name,
            "phone": worker.phone,
            "alipay_account": worker.alipay_account,
        },
        "production": {
            "total_qty": int(total_qty),
            "month_qty": int(month_qty),
            "today_qty": int(today_qty),
            "daily_avg": daily_avg,
            "working_days_30d": working_days,
            "total_labels": total_labels,
            "trend": production_trend,
            "sku_breakdown": sku_data,
        },
        "ranking": {
            "rank": rank,
            "total_workers": total_workers,
        },
    })


# ─── 工人绩效 / 排行 ───
@router.get("/ranking")
def worker_ranking(
    start_date: date | None = None,
    end_date: date | None = None,
    mode: str = "production",
    period: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if mode == "weight_diff":
        return _worker_ranking_weight_diff(start_date, end_date, db)
    if mode == "commission":
        return _worker_ranking_commission(start_date, end_date, db)
    return _worker_ranking_production(start_date, end_date, db)


def _worker_ranking_commission(start_date, end_date, db):
    today = date.today()
    if not start_date:
        start_date = today.replace(day=1)
    if not end_date:
        end_date = today

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    rows = db.query(
        PrintedLabel.u.label("worker_id"),
        func.count(PrintedLabel.id).label("printed"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, 1, 0)).label("outbound"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, Sku.production_performance, 0)).label("commission"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        func.date(PrintedLabel.created_at).between(start_date, end_date),
    ).group_by(PrintedLabel.u).all()

    wids = [r.worker_id for r in rows]
    wname_map = {w.id: w.real_name or w.username for w in db.query(User).filter(User.id.in_(wids)).all()} if wids else {}

    result = sorted([{
        "worker_id": r.worker_id,
        "worker_name": wname_map.get(r.worker_id, f"#{r.worker_id}"),
        "printed": int(r.printed or 0),
        "outbound": int(_f(r.outbound)),
        "commission": round(_f(r.commission), 2),
        "outbound_rate": round(int(_f(r.outbound)) / max(int(r.printed or 1), 1) * 100, 1),
    } for r in rows], key=lambda x: x["commission"], reverse=True)

    for i, r in enumerate(result):
        r["rank"] = i + 1

    return result


@router.get("/ranking-ai-review")
def ranking_ai_review(
    mode: str = "production",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI排行点评 — 流式分析排行数据"""
    from fastapi.responses import StreamingResponse
    import json
    today = date.today()
    month_start = today.replace(day=1)

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    ctx = [f"排行周期: {month_start} ~ {today}"]

    rows = db.query(
        PrintedLabel.u,
        func.count(PrintedLabel.id).label("printed"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, 1, 0)).label("outbound"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, Sku.production_performance, 0)).label("commission"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        func.date(PrintedLabel.created_at).between(month_start, today),
    ).group_by(PrintedLabel.u).all()

    wids = [r[0] for r in rows]
    wm = {w.id: w.real_name or w.username for w in db.query(User).filter(User.id.in_(wids)).all()} if wids else {}

    workers_data = sorted([{
        "name": wm.get(r[0], f"#{r[0]}"), "printed": int(r[1] or 0),
        "outbound": int(_f(r[2])), "commission": round(_f(r[3]), 2),
    } for r in rows], key=lambda x: x["commission"], reverse=True)

    ctx.append("工人排行(按佣金):")
    for i, w in enumerate(workers_data[:8]):
        ctx.append(f"  #{i+1} {w['name']}: 打印{w['printed']} 出库{w['outbound']} 佣金¥{w['commission']:.2f}")

    if workers_data:
        avg_comm = sum(w["commission"] for w in workers_data) / len(workers_data)
        avg_out = sum(w["outbound"] for w in workers_data) / len(workers_data)
        ctx.append(f"团队平均: 出库{avg_out:.0f} 佣金¥{avg_comm:.2f}")

    prompt = f"""请根据以下工人排行数据，生成一份简短的排行点评。

{chr(10).join(ctx)}

请用markdown格式，包含：
1. **排行亮点**: 表现突出的工人及原因
2. **差距分析**: 头部和尾部工人的差距
3. **团队建议**: 1-2条提升整体效率的建议

简洁精炼，不超过150字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333",
                          base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            resp = client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是果管系统的绩效分析师。简洁点评工人排行。使用简体中文。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.3, max_tokens=800)
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _worker_ranking_production(start_date, end_date, db):
    q = db.query(
        WorkerProduction.worker_id,
        func.sum(WorkerProduction.actual_packaging_quantity).label("total_qty"),
    ).filter(WorkerProduction.audit_status == "approved")

    if start_date:
        q = q.filter(WorkerProduction.production_date >= start_date)
    if end_date:
        q = q.filter(WorkerProduction.production_date <= end_date)

    results = q.group_by(WorkerProduction.worker_id).order_by(
        desc("total_qty")
    ).limit(50).all()

    worker_ids = [r[0] for r in results]
    workers = {w.id: w for w in db.query(User).filter(User.id.in_(worker_ids)).all()}

    ranking = []
    for i, (worker_id, total_qty) in enumerate(results, 1):
        w = workers.get(worker_id)
        name = (w.real_name or w.username) if w else "未知"
        ranking.append({
            "rank": i,
            "worker_id": worker_id,
            "worker_name": name,
            "username": w.username if w else "未知",
            "real_name": w.real_name if w else None,
            "total_qty": int(total_qty),
        })
    return ApiResponse(data=ranking)


def _worker_ranking_weight_diff(start_date, end_date, db):
    from sqlalchemy import case as sa_case

    def _d(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    base_filter = [PrintedLabel.scanned_outbound > 0]
    if start_date:
        base_filter.append(func.date(PrintedLabel.scanned_time) >= start_date)
    if end_date:
        base_filter.append(func.date(PrintedLabel.scanned_time) <= end_date)

    diff_expr = PrintedLabel.actual_weight - PrintedLabel.estimated_weight

    rows = db.query(
        PrintedLabel.u.label("worker_id"),
        func.count(PrintedLabel.id).label("total_count"),
        func.sum(PrintedLabel.actual_weight).label("total_actual"),
        func.sum(func.abs(diff_expr)).label("total_abs_diff"),
        func.sum(sa_case((diff_expr > 0, 1), else_=0)).label("overshoot_count"),
        func.sum(sa_case((diff_expr < 0, 1), else_=0)).label("undershoot_count"),
        func.sum(sa_case((diff_expr > 0, diff_expr), else_=0)).label("overshoot_weight"),
        func.sum(sa_case((diff_expr < 0, func.abs(diff_expr)), else_=0)).label("undershoot_weight"),
    ).filter(*base_filter).group_by(PrintedLabel.u).all()

    worker_ids = [r.worker_id for r in rows if r.worker_id]
    wmap = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            wmap[w.id] = {"name": w.real_name or w.username, "username": w.username, "real_name": w.real_name}

    ranking = []
    for r in rows:
        actual = _d(r.total_actual)
        abs_diff = _d(r.total_abs_diff)
        diff_pct = round(abs_diff / actual * 100, 2) if actual > 0 else 0
        oc = int(r.overshoot_count or 0)
        uc = int(r.undershoot_count or 0)
        total = r.total_count or 1
        info = wmap.get(r.worker_id, {"name": f"#{r.worker_id}", "username": f"#{r.worker_id}", "real_name": None})
        ranking.append({
            "worker_id": r.worker_id,
            "worker_name": info["name"],
            "username": info["username"],
            "real_name": info["real_name"],
            "total_count": r.total_count,
            "total_actual_weight": round(actual, 2),
            "total_abs_diff": round(abs_diff, 2),
            "diff_pct": diff_pct,
            "overshoot_count": oc,
            "undershoot_count": uc,
            "overshoot_pct": round(oc / total * 100, 1),
            "undershoot_pct": round(uc / total * 100, 1),
            "overshoot_weight": round(_d(r.overshoot_weight), 2),
            "undershoot_weight": round(_d(r.undershoot_weight), 2),
        })

    ranking.sort(key=lambda x: x["diff_pct"])
    for i, item in enumerate(ranking, 1):
        item["rank"] = i

    return ApiResponse(data=ranking)


@router.get("/my-stats")
def my_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    today = date.today()
    today_qty = db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(
        and_(WorkerProduction.worker_id == user.id, WorkerProduction.production_date == today)
    ).scalar() or 0

    total_qty = db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(
        and_(WorkerProduction.worker_id == user.id, WorkerProduction.audit_status == "approved")
    ).scalar() or 0

    today_labels = db.query(func.count(PrintedLabel.id)).filter(
        and_(PrintedLabel.u == user.id, func.date(PrintedLabel.created_at) == today)
    ).scalar() or 0

    return ApiResponse(data={
        "today_qty": int(today_qty),
        "total_qty": int(total_qty),
        "today_labels": today_labels,
    })


@router.get("/my-performance")
def my_performance(
    start_date: date | None = None,
    end_date: date | None = None,
    worker_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Worker performance analytics. Admin can view any worker via worker_id param."""
    today = date.today()
    if not start_date:
        start_date = today - timedelta(days=29)
    if not end_date:
        end_date = today

    target_id = user.id
    target_name = user.real_name or user.username
    if worker_id and user.role == "admin":
        target_id = worker_id
        w = db.query(User).filter(User.id == worker_id).first()
        target_name = (w.real_name or w.username) if w else f"#{worker_id}"

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    daily_rows = (
        db.query(
            WorkerProduction.production_date,
            func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
            func.count(WorkerProduction.id).label("records"),
        )
        .filter(
            WorkerProduction.worker_id == target_id,
            WorkerProduction.audit_status == "approved",
            WorkerProduction.production_date >= start_date,
            WorkerProduction.production_date <= end_date,
        )
        .group_by(WorkerProduction.production_date)
        .order_by(WorkerProduction.production_date)
        .all()
    )

    daily_map = {str(r.production_date): {"qty": int(r.qty), "records": int(r.records)} for r in daily_rows}

    daily_print_rows = (
        db.query(
            func.date(PrintedLabel.created_at).label("d"),
            func.count(PrintedLabel.id).label("printed"),
            func.sum(func.IF(PrintedLabel.scanned_outbound > 0, 1, 0)).label("outbound"),
        )
        .filter(
            PrintedLabel.u == target_id,
            func.date(PrintedLabel.created_at).between(start_date, end_date),
        )
        .group_by(func.date(PrintedLabel.created_at))
        .all()
    )
    daily_print_map = {str(r.d): {"printed": int(r.printed or 0), "outbound": int(r.outbound or 0)} for r in daily_print_rows}

    daily_production = []
    d = start_date
    while d <= end_date:
        ds = str(d)
        prod = daily_map.get(ds, {"qty": 0, "records": 0})
        prt = daily_print_map.get(ds, {"printed": 0, "outbound": 0})
        daily_production.append({
            "date": ds, "qty": prod["qty"], "records": prod["records"],
            "printed": prt["printed"], "outbound": prt["outbound"],
        })
        d += timedelta(days=1)

    period_total = sum(item["qty"] for item in daily_production)
    period_printed = sum(item["printed"] for item in daily_production)
    period_outbound = sum(item["outbound"] for item in daily_production)
    working_days = sum(1 for item in daily_production if item["qty"] > 0)
    avg_daily = round(period_total / working_days, 1) if working_days > 0 else 0

    sku_breakdown = (
        db.query(
            WorkerProduction.sku_id,
            func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
            func.sum(WorkerProduction.printed_quantity).label("print_qty"),
            func.count(WorkerProduction.id).label("records"),
        )
        .filter(
            WorkerProduction.worker_id == target_id,
            WorkerProduction.audit_status == "approved",
            WorkerProduction.production_date >= start_date,
            WorkerProduction.production_date <= end_date,
        )
        .group_by(WorkerProduction.sku_id)
        .order_by(desc("qty"))
        .all()
    )

    sku_ids = [r.sku_id for r in sku_breakdown]
    sku_map = {}
    if sku_ids:
        skus = db.query(Sku.id, Sku.sku_name, Sku.fruit_name, Sku.production_performance).filter(Sku.id.in_(sku_ids)).all()
        sku_map = {s.id: {"sku_name": s.sku_name, "fruit_name": s.fruit_name, "performance": float(s.production_performance or 0)} for s in skus}

    commission_rows = db.query(
        PrintedLabel.s.label("sku_id"),
        func.count(func.IF(PrintedLabel.scanned_outbound > 0, PrintedLabel.id, None)).label("outbound_count"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, Sku.production_performance, 0)).label("commission"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        PrintedLabel.u == target_id,
        func.date(PrintedLabel.created_at).between(start_date, end_date),
    ).group_by(PrintedLabel.s).all()
    commission_map = {r.sku_id: {"outbound": int(_f(r.outbound_count)), "commission": round(_f(r.commission), 2)} for r in commission_rows}

    sku_data = []
    for r in sku_breakdown:
        info = sku_map.get(r.sku_id, {"sku_name": f"#{r.sku_id}", "fruit_name": "未知", "performance": 0})
        comm = commission_map.get(r.sku_id, {"outbound": 0, "commission": 0})
        sku_data.append({
            "sku_id": r.sku_id,
            "sku_name": info["sku_name"],
            "fruit_name": info["fruit_name"],
            "performance": info["performance"],
            "qty": int(r.qty),
            "print_qty": int(r.print_qty or 0),
            "records": int(r.records),
            "outbound": comm["outbound"],
            "commission": comm["commission"],
        })

    all_workers_ranking = (
        db.query(
            WorkerProduction.worker_id,
            func.sum(WorkerProduction.actual_packaging_quantity).label("total_qty"),
        )
        .filter(
            WorkerProduction.audit_status == "approved",
            WorkerProduction.production_date >= start_date,
            WorkerProduction.production_date <= end_date,
        )
        .group_by(WorkerProduction.worker_id)
        .order_by(desc("total_qty"))
        .all()
    )

    rank = 0
    total_workers = len(all_workers_ranking)
    all_total = 0
    for i, row in enumerate(all_workers_ranking, 1):
        all_total += int(row.total_qty)
        if row.worker_id == target_id:
            rank = i

    team_avg = round(all_total / total_workers, 1) if total_workers > 0 else 0
    vs_avg = round(period_total / team_avg, 2) if team_avg > 0 else 0

    prev_start = start_date - (end_date - start_date) - timedelta(days=1)
    prev_end = start_date - timedelta(days=1)
    prev_total = db.query(func.sum(WorkerProduction.actual_packaging_quantity)).filter(
        WorkerProduction.worker_id == target_id,
        WorkerProduction.audit_status == "approved",
        WorkerProduction.production_date >= prev_start,
        WorkerProduction.production_date <= prev_end,
    ).scalar() or 0
    growth = round((period_total - int(prev_total)) / int(prev_total) * 100, 1) if prev_total else None

    total_commission = round(sum(s["commission"] for s in sku_data), 2)
    total_outbound = sum(s["outbound"] for s in sku_data)

    worker_options = []
    if user.role == "admin":
        workers = db.query(User.id, User.real_name, User.username).filter(User.role == "worker").order_by(User.username).all()
        worker_options = [{"id": w.id, "name": w.real_name or w.username} for w in workers]

    return ApiResponse(data={
        "worker_id": target_id,
        "worker_name": target_name,
        "daily_production": daily_production,
        "period_total": period_total,
        "period_printed": period_printed,
        "period_outbound": period_outbound,
        "working_days": working_days,
        "avg_daily": avg_daily,
        "sku_breakdown": sku_data,
        "rank": rank,
        "total_workers": total_workers,
        "team_avg": team_avg,
        "vs_avg": vs_avg,
        "growth": growth,
        "start_date": str(start_date),
        "end_date": str(end_date),
        "total_commission": total_commission,
        "total_outbound": total_outbound,
        "worker_options": worker_options,
    })


# ─── 工人佣金统计 ───
@router.get("/commission")
def worker_commission(
    start_date: date | None = None,
    end_date: date | None = None,
    worker_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Worker commission based on outbound count × SKU production_performance.
    Matches the old PHP system formula: SUM(scanned_outbound * production_performance)."""
    today = date.today()
    if not start_date:
        start_date = today.replace(day=1)
    if not end_date:
        end_date = today

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    target_workers = []
    if user.role == "worker":
        target_workers = [user.id]
    elif worker_id:
        target_workers = [worker_id]

    base_filter = [
        func.date(PrintedLabel.created_at).between(start_date, end_date),
    ]
    if target_workers:
        base_filter.append(PrintedLabel.u.in_(target_workers))

    commission_by_worker = db.query(
        PrintedLabel.u.label("worker_id"),
        Sku.id.label("sku_id"),
        Sku.sku_name,
        Sku.fruit_name,
        Sku.production_performance,
        func.count(PrintedLabel.id).label("printed_count"),
        func.sum(PrintedLabel.scanned_outbound).label("outbound_count"),
        func.sum(PrintedLabel.scanned_outbound * Sku.production_performance).label("commission"),
    ).join(
        Sku, Sku.id == PrintedLabel.s
    ).filter(
        *base_filter
    ).group_by(
        PrintedLabel.u, Sku.id, Sku.sku_name, Sku.fruit_name, Sku.production_performance
    ).all()

    worker_ids = list({r.worker_id for r in commission_by_worker})
    wname_map = {}
    if worker_ids:
        for w in db.query(User.id, User.real_name, User.username).filter(User.id.in_(worker_ids)).all():
            wname_map[w.id] = w.real_name or w.username

    worker_totals: dict = {}
    for r in commission_by_worker:
        wid = r.worker_id
        if wid not in worker_totals:
            worker_totals[wid] = {
                "worker_id": wid,
                "worker_name": wname_map.get(wid, f"#{wid}"),
                "total_printed": 0,
                "total_outbound": 0,
                "total_commission": 0.0,
                "sku_details": [],
            }
        wt = worker_totals[wid]
        printed = r.printed_count or 0
        outbound = int(_f(r.outbound_count))
        comm = round(_f(r.commission), 2)
        wt["total_printed"] += printed
        wt["total_outbound"] += outbound
        wt["total_commission"] += comm
        wt["sku_details"].append({
            "sku_id": r.sku_id,
            "sku_name": r.sku_name,
            "fruit_name": r.fruit_name,
            "performance": _f(r.production_performance),
            "printed": printed,
            "outbound": outbound,
            "commission": comm,
        })

    for wt in worker_totals.values():
        wt["total_commission"] = round(wt["total_commission"], 2)
        wt["sku_details"].sort(key=lambda x: x["commission"], reverse=True)

    workers_list = sorted(worker_totals.values(), key=lambda x: x["total_commission"], reverse=True)

    grand_total = round(sum(w["total_commission"] for w in workers_list), 2)
    grand_outbound = sum(w["total_outbound"] for w in workers_list)
    grand_printed = sum(w["total_printed"] for w in workers_list)

    return ApiResponse(data={
        "start_date": str(start_date),
        "end_date": str(end_date),
        "summary": {
            "total_commission": grand_total,
            "total_outbound": grand_outbound,
            "total_printed": grand_printed,
            "worker_count": len(workers_list),
        },
        "workers": workers_list,
    })


@router.get("/my-calendar")
def my_production_calendar(
    year: int | None = None,
    month: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Worker production calendar: daily stats for a month."""
    from calendar import monthrange
    today = date.today()
    y = year or today.year
    m = month or today.month
    _, days_in_month = monthrange(y, m)
    month_start = date(y, m, 1)
    month_end = date(y, m, days_in_month)

    uid = user.id

    prod_rows = db.query(
        WorkerProduction.production_date.label("d"),
        func.sum(WorkerProduction.actual_packaging_quantity).label("qty"),
        func.count(WorkerProduction.id).label("cnt"),
        func.max(WorkerProduction.audit_status).label("status"),
    ).filter(
        WorkerProduction.worker_id == uid,
        WorkerProduction.production_date.between(month_start, month_end),
    ).group_by(WorkerProduction.production_date).all()
    prod_map = {r.d: {"qty": int(r.qty or 0), "count": r.cnt, "status": r.status} for r in prod_rows}

    label_rows = db.query(
        func.date(PrintedLabel.created_at).label("d"),
        func.count(PrintedLabel.id).label("printed"),
    ).filter(
        PrintedLabel.u == uid,
        func.date(PrintedLabel.created_at).between(month_start, month_end),
    ).group_by(func.date(PrintedLabel.created_at)).all()
    label_map = {r.d: r.printed for r in label_rows}

    outbound_rows = db.query(
        func.date(PrintedLabel.scanned_time).label("d"),
        func.count(PrintedLabel.id).label("outbound"),
        func.sum(Sku.production_performance).label("commission"),
    ).join(Sku, PrintedLabel.s == Sku.id).filter(
        PrintedLabel.u == uid,
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(month_start, month_end),
    ).group_by(func.date(PrintedLabel.scanned_time)).all()
    out_map = {r.d: {"outbound": r.outbound, "commission": float(r.commission or 0)} for r in outbound_rows}

    days = []
    for i in range(1, days_in_month + 1):
        d = date(y, m, i)
        p = prod_map.get(d, {})
        o = out_map.get(d, {})
        days.append({
            "date": str(d),
            "day": i,
            "weekday": d.isoweekday(),
            "production_qty": p.get("qty", 0),
            "production_count": p.get("count", 0),
            "audit_status": p.get("status"),
            "printed": label_map.get(d, 0),
            "outbound": o.get("outbound", 0),
            "commission": round(o.get("commission", 0), 1),
            "is_today": d == today,
            "is_future": d > today,
        })

    month_total_production = sum(d["production_qty"] for d in days)
    month_total_outbound = sum(d["outbound"] for d in days)
    month_total_commission = round(sum(d["commission"] for d in days), 1)
    month_total_printed = sum(d["printed"] for d in days)
    working_days = sum(1 for d in days if d["production_qty"] > 0 or d["printed"] > 0)

    return ApiResponse(data={
        "year": y, "month": m,
        "days": days,
        "summary": {
            "total_production": month_total_production,
            "total_outbound": month_total_outbound,
            "total_commission": month_total_commission,
            "total_printed": month_total_printed,
            "working_days": working_days,
            "days_in_month": days_in_month,
        },
    })


@router.get("/comparison")
def worker_production_comparison(
    worker_ids: str = "",
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Compare production trends across multiple workers over a date range."""
    today = date.today()
    sd = start_date or (today - timedelta(days=13))
    ed = end_date or today

    ids = [int(x) for x in worker_ids.split(",") if x.strip().isdigit()]
    if not ids:
        all_workers = db.query(User.id).filter(User.role == "worker").limit(10).all()
        ids = [w.id for w in all_workers]

    if not ids:
        return ApiResponse(data={"workers": [], "dates": [], "comparison": [], "summary": []})

    workers = db.query(User.id, User.username, User.real_name).filter(User.id.in_(ids)).all()
    worker_map = {w.id: w.real_name or w.username for w in workers}

    delta_days = (ed - sd).days + 1
    date_list = [sd + timedelta(days=i) for i in range(delta_days)]
    date_strs = [d.strftime("%m-%d") for d in date_list]

    from app.models import WorkerProduction as WP

    production_q = db.query(
        WP.worker_id,
        WP.production_date,
        func.sum(WP.actual_packaging_quantity).label("qty"),
        func.count(WP.id).label("records"),
    ).filter(
        WP.worker_id.in_(ids),
        WP.production_date.between(sd, ed),
        WP.audit_status == "approved",
    ).group_by(WP.worker_id, WP.production_date).all()

    prod_map: dict = {}
    for r in production_q:
        prod_map.setdefault(r.worker_id, {})[r.production_date] = int(r.qty or 0)

    outbound_q = db.query(
        PrintedLabel.u.label("worker_id"),
        func.date(PrintedLabel.scanned_time).label("d"),
        func.count(PrintedLabel.id).label("outbound"),
    ).filter(
        PrintedLabel.u.in_(ids),
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(sd, ed),
    ).group_by(PrintedLabel.u, func.date(PrintedLabel.scanned_time)).all()

    out_map: dict = {}
    for r in outbound_q:
        out_map.setdefault(r.worker_id, {})[r.d] = int(r.outbound or 0)

    commission_q = db.query(
        PrintedLabel.u.label("worker_id"),
        func.sum(Sku.production_performance).label("commission"),
    ).join(Sku, PrintedLabel.s == Sku.id).filter(
        PrintedLabel.u.in_(ids),
        PrintedLabel.scanned_outbound > 0,
        func.date(PrintedLabel.scanned_time).between(sd, ed),
    ).group_by(PrintedLabel.u).all()
    comm_map = {r.worker_id: round(float(r.commission or 0), 2) for r in commission_q}

    comparison = []
    summary = []
    for wid in ids:
        name = worker_map.get(wid, f"#{wid}")
        w_prod = prod_map.get(wid, {})
        w_out = out_map.get(wid, {})
        daily_production = [w_prod.get(d, 0) for d in date_list]
        daily_outbound = [w_out.get(d, 0) for d in date_list]

        total_prod = sum(daily_production)
        total_out = sum(daily_outbound)
        working_days = sum(1 for v in daily_production if v > 0)
        avg_daily = round(total_prod / working_days, 1) if working_days > 0 else 0
        commission = comm_map.get(wid, 0)

        comparison.append({
            "worker_id": wid,
            "worker_name": name,
            "daily_production": daily_production,
            "daily_outbound": daily_outbound,
        })
        summary.append({
            "worker_id": wid,
            "worker_name": name,
            "total_production": total_prod,
            "total_outbound": total_out,
            "working_days": working_days,
            "avg_daily": avg_daily,
            "commission": commission,
            "max_daily": max(daily_production) if daily_production else 0,
        })

    summary.sort(key=lambda x: x["total_production"], reverse=True)

    worker_options = [{"id": w.id, "name": w.real_name or w.username}
                      for w in db.query(User.id, User.real_name, User.username).filter(User.role == "worker").order_by(User.username).all()]

    return ApiResponse(data={
        "workers": [{"id": wid, "name": worker_map.get(wid, f"#{wid}")} for wid in ids],
        "dates": date_strs,
        "comparison": comparison,
        "summary": summary,
        "worker_options": worker_options,
        "date_range": {"start": str(sd), "end": str(ed)},
    })


@router.get("/comparison-ai")
def comparison_ai(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """AI工人对比分析"""
    from fastapi.responses import StreamingResponse
    import json
    today = date.today()
    d14 = today - timedelta(days=13)
    def _f(v): return float(v) if isinstance(v, Decimal) else (v or 0)

    ctx = [f"对比周期: {d14} ~ {today}"]
    rows = db.query(
        PrintedLabel.u, func.count(PrintedLabel.id).label("printed"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, 1, 0)).label("outbound"),
    ).filter(func.date(PrintedLabel.created_at).between(d14, today)).group_by(PrintedLabel.u).all()
    wids = [r[0] for r in rows]
    wm = {w.id: w.real_name or w.username for w in db.query(User).filter(User.id.in_(wids)).all()} if wids else {}
    ctx.append("工人产量对比:")
    for r in sorted(rows, key=lambda x: int(x.outbound or 0), reverse=True)[:8]:
        rate = round(int(_f(r.outbound)) / max(int(r.printed or 1), 1) * 100, 1)
        ctx.append(f"  {wm.get(r[0], f'#{r[0]}')}: 打印{r.printed} 出库{int(_f(r.outbound))} 出库率{rate}%")

    prompt = f"""分析以下工人产量对比数据。\n\n{chr(10).join(ctx)}\n\n用markdown，含：
1. **整体评价**: 团队产能概况
2. **差距分析**: 头部和尾部差距
3. **效率建议**: 2条提升建议\n简洁，不超150字。"""

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key="sk-b121d7a1020f4c4e9740ec130f359333", base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
            for chunk in client.chat.completions.create(model="qwen-plus", messages=[
                {"role": "system", "content": "你是团队效率分析师。简体中文。"},
                {"role": "user", "content": prompt}], stream=True, temperature=0.3, max_tokens=800):
                if chunk.choices and chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/my-tasks")
def my_tasks(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """工人今日任务清单 — 引导式工作流"""
    from app.models import BatchAssignment, SkuTransaction, FruitPurchase, WorkerProductionEdit
    from app.models.user_message import UserMessage

    today = date.today()
    tasks = []

    # 1. 检查今日批次分配
    assignments = db.query(BatchAssignment).filter(
        BatchAssignment.worker_id == user.id,
        BatchAssignment.assignment_date == today,
    ).all()
    batch_count = len(assignments)
    purchase_ids = [a.purchase_id for a in assignments]

    fruit_names = []
    if purchase_ids:
        fps = db.query(FruitPurchase.fruit_name).filter(
            FruitPurchase.id.in_(purchase_ids)
        ).all()
        fruit_names = list(set(f.fruit_name for f in fps if f.fruit_name))

    tasks.append({
        "key": "batches",
        "title": "查看今日批次",
        "description": f"已分配 {batch_count} 个批次" + (f"（{', '.join(fruit_names[:3])}）" if fruit_names else ""),
        "status": "completed" if batch_count > 0 else "empty",
        "count": batch_count,
        "link": "/production/request",
        "icon": "batch",
    })

    # 2. 检查SKU申请
    today_txns = db.query(func.count(SkuTransaction.id), func.coalesce(func.sum(SkuTransaction.quantity), 0)).filter(
        SkuTransaction.worker_id == user.id,
        func.date(SkuTransaction.transaction_date) == today,
    ).first()
    txn_count = int(today_txns[0] or 0)
    txn_qty = int(today_txns[1] or 0)

    pending_print = 0
    if txn_count > 0:
        pending_print = db.query(func.count(SkuTransaction.id)).filter(
            SkuTransaction.worker_id == user.id,
            func.date(SkuTransaction.transaction_date) == today,
            SkuTransaction.is_printed == False,
        ).scalar() or 0

    tasks.append({
        "key": "requests",
        "title": "SKU申请",
        "description": f"今日 {txn_count} 条申请 ({txn_qty} 件)" + (f"，{pending_print} 条待打印" if pending_print > 0 else ""),
        "status": "warning" if pending_print > 0 else ("completed" if txn_count > 0 else "todo"),
        "count": txn_count,
        "link": "/production/request",
        "icon": "request",
    })

    # 3. 检查标签打印
    today_labels = db.query(func.count(PrintedLabel.id)).filter(
        PrintedLabel.u == user.id,
        func.date(PrintedLabel.created_at) == today,
    ).scalar() or 0

    tasks.append({
        "key": "labels",
        "title": "标签已打印",
        "description": f"今日 {today_labels} 个标签已打印",
        "status": "completed" if today_labels > 0 else "waiting",
        "count": today_labels,
        "link": "/production/input",
        "icon": "print",
    })

    # 4. 检查生产录入
    today_productions = db.query(WorkerProduction).filter(
        WorkerProduction.worker_id == user.id,
        WorkerProduction.production_date == today,
    ).all()
    prod_count = len(today_productions)
    total_qty = sum(p.actual_packaging_quantity or 0 for p in today_productions)

    # SKUs with labels but no production input
    labeled_skus = db.query(PrintedLabel.s).filter(
        PrintedLabel.u == user.id,
        func.date(PrintedLabel.created_at) == today,
    ).distinct().all()
    labeled_sku_ids = set(s[0] for s in labeled_skus)
    recorded_sku_ids = set(p.sku_id for p in today_productions)
    missing_input = len(labeled_sku_ids - recorded_sku_ids)

    tasks.append({
        "key": "production",
        "title": "生产录入",
        "description": f"已录入 {prod_count} 条 ({total_qty} 件)" + (f"，还有 {missing_input} 个SKU未录入" if missing_input > 0 else ""),
        "status": "warning" if missing_input > 0 else ("completed" if prod_count > 0 and missing_input == 0 else "todo"),
        "count": prod_count,
        "warning": missing_input,
        "link": "/production/input",
        "icon": "input",
    })

    # 5. 检查审核状态
    pending_count = sum(1 for p in today_productions if p.audit_status == 'pending')
    approved_count = sum(1 for p in today_productions if p.audit_status == 'approved')
    rejected_count = sum(1 for p in today_productions if p.audit_status == 'rejected')

    tasks.append({
        "key": "audit",
        "title": "审核状态",
        "description": f"通过{approved_count} · 待审{pending_count}" + (f" · 驳回{rejected_count}" if rejected_count > 0 else ""),
        "status": "error" if rejected_count > 0 else ("warning" if pending_count > 0 else ("completed" if approved_count > 0 else "waiting")),
        "count": approved_count,
        "warning": rejected_count,
        "link": "/production/input",
        "icon": "audit",
    })

    # 6. 未读消息
    unread = db.query(func.count(UserMessage.id)).filter(
        UserMessage.user_id == user.id,
        UserMessage.is_read == False,
    ).scalar() or 0

    tasks.append({
        "key": "messages",
        "title": "消息通知",
        "description": f"{unread} 条未读消息" if unread > 0 else "暂无未读消息",
        "status": "warning" if unread > 0 else "completed",
        "count": unread,
        "link": "/messages",
        "icon": "message",
    })

    # Commission estimate
    commission = 0.0
    if today_labels > 0:
        comm_row = db.query(
            func.coalesce(func.sum(Sku.production_performance), 0)
        ).select_from(PrintedLabel).join(
            Sku, PrintedLabel.s == Sku.id
        ).filter(
            PrintedLabel.u == user.id,
            PrintedLabel.scanned_outbound > 0,
            func.date(PrintedLabel.created_at) == today,
        ).scalar()
        commission = float(comm_row or 0)

    progress = sum(1 for t in tasks if t["status"] == "completed") / max(len(tasks), 1) * 100

    return ApiResponse(data={
        "date": today.isoformat(),
        "tasks": tasks,
        "summary": {
            "total_tasks": len(tasks),
            "completed": sum(1 for t in tasks if t["status"] == "completed"),
            "warnings": sum(1 for t in tasks if t["status"] in ("warning", "error")),
            "progress": round(progress, 1),
            "today_commission": commission,
        },
    })


# ─── 工人佣金结算单 ───
@router.get("/settlement")
def worker_settlement(
    worker_id: int | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """生成工人佣金结算单 — 详细到每日每SKU的出库明细"""
    from app.models import FruitPurchase
    today = date.today()
    if not start_date:
        start_date = today.replace(day=1)
    if not end_date:
        end_date = today

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    target_ids = []
    if user.role == "worker":
        target_ids = [user.id]
    elif worker_id:
        target_ids = [worker_id]
    else:
        wids = db.query(User.id).filter(User.role == "worker").all()
        target_ids = [w.id for w in wids]

    if not target_ids:
        return ApiResponse(data={"workers": [], "summary": {}})

    workers_info = {w.id: {"name": w.real_name or w.username, "phone": w.phone or "", "alipay": w.alipay_account or ""}
                    for w in db.query(User).filter(User.id.in_(target_ids)).all()}

    daily_details = db.query(
        PrintedLabel.u.label("worker_id"),
        func.date(PrintedLabel.created_at).label("work_date"),
        Sku.id.label("sku_id"),
        Sku.sku_name,
        Sku.fruit_name,
        Sku.production_performance,
        func.count(PrintedLabel.id).label("printed_count"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, 1, 0)).label("outbound_count"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, Sku.production_performance, 0)).label("commission"),
    ).join(
        Sku, Sku.id == PrintedLabel.s
    ).filter(
        PrintedLabel.u.in_(target_ids),
        func.date(PrintedLabel.created_at).between(start_date, end_date),
    ).group_by(
        PrintedLabel.u, func.date(PrintedLabel.created_at), Sku.id,
        Sku.sku_name, Sku.fruit_name, Sku.production_performance,
    ).all()

    production_map = {}
    prod_rows = db.query(
        WorkerProduction.worker_id,
        WorkerProduction.production_date,
        WorkerProduction.sku_id,
        WorkerProduction.actual_packaging_quantity,
        WorkerProduction.audit_status,
    ).filter(
        WorkerProduction.worker_id.in_(target_ids),
        WorkerProduction.production_date.between(start_date, end_date),
    ).all()
    for pr in prod_rows:
        key = (pr.worker_id, str(pr.production_date), pr.sku_id)
        production_map[key] = {"qty": int(pr.actual_packaging_quantity or 0), "status": pr.audit_status}

    result_workers = {}
    for r in daily_details:
        wid = r.worker_id
        if wid not in result_workers:
            info = workers_info.get(wid, {})
            result_workers[wid] = {
                "worker_id": wid,
                "worker_name": info.get("name", f"#{wid}"),
                "phone": info.get("phone", ""),
                "alipay": info.get("alipay", ""),
                "total_printed": 0,
                "total_outbound": 0,
                "total_commission": 0.0,
                "total_approved_qty": 0,
                "daily_records": [],
                "sku_summary": {},
            }

        wt = result_workers[wid]
        printed = r.printed_count or 0
        outbound = int(_f(r.outbound_count))
        comm = round(_f(r.commission), 2)
        work_date_str = str(r.work_date)

        prod_info = production_map.get((wid, work_date_str, r.sku_id), {})
        approved_qty = prod_info.get("qty", 0) if prod_info.get("status") == "approved" else 0

        wt["total_printed"] += printed
        wt["total_outbound"] += outbound
        wt["total_commission"] += comm
        wt["total_approved_qty"] += approved_qty

        wt["daily_records"].append({
            "date": work_date_str,
            "sku_id": r.sku_id,
            "sku_name": r.sku_name,
            "fruit_name": r.fruit_name,
            "performance": _f(r.production_performance),
            "printed": printed,
            "outbound": outbound,
            "approved_qty": approved_qty,
            "commission": comm,
        })

        sid = r.sku_id
        if sid not in wt["sku_summary"]:
            wt["sku_summary"][sid] = {
                "sku_id": sid, "sku_name": r.sku_name, "fruit_name": r.fruit_name,
                "performance": _f(r.production_performance),
                "printed": 0, "outbound": 0, "commission": 0.0,
            }
        ss = wt["sku_summary"][sid]
        ss["printed"] += printed
        ss["outbound"] += outbound
        ss["commission"] += comm

    for wt in result_workers.values():
        wt["total_commission"] = round(wt["total_commission"], 2)
        wt["sku_summary"] = sorted(wt["sku_summary"].values(), key=lambda x: x["commission"], reverse=True)
        for ss in wt["sku_summary"]:
            ss["commission"] = round(ss["commission"], 2)
        wt["daily_records"].sort(key=lambda x: (x["date"], x["sku_name"]))
        outbound_rate = round(wt["total_outbound"] / wt["total_printed"] * 100, 1) if wt["total_printed"] > 0 else 0
        wt["outbound_rate"] = outbound_rate

    workers_list = sorted(result_workers.values(), key=lambda x: x["total_commission"], reverse=True)

    grand = {
        "total_commission": round(sum(w["total_commission"] for w in workers_list), 2),
        "total_outbound": sum(w["total_outbound"] for w in workers_list),
        "total_printed": sum(w["total_printed"] for w in workers_list),
        "total_approved": sum(w["total_approved_qty"] for w in workers_list),
        "worker_count": len(workers_list),
        "avg_commission": round(sum(w["total_commission"] for w in workers_list) / max(len(workers_list), 1), 2),
    }

    return ApiResponse(data={
        "start_date": str(start_date),
        "end_date": str(end_date),
        "generated_at": today.isoformat(),
        "summary": grand,
        "workers": workers_list,
    })


@router.get("/settlement-ai-analysis")
def settlement_ai_analysis(
    worker_id: int,
    start_date: date | None = None,
    end_date: date | None = None,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """AI分析单个工人的佣金结算数据，发现异常并给出建议"""
    from fastapi.responses import StreamingResponse
    import json

    today = date.today()
    if not start_date:
        start_date = today.replace(day=1)
    if not end_date:
        end_date = today

    def _f(v):
        return float(v) if isinstance(v, Decimal) else (v or 0)

    worker = db.query(User).filter(User.id == worker_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="工人不存在")

    details = db.query(
        func.date(PrintedLabel.created_at).label("work_date"),
        Sku.sku_name,
        Sku.production_performance,
        func.count(PrintedLabel.id).label("printed"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, 1, 0)).label("outbound"),
        func.sum(func.IF(PrintedLabel.scanned_outbound > 0, Sku.production_performance, 0)).label("commission"),
    ).join(Sku, Sku.id == PrintedLabel.s).filter(
        PrintedLabel.u == worker_id,
        func.date(PrintedLabel.created_at).between(start_date, end_date),
    ).group_by(
        func.date(PrintedLabel.created_at), Sku.id, Sku.sku_name, Sku.production_performance,
    ).all()

    ctx_lines = [f"工人: {worker.real_name or worker.username} (ID:{worker.id})"]
    ctx_lines.append(f"结算周期: {start_date} ~ {end_date}")

    total_printed = sum(r.printed or 0 for r in details)
    total_outbound = sum(int(_f(r.outbound)) for r in details)
    total_comm = sum(_f(r.commission) for r in details)
    ctx_lines.append(f"总打印: {total_printed}, 总出库: {total_outbound}, 总佣金: ¥{total_comm:.2f}")
    ctx_lines.append(f"出库率: {total_outbound / total_printed * 100:.1f}%" if total_printed > 0 else "出库率: 无数据")

    daily_map: dict = {}
    for r in details:
        d = str(r.work_date)
        if d not in daily_map:
            daily_map[d] = {"printed": 0, "outbound": 0, "commission": 0.0}
        daily_map[d]["printed"] += r.printed or 0
        daily_map[d]["outbound"] += int(_f(r.outbound))
        daily_map[d]["commission"] += _f(r.commission)

    ctx_lines.append("每日明细:")
    for d in sorted(daily_map.keys()):
        dm = daily_map[d]
        ctx_lines.append(f"  {d}: 打印{dm['printed']} 出库{dm['outbound']} 佣金¥{dm['commission']:.2f}")

    sku_map: dict = {}
    for r in details:
        sn = r.sku_name
        if sn not in sku_map:
            sku_map[sn] = {"printed": 0, "outbound": 0, "commission": 0.0, "perf": _f(r.production_performance)}
        sku_map[sn]["printed"] += r.printed or 0
        sku_map[sn]["outbound"] += int(_f(r.outbound))
        sku_map[sn]["commission"] += _f(r.commission)

    ctx_lines.append("SKU汇总:")
    for sn, sm in sorted(sku_map.items(), key=lambda x: x[1]["commission"], reverse=True):
        ctx_lines.append(f"  {sn}(绩效{sm['perf']:.2f}): 打印{sm['printed']} 出库{sm['outbound']} 佣金¥{sm['commission']:.2f}")

    team_avg = db.query(
        func.avg(func.count(PrintedLabel.id))
    ).filter(
        func.date(PrintedLabel.created_at).between(start_date, end_date),
        PrintedLabel.scanned_outbound > 0,
    ).group_by(PrintedLabel.u).scalar()
    if team_avg:
        ctx_lines.append(f"团队人均出库: {float(team_avg):.0f}")

    worker_data = "\n".join(ctx_lines)

    prompt = f"""请分析以下工人的佣金结算数据，生成结算分析报告。

{worker_data}

请用markdown格式回复，包含：
1. **结算概况**: 1-2句话总结
2. **数据亮点**: 2-3个值得关注的数据点
3. **异常检测**: 是否存在出库率异常低、佣金波动大、某日产量骤降等异常
4. **对比分析**: 与团队平均水平对比
5. **建议**: 1-2条管理建议

保持简洁，不超过250字。"""

    DASHSCOPE_API_KEY = "sk-b121d7a1020f4c4e9740ec130f359333"
    DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    def generate():
        try:
            from openai import OpenAI
            client = OpenAI(api_key=DASHSCOPE_API_KEY, base_url=DASHSCOPE_BASE_URL)
            resp = client.chat.completions.create(
                model="qwen-plus",
                messages=[
                    {"role": "system", "content": "你是果管系统的佣金结算分析顾问。回复使用简体中文，简洁专业。"},
                    {"role": "user", "content": prompt},
                ],
                stream=True, temperature=0.2, max_tokens=1500,
            )
            for chunk in resp:
                if chunk.choices and chunk.choices[0].delta.content:
                    data = json.dumps({"content": chunk.choices[0].delta.content}, ensure_ascii=False)
                    yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            err = json.dumps({"error": f"AI分析暂不可用: {str(e)}"}, ensure_ascii=False)
            yield f"data: {err}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
