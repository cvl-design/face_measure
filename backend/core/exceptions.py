from fastapi import HTTPException, status


class FaceSenseError(Exception):
    """所有业务异常的基类"""
    def __init__(self, message: str, detail: str | None = None):
        self.message = message
        self.detail = detail
        super().__init__(message)


class VLMError(FaceSenseError):
    """VLM API 调用失败（超时、解析失败、返回格式异常）"""


class CaptureQualityError(FaceSenseError):
    """图片采集质量不合格（模糊、遮挡、角度偏差、分辨率不足）"""


class TemplateMatchError(FaceSenseError):
    """表型匹配失败（FAISS 索引未加载、特征提取失败）"""


class SimulationError(FaceSenseError):
    """模拟渲染失败（ComfyUI 不可达、任务超时、渲染异常）"""


class SessionError(FaceSenseError):
    """会话状态错误（会话不存在、状态机转换非法）"""


# ── HTTP 异常工厂函数 ─────────────────────────────────────────────

def session_not_found(session_id: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Session '{session_id}' not found",
    )


def session_state_invalid(current: str, expected: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"Session state invalid: expected '{expected}', got '{current}'",
    )


def capture_quality_failed(reasons: list[str]) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"error": "capture_quality_failed", "reasons": reasons},
    )


def vlm_unavailable(reason: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=f"VLM service unavailable: {reason}",
    )
