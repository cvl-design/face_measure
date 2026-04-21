"""
VLM 面部缺陷检测服务 — Phase 3
调用 SiliconFlow Qwen3-VL-8B-Instruct，多角度图像打包发送，
解析 JSON 响应并映射到 DefectItem 格式。
"""
from __future__ import annotations

import base64
import json
import re
import time
from pathlib import Path
from typing import Any

import httpx

from backend.core.config import settings
from backend.core.logging_config import get_logger
from backend.utils.cost_tracker import estimate_cost, log_api_call

logger = get_logger(__name__)

# 角度标签（用于拼接 prompt 里的图像描述）
ANGLE_LABELS: dict[str, str] = {
    "front":   "正面",
    "left45":  "左45°",
    "right45": "右45°",
    "left90":  "左90°",
    "right90": "右90°",
}

# 从 detector_prompt.md 读取 system 提示词（启动时加载一次）
_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "detector_prompt.md"
_SYSTEM_PROMPT: str = ""


def _load_system_prompt() -> str:
    global _SYSTEM_PROMPT
    if not _SYSTEM_PROMPT:
        if _PROMPT_PATH.exists():
            _SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8")
        else:
            logger.warning("detector_prompt.md not found", path=str(_PROMPT_PATH))
            _SYSTEM_PROMPT = (
                "你是医美顾问，请分析面部图像并以 JSON 格式输出缺陷检测结果。"
            )
    return _SYSTEM_PROMPT


def _image_to_base64(image_path: str) -> str:
    """将图片文件编码为 base64 字符串（JPEG）。"""
    with open(image_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")


def _build_messages(
    image_paths: dict[str, str],
    gender: str,
    age_group: str,
    geometric_summary: str = "",
) -> list[dict]:
    """
    构建 OpenAI 格式的 messages（含多图 content blocks）。

    Args:
        image_paths:       {angle: abs_path}，只包含实际存在的角度
        gender:            'male' | 'female'
        age_group:         '20-29' | '30-39' 等
        geometric_summary: Phase 2 几何分析摘要（可选，增强 VLM 上下文）
    """
    system_prompt = _load_system_prompt()

    # ── user message：文字前缀 + 多张图片 ─────────────────────────
    content: list[dict] = []

    # 文字说明
    text_prefix = (
        f"请分析以下面部照片，患者信息：性别={gender}，年龄段={age_group}。\n"
    )
    if geometric_summary:
        text_prefix += f"几何分析摘要（Phase 2）：{geometric_summary}\n"
    text_prefix += "\n图像按顺序如下："

    content.append({"type": "text", "text": text_prefix})

    # 图片 blocks（按标准角度顺序）
    for angle_key in ["front", "left45", "right45", "left90", "right90"]:
        path = image_paths.get(angle_key)
        if not path or not Path(path).exists():
            continue
        label = ANGLE_LABELS.get(angle_key, angle_key)
        content.append({
            "type": "text",
            "text": f"\n[{label}]",
        })
        try:
            b64 = _image_to_base64(path)
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{b64}",
                    "detail": "high",
                },
            })
        except Exception as exc:
            logger.warning("Failed to encode image", angle=angle_key, error=str(exc))

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": content},
    ]


