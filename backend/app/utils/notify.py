"""智能通知工具 — 自动生成业务通知"""

from sqlalchemy.orm import Session
from app.models.user_message import UserMessage


def notify_user(
    db: Session,
    user_id: int,
    title: str,
    content: str = "",
    msg_type: str = "system",
    link: str = "",
):
    db.add(UserMessage(
        user_id=user_id,
        title=title,
        content=content,
        msg_type=msg_type,
        link=link,
    ))


def notify_batch_assigned(db: Session, worker_ids: list[int], purchase_id: int, fruit_name: str, assign_date: str):
    for wid in worker_ids:
        notify_user(
            db, wid,
            title=f"新批次分配：{fruit_name}",
            content=f"管理员已将批次#{purchase_id}（{fruit_name}）分配给你，日期：{assign_date}。请及时前往SKU申请页面提交生产申请。",
            msg_type="assignment",
            link="/production/request",
        )


def notify_low_stock(db: Session, admin_ids: list[int], box_type: str, current_qty: int, threshold: int):
    for uid in admin_ids:
        notify_user(
            db, uid,
            title=f"库存预警：{box_type}",
            content=f"{box_type}当前库存{current_qty}，低于预警阈值{threshold}，请及时采购补货。",
            msg_type="alert",
            link="/inventory/alerts",
        )


def notify_weight_anomaly(db: Session, admin_ids: list[int], label_id: int, diff: float, worker_name: str):
    for uid in admin_ids:
        notify_user(
            db, uid,
            title=f"重量异常：标签#{label_id}",
            content=f"工人{worker_name}的标签#{label_id}重量差异{diff:.2f}g，超出允许范围。",
            msg_type="alert",
            link="/reports/weight",
        )


def notify_sku_request(db: Session, admin_ids: list[int], worker_name: str, sku_name: str, quantity: int):
    for uid in admin_ids:
        notify_user(
            db, uid,
            title=f"新SKU申请：{worker_name}",
            content=f"{worker_name}申请了{sku_name} × {quantity}，请前往标签打印页面处理。",
            msg_type="production",
            link="/production/print",
        )
