"""
API 成本追踪工具 — Phase 3
将每次 VLM API 调用的成本写入 JSONL 文件，便于离线统计。
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from backend.core.config import settings
from backend.core.logging_config import get_logger

logger = get_logger(__name__)

# SiliconFlow Qwen3-VL-8B-Instruct 价格（单位：元/百万 token）
# 输入 token 含图像 token（按官方文档估算：每张图 ~1000 tokens）
_PRICE_INPUT_PER_M  = 0.21   # ¥0.21 / 1M input tokens
_PRICE_OUTPUT_PER_M = 0.21   # ¥0.21 / 1M output tokens


def estimate_cost(
    input_tokens: int,
    output_tokens: int,
    model: str = "",
) -> float:
    """
    估算 API 成本（人民币元）。

    Args:
        input_tokens:  输入 token 数（含图像 token）
        output_tokens: 输出 token 数
        model:         模型名称（当前仅记录，不影响计算）

    Returns:
        估算成本（元，四舍五入到 4 位小数）
    """
    cost = (
        input_tokens  / 1_000_000 * _PRICE_INPUT_PER_M
        + output_tokens / 1_000_000 * _PRICE_OUTPUT_PER_M
    )
    return round(cost, 6)


def log_api_call(
    session_id: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_cny: float,
    latency_ms: int,
    success: bool,
    error: str = "",
) -> None:
    """
    追加一条 API 调用记录到 JSONL 文件。
    写入失败时仅记录警告，不抛出异常（不影响主流程）。
    """
    record = {
        "ts":            time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "session_id":    session_id,
        "model":         model,
        "input_tokens":  input_tokens,
        "output_tokens": output_tokens,
        "cost_cny":      cost_cny,
        "latency_ms":    latency_ms,
        "success":       success,
        "error":         error,
    }

    try:
        log_path = Path(settings.cost_log_path)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception as exc:
        logger.warning("Failed to write cost log", error=str(exc))
