"""
FaceSense Backend — FastAPI 应用入口
"""
from contextlib import asynccontextmanager
import asyncio
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.core.config import settings
from backend.core.logging_config import configure_logging, get_logger
from backend.core.exceptions import FaceSenseError
from backend.db.database import init_db
from backend.api.routes import health, session, capture, analysis, templates, treatment, simulation, report, catalog
from backend.api.routes.health import set_mediapipe_loaded, set_faiss_loaded

configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化，关闭时清理"""
    logger.info("FaceSense starting", env=settings.app_env, port=settings.server_port)

    # 初始化数据库（建表 + WAL 模式）
    await init_db()

    # Phase 2+：MediaPipe 预加载
    from backend.services.face_detector import face_detector
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, face_detector.load)
    set_mediapipe_loaded(True)

    # Phase 4+：FAISS 索引预加载（占位）
    # from backend.services.template_matcher import template_matcher
    # await template_matcher.load()
    # set_faiss_loaded(True)

    logger.info("FaceSense ready")
    yield

    # 关闭时清理
    logger.info("FaceSense shutting down")


app = FastAPI(
    title="FaceSense API",
    description="AI 辅助医生智能面诊系统后端",
    version="0.1.0",
    docs_url="/docs" if settings.is_development else None,
    redoc_url="/redoc" if settings.is_development else None,
    lifespan=lifespan,
)

# ── CORS（仅允许本地前端开发端口）────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",   # Vite 开发服务器
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 全局异常处理 ──────────────────────────────────────────────────
@app.exception_handler(FaceSenseError)
async def facesense_error_handler(request: Request, exc: FaceSenseError) -> JSONResponse:
    logger.warning(
        "business error",
        error_type=type(exc).__name__,
        message=exc.message,
        path=request.url.path,
    )
    return JSONResponse(
        status_code=500,
        content={"error": type(exc).__name__, "message": exc.message, "detail": exc.detail},
    )


# ── 路由注册 ─────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(session.router)
app.include_router(capture.router)
app.include_router(analysis.router)
app.include_router(templates.router)
app.include_router(treatment.router)
app.include_router(simulation.router)
app.include_router(report.router)
app.include_router(catalog.router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=settings.server_host,
        port=settings.server_port,
        reload=settings.is_development,
        log_config=None,   # 由 structlog 接管日志
    )
