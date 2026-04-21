"""
PIL 关键点标注渲染器 — Phase 3
将 MediaPipe 478 关键点投影到原图上，绘制引导折线和高光点，
返回 base64 编码的标注图（供前端直接渲染）。
"""
from __future__ import annotations

import base64
import io
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from backend.core.logging_config import get_logger

logger = get_logger(__name__)

# ── 颜色常量（RGBA，主题色与前端 Indigo 系保持一致）─────────────
COLOR_LANDMARK   = (99,  102, 241, 200)   # indigo-500
COLOR_GUIDE_LINE = (99,  102, 241, 120)   # indigo-500 半透明
COLOR_HIGHLIGHT  = (251, 191,  36, 230)   # amber-400
COLOR_DEFECT_BOX = (239,  68,  68, 180)   # red-500
COLOR_TEXT_BG    = (17,   24,  39, 200)   # gray-900

# ── 需要绘制引导折线的关键点组 ─────────────────────────────────────
# 每个 tuple: (颜色, [关键点索引列表])
GUIDE_GROUPS: list[tuple[tuple[int, int, int, int], list[int]]] = [
    # 眉毛
    (COLOR_GUIDE_LINE, [70, 63, 105, 66, 107, 55, 65, 52, 53, 46]),   # 左眉
    (COLOR_GUIDE_LINE, [300, 293, 334, 296, 336, 285, 295, 282, 283, 276]),  # 右眉
    # 眼睛轮廓
    (COLOR_GUIDE_LINE, [33, 246, 161, 160, 159, 158, 157, 173, 133,
                        155, 154, 153, 145, 144, 163, 7]),              # 左眼
    (COLOR_GUIDE_LINE, [362, 398, 384, 385, 386, 387, 388, 466, 263,
                        249, 390, 373, 374, 380, 381, 382]),            # 右眼
    # 鼻子
    (COLOR_GUIDE_LINE, [168, 6, 197, 195, 5, 4, 1, 19, 94,
                        2, 164, 0]),                                    # 鼻梁+鼻头
    (COLOR_GUIDE_LINE, [98, 97, 2, 326, 327]),                         # 鼻翼
    # 嘴巴外轮廓
    (COLOR_GUIDE_LINE, [61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
                        291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61]),
    # 面部轮廓
    (COLOR_GUIDE_LINE, [10, 338, 297, 332, 284, 251, 389, 356, 454,
                        323, 361, 288, 397, 365, 379, 378, 400, 377,
                        152, 148, 176, 149, 150, 136, 172, 58, 132,
                        93, 234, 127, 162, 21, 54, 103, 67, 109, 10]),
]

# 高光点（美学关键位置）
HIGHLIGHT_POINTS = [116, 345, 105, 334, 1, 61, 291]


def render_annotated_image(
    image_path: str,
    landmarks: list[dict],
    defects: list[dict] | None = None,
    highlight_points: dict[str, Any] | None = None,
    max_output_dim: int = 800,
) -> str:
    """
    在图像上绘制关键点引导线和缺陷标注，返回 base64 PNG 字符串。

    Args:
        image_path:       原始正面图路径
        landmarks:        478 个关键点 list[{x, y, z}]（归一化坐标）
        defects:          缺陷列表（可选，用于添加区域标注文字）
        highlight_points: defect_scorer 输出的高光点坐标（可选）
        max_output_dim:   输出图像最大边长（限制文件大小）

    Returns:
        data:image/png;base64,... 格式字符串
    """
    try:
        img = Image.open(image_path).convert("RGBA")
        w, h = img.size

        # 限制输出尺寸
        if max(w, h) > max_output_dim:
            ratio = max_output_dim / max(w, h)
            img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)
            w, h = img.size

        # 创建叠加层（独立 RGBA，最后合并）
        overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        # ── 绘制引导折线 ──────────────────────────────────────────
        for color, indices in GUIDE_GROUPS:
            pts = []
            for idx in indices:
                if 0 <= idx < len(landmarks):
                    lm = landmarks[idx]
                    pts.append((int(lm["x"] * w), int(lm["y"] * h)))
            if len(pts) >= 2:
                draw.line(pts, fill=color, width=1)

        # ── 绘制关键点（仅高光点画大圆）────────────────────────────
        for idx in HIGHLIGHT_POINTS:
            if 0 <= idx < len(landmarks):
                lm = landmarks[idx]
                cx, cy = int(lm["x"] * w), int(lm["y"] * h)
                draw.ellipse([cx - 4, cy - 4, cx + 4, cy + 4],
                             fill=COLOR_HIGHLIGHT, outline=None)

        # ── 绘制普通关键点（小圆点）──────────────────────────────
        for lm in landmarks:
            cx, cy = int(lm["x"] * w), int(lm["y"] * h)
            draw.ellipse([cx - 1, cy - 1, cx + 1, cy + 1],
                         fill=COLOR_LANDMARK, outline=None)

        # ── 合并叠加层 ────────────────────────────────────────────
        annotated = Image.alpha_composite(img, overlay).convert("RGB")

        # ── 编码为 base64 ─────────────────────────────────────────
        buf = io.BytesIO()
        annotated.save(buf, format="JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        return f"data:image/jpeg;base64,{b64}"

    except Exception as exc:
        logger.warning("Annotation render failed", error=str(exc), image_path=image_path)
        return ""


def render_annotated_image_sync(
    image_path: str,
    landmarks: list[dict],
    defects: list[dict] | None = None,
) -> str:
    """同步包装（在 run_in_executor 中调用）。"""
    return render_annotated_image(image_path, landmarks, defects)
