from fastapi import APIRouter, Depends, Request, HTTPException, Query
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session
from sqlalchemy import func, desc, and_
from datetime import date, datetime
from app.database import get_db
from app.models import PrintedLabel, Sku, User, WeightSetting, FailureLog, Machine
from app.models.upload_record import UploadRecord
from app.utils.cache import cache_clear_prefix
from app.middleware.auth import get_current_user, require_admin
from app.models.user import User as UserModel
from app.utils.log_action import log_action
import re
import os
import json
import base64

router = APIRouter(prefix="/device", tags=["设备接口"])


# ─── 机器管理 CRUD ───

class MachineCreate(BaseModel):
    machine_number: str
    name: str = ""

    @field_validator("machine_number")
    @classmethod
    def must_be_numeric(cls, v: str) -> str:
        v = v.strip()
        if not v or not re.match(r"^\d+$", v):
            raise ValueError("机器号必须是纯数字")
        return v


class MachineUpdate(BaseModel):
    machine_number: str | None = None
    name: str | None = None
    status: str | None = None

    @field_validator("machine_number")
    @classmethod
    def must_be_numeric(cls, v: str | None) -> str | None:
        if v is not None:
            v = v.strip()
            if not re.match(r"^\d+$", v):
                raise ValueError("机器号必须是纯数字")
        return v


@router.get("/machines")
def list_machines(db: Session = Depends(get_db)):
    today = date.today()
    machines = db.query(Machine).order_by(Machine.id).all()

    result = []
    for m in machines:
        today_ok = db.query(func.count(UploadRecord.id)).filter(
            UploadRecord.machine_number == m.machine_number,
            UploadRecord.is_success == True,
            func.date(UploadRecord.upload_time) == today,
        ).scalar() or 0
        today_fail = db.query(func.count(UploadRecord.id)).filter(
            UploadRecord.machine_number == m.machine_number,
            UploadRecord.is_success == False,
            func.date(UploadRecord.upload_time) == today,
        ).scalar() or 0
        last_active = db.query(func.max(UploadRecord.upload_time)).filter(
            UploadRecord.machine_number == m.machine_number,
        ).scalar()
        total_scans = db.query(func.count(UploadRecord.id)).filter(
            UploadRecord.machine_number == m.machine_number,
        ).scalar() or 0

        heartbeat_time = m.updated_at
        effective_active = max(
            last_active or datetime.min,
            heartbeat_time or datetime.min,
        ) if (last_active or heartbeat_time) else None

        result.append({
            "id": m.id,
            "machine_number": m.machine_number,
            "name": m.name or "",
            "status": m.status or "online",
            "total_scans": total_scans,
            "today_success": today_ok,
            "today_fail": today_fail,
            "last_active": effective_active.strftime('%Y-%m-%d %H:%M:%S') if effective_active else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        })
    return {"success": True, "data": result}


@router.post("/machines")
def create_machine(
    req: MachineCreate,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    existing = db.query(Machine).filter(Machine.machine_number == req.machine_number).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"机器号 {req.machine_number} 已存在")

    m = Machine(machine_number=req.machine_number, name=req.name or f"机器{req.machine_number}")
    db.add(m)
    log_action(db, user, f"新建称重机 #{req.machine_number}（{req.name}）")
    db.commit()
    db.refresh(m)
    return {"success": True, "message": f"机器 {req.machine_number} 创建成功", "data": {
        "id": m.id, "machine_number": m.machine_number, "name": m.name,
    }}


@router.put("/machines/{machine_id}")
def update_machine(
    machine_id: int,
    req: MachineUpdate,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="机器不存在")

    old_number = m.machine_number
    changes = []

    if req.machine_number is not None and req.machine_number != m.machine_number:
        dup = db.query(Machine).filter(Machine.machine_number == req.machine_number, Machine.id != machine_id).first()
        if dup:
            raise HTTPException(status_code=400, detail=f"机器号 {req.machine_number} 已被占用")
        db.execute(
            UploadRecord.__table__.update()
            .where(UploadRecord.machine_number == old_number)
            .values(machine_number=req.machine_number)
        )
        m.machine_number = req.machine_number
        changes.append(f"编号 {old_number}→{req.machine_number}")

    if req.name is not None:
        m.name = req.name
        changes.append(f"名称→{req.name}")

    if req.status is not None and req.status in ("online", "offline", "disabled"):
        m.status = req.status
        changes.append(f"状态→{req.status}")

    if changes:
        log_action(db, user, f"修改称重机 #{old_number}：{'，'.join(changes)}")

    db.commit()
    return {"success": True, "message": "修改成功"}


@router.delete("/machines/{machine_id}")
def delete_machine(
    machine_id: int,
    user: UserModel = Depends(require_admin),
    db: Session = Depends(get_db),
):
    m = db.query(Machine).filter(Machine.id == machine_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="机器不存在")

    log_action(db, user, f"删除称重机 #{m.machine_number}（{m.name}）")
    db.delete(m)
    db.commit()
    return {"success": True, "message": f"机器 {m.machine_number} 已删除"}


# ─── 海康威视扫码数据接收（无需认证） ───

@router.get("/scan-push")
async def device_scan_push_get(
    request: Request,
    code: str = "", weight: float = 0, metion: str = "",
    machine_number: str = "", machine: str = "", tickets_num: str = "",
    barcode: str = "", device_id: str = "",
    db: Session = Depends(get_db),
):
    """GET方式接收扫码数据（兼容海康威视HTTP输出插件）"""
    body = {
        "code": code, "weight": weight, "metion": metion,
        "machine_number": machine_number, "machine": machine,
        "tickets_num": tickets_num, "barcode": barcode, "device_id": device_id,
    }
    return await _process_scan_push(body, db)


@router.post("/scan-push")
async def device_scan_push(request: Request, db: Session = Depends(get_db)):
    content_type = request.headers.get("content-type", "")
    if "json" in content_type:
        body = await request.json()
    else:
        form = await request.form()
        body = dict(form)
    return await _process_scan_push(body, db)


