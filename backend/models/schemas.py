"""
Pydantic v2 数据模型（API 请求/响应层）
与 db/models.py（ORM）分离，仅用于序列化和校验
"""
from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field, ConfigDict


# ── 枚举 ─────────────────────────────────────────────────────────

class Gender(str, Enum):
    male = "male"
    female = "female"


class AgeGroup(str, Enum):
    g20s = "20-29"
    g30s = "30-39"
    g40s = "40-49"
    g50p = "50+"


class SessionStatus(str, Enum):
    capturing = "capturing"
    analyzing = "analyzing"
    consulting = "consulting"
    closed = "closed"


class DefectCategory(str, Enum):
    wrinkle = "wrinkle"           # 皱纹
    volume_loss = "volume_loss"   # 容量缺失
    contour = "contour"           # 轮廓
    ptosis = "ptosis"             # 下垂


class CaptureMethod(str, Enum):
    webcam = "webcam"
    upload = "upload"


class TreatmentCategory(str, Enum):
    anti_aging = "anti_aging"     # 抗衰老
    contouring = "contouring"     # 轮廓优化
    refinement = "refinement"     # 精致化


# ── DefectItem ───────────────────────────────────────────────────

class DefectItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    defect_id: str
    name_zh: str                                  # '法令纹'
    category: DefectCategory
    severity: int = Field(ge=1, le=5)             # 1=极轻, 5=严重
    confidence: float = Field(ge=0.0, le=1.0)
    landmark_refs: list[int] = Field(default_factory=list)
    # MediaPipe 关键点索引（前端用于绘制引导折线）
    clinical_description: str | None = None
    treatment_suggestion: str | None = None
    anatomical_regions: list[str] = Field(default_factory=list)


# ── 几何分析结果 ─────────────────────────────────────────────────

class ThreeSections(BaseModel):
    upper: float        # 发际线~眉骨
    middle: float       # 眉骨~鼻底
    lower: float        # 鼻底~下颌
    ratios: dict[str, float]
    score: float
    advice: str


class FiveEyes(BaseModel):
    eye_width: float
    face_width: float
    ratio: float
    score: float
    advice: str


class FaceShape(BaseModel):
    classification: str         # '鹅蛋形' | '瓜子形' | '心形' | '方形' | '长形'
    width_height_ratio: float
    score: float


class AestheticMetricsResult(BaseModel):
    three_sections: ThreeSections
    five_eyes: FiveEyes
    face_shape: FaceShape
    malar_prominence: dict[str, Any]    # { ratio, score, advice }
    brow_arch: dict[str, Any]           # { left_q_point, right_q_point, score }
    highlight_points: dict[str, Any]    # { malar, cheek, brow }
    symmetry: dict[str, Any]            # { score, asymmetric_features }
    composite_score: int = Field(ge=0, le=100)


# ── 表型匹配 ─────────────────────────────────────────────────────

class TemplateMatch(BaseModel):
    template_id: str
    name_zh: str
    similarity: float = Field(ge=0.0, le=1.0)
    aesthetic_tags: dict[str, str] = Field(default_factory=dict)
    thumbnail_url: str = ""


class GapAnalysisItem(BaseModel):
    metric: str             # '三庭比例' | '五眼宽度' ...
    current: float
    ideal: float
    delta: float
    treatment_hint: str


class PhenotypeMatchResult(BaseModel):
    best_match: TemplateMatch
    all_matches: list[TemplateMatch]    # Top5
    gap_analysis: list[GapAnalysisItem]
    selected_id: str | None = None
    reference_image_url: str = ""


# ── 治疗方案 ─────────────────────────────────────────────────────

class TreatmentItem(BaseModel):
    item_id: str
    name: str                   # '玻尿酸 · 法令纹填充'
    category: TreatmentCategory
    intensity: float = Field(ge=0.0, le=1.0, default=0.5)
    unit_price: float
    priority: int = 0


class TreatmentPlanResponse(BaseModel):
    plan_id: str
    session_id: str
    ai_recommended: list[TreatmentItem] = Field(default_factory=list)
    doctor_selected: list[TreatmentItem] = Field(default_factory=list)
    total_price: float = 0.0
    simulation_url: str | None = None
    notes: str | None = None


# ── Session 请求/响应 ─────────────────────────────────────────────

class SessionCreate(BaseModel):
    gender: Gender
    age_group: AgeGroup
    chief_complaint: str = Field(default="", max_length=500)
    allergy_note: str | None = Field(default=None, max_length=200)


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    session_id: str
    gender: str
    age_group: str
    chief_complaint: str
    allergy_note: str | None
    status: str
    created_at: datetime
    closed_at: datetime | None


# ── 采集请求/响应 ─────────────────────────────────────────────────

class CaptureQualityScore(BaseModel):
    angle: str = ""                       # 角度标签，如 'front' / 'left45'
    lighting: float = Field(ge=0.0, le=1.0)
    occlusion: float = Field(ge=0.0, le=1.0)
    sharpness: float = Field(ge=0.0, le=1.0)
    overall: float = Field(ge=0.0, le=1.0)
    passed: bool
    reasons: list[str] = Field(default_factory=list)


class CaptureQualityReport(BaseModel):
    capture_id: str
    session_id: str
    quality_scores: dict[str, CaptureQualityScore]
    all_passed: bool


class CaptureUploadResponse(BaseModel):
    capture_id: str
    session_id: str
    uploaded_angles: list[str]           # 实际上传的角度名列表
    quality_scores: dict[str, CaptureQualityScore]
    all_passed: bool
    message: str


# ── 分析结果响应 ─────────────────────────────────────────────────

class AgeAssessment(BaseModel):
    estimated_age: int
    vlm_age: int | None = None
    mediapipe_age: int | None = None
    confidence: float = 0.0


class OverallAssessment(BaseModel):
    composite_score: int = Field(ge=0, le=100)
    summary: str = ""
    priority_concerns: list[str] = Field(default_factory=list)


class DetectionResultResponse(BaseModel):
    result_id: str
    session_id: str
    face_detected: bool
    defects: list[DefectItem] = Field(default_factory=list)
    age_assessment: AgeAssessment | None = None
    aesthetic_metrics: AestheticMetricsResult | None = None
    overall: OverallAssessment | None = None
    api_provider: str = ""
    api_cost_cny: float = 0.0
    annotated_image_url: str = ""   # Phase 3: base64 data URL of landmark-annotated image


# ── 健康检查 ─────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    env: str
    db: str = "ok"
    mediapipe_loaded: bool = False
    faiss_loaded: bool = False