def _parse_vlm_response(raw_text: str) -> dict[str, Any]:
    """
    从 VLM 响应中提取 JSON 对象。
    模型可能在 JSON 前后附加说明文字，用正则提取第一个 {...} 块。
    """
    # 优先尝试直接解析
    try:
        return json.loads(raw_text.strip())
    except json.JSONDecodeError:
        pass

    # 提取 ```json ... ``` 代码块
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 提取首个 { ... } 块
    match = re.search(r"\{.*\}", raw_text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass

    logger.warning("VLM response JSON parse failed", raw_preview=raw_text[:200])
    return {}


def _normalize_defect(d: dict, source: str = "vlm") -> dict | None:
    """
    将 VLM 输出的缺陷 dict 规范化为 DefectItem 兼容格式。
    不满足最低要求的记录返回 None（调用方丢弃）。
    """
    confidence = float(d.get("confidence", 0.0))
    if confidence < settings.defect_confidence_threshold:
        return None

    severity = int(d.get("severity", 1))
    severity = max(1, min(5, severity))

    # 映射 category 枚举
    raw_cat = str(d.get("category", "")).lower()
    cat_map = {
        "wrinkle":     "wrinkle",
        "volume_loss": "volume_loss",
        "contour":     "contour",
        "ptosis":      "ptosis",
    }
    category = cat_map.get(raw_cat, "wrinkle")

    return {
        "defect_id":            d.get("defect_key", d.get("defect_id", str(time.time_ns()))),
        "name_zh":              d.get("name_zh", "未知缺陷"),
        "category":             category,
        "severity":             severity,
        "confidence":           round(confidence, 3),
        "landmark_refs":        d.get("landmark_refs", []),
        "clinical_description": d.get("clinical_description", ""),
        "treatment_suggestion": d.get("treatment_suggestion", ""),
        "anatomical_regions":   d.get("anatomical_regions", []),
        "_source":              source,   # 内部标记，持久化前清除
    }


async def detect_defects_vlm(
    image_paths: dict[str, str],
    session_id: str,
    gender: str = "female",
    age_group: str = "30-39",
    geometric_summary: str = "",
) -> dict[str, Any]:
    """
    调用 SiliconFlow VLM 检测面部缺陷。

    Args:
        image_paths:       {angle: abs_path}
        session_id:        会话 ID（用于日志和成本追踪）
        gender/age_group:  患者信息
        geometric_summary: Phase 2 摘要（注入到 prompt 增强上下文）

    Returns:
        {
          "face_detected": bool,
          "estimated_age": int,
          "defects": list[dict],       # 规范化后的 DefectItem 格式
          "overall_summary": str,
          "priority_concerns": list[str],
          "vlm_notes": str,
          "input_tokens": int,
          "output_tokens": int,
          "cost_cny": float,
        }
    """
    if not settings.siliconflow_api_key:
        logger.warning("SiliconFlow API key not configured, skipping VLM")
        return _empty_result()

    messages = _build_messages(image_paths, gender, age_group, geometric_summary)

    payload = {
        "model":       settings.vlm_model_name,
        "messages":    messages,
        "temperature": settings.vlm_temperature,
        "max_tokens":  settings.vlm_max_tokens,
        "stream":      False,
    }

    start_ms = int(time.time() * 1000)
    raw_text = ""
    input_tokens = 0
    output_tokens = 0

    try:
        async with httpx.AsyncClient(
            base_url=settings.siliconflow_base_url,
            headers={
                "Authorization": f"Bearer {settings.siliconflow_api_key}",
                "Content-Type":  "application/json",
            },
            timeout=settings.vlm_timeout_seconds,
        ) as client:
            resp = await client.post("/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()

        latency_ms = int(time.time() * 1000) - start_ms

        raw_text      = data["choices"][0]["message"]["content"]
        input_tokens  = data.get("usage", {}).get("prompt_tokens", 0)
        output_tokens = data.get("usage", {}).get("completion_tokens", 0)
        cost_cny      = estimate_cost(input_tokens, output_tokens, settings.vlm_model_name)

        log_api_call(
            session_id=session_id,
            model=settings.vlm_model_name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_cny=cost_cny,
            latency_ms=latency_ms,
            success=True,
        )

        logger.info(
            "VLM call success",
            session_id=session_id,
            latency_ms=latency_ms,
            tokens=f"{input_tokens}+{output_tokens}",
            cost_cny=cost_cny,
        )

    except httpx.HTTPStatusError as exc:
        latency_ms = int(time.time() * 1000) - start_ms
        err_msg = f"HTTP {exc.response.status_code}: {exc.response.text[:200]}"
        logger.error("VLM HTTP error", session_id=session_id, error=err_msg)
        log_api_call(
            session_id=session_id,
            model=settings.vlm_model_name,
            input_tokens=0, output_tokens=0, cost_cny=0.0,
            latency_ms=latency_ms, success=False, error=err_msg,
        )
        return _empty_result()

    except Exception as exc:
        latency_ms = int(time.time() * 1000) - start_ms
        logger.error("VLM call failed", session_id=session_id, error=str(exc))
        log_api_call(
            session_id=session_id,
            model=settings.vlm_model_name,
            input_tokens=0, output_tokens=0, cost_cny=0.0,
            latency_ms=latency_ms, success=False, error=str(exc),
        )
        return _empty_result()

    # ── 解析响应 ─────────────────────────────────────────────────
    parsed = _parse_vlm_response(raw_text)

    raw_defects: list[dict] = parsed.get("defects", [])
    normalized: list[dict] = []
    for d in raw_defects:
        nd = _normalize_defect(d, source="vlm")
        if nd is not None:
            normalized.append(nd)

    return {
        "face_detected":    bool(parsed.get("face_detected", True)),
        "estimated_age":    int(parsed.get("estimated_age", 0)),
        "defects":          normalized,
        "overall_summary":  str(parsed.get("overall_summary", "")),
        "priority_concerns": list(parsed.get("priority_concerns", [])),
        "vlm_notes":        str(parsed.get("vlm_notes", "")),
        "input_tokens":     input_tokens,
        "output_tokens":    output_tokens,
        "cost_cny":         cost_cny if "cost_cny" in dir() else 0.0,
    }


def _empty_result() -> dict[str, Any]:
    return {
        "face_detected":     False,
        "estimated_age":     0,
        "defects":           [],
        "overall_summary":   "",
        "priority_concerns": [],
        "vlm_notes":         "VLM 不可用（API Key 未配置或调用失败）",
        "input_tokens":      0,
        "output_tokens":     0,
        "cost_cny":          0.0,
    }


def merge_defects(
    geometry_defects: list[dict],
    vlm_defects: list[dict],
) -> list[dict]:
    """
    合并几何引擎和 VLM 缺陷列表：
    - 优先保留 VLM 结果（更丰富的视觉特征）
    - 几何引擎独有的缺陷追加到列表末尾（带低置信度标记）
    - 同名缺陷（name_zh 相同）按 confidence 加权取最大值

    Args:
        geometry_defects: Phase 2 几何引擎输出的 defect dict 列表
        vlm_defects:      Phase 3 VLM 输出的已规范化 defect dict 列表

    Returns:
        合并去重后的 defect dict 列表（内部 _source 字段已清除）
    """
    merged: dict[str, dict] = {}

    # 先放几何结果
    for d in geometry_defects:
        key = d["name_zh"]
        merged[key] = {**d, "_source": "geometry"}

    # VLM 结果覆盖或新增
    for d in vlm_defects:
        key = d["name_zh"]
        if key in merged:
            existing = merged[key]
            # 取较高置信度，severity 取较大值
            if d["confidence"] >= existing["confidence"]:
                merged[key] = {
                    **d,
                    "severity":   max(d["severity"], existing["severity"]),
                    "confidence": round(
                        0.6 * d["confidence"] + 0.4 * existing["confidence"], 3
                    ),
                    "_source": "merged",
                }
        else:
            merged[key] = {**d, "_source": "vlm"}

    # 清除内部字段
    result = []
    for d in merged.values():
        clean = {k: v for k, v in d.items() if not k.startswith("_")}
        result.append(clean)

    return result