async def _process_scan_push(body: dict, db: Session):
    """统一处理扫码推送数据"""
    tickets_num = str(body.get("tickets_num") or body.get("barcode") or body.get("code") or "")
    express_number = str(body.get("express_number") or "")
    weight = float(body.get("weight", 0) or 0)
    machine_number = str(body.get("machine_number") or body.get("machine") or body.get("device_id") or body.get("metion") or "unknown")
    client_version = str(body.get("client_version") or "")
    decode_info_raw = body.get("decode_info")
    decode_info_str = json.dumps(decode_info_raw, ensure_ascii=False) if decode_info_raw else None

    if not tickets_num and not express_number:
        db.add(UploadRecord(tickets_num="", weight=weight, is_success=False, message="条码为空", upload_time=datetime.now(), machine_number=machine_number, client_version=client_version, decode_info=decode_info_str))
        db.commit()
        return {"success": False, "message": "条码为空"}

    # 只有快递码没有内部单号 → 记录下来，标记成功但提示缺单号
    if not tickets_num and express_number:
        db.add(UploadRecord(tickets_num="", express_number=express_number, weight=weight,
                            is_success=True, message=f"仅快递码出库(无内部单号)",
                            upload_time=datetime.now(), machine_number=machine_number,
                            client_version=client_version, decode_info=decode_info_str))
        db.commit()
        return {"success": True, "message": f"仅快递码出库: {express_number}", "data": {"express_number": express_number}}

    label_id = None
    raw = tickets_num.strip()
    if len(raw) > 2 and raw.isdigit():
        label_id = int(raw[2:])
    elif raw.isdigit():
        label_id = int(raw)

    if not label_id or label_id <= 0:
        db.add(UploadRecord(tickets_num=tickets_num, express_number=express_number, weight=weight, is_success=False, message=f"条码格式无效: {tickets_num}", upload_time=datetime.now(), machine_number=machine_number, client_version=client_version, decode_info=decode_info_str))
        db.commit()
        return {"success": False, "message": f"条码格式无效: {tickets_num}"}

    label = db.query(PrintedLabel).filter(PrintedLabel.id == label_id).first()
    sku_name = ""
    worker_name = ""
    estimated_weight = 0.0
    if label:
        sku = db.query(Sku.sku_name).filter(Sku.id == label.s).first()
        sku_name = sku.sku_name if sku else ""
        worker = db.query(User.real_name, User.username).filter(User.id == label.u).first()
        worker_name = (worker.real_name or worker.username) if worker else ""
        estimated_weight = float(label.estimated_weight or 0)

    if not label:
        db.add(UploadRecord(tickets_num=tickets_num, express_number=express_number, weight=weight, is_success=False, message=f"标签#{label_id}不存在", upload_time=datetime.now(), worker_name=worker_name, machine_number=machine_number, client_version=client_version, decode_info=decode_info_str))
        db.add(FailureLog(tickets_num=label_id, user_id=0, worker_id=0, sku_id=0, batch_id=0, failure_reason=f"标签#{label_id}不存在", scanned_weight=weight))
        db.commit()
        return {"success": False, "message": f"标签#{label_id}不存在"}

    is_rescan = False
    if label.scanned_outbound and label.scanned_outbound > 0:
        if label.weight_abnormal:
            is_rescan = True
        else:
            scanned_str = label.scanned_time.strftime('%m-%d %H:%M') if label.scanned_time else '未知时间'
            db.add(UploadRecord(tickets_num=tickets_num, express_number=express_number, weight=weight, is_success=False, message=f"重复扫码，已于{scanned_str}出库", upload_time=datetime.now(), worker_name=worker_name, machine_number=machine_number, client_version=client_version, decode_info=decode_info_str))
            db.add(FailureLog(tickets_num=label_id, user_id=0, worker_id=label.u or 0, sku_id=label.s or 0, batch_id=label.b or 0, failure_reason=f"重复扫码，已于{scanned_str}出库", scanned_weight=weight))
            db.commit()
            return {"success": False, "message": f"重复扫码，该标签已于{scanned_str}出库"}

    weight_diff = 0.0
    weight_warning = None
    weight_exceeded = False
    est = estimated_weight
    if weight > 0:
        weight_diff = round(weight - est, 2)
        ws = db.query(WeightSetting).order_by(desc(WeightSetting.id)).first()
        max_diff = float(ws.max_weight_difference) if ws else 999
        max_pct = float(ws.max_weight_percentage) if ws and ws.max_weight_percentage else None
        diff_abs = abs(weight_diff)
        weight_exceeded = diff_abs > max_diff
        if max_pct and est > 0:
            weight_exceeded = weight_exceeded or (diff_abs / est) * 100 > max_pct
        if weight_exceeded:
            db.add(FailureLog(tickets_num=label_id, user_id=0, worker_id=label.u or 0, sku_id=label.s or 0, batch_id=label.b or 0, failure_reason=f"重量差值过大：预估{est}kg 实际{weight}kg 差值{weight_diff}kg", scanned_weight=weight))
            weight_warning = f"重量差异超标：差值{weight_diff}kg"

    if is_rescan and not weight_exceeded:
        label.actual_weight = weight if weight > 0 else label.actual_weight
        label.weight_abnormal = False
        label.weight_fixed = True
        label.weight_fixed_time = datetime.now()
        label.scanned_time = datetime.now()
        if express_number:
            label.express_number = express_number
        msg = "重新扫码成功，重量已修正"
        db.add(UploadRecord(tickets_num=tickets_num, express_number=express_number, weight=weight, is_success=True, message=msg, upload_time=datetime.now(), weight_difference=weight_diff if weight > 0 else None, worker_name=worker_name, machine_number=machine_number, client_version=client_version, decode_info=decode_info_str))
        db.commit()
        cache_clear_prefix("dashboard")
        return {"success": True, "message": msg, "data": {"label_id": label_id, "sku_name": sku_name, "worker_name": worker_name, "estimated_weight": est, "actual_weight": weight, "weight_difference": weight_diff, "weight_fixed": True, "express_number": express_number}}

    if is_rescan and weight_exceeded:
        label.actual_weight = weight if weight > 0 else label.actual_weight
        label.scanned_time = datetime.now()
        if express_number:
            label.express_number = express_number
        msg = f"重新扫码但重量仍异常（{weight_warning}）"
        db.add(UploadRecord(tickets_num=tickets_num, express_number=express_number, weight=weight, is_success=True, message=msg, upload_time=datetime.now(), weight_difference=weight_diff if weight > 0 else None, worker_name=worker_name, machine_number=machine_number, client_version=client_version, decode_info=decode_info_str))
        db.commit()
        return {"success": True, "message": msg, "data": {"label_id": label_id, "sku_name": sku_name, "worker_name": worker_name, "estimated_weight": est, "actual_weight": weight, "weight_difference": weight_diff, "weight_abnormal": True, "express_number": express_number}}

    label.scanned_outbound = 1
    label.scanned_time = datetime.now()
    if weight > 0:
        label.actual_weight = weight
    if express_number:
        label.express_number = express_number
    if weight_exceeded:
        label.weight_abnormal = True
        label.weight_fixed = False

    msg = "出库成功"
    if express_number:
        msg += f"（快递: {express_number}）"
    if weight_warning:
        msg += f"（{weight_warning}，已标记异常）"

    db.add(UploadRecord(tickets_num=tickets_num, express_number=express_number, weight=weight, is_success=True, message=msg, upload_time=datetime.now(), weight_difference=weight_diff if weight > 0 else None, worker_name=worker_name, machine_number=machine_number, client_version=client_version, decode_info=decode_info_str))
    db.commit()
    cache_clear_prefix("dashboard")
    return {"success": True, "message": msg, "data": {"label_id": label_id, "sku_name": sku_name, "worker_name": worker_name, "estimated_weight": est, "actual_weight": weight, "weight_difference": weight_diff, "weight_abnormal": weight_exceeded, "express_number": express_number}}


# ─── 轮询API（扫码员报数页面用，无需JWT） ───

