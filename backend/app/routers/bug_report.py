from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from datetime import datetime
from typing import Optional
from app.database import get_db
from app.models.bug_report import BugReport
from app.models.user import User
from app.middleware.auth import get_current_user, require_admin
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/bugs", tags=["BUG反馈"])


class BugSubmit(BaseModel):
    title: str
    description: str
    page_url: str = ""
    priority: str = "medium"


class BugUpdate(BaseModel):
    status: Optional[str] = None
    fix_note: Optional[str] = None
    priority: Optional[str] = None


@router.post("", response_model=ApiResponse)
def submit_bug(
    req: BugSubmit,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="标题不能为空")
    if not req.description.strip():
        raise HTTPException(status_code=400, detail="描述不能为空")
    if len(req.title) > 200:
        raise HTTPException(status_code=400, detail="标题不超过200字")
    if len(req.description) > 5000:
        raise HTTPException(status_code=400, detail="描述不超过5000字")
    if req.priority not in ("low", "medium", "high", "critical"):
        req.priority = "medium"

    bug = BugReport(
        title=req.title.strip(),
        description=req.description.strip(),
        page_url=req.page_url.strip() if req.page_url else "",
        priority=req.priority,
        submitted_by=user.id,
        submitted_name=user.real_name or user.username,
    )
    db.add(bug)
    db.commit()
    db.refresh(bug)
    return ApiResponse(message="BUG已提交，感谢反馈！", data={"id": bug.id})


@router.get("", response_model=ApiResponse)
def list_bugs(
    page: int = 1,
    page_size: int = 20,
    status: str = "",
    priority: str = "",
    mine: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(BugReport)
    if mine and user.role != "admin":
        q = q.filter(BugReport.submitted_by == user.id)
    if status:
        q = q.filter(BugReport.status == status)
    if priority:
        q = q.filter(BugReport.priority == priority)

    total = q.count()
    items = q.order_by(desc(BugReport.id)).offset((page - 1) * page_size).limit(page_size).all()

    result = []
    for b in items:
        result.append({
            "id": b.id,
            "title": b.title,
            "description": b.description,
            "page_url": b.page_url or "",
            "priority": b.priority,
            "status": b.status,
            "submitted_by": b.submitted_by,
            "submitted_name": b.submitted_name or "",
            "fixed_by": b.fixed_by,
            "fixed_name": b.fixed_name or "",
            "fix_note": b.fix_note or "",
            "created_at": b.created_at.isoformat() if b.created_at else None,
            "updated_at": b.updated_at.isoformat() if b.updated_at else None,
            "fixed_at": b.fixed_at.isoformat() if b.fixed_at else None,
        })

    return ApiResponse(data={"items": result, "total": total, "page": page, "page_size": page_size})


@router.get("/stats")
def bug_stats(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    open_count = db.query(func.count(BugReport.id)).filter(BugReport.status == "open").scalar() or 0
    fixing_count = db.query(func.count(BugReport.id)).filter(BugReport.status == "fixing").scalar() or 0
    fixed_count = db.query(func.count(BugReport.id)).filter(BugReport.status == "fixed").scalar() or 0
    closed_count = db.query(func.count(BugReport.id)).filter(BugReport.status == "closed").scalar() or 0
    total = db.query(func.count(BugReport.id)).scalar() or 0

    my_count = 0
    if user.role != "admin":
        my_count = db.query(func.count(BugReport.id)).filter(BugReport.submitted_by == user.id).scalar() or 0

    return ApiResponse(data={
        "open": open_count,
        "fixing": fixing_count,
        "fixed": fixed_count,
        "closed": closed_count,
        "total": total,
        "my_count": my_count,
    })


@router.put("/{bug_id}", response_model=ApiResponse)
def update_bug(
    bug_id: int,
    req: BugUpdate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    bug = db.query(BugReport).filter(BugReport.id == bug_id).first()
    if not bug:
        raise HTTPException(status_code=404, detail="BUG不存在")

    if req.status:
        if req.status not in ("open", "fixing", "fixed", "closed", "wontfix"):
            raise HTTPException(status_code=400, detail="无效状态")
        old_status = bug.status
        bug.status = req.status
        if req.status in ("fixed", "closed"):
            bug.fixed_by = user.id
            bug.fixed_name = user.real_name or user.username
            bug.fixed_at = datetime.now()

    if req.fix_note is not None:
        bug.fix_note = req.fix_note.strip()

    if req.priority and req.priority in ("low", "medium", "high", "critical"):
        bug.priority = req.priority

    db.commit()
    return ApiResponse(message="已更新")


@router.delete("/{bug_id}", response_model=ApiResponse)
def delete_bug(
    bug_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    bug = db.query(BugReport).filter(BugReport.id == bug_id).first()
    if not bug:
        raise HTTPException(status_code=404, detail="BUG不存在")
    db.delete(bug)
    db.commit()
    return ApiResponse(message="已删除")
