"""
采集路由 — Phase 1 完整实现
POST /{session_id}/capture        — 上传5张图片，预处理并质量评估
GET  /{session_id}/capture/quality — 获取质量报告
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path as FilePath

from fastapi import APIRouter, Depends, File, Form, HTTPException, Path as PathParam, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.db.database import get_db
from backend.db.models import FaceCapture, Session
from backend.models.schemas import (
    CaptureQualityReport,
    CaptureQualityScore,
    CaptureUploadResponse,
)
from backend.utils.image_utils import assess_image_quality, preprocess_and_save

router = APIRouter(prefix="/api/v1/sessions", tags=["capture"])

# 允许上传的角度列表（顺序决定字段顺序）
ANGLES = ["front", "left45", "right45", "left90", "right90"]

# 单文件大小上限（bytes），与前端 MAX_FILE_MB 对齐
MAX_FILE_BYTES = settings.max_image_size_mb * 1024 * 1024


# ── POST /{session_id}/capture ────────────────────────────────────

@router.post(
    "/{session_id}/capture",
    response_model=CaptureUploadResponse,
    status_code=201,
    summary="上传角度照片并获得质量评估",
)
async def upload_capture(
    session_id: str = PathParam(..., description="会话 UUID"),
    capture_method: str = Form(default="upload"),
    front: UploadFile | None = File(default=None),
    left45: UploadFile | None = File(default=None),
    right45: UploadFile | None = File(default=None),
    left90: UploadFile | None = File(default=None),
    right90: UploadFile | None = File(default=None),
    db: AsyncSession = Depends(get_db),
) -> CaptureUploadResponse:
    # ── 1. 校验 Session ──────────────────────────────────────────
    session = await db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"会话 {session_id} 不存在")
    if session.status != "capturing":
        raise HTTPException(
            status_code=422,
            detail=f"会话状态为 '{session.status}'，无法上传图片（需处于 'capturing' 状态）",
        )

    # ── 2. 收集非空文件 ──────────────────────────────────────────
    file_map: dict[str, UploadFile] = {}
    for angle, upload in zip(
        ANGLES, [front, left45, right45, left90, right90]
    ):
        if upload is not None:
            file_map[angle] = upload

    if "front" not in file_map:
        raise HTTPException(status_code=422, detail="正面图（front）为必填项")

    # ── 3. 目标目录 ──────────────────────────────────────────────
    dest_dir: FilePath = settings.temp_image_dir_path / session_id
    dest_dir.mkdir(parents=True, exist_ok=True)

    # ── 4. 遍历处理每个角度 ──────────────────────────────────────
    path_fields: dict[str, str] = {}   # angle → saved path str
    quality_scores: dict[str, dict] = {}

    for angle, upload_file in file_map.items():
        raw_bytes = await upload_file.read()

        # 文件大小校验
        if len(raw_bytes) > MAX_FILE_BYTES:
            size_mb = len(raw_bytes) / 1024 / 1024
            raise HTTPException(
                status_code=413,
                detail=f"文件 '{angle}' 过大（{size_mb:.1f} MB），最大 {settings.max_image_size_mb} MB",
            )

        # 预处理并保存
        saved_path, _sha256 = preprocess_and_save(
            raw_bytes,
            dest_dir=dest_dir,
            filename=f"{angle}.jpg",
            max_dim=settings.max_image_dimension,
        )
        path_fields[angle] = str(saved_path)

        # 质量评估（对保存后的文件做评估，已去噪）
        processed_bytes = saved_path.read_bytes()
        quality_scores[angle] = assess_image_quality(processed_bytes, angle_label=angle)

    # ── 5. Upsert FaceCapture ────────────────────────────────────
    result = await db.execute(
        select(FaceCapture).where(FaceCapture.session_id == session_id)
    )
    capture = result.scalar_one_or_none()

    quality_json = {k: v for k, v in quality_scores.items()}

    if capture is None:
        capture = FaceCapture(
            capture_id=str(uuid.uuid4()),
            session_id=session_id,
            capture_method=capture_method,
            quality_scores=quality_json,
            **{f"{angle}_path": path_fields.get(angle) for angle in ANGLES},
        )
        db.add(capture)
    else:
        capture.capture_method = capture_method
        capture.quality_scores = quality_json
        for angle in ANGLES:
            if angle in path_fields:
                setattr(capture, f"{angle}_path", path_fields[angle])

    await db.commit()
    await db.refresh(capture)

    # ── 6. 构造响应 ──────────────────────────────────────────────
    all_passed = all(q["passed"] for q in quality_scores.values())
    scored: dict[str, CaptureQualityScore] = {
        angle: CaptureQualityScore(**score_dict)
        for angle, score_dict in quality_scores.items()
    }

    return CaptureUploadResponse(
        capture_id=capture.capture_id,
        session_id=session_id,
        uploaded_angles=list(file_map.keys()),
        quality_scores=scored,
        all_passed=all_passed,
        message="上传成功" if all_passed else "部分图像质量不合格，建议重新拍摄（当前仍可继续）",
    )


# ── GET /{session_id}/capture/quality ────────────────────────────

@router.get(
    "/{session_id}/capture/quality",
    response_model=CaptureQualityReport,
    summary="获取质量评估报告",
)
async def get_capture_quality(
    session_id: str = PathParam(..., description="会话 UUID"),
    db: AsyncSession = Depends(get_db),
) -> CaptureQualityReport:
    session = await db.get(Session, session_id)
    if session is None:
        raise HTTPException(status_code=404, detail=f"会话 {session_id} 不存在")

    result = await db.execute(
        select(FaceCapture).where(FaceCapture.session_id == session_id)
    )
    capture = result.scalar_one_or_none()
    if capture is None:
        raise HTTPException(status_code=404, detail="该会话尚未上传任何图片")

    raw_scores: dict = capture.quality_scores or {}
    scored: dict[str, CaptureQualityScore] = {}
    for angle, score_data in raw_scores.items():
        if isinstance(score_data, str):
            score_data = json.loads(score_data)
        scored[angle] = CaptureQualityScore(**score_data)

    all_passed = all(s.passed for s in scored.values())

    return CaptureQualityReport(
        capture_id=capture.capture_id,
        session_id=session_id,
        quality_scores=scored,
        all_passed=all_passed,
    )
