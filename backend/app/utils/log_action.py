"""Utility to create ActionLog entries for key operations."""

from contextvars import ContextVar
from sqlalchemy.orm import Session
from app.models.action_log import ActionLog
from app.models.user import User

_request_ip: ContextVar[str] = ContextVar("request_ip", default="")


def set_request_ip(ip: str) -> None:
    _request_ip.set(ip)


def get_request_ip() -> str:
    return _request_ip.get("")


def log_action(
    db: Session,
    user: User,
    action: str,
    data_before: str | None = None,
    data_after: str | None = None,
    ip: str | None = None,
):
    resolved_ip = ip or get_request_ip() or None
    entry = ActionLog(
        user_id=user.id,
        username=user.real_name or user.username,
        action=action,
        data_before=data_before,
        data_after=data_after,
        ip_address=resolved_ip,
    )
    db.add(entry)
    try:
        db.flush()
    except Exception:
        pass
