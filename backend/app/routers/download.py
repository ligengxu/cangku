from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import os
import glob as globmod
from datetime import datetime

router = APIRouter(prefix="/download", tags=["下载"])

DOWNLOAD_DIR = Path(__file__).parent.parent.parent / "static" / "downloads"


def _find_exe() -> Path | None:
    candidates = sorted(
        DOWNLOAD_DIR.glob("*.exe"),
        key=lambda p: os.path.getmtime(p),
        reverse=True,
    )
    return candidates[0] if candidates else None


@router.get("/client/info")
def get_client_info():
    """获取客户端下载信息"""
    exe_path = _find_exe()
    if exe_path and exe_path.exists():
        size_mb = round(os.path.getsize(exe_path) / (1024 * 1024), 1)
        mtime = os.path.getmtime(exe_path)
        update_time = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
        return {
            "success": True,
            "data": {
                "available": True,
                "version": "3.0.0",
                "size": f"{size_mb}MB",
                "filename": exe_path.name,
                "update_time": update_time,
                "download_url": "/api/download/client",
            },
        }
    return {
        "success": True,
        "data": {
            "available": False,
            "version": "2.0.0",
            "message": "客户端正在构建中，请稍后再试",
        },
    }


@router.get("/client")
def download_client():
    """下载 Windows 客户端"""
    exe_path = _find_exe()
    if not exe_path or not exe_path.exists():
        raise HTTPException(status_code=404, detail="客户端安装包暂不可用")
    return FileResponse(
        path=str(exe_path),
        filename=exe_path.name,
        media_type="application/octet-stream",
    )
