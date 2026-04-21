from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── 服务配置 ──────────────────────────────────────────────────
    app_env: str = Field(default="development")
    server_host: str = Field(default="127.0.0.1")
    server_port: int = Field(default=8000)
    log_level: str = Field(default="INFO")

    # ── VLM API ───────────────────────────────────────────────────
    siliconflow_api_key: str = Field(default="")
    siliconflow_base_url: str = Field(default="https://api.siliconflow.cn/v1")
    vlm_model_name: str = Field(default="Qwen/Qwen3-VL-8B-Instruct")
    vlm_timeout_seconds: int = Field(default=60)
    vlm_temperature: float = Field(default=0.1)
    vlm_max_tokens: int = Field(default=2048)
    defect_confidence_threshold: float = Field(default=0.7)

    # ── 本地 AI 模型 ──────────────────────────────────────────────
    mediapipe_model_path: str = Field(default="./ai_models/face_landmarker.task")
    insightface_model_dir: str = Field(default="./ai_models/insightface/")
    template_db_path: str = Field(default="./ai_models/templates/features.index")
    template_meta_path: str = Field(default="./ai_models/templates/metadata.json")

    # ── 缓存 ──────────────────────────────────────────────────────
    redis_url: str = Field(default="")  # 空字符串 = 禁用 Redis，降级内存 dict

    # ── 模拟 API ─────────────────────────────────────────────────
    simulation_provider: str = Field(default="comfyui_autodl")
    comfyui_endpoint: str = Field(default="")
    comfyui_workflow_id: str = Field(default="face_aesthetic_sim_v1")

    # ── 数据 & 隐私 ───────────────────────────────────────────────
    sqlite_path: str = Field(default="./data/facesense.db")
    temp_image_dir: str = Field(default="./data/temp/")
    anonymize_before_api: bool = Field(default=True)
    session_auto_purge: bool = Field(default=True)

    # ── 价格 & 成本 ────────────────────────────────────────────────
    price_catalog_path: str = Field(default="./data/price_catalog.json")
    treatment_rules_path: str = Field(default="./data/treatment_rules.json")
    cost_log_path: str = Field(default="./data/cost_log.jsonl")
    max_image_size_mb: int = Field(default=10)
    max_image_dimension: int = Field(default=1024)

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def temp_image_dir_path(self) -> Path:
        p = Path(self.temp_image_dir)
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def data_dir_path(self) -> Path:
        p = Path(self.sqlite_path).parent
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
