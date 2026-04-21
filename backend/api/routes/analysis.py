"""
分析路由 — Phase 3 完整实现
POST /{session_id}/analyze  — 触发后台几何 + VLM 分析（立即返回 202）
GET  /{session_id}/analysis — 查询分析结果（前端轮询）
"""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path as PathParam, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.logging_config import get_logger
from backend.db.database import get_db, AsyncSessionLocal
from backend.db.models import DetectionResult, FaceCapture, Session
from backend.models.schemas import DetectionResultResponse, AestheticMetricsResult, DefectItem, AgeAssessment, OverallAssessment
from backend.services.face_detector import face_detector
from backend.services.defect_scorer import score_from_landmarks
from backend.services.vlm_detector import detect_defects_vlm, merge_defects
from backend.services.annotation_renderer import render_annotated_image_sync
from backend.services.cache_service import make_cache_key, cache_get_vlm, cache_set_vlm

router = APIRouter(prefix="/api/v1/sessions", tags=["analysis"])
logger = get_logger(__name__)


# ── 工具函数 ───────────────────────────────────────────────────────

def _collect_image_paths(capture: FaceCapture) -> dict[str, str]:
    """从 FaceCapture ORM 对象收集所有存在的角度图片路径。"""
    paths: dict[str, str] = {}
    for angle in ("front", "left45", "right45", "left90", "right90"):
        p = getattr(capture, f"{angle}_path", None)
        if p and Path(p).exists():
            paths[angle] = p
    return paths


def _build_geometric_summary(aesthetic_metrics: dict) -> str:
    """生成注入 VLM prompt 的几何摘要（100字以内）。"""
    cs = aesthetic_metrics.get("composite_score", 0)
    ts = aesthetic_metrics.get("three_sections", {}).get("score", 0)
    fe = aesthetic_metrics.get("five_eyes", {}).get("score", 0)
    sym = aesthetic_metrics.get("symmetry", {}).get("score", 0)
    fs = aesthetic_metrics.get("face_shape", {}).get("classification", "未知")
    return (
        f"综合评分{cs}分；三庭{ts:.0f}分；五眼{fe:.0f}分；"
        f"对称性{sym:.0f}分；面型{fs}"
    )


# ── 后台分析任务 ───────────────────────────────────────────────────

