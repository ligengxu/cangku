from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from app.database import get_db
from app.models.user import User
from app.models.login_attempt import LoginAttempt
from app.models.activity_log import ActivityLog
from app.schemas.auth import LoginRequest, TokenResponse, UserInfo, ChangePasswordRequest, ProfileUpdate, ProfileOut
from app.schemas.common import ApiResponse
from app.middleware.auth import (
    verify_password, hash_password, create_token, get_current_user
)

router = APIRouter(prefix="/auth", tags=["认证"])

MAX_ATTEMPTS = 10
LOCKOUT_MINUTES = 15


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_rate_limit(db: Session, ip: str, username: str) -> None:
    cutoff = datetime.now() - timedelta(minutes=LOCKOUT_MINUTES)
    recent = db.query(func.count(LoginAttempt.id)).filter(
        LoginAttempt.ip_address == ip,
        LoginAttempt.attempt_time >= cutoff,
    ).scalar() or 0
    if recent >= MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail=f"登录尝试过于频繁，请 {LOCKOUT_MINUTES} 分钟后再试",
        )


def _record_attempt(db: Session, ip: str, username: str) -> None:
    attempt = LoginAttempt(ip_address=ip, username=username)
    db.add(attempt)
    try:
        db.commit()
    except Exception:
        db.rollback()


@router.post("/login", response_model=ApiResponse[TokenResponse])
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = _get_client_ip(request)
    _check_rate_limit(db, ip, req.username)

    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password):
        _record_attempt(db, ip, req.username)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    token, expires_in = create_token(user.id, user.username, user.role, req.remember)

    try:
        ua = request.headers.get("user-agent", "")
        log = ActivityLog(
            user_id=user.id,
            username=user.username,
            action=f"用户登录 ({user.role})",
            login_ip=ip,
            user_agent=ua[:500] if ua else None,
        )
        db.add(log)
        db.commit()
    except Exception:
        db.rollback()

    return ApiResponse(data=TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserInfo(
            user_id=user.id,
            username=user.username,
            role=user.role,
            real_name=user.real_name,
        ),
    ))


@router.get("/me", response_model=ApiResponse[UserInfo])
def get_me(user: User = Depends(get_current_user)):
    return ApiResponse(data=UserInfo(
        user_id=user.id,
        username=user.username,
        role=user.role,
        real_name=user.real_name,
    ))