@router.get("/latest-records/{machine_number}/{last_id}")
def device_latest_records(machine_number: str, last_id: int = 0, db: Session = Depends(get_db)):
    records = db.query(UploadRecord).filter(
        UploadRecord.machine_number == machine_number,
        UploadRecord.id > last_id,
        func.date(UploadRecord.upload_time) == date.today(),
    ).order_by(UploadRecord.id.asc()).limit(50).all()

    scan_count = db.query(func.count(UploadRecord.id)).filter(
        UploadRecord.machine_number == machine_number, UploadRecord.is_success == True,
        func.date(UploadRecord.upload_time) == date.today(),
    ).scalar() or 0
    fail_count = db.query(func.count(UploadRecord.id)).filter(
        UploadRecord.machine_number == machine_number, UploadRecord.is_success == False,
        func.date(UploadRecord.upload_time) == date.today(),
    ).scalar() or 0

    items = []
    for r in records:
        est_weight = 0.0
        sku_name = ""
        raw = (r.tickets_num or "").strip()
        if raw.isdigit() and len(raw) > 2:
            lid = int(raw[2:])
            row = db.query(PrintedLabel.estimated_weight, PrintedLabel.s).filter(PrintedLabel.id == lid).first()
            if row:
                est_weight = float(row.estimated_weight or 0)
                sku_row = db.query(Sku.sku_name).filter(Sku.id == row.s).first()
                sku_name = sku_row.sku_name if sku_row else ""
        items.append({
            "id": r.id, "tickets_num": r.tickets_num,
            "weight": float(r.weight) if r.weight else 0,
            "estimated_weight": est_weight, "sku_name": sku_name,
            "is_success": bool(r.is_success), "message": r.message or "",
            "upload_time": r.upload_time.isoformat() if r.upload_time else None,
            "weight_difference": float(r.weight_difference) if r.weight_difference else 0,
            "worker_name": r.worker_name or "",
        })
    return {"success": True, "data": {"records": items, "scan_count": scan_count, "fail_count": fail_count, "machine_number": machine_number}}


# ─── 扫码员报数页面（纯HTML，无需登录） ───

@router.get("/scan-dashboard", response_class=HTMLResponse)
def scan_dashboard_page():
    return SCAN_DASHBOARD_HTML


@router.post("/heartbeat/{machine_number}")
def machine_heartbeat(machine_number: str, db: Session = Depends(get_db)):
    """机器心跳 — 报数页面定期调用，更新机器在线状态"""
    m = db.query(Machine).filter(Machine.machine_number == machine_number).first()
    if not m:
        return {"success": False, "message": "机器不存在"}
    if m.status != 'disabled':
        m.status = 'online'
    m.updated_at = datetime.now()
    db.commit()
    return {"success": True, "machine": machine_number, "status": m.status}


@router.get("/scan-monitor", response_class=HTMLResponse)
def scan_monitor_page(machine: str = ""):
    return SCAN_MONITOR_HTML.replace("__MACHINE__", machine)


@router.get("/scan-monitor-download")
def download_scan_monitor():
    """下载扫码监控客户端EXE (Go v4.2)"""
    import os
    from fastapi.responses import FileResponse
    static = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
    exe_path = os.path.join(static, "fruit-scanner.exe")
    if not os.path.exists(exe_path):
        exe_path = os.path.join(static, "scan-monitor.exe")
    if not os.path.exists(exe_path):
        raise HTTPException(status_code=404, detail="客户端文件不存在")
    fname = os.path.basename(exe_path)
    return FileResponse(
        path=exe_path, filename=fname, media_type="application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={fname}"},
    )


@router.get("/scan-monitor-download-py")
def download_py_client():
    """下载Python GUI客户端（始终读取最新版）"""
    import os
    from fastapi.responses import FileResponse
    source = "/opt/1panel/www/sites/mz24639/index/auto_system.py"
    if not os.path.exists(source):
        static = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
        source = os.path.join(static, "auto_system.py")
    if not os.path.exists(source):
        raise HTTPException(status_code=404, detail="Python客户端文件不存在")
    return FileResponse(
        path=source, filename="auto_system.py", media_type="text/x-python",
        headers={
            "Content-Disposition": "attachment; filename=auto_system.py",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@router.get("/scan-monitor-download-debug")
def download_debug_tool():
    """下载条码调试工具（千问AI辅助）"""
    import os
    from fastapi.responses import FileResponse
    static = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
    dbg_path = os.path.join(static, "barcode_debug.py")
    if not os.path.exists(dbg_path):
        raise HTTPException(status_code=404, detail="调试工具文件不存在")
    return FileResponse(
        path=dbg_path, filename="barcode_debug.py", media_type="text/x-python",
        headers={"Content-Disposition": "attachment; filename=barcode_debug.py"},
    )


@router.get("/scan-monitor-download-test")
def download_test_tool():
    """下载条码库对比测试工具"""
    import os
    from fastapi.responses import FileResponse
    static = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "static")
    test_path = os.path.join(static, "barcode_test_libs.py")
    if not os.path.exists(test_path):
        raise HTTPException(status_code=404, detail="测试工具文件不存在")
    return FileResponse(
        path=test_path, filename="barcode_test_libs.py", media_type="text/x-python",
        headers={"Content-Disposition": "attachment; filename=barcode_test_libs.py"},
    )


# ─── 失败图片上传与查看 ───

FAIL_IMAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "static", "fail_images")
os.makedirs(FAIL_IMAGE_DIR, exist_ok=True)
FAIL_META_FILE = os.path.join(FAIL_IMAGE_DIR, "meta.json")


