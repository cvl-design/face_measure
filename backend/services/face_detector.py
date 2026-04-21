"""
MediaPipe FaceLandmarker 单例封装 — Phase 2
使用 mediapipe.tasks API（0.10.x，mp.solutions 已移除）
"""
from __future__ import annotations

import numpy as np
from PIL import Image

import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import FaceLandmarker
from mediapipe.tasks.python.vision.face_landmarker import FaceLandmarkerOptions
from mediapipe.tasks.python.vision.core.vision_task_running_mode import VisionTaskRunningMode

from backend.core.config import settings
from backend.core.logging_config import get_logger

logger = get_logger(__name__)


class FaceDetectorService:
    """MediaPipe FaceLandmarker 包装器，FastAPI 启动时预加载，整个进程单例复用。"""

    def __init__(self) -> None:
        self._detector: FaceLandmarker | None = None

    def load(self) -> None:
        """同步加载模型（在 lifespan 中通过 run_in_executor 调用）。"""
        model_path = settings.mediapipe_model_path
        logger.info("Loading MediaPipe FaceLandmarker", model_path=model_path)
        opts = FaceLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=model_path),
            running_mode=VisionTaskRunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=0.3,
            min_tracking_confidence=0.3,
        )
        self._detector = FaceLandmarker.create_from_options(opts)
        logger.info("MediaPipe FaceLandmarker loaded successfully")

    def detect(self, image_path: str) -> list[dict] | None:
        """
        检测人脸关键点。

        Returns:
            478个关键点 list[{x, y, z}]（归一化坐标 0.0–1.0），
            未检测到人脸时返回 None。
        """
        if self._detector is None:
            raise RuntimeError("FaceDetectorService.load() 尚未调用，模型未初始化")

        img = Image.open(image_path).convert("RGB")
        mp_image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=np.array(img, dtype=np.uint8),
        )
        result = self._detector.detect(mp_image)

        if not result.face_landmarks:
            logger.warning("No face detected", image_path=image_path)
            return None

        lm = result.face_landmarks[0]
        landmarks = [{"x": float(p.x), "y": float(p.y), "z": float(p.z)} for p in lm]
        logger.info("Face detected", num_landmarks=len(landmarks))
        return landmarks


# 模块级单例 — 在 FastAPI lifespan 中调用 load()
face_detector = FaceDetectorService()
