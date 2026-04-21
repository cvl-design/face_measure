from fastapi import APIRouter
from backend.models.schemas import HealthResponse
from backend.core.config import settings

router = APIRouter(tags=["system"])

# 由 main.py lifespan 更新这两个标志
_mediapipe_loaded = False
_faiss_loaded = False


def set_mediapipe_loaded(value: bool) -> None:
    global _mediapipe_loaded
    _mediapipe_loaded = value


def set_faiss_loaded(value: bool) -> None:
    global _faiss_loaded
    _faiss_loaded = value


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version="0.1.0",
        env=settings.app_env,
        db="ok",
        mediapipe_loaded=_mediapipe_loaded,
        faiss_loaded=_faiss_loaded,
    )