async def _run_analysis(session_id: str) -> None:
    """
    后台任务（Phase 3）：
    1. MediaPipe 几何分析（Phase 2 保留）
    2. PIL 标注渲染
    3. VLM 缺陷检测（带缓存）
    4. 合并几何 + VLM 缺陷
    5. Upsert DetectionResult（含标注图 base64 URL）
    6. 更新 session.status → 'consulting'
    """
    logger.info("Analysis background task started (Phase 3)", session_id=session_id)

    async with AsyncSessionLocal() as db:
        try:
            # ── 读取 FaceCapture ──────────────────────────────────
            result = await db.execute(
                select(FaceCapture).where(FaceCapture.session_id == session_id)
            )
            capture = result.scalar_one_or_none()

            if capture is None or not capture.front_path:
                logger.error("No front image found for analysis", session_id=session_id)
                await _mark_failed(db, session_id)
                return

            # ── 读取 Session ──────────────────────────────────────
            session = await db.get(Session, session_id)
            if session is None:
                logger.error("Session not found in background task", session_id=session_id)
                return

            gender    = session.gender
            age_group = session.age_group

            # ── Phase 2: MediaPipe 关键点检测 ─────────────────────
            loop = asyncio.get_event_loop()
            landmarks: list[dict] | None = await loop.run_in_executor(
                None, face_detector.detect, capture.front_path
            )

            face_detected = landmarks is not None

            if face_detected and landmarks:
                capture.landmarks_json = {"front": landmarks}
                await db.flush()

            # ── Phase 2: 几何规则引擎 ─────────────────────────────
            aesthetic_metrics: dict[str, Any] | None = None
            geometry_defects: list[dict] = []
            composite_score = 0

            if face_detected and landmarks:
                aesthetic_metrics, geometry_defects = score_from_landmarks(
                    landmarks, gender=gender, age_group=age_group
                )
                composite_score = int(aesthetic_metrics.get("composite_score", 0))

            # ── Phase 3: PIL 标注渲染 ──────────────────────────────
            annotated_image_url = ""
            if face_detected and landmarks:
                annotated_image_url = await loop.run_in_executor(
                    None,
                    render_annotated_image_sync,
                    capture.front_path,
                    landmarks,
                    geometry_defects,
                )

            # ── Phase 3: VLM 缺陷检测（带缓存）──────────────────
            image_paths = _collect_image_paths(capture)
            vlm_result: dict[str, Any] = {}

            if image_paths:
                cache_key = make_cache_key(list(image_paths.values()))
                cached = cache_get_vlm(cache_key)

                if cached is not None:
                    vlm_result = cached
                    logger.info("VLM cache hit, skipping API call", session_id=session_id)
                else:
                    geo_summary = ""
                    if aesthetic_metrics:
                        geo_summary = _build_geometric_summary(aesthetic_metrics)

                    vlm_result = await detect_defects_vlm(
                        image_paths=image_paths,
                        session_id=session_id,
                        gender=gender,
                        age_group=age_group,
                        geometric_summary=geo_summary,
                    )
                    if vlm_result.get("face_detected") or vlm_result.get("defects"):
                        cache_set_vlm(cache_key, vlm_result)

            # ── 合并几何 + VLM 缺陷 ──────────────────────────────
            vlm_defects: list[dict] = vlm_result.get("defects", [])
            final_defects = merge_defects(geometry_defects, vlm_defects)

            # 用 VLM 的 face_detected 更新（如果 VLM 运行了）
            if vlm_result.get("face_detected") is not None:
                face_detected = face_detected or vlm_result["face_detected"]

            # ── 构建综合结果 ──────────────────────────────────────
            vlm_summary  = vlm_result.get("overall_summary", "")
            geo_summary  = "几何分析完成（Phase 2）" if face_detected else "未检测到人脸"
            final_summary = vlm_summary or geo_summary

            estimated_age = int(vlm_result.get("estimated_age", 0))
            input_tokens  = int(vlm_result.get("input_tokens", 0))
            output_tokens = int(vlm_result.get("output_tokens", 0))
            cost_cny      = float(vlm_result.get("cost_cny", 0.0))

            overall_dict: dict[str, Any] = {
                "composite_score":    composite_score,
                "summary":            final_summary,
                "priority_concerns":  [d["name_zh"] for d in final_defects[:3]],
            }

            # ── Upsert DetectionResult ────────────────────────────
            dr_result = await db.execute(
                select(DetectionResult).where(DetectionResult.session_id == session_id)
            )
            detection = dr_result.scalar_one_or_none()

            if detection is None:
                detection = DetectionResult(
                    result_id=str(uuid.uuid4()),
                    session_id=session_id,
                    face_detected=face_detected,
                    defects=final_defects,
                    aesthetic_metrics=aesthetic_metrics,
                    overall=overall_dict,
                    api_provider="mediapipe+qwen3vl" if vlm_defects else "mediapipe_geometry",
                    api_cost_cny=cost_cny,
                )
                db.add(detection)
            else:
                detection.face_detected     = face_detected
                detection.defects           = final_defects
                detection.aesthetic_metrics = aesthetic_metrics
                detection.overall           = overall_dict
                detection.api_provider      = "mediapipe+qwen3vl" if vlm_defects else "mediapipe_geometry"
                detection.api_cost_cny      = cost_cny

            # ── 更新 session 状态 ─────────────────────────────────
            session.status = "consulting"
            # 将标注图 URL 和 VLM 年龄估计存入 session 额外字段（复用 chief_complaint 之外字段暂存）
            # Phase 3: 将 annotated_image_url 放入 DetectionResult（需模型支持）
            # 当前通过在 overall_dict 中附加绕过 schema 限制
            if annotated_image_url:
                overall_dict["annotated_image_url"] = annotated_image_url
                detection.overall = overall_dict
            if estimated_age:
                overall_dict["estimated_age"] = estimated_age
                detection.overall = overall_dict

            await db.commit()
            logger.info(
                "Analysis completed (Phase 3)",
                session_id=session_id,
                face_detected=face_detected,
                defect_count=len(final_defects),
                geometry_defects=len(geometry_defects),
                vlm_defects=len(vlm_defects),
                composite_score=composite_score,
                cost_cny=cost_cny,
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
    summary="触发面部几何 + VLM 分析（异步后台执行）",
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

    logger.info("Analysis triggered (Phase 3)", session_id=session_id)
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

    # 仍在分析中：返回 202，前端继续轮询
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

    # ── 反序列化 JSON 字段 ────────────────────────────────────────
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
                logger.warning("Failed to parse defect item", error=str(e), item=d.get("name_zh"))

    overall: OverallAssessment | None = None
    annotated_image_url = ""
    estimated_age_val = 0

    if detection.overall:
        try:
            # 提取附加字段（标注图 URL、年龄估计）
            overall_data = dict(detection.overall)
            annotated_image_url = str(overall_data.pop("annotated_image_url", ""))
            estimated_age_val   = int(overall_data.pop("estimated_age", 0))
            overall = OverallAssessment(**overall_data)
        except Exception:
            pass

    age_assessment: AgeAssessment | None = None
    if estimated_age_val:
        age_assessment = AgeAssessment(
            estimated_age=estimated_age_val,
            vlm_age=estimated_age_val,
            confidence=0.75,
        )

    return DetectionResultResponse(
        result_id=detection.result_id,
        session_id=session_id,
        face_detected=detection.face_detected,
        defects=defects,
        aesthetic_metrics=aesthetic,
        age_assessment=age_assessment,
        overall=overall,
        api_provider=detection.api_provider,
        api_cost_cny=detection.api_cost_cny,
        annotated_image_url=annotated_image_url,
    )
