"""
SHA256 缓存服务 — Phase 3
内存 dict 实现（Redis 降级方案）。
同一张图片（相同 SHA256）在同一进程内不会二次调用 VLM。
"""
from __future__ import annotations

import hashlib
import time
from typing import Any

from backend.core.logging_config import get_logger

logger = get_logger(__name__)

# TTL：单次服务进程运行期间有效（重启即失效）
_CACHE_TTL_SECONDS = 3600  # 1 小时


class InMemoryCache:
    """线程安全的内存 KV 缓存，带 TTL。"""

    def __init__(self, ttl: int = _CACHE_TTL_SECONDS) -> None:
        self._store: dict[str, tuple[Any, float]] = {}  # key → (value, expire_at)
        self._ttl = ttl

    def get(self, key: str) -> Any | None:
        entry = self._store.get(key)
        if entry is None:
            return None
        value, expire_at = entry
        if time.time() > expire_at:
            del self._store[key]
            return None
        return value

    def set(self, key: str, value: Any) -> None:
        self._store[key] = (value, time.time() + self._ttl)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def size(self) -> int:
        now = time.time()
        expired = [k for k, (_, exp) in self._store.items() if now > exp]
        for k in expired:
            del self._store[k]
        return len(self._store)


# ── VLM 结果缓存单例 ──────────────────────────────────────────────
vlm_cache = InMemoryCache(ttl=_CACHE_TTL_SECONDS)


def make_cache_key(image_paths: list[str]) -> str:
    """
    根据多张图片的文件路径生成缓存 key。
    实际使用文件内容 SHA256（Phase 3 image_utils.compute_sha256 的结果）。
    此处用路径列表的 SHA256 作为简化 key（路径变则 key 变）。
    """
    raw = "|".join(sorted(image_paths))
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def cache_get_vlm(key: str) -> dict | None:
    result = vlm_cache.get(key)
    if result is not None:
        logger.info("VLM cache hit", key=key[:8])
    return result


def cache_set_vlm(key: str, result: dict) -> None:
    vlm_cache.set(key, result)
    logger.info("VLM result cached", key=key[:8], size=vlm_cache.size())
