"""
图像预处理与质量评估工具函数
依赖：Pillow、opencv-python-headless（requirements.txt 已列）
无 FastAPI 依赖，可单独 import 测试。
"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# ── 尺寸压缩 ─────────────────────────────────────────────────────


def strip_exif_and_convert(image_bytes: bytes) -> bytes:
    """去除 EXIF 元数据并将图像转为 RGB JPEG bytes。"""
    img = Image.open(io.BytesIO(image_bytes))
    img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def resize_to_max_dimension(img: Image.Image, max_dim: int = 1024) -> Image.Image:
    """按 max_dim 等比缩放；若两边均未超限则直接返回原图（不放大）。"""
    w, h = img.size
    if w <= max_dim and h <= max_dim:
        return img
    ratio = min(max_dim / w, max_dim / h)
    new_w = max(1, round(w * ratio))
    new_h = max(1, round(h * ratio))
    return img.resize((new_w, new_h), Image.LANCZOS)


# ── 哈希 ─────────────────────────────────────────────────────────


def compute_sha256(data: bytes) -> str:
    """返回 hex 格式 SHA256 字符串（Phase 3 缓存 key 使用）。"""
    return hashlib.sha256(data).hexdigest()


# ── 质量评估 ─────────────────────────────────────────────────────


def compute_blur_score(image_bytes: bytes) -> float:
    """Laplacian 方差法：返回方差值（越大越清晰）。"""
    arr = np.frombuffer(image_bytes, np.uint8)
    img_cv = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img_cv is None:
        return 0.0
    return float(cv2.Laplacian(img_cv, cv2.CV_64F).var())


def assess_image_quality(image_bytes: bytes, angle_label: str = "") -> dict:
    """
    返回与 CaptureQualityScore schema 兼容的 dict。

    评分规则：
      sharpness  = min(laplacian_var / 500.0, 1.0)
      lighting   = 1.0 - 2 * abs(mean_px/255 - 0.5)
      angle      = 1.0  （Phase 1 不检测）
      occlusion  = 1.0  （Phase 1 不检测）
      overall    = 0.5 * sharpness + 0.5 * lighting
      passed     = overall >= 0.5

    质量阈值（用于生成中文原因）：
      sharpness < 0.15 （laplacian < 75）  → 图像过于模糊
      mean_px < 38                          → 光线过暗
      mean_px > 217                         → 图像过曝
    """
    arr = np.frombuffer(image_bytes, np.uint8)
    img_gray = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img_gray is None:
        return {
            "angle": angle_label,
            "sharpness": 0.0,
            "lighting": 0.0,
            "occlusion": 1.0,
            "overall": 0.0,
            "passed": False,
            "reasons": ["无法解码图像，请重新上传"],
        }

    laplacian_var = float(cv2.Laplacian(img_gray, cv2.CV_64F).var())
    mean_px = float(img_gray.mean())

    sharpness = min(laplacian_var / 500.0, 1.0)
    lighting = 1.0 - 2.0 * abs(mean_px / 255.0 - 0.5)
    lighting = max(0.0, min(1.0, lighting))
    overall = 0.5 * sharpness + 0.5 * lighting
    passed = overall >= 0.5

    reasons: list[str] = []
    if sharpness < 0.15:
        reasons.append("图像过于模糊，请重新拍摄")
    if mean_px < 38:
        reasons.append("光线过暗，请补光后重新拍摄")
    elif mean_px > 217:
        reasons.append("图像过曝，请避免强光直射")

    return {
        "angle": angle_label,
        "sharpness": round(sharpness, 4),
        "lighting": round(lighting, 4),
        "occlusion": 1.0,
        "overall": round(overall, 4),
        "passed": passed,
        "reasons": reasons,
    }


# ── 完整管道 ──────────────────────────────────────────────────────


def preprocess_and_save(
    raw_bytes: bytes,
    dest_dir: Path,
    filename: str,
    max_dim: int = 1024,
) -> tuple[Path, str]:
    """
    完整预处理管道：
      1. strip_exif_and_convert（去 EXIF，转 RGB JPEG）
      2. resize_to_max_dimension（缩放至 max_dim）
      3. 保存为 JPEG 到 dest_dir/filename
      4. 返回 (saved_path, sha256_of_raw_bytes)

    调用方需提前确保 dest_dir 存在。
    """
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Step 1 — 去 EXIF
    clean_bytes = strip_exif_and_convert(raw_bytes)

    # Step 2 — 缩放
    img = Image.open(io.BytesIO(clean_bytes)).convert("RGB")
    img = resize_to_max_dimension(img, max_dim)

    # Step 3 — 保存
    out_path = dest_dir / filename
    img.save(str(out_path), format="JPEG", quality=88)

    # Step 4 — SHA256（对原始 bytes 计算，作为去重 key）
    sha = compute_sha256(raw_bytes)

    return out_path, sha
