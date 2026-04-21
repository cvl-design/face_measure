"""
分析路由 — Phase 2 完整实现
POST /{session_id}/analyze  — 触发后台几何分析（立即返回 202）
GET  /{session_id}/analysis — 查询分析结果（前端轮询）
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path as PathParam, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.logging_config import get_logger
from backend.db.database import get_db, AsyncSessionLocal
from backend.db.models import DetectionResult, FaceCapture, Session
from backend.models.schemas import DetectionResultResponse, AestheticMetricsResult, DefectItem
from backend.services.face_detector import face_detector
from backend.services.defect_scorer import score_from_landmarks

router = APIRouter(prefix="/api/v1/sessions", tags=["analysis"])
logger = get_logger(__name__)


# ── 后台分析任务 ───────────────────────────────────────────────────

async def _run_analysis(session_id: str) -> None:
    """
    后台任务：
    1. 读取 front_path
    2. 同步调用 MediaPipe（run_in_executor 避免阻塞事件循环）
    3. 运行几何规则引擎
    4. Upsert DetectionResult
    5. 更新 session.status → 'consulting'
    """
    logger.info("Analysis background task started", session_id=session_id)

    async with AsyncSessionLocal() as db:
        try:
            # 读取 FaceCapture
            result = await db.execute(
                select(FaceCapture).where(FaceCapture.session_id == session_id)
            )
            capture = result.scalar_one_or_none()

            if capture is None or not capture.front_path:
                logger.error("No front image found for analysis", session_id=session_id)
                await _mark_failed(db, session_id)
                return

            front_path: str = capture.front_path

            # 读取 Session 获取 gender / age_group
            session = await db.get(Session, session_id)
            if session is None:
                logger.error("Session not found in background task", session_id=session_id)
                return

            gender    = session.gender
            age_group = session.age_group

            # ── MediaPipe 关键点检测（同步阻塞 → executor）──────
            loop = asyncio.get_event_loop()
            landmarks: list[dict] | None = await loop.run_in_executor(
                None, face_detector.detect, front_path
            )

            face_detected = landmarks is not None

            # ── 持久化 landmarks ─────────────────────────────────
            if face_detected:
                capture.landmarks_json = {"front": landmarks}
                await db.flush()

            # ── 几何分析 ─────────────────────────────────────────
            aesthetic_metrics: dict[str, Any] | None = None
            defects_list: list[dict] = []
            composite_score = 0

            if face_detected and landmarks:
                aesthetic_metrics, defects_list = score_from_landmarks(
                    landmarks, gender=gender, age_group=age_group
                )
                composite_score = int(aesthetic_metrics.get("composite_score", 0))

            # ── Upsert DetectionResult ────────────────────────────
            dr_result = await db.execute(
                select(DetectionResult).where(DetectionResult.session_id == session_id)
            )
            detection = dr_result.scalar_one_or_none()

            overall_dict: dict[str, Any] = {
                "composite_score": composite_score,
                "summary":         "几何分析完成（Phase 2）" if face_detected else "未检测到人脸",
                "priority_concerns": [d["name_zh"] for d in defects_list[:3]],
            }

            if detection is None:
                detection = DetectionResult(
                    result_id=str(uuid.uuid4()),
                    session_id=session_id,
                    face_detected=face_detected,
                    defects=defects_list,
                    aesthetic_metrics=aesthetic_metrics,
                    overall=overall_dict,
                    api_provider="mediapipe_geometry",
                    api_cost_cny=0.0,
                )
                db.add(detection)
            else:
                detection.face_detected      = face_detected
                detection.defects            = defects_list
                detection.aesthetic_metrics  = aesthetic_metrics
                detection.overall            = overall_dict
                detection.api_provider       = "mediapipe_geometry"

            # ── 更新 session 状态 ─────────────────────────────────
            session.status = "consulting"

            await db.commit()
            logger.info(
                "Analysis completed",
                session_id=session_id,
                face_detected=face_detected,
                defect_count=len(defects_list),
                composite_score=composite_score,
            )

        except Exception as exc:
            logger.exception("Analysis background task failed", session_id=session_id, error=str(exc))
            await db.rollback()
            await _mark_failed(db, session_id)


async def _mark_failed(db: AsyncSession, session_id: str) -> None:
    """分析失败时将 session.status 回退为 'capturing' 以允许重试。"""
    session = await db.get(Session, session_id)
    if session:
        session.status = "capturing"
        await db.commit()


# ── POST /{session_id}/analyze ────────────────────────────────────

@router.post(
    "/{session_id}/analyze",
    status_code=202,
    summary="触发面部几何分析（异步后台执行）",
)
async def trigger_analysis(
    background_tasks: BackgroundTasks,
    session_id: str = PathParam(..., description="会话 UUID"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # ── 校验 session ──────────────────────────────────────────────
    session = await db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"会话 {session_id} 不存在")

    if session.status == "consulting":
        # 已分析完成，前端可直接查询结果
        return {"message": "分析已完成，请查询 GET /analysis", "status": session.status}

    if session.status == "analyzing":
        return {"message": "分析正在进行中，请稍候", "status": session.status}

    if session.status not in ("capturing",):
        raise HTTPException(
            status_code=422,
            detail=f"会话状态为 '{session.status}'，无法触发分析",
        )

    # ── 验证正面图存在 ────────────────────────────────────────────
    result = await db.execute(
        select(FaceCapture).where(FaceCapture.session_id == session_id)
    )
    capture = result.scalar_one_or_none()
    if capture is None or not capture.front_path:
        raise HTTPException(status_code=422, detail="请先上传正面图再触发分析")

    # ── 状态切换 → analyzing ─────────────────────────────────────
    session.status = "analyzing"
    await db.commit()

    # ── 添加后台任务 ──────────────────────────────────────────────
    background_tasks.add_task(_run_analysis, session_id)

    logger.info("Analysis triggered", session_id=session_id)
    return {"message": "分析已启动，请轮询 GET /analysis", "status": "analyzing"}


# ── GET /{session_id}/analysis ────────────────────────────────────

@router.get(
    "/{session_id}/analysis",
    response_model=DetectionResultResponse,
    summary="查询分析结果（前端轮询）",
)
async def get_analysis(
    response: Response,
    session_id: str = PathParam(..., description="会话 UUID"),
    db: AsyncSession = Depends(get_db),
) -> DetectionResultResponse:
    session = await db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"会话 {session_id} 不存在")

    # 仍在分析中：返回 202，body 为空壳，前端继续轮询
    if session.status == "analyzing":
        response.status_code = 202
        return DetectionResultResponse(
            result_id="",
            session_id=session_id,
            face_detected=False,
        )

    result = await db.execute(
        select(DetectionResult).where(DetectionResult.session_id == session_id)
    )
    detection = result.scalar_one_or_none()

    if detection is None:
        raise HTTPException(status_code=404, detail="该会话尚无分析结果，请先调用 POST /analyze")

    # 反序列化 JSON 字段
    aesthetic: AestheticMetricsResult | None = None
    if detection.aesthetic_metrics:
        try:
            aesthetic = AestheticMetricsResult(**detection.aesthetic_metrics)
        except Exception as e:
            logger.warning("Failed to parse aesthetic_metrics", error=str(e))

    defects: list[DefectItem] = []
    if detection.defects:
        for d in detection.defects:
            try:
                defects.append(DefectItem(**d))
            except Exception as e:
                logger.warning("Failed to parse defect item", error=str(e))

    from backend.models.schemas import OverallAssessment, AgeAssessment
    overall: OverallAssessment | None = None
    if detection.overall:
        try:
            overall = OverallAssessment(**detection.overall)
        except Exception:
            pass

    return DetectionResultResponse(
        result_id=detection.result_id,
        session_id=session_id,
        face_detected=detection.face_detected,
        defects=defects,
        aesthetic_metrics=aesthetic,
        overall=overall,
        api_provider=detection.api_provider,
        api_cost_cny=detection.api_cost_cny,
    )