def _load_fail_meta():
    try:
        if os.path.exists(FAIL_META_FILE):
            with open(FAIL_META_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception:
        pass
    return []


def _save_fail_meta(data):
    try:
        with open(FAIL_META_FILE, 'w', encoding='utf-8') as f:
            json.dump(data[-500:], f, ensure_ascii=False)
    except Exception:
        pass


@router.post("/fail-image")
async def upload_fail_image(request: Request):
    """接收客户端上传的未识别快递码图片"""
    try:
        body = await request.json()
        img_b64 = body.get("image_b64", "")
        if not img_b64:
            return {"success": False, "message": "no image"}

        ts = datetime.now()
        fname = f"{ts.strftime('%Y%m%d_%H%M%S')}_{body.get('machine_number', 'x')}.jpg"
        fpath = os.path.join(FAIL_IMAGE_DIR, fname)

        img_bytes = base64.b64decode(img_b64)
        with open(fpath, 'wb') as f:
            f.write(img_bytes)

        meta = _load_fail_meta()
        meta.append({
            "file": fname,
            "time": ts.strftime('%Y-%m-%d %H:%M:%S'),
            "machine": body.get("machine_number", ""),
            "version": body.get("client_version", ""),
            "weight": body.get("weight", 0),
            "codes": body.get("codes", []),
            "diag": body.get("diag", {}),
        })
        _save_fail_meta(meta)

        return {"success": True, "file": fname}
    except Exception as e:
        return {"success": False, "message": str(e)}


@router.get("/fail-images")
def list_fail_images(page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    """列出失败图片（分页）"""
    meta = _load_fail_meta()
    meta.reverse()
    total = len(meta)
    start = (page - 1) * size
    items = meta[start:start + size]
    return {"success": True, "data": {"items": items, "total": total, "page": page, "size": size}}


@router.get("/fail-image-file/{filename}")
def get_fail_image_file(filename: str):
    """获取失败图片文件"""
    safe_name = os.path.basename(filename)
    fpath = os.path.join(FAIL_IMAGE_DIR, safe_name)
    if not os.path.exists(fpath):
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(fpath, media_type="image/jpeg")


@router.get("/fail-viewer", response_class=HTMLResponse)
def fail_viewer_page():
    """失败图片查看页面"""
    return FAIL_VIEWER_HTML


FAIL_VIEWER_HTML = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>识别失败图片查看 - 果管系统</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0b0f1a;--card:#111827;--border:rgba(255,255,255,.08);--text:#f1f5f9;--text2:#94a3b8;--brand:#6366f1;--fail:#ef4444;--ok:#10b981;--warn:#f59e0b}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:20px}
h1{text-align:center;font-size:1.8rem;margin-bottom:24px;background:linear-gradient(135deg,#ef4444,#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.stats{display:flex;gap:16px;justify-content:center;margin-bottom:24px;flex-wrap:wrap}
.stat{padding:12px 24px;border-radius:12px;background:var(--card);border:1px solid var(--border);text-align:center}
.stat .num{font-size:1.8rem;font-weight:900;color:var(--fail)}
.stat .label{font-size:.8rem;color:var(--text2);margin-top:4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;max-width:1400px;margin:0 auto}
.card{border-radius:16px;background:var(--card);border:1px solid var(--border);overflow:hidden;transition:transform .2s}
.card:hover{transform:translateY(-2px);border-color:rgba(239,68,68,.3)}
.card img{width:100%;height:240px;object-fit:cover;cursor:pointer;background:#1a1a2e}
.card-body{padding:14px}
.card-time{font-size:.8rem;color:var(--text2);margin-bottom:6px}
.card-info{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.chip{padding:4px 10px;border-radius:20px;font-size:.75rem;font-weight:600}
.chip.machine{background:rgba(99,102,241,.15);color:#a5b4fc}
.chip.weight{background:rgba(245,158,11,.15);color:#fcd34d}
.chip.version{background:rgba(16,185,129,.15);color:#6ee7b7}
.card-codes{font-size:.8rem;color:var(--text2)}
.card-codes b{color:var(--text)}
.card-diag{font-size:.72rem;color:var(--text2);margin-top:6px;word-break:break-all}
.pager{display:flex;justify-content:center;gap:10px;margin-top:24px}
.pager button{padding:10px 20px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);cursor:pointer;font-size:.9rem}
.pager button:hover{border-color:var(--brand)}
.pager button:disabled{opacity:.3;cursor:not-allowed}
.pager span{padding:10px;color:var(--text2);font-size:.9rem}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:999;align-items:center;justify-content:center;cursor:pointer}
.modal.active{display:flex}
.modal img{max-width:95vw;max-height:95vh;border-radius:8px}
.empty{text-align:center;padding:60px;color:var(--text2);font-size:1.1rem}
</style>
</head>
<body>
<h1>🔍 识别失败图片查看</h1>
<div class="stats" id="stats"></div>
<div class="grid" id="grid"></div>
<div class="pager" id="pager"></div>
<div class="modal" id="modal" onclick="this.classList.remove('active')"><img id="modalImg"></div>
<script>
const API=window.location.origin+'/api/device';
let page=1,size=20;
function showModal(src){document.getElementById('modalImg').src=src;document.getElementById('modal').classList.add('active')}
async function load(){
  try{
    const r=await fetch(`${API}/fail-images?page=${page}&size=${size}`);
    const d=await r.json();
    if(!d.success)return;
    const{items,total}=d.data;
    const totalPages=Math.ceil(total/size)||1;
    document.getElementById('stats').innerHTML=`<div class="stat"><div class="num">${total}</div><div class="label">失败图片总数</div></div><div class="stat"><div class="num">${page}/${totalPages}</div><div class="label">当前页</div></div>`;
    const grid=document.getElementById('grid');
    if(!items.length){grid.innerHTML='<div class="empty">暂无失败图片记录</div>';return}
    grid.innerHTML='';
    items.forEach(it=>{
      const imgUrl=`${API}/fail-image-file/${it.file}`;
      const codes=(it.codes||[]).map(c=>`${c.type}:${c.data}`).join(', ')||'无码';
      const diag=it.diag||{};
      const diagStr=Object.entries(diag).filter(([k])=>!k.startsWith('file')&&k!=='imread_ok').map(([k,v])=>`${k}=${typeof v==='object'?JSON.stringify(v):v}`).join(' | ');
      const div=document.createElement('div');
      div.className='card';
      div.innerHTML=`<img src="${imgUrl}" onclick="showModal('${imgUrl}')" loading="lazy"><div class="card-body"><div class="card-time">${it.time||''}</div><div class="card-info"><span class="chip machine">${it.machine||'?'}号机</span><span class="chip weight">${it.weight||0}kg</span><span class="chip version">v${it.version||'?'}</span></div><div class="card-codes">识别码: <b>${codes}</b></div>${diagStr?`<div class="card-diag">${diagStr}</div>`:''}</div>`;
      grid.appendChild(div);
    });
    const pager=document.getElementById('pager');
    pager.innerHTML=`<button onclick="page--;load()" ${page<=1?'disabled':''}>← 上一页</button><span>第 ${page} / ${totalPages} 页</span><button onclick="page++;load()" ${page>=totalPages?'disabled':''}>下一页 →</button>`;
  }catch(e){console.error(e)}
}
load();
</script>
</body>
</html>'''


SCAN_DASHBOARD_HTML = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>扫码监控大屏 - 果管系统</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#040816;--bg2:#0a1333;--panel:rgba(10,18,44,.78);--panel-strong:rgba(13,21,52,.92);--line:rgba(148,163,184,.14);--line-strong:rgba(99,102,241,.3);--text:#eef2ff;--muted:#93a4c3;--brand:#7c3aed;--brand2:#22d3ee;--ok:#10b981;--fail:#ef4444;--warn:#f59e0b;--shadow:0 24px 80px rgba(2,8,23,.45)}
html,body{min-height:100%}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:
radial-gradient(circle at 12% 18%,rgba(124,58,237,.26),transparent 26%),
radial-gradient(circle at 86% 16%,rgba(34,211,238,.18),transparent 22%),
radial-gradient(circle at 50% 100%,rgba(16,185,129,.15),transparent 24%),
linear-gradient(160deg,var(--bg) 0%,var(--bg2) 52%,#050913 100%);
color:var(--text);overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;mask-image:radial-gradient(circle at center,black 48%,transparent 100%);pointer-events:none;opacity:.6}
.aurora,.noise{position:fixed;inset:0;pointer-events:none}
.aurora{background:
radial-gradient(circle at 20% 30%,rgba(99,102,241,.18),transparent 22%),
radial-gradient(circle at 80% 35%,rgba(34,211,238,.14),transparent 20%),
radial-gradient(circle at 50% 85%,rgba(16,185,129,.10),transparent 28%);
filter:blur(28px);opacity:.9}
.noise{opacity:.08;background-image:radial-gradient(rgba(255,255,255,.8) .6px,transparent .8px);background-size:9px 9px}
.container{max-width:1720px;margin:0 auto;padding:24px;position:relative;z-index:1}
.topbar{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:18px;align-items:stretch;margin-bottom:18px}
.hero{position:relative;padding:28px 30px;border-radius:30px;background:linear-gradient(135deg,rgba(15,23,54,.88),rgba(19,31,72,.72));border:1px solid var(--line-strong);box-shadow:var(--shadow);overflow:hidden}
.hero::before{content:'';position:absolute;inset:-1px auto auto -80px;width:260px;height:260px;border-radius:50%;background:radial-gradient(circle,rgba(124,58,237,.24),transparent 65%)}
.hero::after{content:'';position:absolute;right:-90px;top:-110px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(34,211,238,.18),transparent 62%)}
.hero-inner{position:relative;z-index:1}
.hero-title{display:flex;align-items:center;gap:18px;margin-bottom:18px}
.hero-mark{width:68px;height:68px;border-radius:24px;background:linear-gradient(135deg,#7c3aed,#22d3ee);display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 20px 50px rgba(34,211,238,.18),inset 0 1px 0 rgba(255,255,255,.2)}
.hero-copy h1{font-size:2.4rem;font-weight:900;letter-spacing:.02em;line-height:1.1}
.hero-copy p{margin-top:8px;font-size:1rem;color:var(--muted);max-width:780px}
.hero-tags{display:flex;flex-wrap:wrap;gap:10px}
.tag{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);font-size:.9rem;color:#d7e3ff;backdrop-filter:blur(10px)}
.tag b{font-size:1rem;color:#fff}
.side-panel{display:grid;gap:18px}
.panel-card{padding:18px;border-radius:24px;background:linear-gradient(180deg,rgba(14,22,50,.88),rgba(10,18,42,.72));border:1px solid var(--line);box-shadow:var(--shadow);backdrop-filter:blur(16px)}
.clock-label,.panel-title{font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.clock-time{margin-top:10px;font-size:2rem;font-weight:900;font-variant-numeric:tabular-nums}
.clock-date{margin-top:6px;color:#d9e3ff}
.live-row{margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.9rem;color:var(--muted)}
.live-badge{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(16,185,129,.12);color:#b4f7da;border:1px solid rgba(16,185,129,.18)}
.live-dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 rgba(16,185,129,.35);animation:pulse 1.8s infinite}
.action-group{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.action-btn{appearance:none;border:none;outline:none;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 14px;border-radius:14px;font-size:.92rem;font-weight:700;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.action-btn:hover{transform:translateY(-1px)}
.action-btn.primary{background:linear-gradient(135deg,#7c3aed,#6366f1);color:#fff;box-shadow:0 12px 28px rgba(99,102,241,.28)}
.action-btn.secondary{background:rgba(255,255,255,.04);color:#dce6ff;border:1px solid rgba(255,255,255,.08)}
.action-btn.secondary:hover{border-color:rgba(255,255,255,.18)}
.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:18px}
.stat-card{position:relative;padding:18px;border-radius:24px;background:linear-gradient(180deg,rgba(14,22,50,.88),rgba(10,18,42,.72));border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden}
.stat-card::after{content:'';position:absolute;inset:auto auto -45px -20px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.16),transparent 70%);opacity:.5}
.stat-top{display:flex;align-items:center;justify-content:space-between;gap:12px}
.stat-label{font-size:.84rem;color:var(--muted)}
.stat-icon{width:46px;height:46px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:21px;color:#fff}
.stat-icon.blue{background:linear-gradient(135deg,#6366f1,#8b5cf6)}
.stat-icon.green{background:linear-gradient(135deg,#10b981,#34d399)}
.stat-icon.red{background:linear-gradient(135deg,#ef4444,#fb7185)}
.stat-icon.cyan{background:linear-gradient(135deg,#06b6d4,#38bdf8)}
.stat-value{margin-top:16px;font-size:2.2rem;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}
.stat-foot{margin-top:8px;font-size:.86rem;color:#d3def8}
.machine-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:18px}
.machine-card{position:relative;padding:22px;border-radius:28px;background:linear-gradient(180deg,rgba(14,22,50,.90),rgba(10,18,42,.72));border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden;transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease}
.machine-card:hover{transform:translateY(-3px);border-color:rgba(255,255,255,.14);box-shadow:0 28px 80px rgba(2,8,23,.52)}
.machine-card.online{border-color:rgba(16,185,129,.22)}
.machine-card.offline{border-color:rgba(148,163,184,.16)}
.machine-card.disabled{border-color:rgba(239,68,68,.18)}
.machine-card::before{content:'';position:absolute;left:18px;right:18px;top:0;height:3px;border-radius:999px;background:linear-gradient(90deg,rgba(124,58,237,.85),rgba(34,211,238,.85))}
.machine-card.online::before{background:linear-gradient(90deg,#10b981,#22c55e)}
.machine-card.offline::before{background:linear-gradient(90deg,#64748b,#94a3b8)}
.machine-card.disabled::before{background:linear-gradient(90deg,#ef4444,#fb7185)}
.machine-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
.machine-main{display:flex;align-items:center;gap:14px;min-width:0}
.machine-avatar{width:56px;height:56px;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:26px;background:linear-gradient(135deg,rgba(124,58,237,.22),rgba(34,211,238,.18));border:1px solid rgba(255,255,255,.08);flex:0 0 auto}
.machine-card.online .machine-avatar{background:linear-gradient(135deg,rgba(16,185,129,.24),rgba(34,197,94,.14))}
.machine-card.disabled .machine-avatar{background:linear-gradient(135deg,rgba(239,68,68,.20),rgba(251,113,133,.12))}
.machine-no{font-size:1.36rem;font-weight:900;letter-spacing:.02em}
.machine-name{margin-top:4px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.machine-status{flex:0 0 auto;padding:7px 12px;border-radius:999px;font-size:.82rem;font-weight:800;border:1px solid transparent}
.machine-status.online{background:rgba(16,185,129,.12);color:#b4f7da;border-color:rgba(16,185,129,.18)}
.machine-status.offline{background:rgba(148,163,184,.12);color:#d2dbe8;border-color:rgba(148,163,184,.12)}
.machine-status.disabled{background:rgba(239,68,68,.12);color:#fecaca;border-color:rgba(239,68,68,.18)}
.health{margin-bottom:18px}
.health-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:.85rem;color:var(--muted);margin-bottom:8px}
.health-bar{height:10px;border-radius:999px;background:rgba(255,255,255,.06);overflow:hidden;border:1px solid rgba(255,255,255,.04)}
.health-fill{height:100%;border-radius:999px;transition:width .45s ease}
.mini-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.metric{padding:14px 14px 12px;border-radius:18px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.05)}
.metric span{display:block;font-size:.78rem;color:var(--muted);margin-bottom:8px}
.metric strong{font-size:1.5rem;font-weight:900;font-variant-numeric:tabular-nums;color:#fff}
.metric strong.ok{color:#7bf1bf}
.metric strong.fail{color:#fca5a5}
.metric strong.sub{font-size:1.02rem}
.machine-footer{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.footer-chip{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.05);font-size:.82rem;color:#dbe5ff}
.footer-chip.muted{color:var(--muted)}
.empty{padding:56px 24px;border-radius:28px;background:rgba(14,22,50,.74);border:1px dashed rgba(255,255,255,.10);text-align:center;color:var(--muted)}
.empty b{display:block;font-size:1.2rem;color:#fff;margin-bottom:8px}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.32)}70%{box-shadow:0 0 0 10px rgba(16,185,129,0)}}
@media(max-width:1180px){.topbar{grid-template-columns:1fr}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.container{padding:14px}.hero{padding:22px}.hero-title{align-items:flex-start}.hero-copy h1{font-size:1.8rem}.summary-grid{grid-template-columns:1fr}.machine-grid{grid-template-columns:1fr}.machine-name{max-width:none}.clock-time{font-size:1.6rem}}
</style>
</head>
<body>
<div class="aurora"></div>
<div class="noise"></div>
<div class="container">
  <section class="topbar">
    <div class="hero">
      <div class="hero-inner">
        <div class="hero-title">
          <div class="hero-mark">🍊</div>
          <div class="hero-copy">
            <h1>扫码监控大屏</h1>
            <p>总览所有扫码机器实时状态、在线情况、今日成功失败与机器健康度，适合管理员在监控中心或电视大屏持续展示。</p>
          </div>
        </div>
        <div class="hero-tags">
          <div class="tag">在线机器 <b id="heroOnline">0 / 0</b></div>
          <div class="tag">今日成功 <b id="heroOk">0</b></div>
          <div class="tag">今日失败 <b id="heroFail">0</b></div>
          <div class="tag">累计扫码 <b id="heroTotalScans">0</b></div>
        </div>
      </div>
    </div>
    <div class="side-panel">
      <div class="panel-card">
        <div class="clock-label">实时状态</div>
        <div class="clock-time" id="clock">--:--:--</div>
        <div class="clock-date" id="clockDate">--</div>
        <div class="live-row">
          <div class="live-badge"><span class="live-dot"></span>实时轮询中</div>
          <span id="lastRefresh">刚刚更新</span>
        </div>
      </div>
      <div class="panel-card">
        <div class="panel-title">大屏操作</div>
        <div class="action-group">
          <button class="action-btn secondary" type="button" onclick="goBack()">← 返回监控中心</button>
          <button class="action-btn secondary" type="button" onclick="toggleFullscreen()">⛶ 全屏</button>
          <button class="action-btn primary" type="button" onclick="refresh()">↻ 立即刷新</button>
        </div>
      </div>
    </div>
  </section>

  <section class="summary-grid">
    <div class="stat-card">
      <div class="stat-top">
        <div>
          <div class="stat-label">在线机器</div>
          <div class="stat-value" id="sOnline">0 / 0</div>
        </div>
        <div class="stat-icon green">📡</div>
      </div>
      <div class="stat-foot">5 分钟内有心跳上报的机器</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <div>
          <div class="stat-label">今日成功</div>
          <div class="stat-value" id="sOk">0</div>
        </div>
        <div class="stat-icon blue">✓</div>
      </div>
      <div class="stat-foot">扫码与重量校验通过总数</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <div>
          <div class="stat-label">今日失败</div>
          <div class="stat-value" id="sFail">0</div>
        </div>
        <div class="stat-icon red">!</div>
      </div>
      <div class="stat-foot">失败报警与异常记录总数</div>
    </div>
    <div class="stat-card">
      <div class="stat-top">
        <div>
          <div class="stat-label">在线率</div>
          <div class="stat-value" id="sRate">0%</div>
        </div>
        <div class="stat-icon cyan">◉</div>
      </div>
      <div class="stat-foot">全机器在线占比与运行情况</div>
    </div>
  </section>

  <section class="machine-grid" id="grid"></section>
</div>
<script>
const API=window.location.origin+'/api/device';
function isOnline(m){return m.status!=='disabled'&&m.last_active&&(Date.now()-new Date(m.last_active).getTime())<300000}
function formatNumber(v){return Number(v||0).toLocaleString('zh-CN')}
function formatTime(ts){if(!ts)return'暂无数据';const d=new Date(ts);return Number.isNaN(d.getTime())?'暂无数据':d.toLocaleTimeString('zh-CN',{hour12:false})}
function formatDateTime(ts){if(!ts)return'等待数据';const d=new Date(ts);return Number.isNaN(d.getTime())?'等待数据':d.toLocaleString('zh-CN',{hour12:false})}
function updateClock(){const n=new Date();document.getElementById('clock').textContent=n.toLocaleTimeString('zh-CN',{hour12:false});document.getElementById('clockDate').textContent=n.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}
function updateRefreshText(){document.getElementById('lastRefresh').textContent='更新于 '+new Date().toLocaleTimeString('zh-CN',{hour12:false})}
function goBack(){
  try{if(window.opener&&!window.opener.closed){window.close();return}}catch(e){}
  window.location.href=window.location.origin+'/production/scan-screen';
}
function toggleFullscreen(){
  if(!document.fullscreenElement){
    document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen();
    return;
  }
  document.exitFullscreen&&document.exitFullscreen();
}
setInterval(updateClock,1000);updateClock();
async function refresh(){
  try{
    const res=await fetch(API+'/machines');
    const d=await res.json();
    const machines=Array.isArray(d.data)?d.data:[];
    let totalOk=0,totalFail=0,online=0,totalScans=0;
    machines.forEach(m=>{
      totalOk+=m.today_success||0;
      totalFail+=m.today_fail||0;
      totalScans+=m.total_scans||0;
      if(isOnline(m))online++;
    });
    const onlineRate=machines.length?Math.round((online/machines.length)*100):0;
    document.getElementById('heroOnline').textContent=online+' / '+machines.length;
    document.getElementById('heroOk').textContent=formatNumber(totalOk);
    document.getElementById('heroFail').textContent=formatNumber(totalFail);
    document.getElementById('heroTotalScans').textContent=formatNumber(totalScans);
    document.getElementById('sOnline').textContent=online+' / '+machines.length;
    document.getElementById('sOk').textContent=formatNumber(totalOk);
    document.getElementById('sFail').textContent=formatNumber(totalFail);
    document.getElementById('sRate').textContent=onlineRate+'%';
    updateRefreshText();

    const grid=document.getElementById('grid');
    if(!machines.length){
      grid.innerHTML='<div class="empty"><b>暂无机器数据</b><span>请先在扫码监控中心创建机器，随后这里会自动展示实时状态。</span></div>';
      return;
    }

    grid.innerHTML='';
    machines.sort((a,b)=>{
      const oa=isOnline(a)?1:0;
      const ob=isOnline(b)?1:0;
      const ta=(a.today_success||0)+(a.today_fail||0);
      const tb=(b.today_success||0)+(b.today_fail||0);
      return ob-oa||tb-ta||Number(a.machine_number)-Number(b.machine_number);
    });

    machines.forEach(m=>{
      const success=m.today_success||0;
      const fail=m.today_fail||0;
      const total=success+fail;
      const scans=m.total_scans||0;
      const on=isOnline(m);
      const disabled=m.status==='disabled';
      const rate=total?Math.round((success/total)*100):0;
      const cls=disabled?'disabled':(on?'online':'offline');
      const statusText=disabled?'停用':(on?'在线':'离线');
      const runtimeText=disabled?'暂停使用':(on?'运行稳定':'等待连接');
      const fillWidth=disabled?0:(total?Math.max(rate,8):8);
      const fillColor=disabled?'linear-gradient(90deg,#ef4444,#fb7185)':rate>=95?'linear-gradient(90deg,#10b981,#22c55e)':rate>=80?'linear-gradient(90deg,#f59e0b,#fbbf24)':'linear-gradient(90deg,#ef4444,#f97316)';
      const icon=disabled?'⛔':(on?'📡':'🖥️');
      const div=document.createElement('div');
      div.className='machine-card '+cls;
      div.innerHTML=`
        <div class="machine-head">
          <div class="machine-main">
            <div class="machine-avatar">${icon}</div>
            <div>
              <div class="machine-no">#${m.machine_number}</div>
              <div class="machine-name">${m.name||('机器'+m.machine_number)}</div>
            </div>
          </div>
          <div class="machine-status ${cls}">${statusText}</div>
        </div>
        <div class="health">
          <div class="health-meta">
            <span>成功率 ${rate}%</span>
            <span>${m.last_active?('最近活跃 '+formatTime(m.last_active)):'暂无心跳'}</span>
          </div>
          <div class="health-bar">
            <div class="health-fill" style="width:${fillWidth}%;background:${fillColor}"></div>
          </div>
        </div>
        <div class="mini-grid">
          <div class="metric"><span>今日成功</span><strong class="ok">${formatNumber(success)}</strong></div>
          <div class="metric"><span>今日失败</span><strong class="fail">${formatNumber(fail)}</strong></div>
          <div class="metric"><span>累计扫码</span><strong>${formatNumber(scans)}</strong></div>
          <div class="metric"><span>运行状态</span><strong class="sub">${runtimeText}</strong></div>
        </div>
        <div class="machine-footer">
          <div class="footer-chip">今日总量 ${formatNumber(total)}</div>
          <div class="footer-chip muted">${m.last_active?('最后上报 '+formatDateTime(m.last_active)):'等待数据上报'}</div>
        </div>`;
      grid.appendChild(div);
    });
  }catch(e){
    console.error(e);
  }
}
setInterval(refresh,5000);
refresh();
</script>
</body>
</html>'''


SCAN_MONITOR_HTML = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>扫码报数</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--bg:#0b0f1a;--card:#111827;--ok:#10b981;--fail:#ef4444;--warn:#f59e0b;--brand:#6366f1;--text:#f1f5f9;--text2:#94a3b8;--border:rgba(255,255,255,.08)}
html,body{height:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--text)}
.setup{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:24px;padding:20px}
.setup h1{font-size:2rem;background:linear-gradient(135deg,#6366f1,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.setup input{width:300px;padding:14px 20px;border-radius:12px;border:2px solid var(--border);background:var(--card);color:var(--text);font-size:1.1rem;text-align:center;outline:none}
.setup input:focus{border-color:var(--brand)}
.setup button{padding:14px 48px;border-radius:12px;border:none;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:1.1rem;font-weight:700;cursor:pointer}
.setup .machines{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:8px}
.setup .mbtn{padding:10px 24px;border-radius:10px;background:var(--card);border:1px solid var(--border);color:var(--text);cursor:pointer;font-size:.95rem;transition:all .2s}
.setup .mbtn:hover{border-color:var(--brand);background:rgba(99,102,241,.1)}
.monitor{display:none;height:100%;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:var(--card);border-bottom:1px solid var(--border)}
.top .machine-tag{font-size:1rem;font-weight:700;color:var(--brand)}
.top .status-dot{width:10px;height:10px;border-radius:50%;background:var(--ok);display:inline-block;margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.counter-area{flex:0 0 auto;display:flex;align-items:stretch;padding:16px 20px;gap:16px}
.count-box{flex:1;border-radius:16px;padding:20px;text-align:center;border:1px solid var(--border)}
.count-box.main{background:linear-gradient(135deg,rgba(16,185,129,.12),rgba(16,185,129,.04));border-color:rgba(16,185,129,.2)}
.count-box.fail-box{background:linear-gradient(135deg,rgba(239,68,68,.12),rgba(239,68,68,.04));border-color:rgba(239,68,68,.2)}
.count-label{font-size:.8rem;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.count-num{font-size:4rem;font-weight:900;line-height:1;font-variant-numeric:tabular-nums}
.count-box.main .count-num{color:var(--ok)}
.count-box.fail-box .count-num{color:var(--fail)}
.last-result{padding:0 20px;flex:0 0 auto}
.result-card{border-radius:14px;padding:16px 20px;border:2px solid var(--border);transition:all .3s}
.result-card.ok{border-color:var(--ok);background:rgba(16,185,129,.06)}
.result-card.fail{border-color:var(--fail);background:rgba(239,68,68,.08)}
.result-card .r-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.result-card .r-status{font-size:1.3rem;font-weight:800}
.result-card.ok .r-status{color:var(--ok)}
.result-card.fail .r-status{color:var(--fail)}
.result-card .r-time{font-size:.8rem;color:var(--text2);font-family:monospace}
.result-card .r-detail{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:.85rem}
.result-card .r-detail .rd-label{color:var(--text2);font-size:.7rem}
.result-card .r-detail .rd-value{font-weight:700;font-size:1rem;font-variant-numeric:tabular-nums}
.result-card .r-msg{margin-top:8px;padding:8px 12px;border-radius:8px;font-size:.85rem;font-weight:600}
.result-card.fail .r-msg{background:rgba(239,68,68,.15);color:#fca5a5}
.log-area{flex:1;overflow-y:auto;padding:8px 20px 20px}
.log-area table{width:100%;border-collapse:collapse;font-size:.78rem}
.log-area th{text-align:left;padding:6px 8px;color:var(--text2);font-weight:600;border-bottom:1px solid var(--border);font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;position:sticky;top:0;background:var(--bg)}
.log-area td{padding:6px 8px;border-bottom:1px solid var(--border)}
.log-area tr.fail-row{background:rgba(239,68,68,.06)}
.badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.7rem;font-weight:700}
.badge.ok{background:rgba(16,185,129,.15);color:#34d399}
.badge.fail{background:rgba(239,68,68,.15);color:#f87171}
.mono{font-family:'SF Mono',Monaco,monospace}
.flash-overlay{display:none;position:fixed;inset:0;z-index:999;pointer-events:none}
.flash-overlay.active{display:block;animation:overlayFlash .4s ease-in-out 4}
@keyframes overlayFlash{0%,100%{background:transparent}50%{background:rgba(239,68,68,.25)}}
@media(max-width:600px){.count-num{font-size:3rem}.result-card .r-detail{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
<div class="flash-overlay" id="flashOverlay"></div>
<div class="setup" id="setupView">
<h1>🍊 扫码报数监控</h1>
<p style="color:var(--text2)">输入或选择机器编号开始监控</p>
<input id="machineInput" placeholder="输入机器编号（数字）" autofocus>
<button onclick="startMonitor()">开始监控</button>
<div class="machines" id="machineList"></div>
</div>
<div class="monitor" id="monitorView">
<div class="top">
  <div><span class="status-dot"></span><span class="machine-tag" id="machineTag">-</span></div>
  <div style="font-size:.8rem;color:var(--text2)">今日 <span id="dateStr"></span></div>
</div>
<div class="counter-area">
  <div class="count-box main"><div class="count-label">成功出库</div><div class="count-num" id="okCount">0</div></div>
  <div class="count-box fail-box"><div class="count-label">失败</div><div class="count-num" id="failCount">0</div></div>
</div>
<div class="last-result">
  <div class="result-card" id="lastCard" style="border-color:var(--border)">
    <div class="r-top"><span class="r-status" id="lastStatus">等待扫码...</span><span class="r-time" id="lastTime">-</span></div>
    <div class="r-detail">
      <div><div class="rd-label">条码</div><div class="rd-value" id="lastBarcode">-</div></div>
      <div><div class="rd-label">应有重量</div><div class="rd-value" id="lastEst">-</div></div>
      <div><div class="rd-label">实际重量</div><div class="rd-value" id="lastWeight">-</div></div>
      <div><div class="rd-label">差值</div><div class="rd-value" id="lastDiff">-</div></div>
    </div>
    <div class="r-msg" id="lastMsg" style="display:none"></div>
  </div>
</div>
<div class="log-area">
  <table><thead><tr><th>时间</th><th>条码</th><th>SKU</th><th>应有</th><th>实际</th><th>差值</th><th>工人</th><th>状态</th></tr></thead>
  <tbody id="logBody"></tbody></table>
</div>
</div>
<script>
const API=window.location.origin+'/api/device';
let MN='__MACHINE__',lastId=0,polling=null,audioCtx=null;
function ac(){if(!audioCtx)audioCtx=new(window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();return audioCtx}
function beepOk(){try{const c=ac(),o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.frequency.value=1200;g.gain.value=0.4;o.start();o.stop(c.currentTime+.08)}catch(e){}}
function beepFail(){try{const c=ac();for(let i=0;i<3;i++){const o=c.createOscillator(),g=c.createGain();o.connect(g);g.connect(c.destination);o.type='square';o.frequency.value=400;g.gain.value=0.7;o.start(c.currentTime+i*.25);o.stop(c.currentTime+i*.25+.15)}}catch(e){}}
function speak(t){if(!('speechSynthesis' in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang='zh-CN';u.rate=1.2;u.volume=1;speechSynthesis.speak(u)}
function flash(){const e=document.getElementById('flashOverlay');e.classList.remove('active');void e.offsetWidth;e.classList.add('active');setTimeout(()=>e.classList.remove('active'),2000)}
async function loadMachines(){try{const r=await fetch(API+'/machines');const d=await r.json();const l=document.getElementById('machineList');l.innerHTML='';(d.data||[]).forEach(m=>{const b=document.createElement('div');b.className='mbtn';b.textContent='#'+m.machine_number+(m.name?' '+m.name:'')+' ('+m.today_success+'✓)';b.onclick=()=>{document.getElementById('machineInput').value=m.machine_number;startMonitor()};l.appendChild(b)})}catch(e){}}
function sendHeartbeat(){fetch(API+'/heartbeat/'+MN,{method:'POST'}).catch(()=>{})}
function startMonitor(){const v=document.getElementById('machineInput').value.trim();if(!v){alert('请输入机器编号');return}if(!/^\d+$/.test(v)){alert('机器号必须是纯数字');return}MN=v;lastId=0;document.getElementById('setupView').style.display='none';document.getElementById('monitorView').style.display='flex';document.getElementById('machineTag').textContent='📡 '+MN+' 号机';document.getElementById('dateStr').textContent=new Date().toLocaleDateString('zh-CN');document.title=MN+'号机 - 扫码报数';history.replaceState(null,'','?machine='+MN);if(polling)clearInterval(polling);poll();polling=setInterval(poll,500);sendHeartbeat();setInterval(sendHeartbeat,30000)}
async function poll(){try{const r=await fetch(API+'/latest-records/'+MN+'/'+lastId);const d=await r.json();if(!d.success)return;const data=d.data;document.getElementById('okCount').textContent=data.scan_count||0;document.getElementById('failCount').textContent=data.fail_count||0;const recs=data.records||[];if(!recs.length)return;recs.forEach(r=>{if(r.id>lastId)lastId=r.id;addRow(r);if(r.is_success){beepOk();speak(String(data.scan_count));showLast(r,true)}else{beepFail();flash();speak('失败！'+(r.message||'').substring(0,40));showLast(r,false)}})}catch(e){}}
function showLast(r,ok){const c=document.getElementById('lastCard');c.className='result-card '+(ok?'ok':'fail');document.getElementById('lastStatus').textContent=ok?'✅ 出库成功 #'+document.getElementById('okCount').textContent:'❌ 扫码失败';document.getElementById('lastTime').textContent=r.upload_time?(r.upload_time.split('T')[1]||''):'';document.getElementById('lastBarcode').textContent=r.tickets_num||'-';document.getElementById('lastEst').textContent=r.estimated_weight?r.estimated_weight.toFixed(2)+'kg':'-';document.getElementById('lastWeight').textContent=r.weight?r.weight.toFixed(2)+'kg':'-';const df=r.weight_difference||0;document.getElementById('lastDiff').textContent=(df>=0?'+':'')+df.toFixed(2)+'kg';document.getElementById('lastDiff').style.color=Math.abs(df)>0.5?'var(--warn)':'var(--ok)';const m=document.getElementById('lastMsg');if(!ok&&r.message){m.style.display='block';m.textContent='⚠ '+r.message}else m.style.display='none'}
function addRow(r){const b=document.getElementById('logBody'),tr=document.createElement('tr');if(!r.is_success)tr.className='fail-row';const t=r.upload_time?(r.upload_time.split('T')[1]||'').substring(0,8):'',df=r.weight_difference||0;tr.innerHTML='<td class="mono">'+t+'</td><td class="mono">'+(r.tickets_num||'')+'</td><td>'+(r.sku_name||'-')+'</td><td>'+(r.estimated_weight?r.estimated_weight.toFixed(2):'-')+'</td><td>'+(r.weight?r.weight.toFixed(2):'-')+'</td><td style="color:'+(Math.abs(df)>0.5?'var(--warn)':'var(--text)')+'">'+(df>=0?'+':'')+df.toFixed(2)+'</td><td>'+(r.worker_name||'-')+'</td><td><span class="badge '+(r.is_success?'ok':'fail')+'">'+(r.is_success?'成功':'失败')+'</span></td>';b.insertBefore(tr,b.firstChild);while(b.children.length>100)b.removeChild(b.lastChild)}
document.addEventListener('DOMContentLoaded',()=>{const p=new URLSearchParams(window.location.search);const m=p.get('machine')||'__MACHINE__';if(m&&m!==''&&m!=='__MACHINE__'){document.getElementById('machineInput').value=m;startMonitor()}else loadMachines()});
document.addEventListener('click',()=>ac(),{once:true});
document.getElementById('machineInput').addEventListener('keydown',e=>{if(e.key==='Enter')startMonitor()});
</script>
</body>
</html>'''
