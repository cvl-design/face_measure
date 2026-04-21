import uuid
from datetime import datetime
from sqlalchemy import String, Float, Integer, Boolean, DateTime, JSON, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


class Session(Base):
    __tablename__ = "sessions"

    session_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    gender: Mapped[str] = mapped_column(String(10))                  # 'male' | 'female'
    age_group: Mapped[str] = mapped_column(String(10))               # '20-29' | '30-39' ...
    chief_complaint: Mapped[str] = mapped_column(Text, default="")   # 主诉
    allergy_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="capturing")
    # 状态机：capturing → analyzing → consulting → closed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # relationships
    capture: Mapped["FaceCapture | None"] = relationship(back_populates="session", uselist=False)
    detection_result: Mapped["DetectionResult | None"] = relationship(back_populates="session", uselist=False)
    phenotype_match: Mapped["PhenotypeMatchResult | None"] = relationship(back_populates="session", uselist=False)
    treatment_plan: Mapped["TreatmentPlan | None"] = relationship(back_populates="session", uselist=False)


class FaceCapture(Base):
    __tablename__ = "face_captures"

    capture_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.session_id"), unique=True)
    front_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    left45_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    right45_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    left90_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    right90_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality_scores: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # { front: 0.92, left45: 0.87, right45: 0.91, left90: 0.88, right90: 0.90 }
    landmarks_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # { front: [[x,y,z]×478], left45: [...], ... }
    capture_method: Mapped[str] = mapped_column(String(10), default="upload")
    # 'webcam' | 'upload'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    session: Mapped["Session"] = relationship(back_populates="capture")


class DetectionResult(Base):
    __tablename__ = "detection_results"

    result_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.session_id"), unique=True)
    face_detected: Mapped[bool] = mapped_column(Boolean, default=False)
    defects: Mapped[list | None] = mapped_column(JSON, nullable=True)          # List[DefectItem]
    age_assessment: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    aesthetic_metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True) # AestheticMetricsResult
    overall: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    raw_vlm_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_provider: Mapped[str] = mapped_column(String(100), default="")
    api_cost_cny: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    session: Mapped["Session"] = relationship(back_populates="detection_result")


class PhenotypeMatchResult(Base):
    __tablename__ = "phenotype_matches"

    match_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.session_id"), unique=True)
    best_match: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    # { template_id, name_zh, similarity: float }
    all_matches: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # List[{ template_id, name_zh, similarity, aesthetic_tags, thumbnail_url }]
    gap_analysis: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # List[{ metric, current, ideal, delta, treatment_hint }]
    selected_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reference_image_url: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    session: Mapped["Session"] = relationship(back_populates="phenotype_match")


class TreatmentPlan(Base):
    __tablename__ = "treatment_plans"

    plan_id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    session_id: Mapped[str] = mapped_column(String(36), ForeignKey("sessions.session_id"), unique=True)
    ai_recommended: Mapped[list | None] = mapped_column(JSON, nullable=True)  # List[TreatmentItem]
    doctor_selected: Mapped[list | None] = mapped_column(JSON, nullable=True)  # List[TreatmentItem]
    total_price: Mapped[float] = mapped_column(Float, default=0.0)
    simulation_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    session: Mapped["Session"] = relationship(back_populates="treatment_plan")
