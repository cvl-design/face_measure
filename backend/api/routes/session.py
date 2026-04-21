"""会话管理路由（Phase 0 基础实现）"""
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from backend.db.database import get_db
from backend.db import models as orm
from backend.models.schemas import SessionCreate, SessionResponse
from backend.core.exceptions import session_not_found
from backend.core.logging_config import get_logger

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])
logger = get_logger(__name__)


@router.post("", response_model=SessionResponse, status_code=201)
async def create_session(
    body: SessionCreate,
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    session = orm.Session(
        session_id=str(uuid.uuid4()),
        gender=body.gender.value,
        age_group=body.age_group.value,
        chief_complaint=body.chief_complaint,
        allergy_note=body.allergy_note,
        status="capturing",
        created_at=datetime.utcnow(),
    )
    db.add(session)
    await db.flush()
    logger.info("session created", session_id=session.session_id)
    return SessionResponse.model_validate(session)


@router.get("/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str = Path(...),
    db: AsyncSession = Depends(get_db),
) -> SessionResponse:
    result = await db.execute(
        select(orm.Session).where(orm.Session.session_id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise session_not_found(session_id)
    return SessionResponse.model_validate(session)


@router.delete("/{session_id}", status_code=204)
async def close_session(
    session_id: str = Path(...),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(
        select(orm.Session).where(orm.Session.session_id == session_id)
    )
    session = result.scalar_one_or_none()
    if session is None:
        raise session_not_found(session_id)

    session.status = "closed"
    session.closed_at = datetime.utcnow()

    # 清理临时图像（Phase 1 完善后扩充）
    if session.capture:
        _purge_capture_files(session.capture)

    logger.info("session closed", session_id=session_id)


def _purge_capture_files(capture: orm.FaceCapture) -> None:
    """删除会话关联的临时图像文件"""
    import os
    for field in ["front_path", "left45_path", "right45_path", "left90_path", "right90_path"]:
        path = getattr(capture, field, None)
        if path and os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass
