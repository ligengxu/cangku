from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session
from app.config import get_settings
from app.database import get_db
from app.models.user import User
import bcrypt as _bcrypt

settings = get_settings()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    # PHP bcrypt uses $2y$ prefix, Python uses $2b$
    normalized = hashed.replace("$2y$", "$2b$", 1) if hashed.startswith("$2y$") else hashed
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), normalized.encode("utf-8"))
    except Exception:
        return False


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def create_token(user_id: int, username: str, role: str, remember: bool = False) -> tuple[str, int]:
    if remember:
        expires_delta = timedelta(days=settings.JWT_REMEMBER_DAYS)
    else:
        expires_delta = timedelta(hours=settings.JWT_EXPIRE_HOURS)

    expires_in = int(expires_delta.total_seconds())
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": datetime.now(timezone.utc) + expires_delta,
        "iat": datetime.now(timezone.utc),
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, expires_in


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期，请重新登录")


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    token = None
    if credentials:
        token = credentials.credentials
    if not token:
        token = request.cookies.get("jwt_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录，请先登录")

    payload = decode_token(token)
    user_id = int(payload.get("sub", 0))
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户不存在")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限访问此资源")
    return user


async def require_worker(user: User = Depends(get_current_user)) -> User:
    if user.role != "worker":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权限访问此资源")
    return user
