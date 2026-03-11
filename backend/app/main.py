from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import os
import time
from app.config import get_settings
from app.routers import auth, dashboard, orders, production, workers, inventory, reports, system, recycle, device, ai, bug_report, download, worker_settlement

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="水果仓储生产管理系统 API",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_timing_and_ip(request: Request, call_next):
    from app.utils.log_action import set_request_ip
    forwarded = request.headers.get("x-forwarded-for")
    client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "")
    set_request_ip(client_ip)

    start = time.time()
    response = await call_next(request)
    elapsed = time.time() - start
    response.headers["X-Response-Time"] = f"{elapsed:.3f}s"
    return response


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": "服务器内部错误", "detail": str(exc) if settings.DEBUG else None},
    )


app.include_router(auth.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(orders.router, prefix="/api")
app.include_router(production.router, prefix="/api")
app.include_router(workers.router, prefix="/api")
app.include_router(inventory.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(recycle.router, prefix="/api")
app.include_router(device.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(bug_report.router, prefix="/api")
app.include_router(download.router, prefix="/api")
app.include_router(worker_settlement.router, prefix="/api")

# 确保下载目录存在
downloads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "downloads")
os.makedirs(downloads_dir, exist_ok=True)


@app.get("/api/health")
def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}