@router.post("/change-password", response_model=ApiResponse)
def change_password(
    req: ChangePasswordRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(req.old_password, user.password):
        raise HTTPException(status_code=400, detail="原密码错误")
    user.password = hash_password(req.new_password)
    db.commit()
    return ApiResponse(message="密码修改成功")


@router.get("/profile", response_model=ApiResponse[ProfileOut])
def get_profile(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.models import WorkerProduction, PrintedLabel, ActionLog
    from sqlalchemy import func

    from app.models import Sku, SkuTransaction
    from datetime import date as d_date, timedelta

    stats: dict = {}
    badges: list = []
    today = d_date.today()
    month_start = today.replace(day=1)

    if user.role == "worker":
        from sqlalchemy import text

        total_production = db.query(
            func.sum(WorkerProduction.actual_packaging_quantity)
        ).filter(
            WorkerProduction.worker_id == user.id,
            WorkerProduction.audit_status == "approved",
        ).scalar() or 0
        total_labels = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.u == user.id
        ).scalar() or 0
        total_outbound = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.u == user.id, PrintedLabel.scanned_outbound > 0
        ).scalar() or 0
        working_days = db.query(
            func.count(func.distinct(WorkerProduction.production_date))
        ).filter(WorkerProduction.worker_id == user.id).scalar() or 0

        month_production = db.query(
            func.sum(WorkerProduction.actual_packaging_quantity)
        ).filter(
            WorkerProduction.worker_id == user.id,
            WorkerProduction.audit_status == "approved",
            WorkerProduction.production_date >= month_start,
        ).scalar() or 0

        month_labels = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.u == user.id, PrintedLabel.created_at >= month_start
        ).scalar() or 0
        month_outbound = db.query(func.count(PrintedLabel.id)).filter(
            PrintedLabel.u == user.id, PrintedLabel.scanned_outbound > 0,
            PrintedLabel.created_at >= month_start
        ).scalar() or 0

        month_working_days = db.query(
            func.count(func.distinct(WorkerProduction.production_date))
        ).filter(
            WorkerProduction.worker_id == user.id,
            WorkerProduction.production_date >= month_start,
        ).scalar() or 0

        month_sku_count = db.query(func.count(func.distinct(PrintedLabel.s))).filter(
            PrintedLabel.u == user.id, PrintedLabel.created_at >= month_start
        ).scalar() or 0

        month_outbound_rate = round(month_outbound / month_labels * 100, 1) if month_labels > 0 else 0

        total_commission = 0
        month_commission = 0
        try:
            r = db.execute(text("""
                SELECT COALESCE(SUM(s.production_performance), 0) as c
                FROM printed_labels pl JOIN sku s ON pl.s=s.id
                WHERE pl.u=:wid AND pl.scanned_outbound>0
            """), {"wid": user.id}).mappings().first()
            total_commission = float(r['c']) if r else 0

            r2 = db.execute(text("""
                SELECT COALESCE(SUM(s.production_performance), 0) as c
                FROM printed_labels pl JOIN sku s ON pl.s=s.id
                WHERE pl.u=:wid AND pl.scanned_outbound>0
                AND pl.created_at >= :month_start
            """), {"wid": user.id, "month_start": month_start}).mappings().first()
            month_commission = float(r2['c']) if r2 else 0
        except Exception:
            pass

        sku_count = db.query(func.count(func.distinct(PrintedLabel.s))).filter(
            PrintedLabel.u == user.id
        ).scalar() or 0

        stats = {
            "total_production": int(total_production),
            "total_labels": total_labels,
            "total_outbound": total_outbound,
            "working_days": working_days,
            "total_commission": round(total_commission, 2),
            "sku_count": sku_count,
            "outbound_rate": round(total_outbound / total_labels * 100, 1) if total_labels > 0 else 0,
            "month_production": int(month_production),
            "month_labels": month_labels,
            "month_outbound": month_outbound,
            "month_working_days": month_working_days,
            "month_commission": round(month_commission, 2),
            "month_sku_count": month_sku_count,
            "month_outbound_rate": month_outbound_rate,
        }

        if total_labels >= 10000: badges.append({"icon": "🏆", "name": "万标达人", "desc": f"累计打印{total_labels}张标签"})
        elif total_labels >= 5000: badges.append({"icon": "🥇", "name": "五千标签", "desc": f"累计打印{total_labels}张标签"})
        elif total_labels >= 1000: badges.append({"icon": "🥈", "name": "千标工匠", "desc": f"累计打印{total_labels}张标签"})
        if working_days >= 100: badges.append({"icon": "💪", "name": "百日老兵", "desc": f"累计工作{working_days}天"})
        elif working_days >= 30: badges.append({"icon": "⭐", "name": "月度之星", "desc": f"累计工作{working_days}天"})
        if total_commission >= 1000: badges.append({"icon": "💰", "name": "千元佣金", "desc": f"累计佣金¥{total_commission:.0f}"})
        if sku_count >= 10: badges.append({"icon": "🎯", "name": "多面手", "desc": f"参与{sku_count}种SKU"})
        if stats["outbound_rate"] >= 90: badges.append({"icon": "🚀", "name": "高效达人", "desc": f"出库率{stats['outbound_rate']}%"})
    else:
        total_actions = db.query(func.count(ActionLog.id)).filter(
            ActionLog.username == user.username,
        ).scalar() or 0

        total_labels = db.query(func.count(PrintedLabel.id)).scalar() or 0
        total_workers = db.query(func.count(User.id)).filter(User.role == "worker").scalar() or 0
        total_purchases = db.query(func.count(func.distinct(PrintedLabel.b))).scalar() or 0

        stats = {
            "total_actions": total_actions,
            "total_labels": total_labels,
            "total_workers": total_workers,
            "total_purchases": total_purchases,
        }
        if total_actions >= 1000: badges.append({"icon": "📊", "name": "操作达人", "desc": f"累计{total_actions}次操作"})
        if total_workers >= 10: badges.append({"icon": "👥", "name": "团队管理", "desc": f"管理{total_workers}名工人"})

    stats["badges"] = badges

    return ApiResponse(data=ProfileOut(
        user_id=user.id,
        username=user.username,
        role=user.role,
        real_name=user.real_name,
        phone=user.phone,
        alipay_account=user.alipay_account,
        created_stats=stats,
    ))


@router.put("/profile", response_model=ApiResponse)
def update_profile(
    req: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if req.real_name is not None:
        real_name = req.real_name.strip()
        if len(real_name) > 50:
            raise HTTPException(status_code=400, detail="真实姓名不能超过50个字符")
        user.real_name = real_name if real_name else None
    if req.phone is not None:
        phone = req.phone.strip()
        if phone and len(phone) > 20:
            raise HTTPException(status_code=400, detail="手机号格式不正确")
        user.phone = phone if phone else None
    if req.alipay_account is not None:
        alipay = req.alipay_account.strip()
        if alipay and len(alipay) > 100:
            raise HTTPException(status_code=400, detail="支付宝账号不能超过100个字符")
        user.alipay_account = alipay if alipay else None
    db.commit()
    return ApiResponse(message="个人信息更新成功")
