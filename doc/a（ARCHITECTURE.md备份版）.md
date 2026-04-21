---
  AI 辅助医生智能面诊系统 — 企业级架构文档

  项目代号：FaceSense
  阶段：PoC 单诊所验证
  目标周期：4–6 周
  最后更新：2026-04-21

  ---
  一、产品 SOP（标准操作流程）

  STAGE 0 — 接诊登记（约 30s）
    医生开启系统 → 录入基本信息（性别 / 年龄段 / 主诉）
    → 系统生成会话 ID → 显示隐私声明确认

  STAGE 1 — 多视角面部采集（约 2–3min）
    两种采集方式（任选其一或混合使用）：
    ┌──────────────────────────────────────────────────────┐
    │ 方式A：摄像头实时捕捉                                   │
    │  MediaPipe WASM 实时检测角度/清晰度/遮挡               │
    │  屏幕显示引导框 → 人脸保持目标角度 ≥1.5s → 自动抓取     │
    │ 方式B：手动上传 5 张静态图片                            │
    │  上传后逐张质量评估（模糊/角度偏差/遮挡检测）            │
    └──────────────────────────────────────────────────────┘
    采集顺序：正面(0°) → 左45° → 右45° → 左90° → 右90°
    质检不合格 → 实时标红提示 → 引导重拍/重传

  STAGE 2 — 后台并行分析（约 18–25s，前端显示三路进度动画）
    ┌─────────────────┬──────────────────────┬─────────────────────┐
    │  VLM 检测（后端） │  MediaPipe 几何（前端）│   表型匹配（后端）    │
    │  5张图打包调用   │  478点关键点提取      │  ArcFace特征向量     │
    │  28类缺陷+严重度 │  三庭五眼/面型/对称性 │  FAISS → Top5匹配   │
    └─────────────────┴──────────────────────┴─────────────────────┘
    VLM 策略：5张图单次打包 → 输出综合评估报告（均值~18s）

  STAGE 3 — 美学表型呈现（约 3–5min）[制造期望感]
    展示 Top5 虚拟参考面（相似度% + 美学标签）
    例："您的骨相与「知性轮廓型」相似度 83%，
         优化下颌缘后可提升至 94%"
    医生审核并选定参考方向 → gap_analysis 驱动后续推荐

  STAGE 4 — AI 检测报告（在 Workspace 页展示，约 3–5min）[建立信任感]
    左侧：标注图
      MediaPipe 关键点 + 指导折线（一端→缺陷区域，另一端→问题类别标签）
      置信度 < 0.7 的缺陷不渲染折线
    右侧：缺陷列表（28类 / 5级严重度 / 自然语言描述）
    分类：【年轻化问题】抗衰老 ｜ 【精致化问题】美学优化
    医生可勾选/取消检测项，调整优先级

  STAGE 5 — 方案协创 + 实时模拟（在 Workspace 页，约 5–10min）[促成交]
    菜单式勾选治疗项目 + 强度滑块
    四阶段模拟画面同步展示：
    ┌──────────┬──────────┬──────────┬──────────┐
    │ 当前状态  │ 年轻化   │ 轮廓优化  │ 综合效果  │
    │（标注图） │（模拟图1）│（模拟图2）│（模拟图3）│
    └──────────┴──────────┴──────────┴──────────┘
    快速预览（<500ms）：TPS 本地 2D 变形
    高质量渲染（~5–15s）：点击「生成高清」→ ComfyUI@AutoDL

  STAGE 6 — 方案确认与报价（约 2min）
    医生最终审核 → 生成报价单（项目明细 + 价格）
    导出 PDF 面诊报告（检测图 + 美学分析 + 模拟效果 + 价格明细）

  STAGE 7 — 数据清除
    会话关闭 → 原始人脸图像即时删除
    保留：会话ID + 项目选择记录 + 脱敏分析摘要
    符合「用完即删」隐私承诺

  ---
  二、技术路线总览

  用户照片（5角度，摄像头或手动上传）
     │
     ▼
  [采集引导层]  React + MediaPipe WASM（实时角度/质量校验）
     │  前端压缩至 ≤1080px + EXIF 剥离后上传
     ▼
  [后端接收]    FastAPI  POST /sessions/{id}/capture
     │
     ├─────────────────────────────────────┐
     ▼                                     ▼
  [VLM 检测]                         [几何分析]
  backend/services/vlm_detector.py   frontend/core/aestheticMetrics.ts
  SiliconFlow                        MediaPipe WASM 478点
  Qwen/Qwen3-VL-8B-Instruct         三庭五眼/面型/高光点/对称性
  5张打包→综合评估（~18s）            → AestheticMetricsResult
  28类缺陷 + 5级严重度 + confidence
     │                                     │
     └──────────────┬──────────────────────┘
                    ▼
  [SHA256 缓存检查]  backend/services/cache_service.py
     │  命中(Redis/内存dict) → 直接返回，零API成本
     │  未命中 → 继续
                    ▼
  [标注渲染]   前端 Canvas（annotationRenderer.ts）
     │  VLM缺陷列表 × MediaPipe关键点坐标
     │  confidence ≥ 0.7 → 绘制指导折线
     │  折线：关键点位置 ──▶ 问题类别标签
                    ▼
  [表型匹配]   backend/services/template_matcher.py
     │  ArcFace 512维特征 → FAISS IVFFlat → Top5虚拟参考面
     │  → gap_analysis（当前指标 vs 理想指标）
                    ▼
  [治疗推荐]   backend/services/treatment_engine.py
     │  28类缺陷 + gap_analysis → 规则引擎 → 项目组合推荐
                    ▼
  [模拟渲染]   本地TPS快速预览 + ComfyUI@AutoDL高质量（按需）
                    ▼
  [成本记录]   backend/utils/cost_tracker.py → cost_log.jsonl

  前端框架选型：React 18 + TypeScript

  ▎ 前端完全重新设计，无历史包袱。React + TypeScript 对 Canvas 操作（MediaPipe 关键点绘制、折线标注、TPS变形）生态更成熟；复杂异步状态（WebSocket + 多图并发 + 实时模拟）在 React + Zustand 下更易维护；TypeScript
  ▎ 类型安全在医疗级产品中尤为重要。

  ---
  三、分层架构详述

  3.1 前端分层（React 18 + TypeScript + Tailwind CSS + Zustand）

  frontend/
  ├── pages/                          # 6个主页面（对应 SOP Stage）
  │   ├── Welcome.tsx                 # STAGE 0：接诊登记
  │   ├── Capture.tsx                 # STAGE 1：多视角采集
  │   ├── Analyzing.tsx               # STAGE 2：三路并行分析进度
  │   ├── Templates.tsx               # STAGE 3：表型参考面展示
  │   ├── Workspace.tsx               # STAGE 4+5：检测报告+方案协创+模拟（合并）
  │   └── Summary.tsx                 # STAGE 6：报价确认+PDF导出
  │
  ├── components/                     # 按功能模块分组
  │   ├── capture/
  │   │   ├── WebcamCapture.tsx       # 摄像头实时捕捉
  │   │   ├── AngleGuideOverlay.tsx   # 角度引导框（保持目标角度≥1.5s自动抓取）
  │   │   └── ImageUpload.tsx         # 手动上传5张（含质量预检）
  │   │
  │   ├── analysis/
  │   │   ├── FaceAnnotator.tsx       # Canvas标注：关键点+指导折线
  │   │   ├── DefectList.tsx          # 缺陷列表（28类/5级/分类展示）
  │   │   └── AestheticRadar.tsx      # 雷达图：美学评分可视化
  │   │
  │   ├── template/
  │   │   ├── TemplateGallery.tsx     # Top5虚拟参考面画廊
  │   │   ├── TemplateCard.tsx        # 单个参考面：缩略图+相似度+美学标签
  │   │   └── GapAnalysisPanel.tsx    # 差距分析：当前vs理想+治疗提示
  │   │
  │   ├── treatment/
  │   │   ├── TreatmentMenu.tsx       # 菜单式勾选（3大类）+强度滑块
  │   │   └── PriceSheet.tsx          # 实时价格汇总
  │   │
  │   └── simulation/
  │       ├── SimulationStages.tsx    # 四阶段画面并排展示
  │       └── BeforeAfterSlider.tsx   # 原图/模拟图滑动对比
  │
  ├── core/                           # 纯算法层（无UI依赖，可独立测试）
  │   ├── aestheticMetrics.ts         # 三庭五眼/面型/高光点几何算法
  │   ├── annotationRenderer.ts       # 指导折线绘制逻辑（Canvas API）
  │   ├── morphingEngine.ts           # TPS本地2D变形（目标<16ms）
  │   └── mediapipeLoader.ts          # MediaPipe WASM单例加载器
  │
  ├── store/
  │   └── sessionStore.ts             # Zustand单一Store（会话ID/图像/分析结果/选定项目）
  │
  └── services/
      ├── api.ts                      # Axios封装（REST + WebSocket）
      └── captureUtils.ts             # 图片压缩/EXIF剥离工具

  UI 交互原则：
  - Workspace 页双栏布局：左栏「医生操作区」（缺陷列表+治疗菜单）/ 右栏「客户视觉展示区」（标注图+模拟图）
  - 全程大字体（≥16px）+ 高对比度，医生和客户共用同屏
  - STAGE 2 分析中：三路独立进度条（VLM检测 / 几何分析 / 表型匹配）
  - API 等待期间显示骨架屏，不使用旋转加载圈

  3.2 后端分层（Python FastAPI）

  backend/
  ├── main.py                         # FastAPI入口 + CORS + 路由注册 + 生命周期钩子
  │
  ├── core/
  │   ├── config.py                   # pydantic-settings 环境变量管理
  │   ├── exceptions.py               # 5类业务异常：
  │   │                               #   VLMError / CaptureQualityError /
  │   │                               #   TemplateMatchError / SimulationError / SessionError
  │   └── logging_config.py           # structlog JSON结构化日志
  │
  ├── prompts/
  │   └── detector_prompt.md          # VLM System Prompt（版本化管理，独立迭代）
  │
  ├── routers/                        # 路由层（薄控制器，不含业务逻辑）
  │   ├── session.py
  │   ├── capture.py
  │   ├── analysis.py
  │   ├── templates.py
  │   ├── treatment.py
  │   ├── simulation.py
  │   ├── report.py
  │   └── health.py
  │
  ├── services/                       # 业务逻辑层
  │   ├── vlm_detector.py             # Qwen3-VL-8B（5图打包→综合评估）
  │   ├── face_detector.py            # MediaPipe Python（批量关键点持久化，启动时单例加载）
  │   ├── defect_scorer.py            # 几何规则引擎→缺陷评分（纯计算，无IO）
  │   ├── aesthetic_analyzer.py       # AestheticMetricsResult 组装
  │   ├── template_matcher.py         # InsightFace ArcFace + FAISS → Top5
  │   ├── treatment_engine.py         # 规则引擎→治疗项目推荐
  │   ├── simulation_client.py        # TPS本地 + ComfyUI@AutoDL（按需）
  │   ├── cache_service.py            # Redis SHA256缓存（不可用时降级内存dict）
  │   ├── anonymizer.py               # API发送前人脸脱敏 + EXIF剥离
  │   └── report_exporter.py          # WeasyPrint → PDF
  │
  ├── models/
  │   └── schemas.py                  # Pydantic v2 全部数据模型
  │
  ├── db/
  │   ├── database.py                 # SQLite + SQLAlchemy（WAL模式）
  │   └── orm_models.py               # ORM表定义
  │
  └── utils/
      ├── image_utils.py              # resize / EXIF / base64工具
      └── cost_tracker.py             # API调用成本 JSONL记录

  ---
  四、核心数据模型

  # ── Session ─────────────────────────────────────────────────────
  Session:
    session_id:        UUID
    gender:            str          # 'male' | 'female'
    age_group:         str          # '20-29'|'30-39'|'40-49'|'50+'
    chief_complaint:   str          # 主诉（自由文本）
    status:            str          # 'capturing'|'analyzing'|'consulting'|'closed'
    created_at:        datetime
    closed_at:         datetime | None

  # ── FaceCapture（5角度，会话关闭后删除图像文件）────────────────
  FaceCapture:
    capture_id:        UUID
    session_id:        UUID   (FK)
    front_path:        str          # 临时路径，关闭后删除
    left45_path:       str
    right45_path:      str
    left90_path:       str
    right90_path:      str
    quality_scores:    JSON         # {front:0.92, left45:0.88, ...}
    capture_method:    str          # 'webcam' | 'upload'

  # ── VLMAnalysisResult（5图综合评估）────────────────────────────
  VLMAnalysisResult:
    vlm_result_id:     UUID
    session_id:        UUID   (FK)
    age_estimate:      int
    defects:           List[DefectItem]
    overall_score:     float        # 0–100 综合颜值评分
    vlm_narrative:     str          # 自然语言美学优化建议（中文）
    model_used:        str          # 实际使用模型版本
    processing_ms:     int          # VLM 耗时记录（ms）

  # DefectItem（内嵌）:
    defect_id:         str          # 'nasolabial_fold'
    name_zh:           str          # '法令纹'
    category:          str          # 'wrinkle'|'volume_loss'|'contour'|'ptosis'
    severity:          int          # 1–5（1极轻微，5重度）
    confidence:        float        # 0.0–1.0
    # ★ 不使用VLM bounding_box
    # ★ 由MediaPipe关键点提供精确坐标，confidence≥0.7才渲染折线
    landmark_indices:  List[int]    # 关联MediaPipe关键点索引（折线起点）
    treatment_hint:    str          # '透明质酸填充'
    affected_angles:   List[str]    # 在哪些角度最明显

  # ── AestheticMetricsResult（MediaPipe几何分析）─────────────────
  AestheticMetricsResult:
    session_id:        UUID   (FK)
    three_sections:    JSON         # {upper,middle,lower,ratios,score,advice}
    five_eyes:         JSON         # {eye_width,face_width,ratio,score,advice}
    face_shape:        JSON         # {classification,width_height_ratio,score}
                                    # classification: 鹅蛋/瓜子/心形/方形/圆形
    malar_prominence:  JSON         # 颧骨高光点位置分析
    brow_arch:         JSON         # 眉弓Q点位置
    highlight_points:  JSON         # {malar,cheek,brow} 高光点坐标
    symmetry:          JSON         # {score, asymmetric_features}
    composite_score:   int          # 0–100 综合美学评分

  # ── PhenotypeMatchResult（表型匹配）─────────────────────────────
  PhenotypeMatchResult:
    session_id:        UUID   (FK)
    top5:              List[TemplateMatch]
    selected_id:       str          # 医生选定的参考面ID
    gap_analysis:      List[GapItem]

  # TemplateMatch（内嵌）:
    template_id:       str
    name_zh:           str          # '知性优雅型'
    similarity:        float        # 0.0–1.0
    aesthetic_tags:    List[str]    # ['流线轮廓','高颧弓','立体骨感']
    thumbnail_url:     str

  # GapItem（内嵌）:
    metric:            str          # '下颌缘清晰度'
    current_value:     float
    ideal_value:       float
    delta:             float
    treatment_hint:    str          # '肉毒素+玻尿酸下颌缘塑形'

  # ── TreatmentPlan ───────────────────────────────────────────────
  TreatmentPlan:
    plan_id:           UUID
    session_id:        UUID   (FK)
    ai_recommended:    List[TreatmentItem]
    doctor_selected:   List[TreatmentItem]
    total_price:       float
    simulation_jobs:   JSON         # {stage1_job_id, stage2_job_id, stage3_job_id}
    notes:             str          # 医生备注

  # TreatmentItem（内嵌）:
    item_id:           str          # 'hyaluronic_nasolabial'
    name:              str          # '玻尿酸·法令纹填充'
    category:          str          # 'anti_aging'|'contouring'|'refinement'
    intensity:         float        # 0.0–1.0（强度滑块值）
    unit_price:        float
    priority:          int          # AI推荐优先级

  ---
  五、关键配置（.env）

  # ── 服务 ──────────────────────────────────────────────────────────
  APP_ENV=development
  SERVER_HOST=127.0.0.1
  SERVER_PORT=8000
  LOG_LEVEL=INFO
  LOG_FORMAT=json                      # json | text（structlog格式）

  # ── 本地 AI 模型 ───────────────────────────────────────────────────
  MEDIAPIPE_MODEL_PATH=./ai_models/face_landmarker.task
  INSIGHTFACE_MODEL_DIR=./ai_models/insightface/
  TEMPLATE_DB_PATH=./ai_models/templates/features.index
  TEMPLATE_META_PATH=./ai_models/templates/metadata.json

  # ── VLM 主力：SiliconFlow Qwen3-VL-8B-Instruct ────────────────────
  SILICONFLOW_API_KEY=your_key_here
  SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
  VLM_MODEL_NAME=Qwen/Qwen3-VL-8B-Instruct
  VLM_TIMEOUT_SECONDS=60               # 均值18s，留余量
  VLM_TEMPERATURE=0.1
  VLM_MAX_TOKENS=2048
  DEFECT_CONFIDENCE_THRESHOLD=0.7      # 低于此值不渲染指导折线

  # ── 缓存（Redis可选，不填则自动降级内存dict）──────────────────────
  REDIS_URL=                           # redis://localhost:6379/0
  CACHE_TTL_SECONDS=86400              # 24h

  # ── 模拟 API ───────────────────────────────────────────────────────
  SIMULATION_PROVIDER=comfyui_autodl   # comfyui_autodl | perfect_corp（备用）
  COMFYUI_ENDPOINT=http://your-autodl-instance:8188
  COMFYUI_WORKFLOW_ID=face_aesthetic_sim_v1
  PERFECT_CORP_API_KEY=                # 备用留空

  # ── 数据 & 隐私 ────────────────────────────────────────────────────
  SQLITE_PATH=./data/facesense.db
  TEMP_IMAGE_DIR=./data/temp/
  ANONYMIZE_BEFORE_API=true
  SESSION_AUTO_PURGE=true

  # ── 业务配置 ───────────────────────────────────────────────────────
  PRICE_CATALOG_PATH=./data/price_catalog.json
  TREATMENT_RULES_PATH=./data/treatment_rules.json
  COST_LOG_PATH=./data/cost_log.jsonl

  ---
  六、API 端点速览

  ┌────────┬──────────────────────────────────┬────────────────────────────────────┬──────┐
  │  方法  │               路径               │                说明                │ 状态 │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /health                          │ 服务健康检查                       │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ POST   │ /sessions                        │ 创建会话（接诊登记）               │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ DELETE │ /sessions/{id}                   │ 关闭会话（触发图像清除）           │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ POST   │ /sessions/{id}/capture           │ 上传5角度图片+质量评估             │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /sessions/{id}/capture/quality   │ 获取采集质量报告                   │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ POST   │ /sessions/{id}/analyze           │ 触发三路并行分析                   │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /sessions/{id}/analysis          │ 获取VLM+几何分析结果               │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /sessions/{id}/templates         │ 获取Top5表型匹配+gap_analysis      │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ PUT    │ /sessions/{id}/templates/select  │ 医生选定参考面                     │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /sessions/{id}/treatment         │ 获取AI推荐方案                     │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ PUT    │ /sessions/{id}/treatment         │ 医生更新选定项目                   │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ POST   │ /sessions/{id}/simulate          │ 请求高质量模拟（异步，返回job_id） │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /sessions/{id}/simulate/{job_id} │ 轮询模拟结果                       │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ WS     │ /ws/sessions/{id}/simulate       │ WebSocket实时渲染进度推送          │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /sessions/{id}/report            │ 导出PDF报告（二进制流）            │ 🔲   │
  ├────────┼──────────────────────────────────┼────────────────────────────────────┼──────┤
  │ GET    │ /catalog/treatments              │ 获取完整治疗项目目录（含价格）     │ 🔲   │
  └────────┴──────────────────────────────────┴────────────────────────────────────┴──────┘

  ---
  七、开发阶段路线

  ┌─────────┬─────────────────────────────────────────────────────────────────┬──────────┬──────┐
  │  Phase  │                            核心内容                             │   周期   │ 状态 │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 0 │ 项目骨架：FastAPI + React18 + SQLite + .env规范 + structlog     │ Week 1   │ 🔲   │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 1 │ 面部采集：摄像头引导(WASM质检) + 手动上传 + 质量评估接口        │ Week 1–2 │ 🔲   │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 2 │ 本地分析：MediaPipe Python关键点 + 几何算法 + 缺陷评分规则引擎  │ Week 2   │ 🔲   │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 3 │ VLM接入：Qwen3-VL-8B 5图打包 + Prompt调优 + 指导折线渲染        │ Week 3   │ 🔲   │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 4 │ 表型匹配：SDXL生成模板库 + FAISS索引 + Top5展示 + gap_analysis  │ Week 3–4 │ 🔲   │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 5 │ 方案协创：治疗目录JSON + 菜单勾选 + 强度滑块 + 实时计价         │ Week 4   │ 🔲   │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 6 │ 模拟渲染：TPS快速预览 + ComfyUI@AutoDL + 四阶段画面展示         │ Week 5   │ 🔲   │
  ├─────────┼─────────────────────────────────────────────────────────────────┼──────────┼──────┤
  │ Phase 7 │ 收尾：PDF报告 + 数据清除钩子 + 成本追踪 + 端到端联调 + Demo数据 │ Week 6   │ 🔲   │
  └─────────┴─────────────────────────────────────────────────────────────────┴──────────┴──────┘

  后续拓展（PoC验证后）：
  - Phase 8：语音引导（TTS）、视频面诊模块
  - Phase 9：多诊所SaaS化、HIS系统对接

  ---
  八、性能陷阱与规避策略

  ┌─────────────────────────────────┬────────────────────────┬─────────────────────────────────────────────────────┐
  │              陷阱               │          风险          │                      规避策略                       │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ MediaPipe WASM 首次加载 2–4s    │ 采集页冻结             │ STAGE 0 期间后台静默预加载                          │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ Qwen3-VL 推理~18s，5图串行则90s │ 等待过长               │ 5图打包单次调用 → 降至18–25s；异步任务+三路进度动画 │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ MediaPipe Python 重复加载模型   │ 首次延迟8–15s          │ FastAPI 启动时单例预加载，全程复用                  │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ 5张高清图同时上传               │ 前端卡顿/后端OOM       │ 前端逐张压缩至≤1080p，后端body限制15MB              │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ FAISS 冷启动                    │ 首次匹配慢             │ 应用启动时预加载索引到内存（<50MB）                 │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ Redis 不可用                    │ 缓存失效 → API重复调用 │ cache_service.py 自动降级内存dict，不阻塞主流程     │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ WebSocket 推送频率过高          │ 前端渲染抖动           │ 节流：最高2fps进度更新，最终图一次性推送            │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ 临时图像未清理                  │ 磁盘泄漏               │ 会话关闭钩子 + 每小时定时扫描清理过期文件           │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ SQLite 写入锁                   │ 并发写入卡死           │ WAL模式开启（单诊所并发低，足够）                   │
  ├─────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────┤
  │ TPS变形精度有限                 │ 客户感知效果差         │ TPS仅作快速预览，高质量走ComfyUI API                │
  └─────────────────────────────────┴────────────────────────┴─────────────────────────────────────────────────────┘

  ---
  九、成本控制机制

  单次面诊 API 成本估算：

  Qwen3-VL-8B（SiliconFlow）5图综合    ≈ ¥0.02–0.05
  ComfyUI@AutoDL 模拟图（按需触发）     ≈ ¥0.1–0.5（按小时租用均摊）
  ─────────────────────────────────────────────────────
  单次面诊 API 总成本                   ≈ ¥0.15–0.55
  （对比原方案¥0.6–2.1，成本降低 70%+）

  控制策略：
  1. 本地优先：MediaPipe/InsightFace 完成全部几何计算，不调外部 API
  2. SHA256图片缓存：同一批图片24h内不重复调用VLM（Redis或内存dict）
  3. 5图打包：单次VLM调用处理所有角度，非串行5次
  4. 模拟按需触发：医生主动点击「生成高清」才调ComfyUI，滑块走本地TPS
  5. AutoDL按量付费：GPU渲染按小时租用，PoC阶段无需固定持有
  6. JSONL成本日志：每次API调用记录token数和估算费用，定期汇总

  ---
  十、虚拟美学表型库构建方案

  ▎ 规避版权风险、实现「骨相参考面」功能的核心技术资产。全部使用 AI 生成图像，无版权问题。

  构建流程：

  1. 使用 SDXL + 亚洲面孔 LoRA（AutoDL GPU）生成 500–1000 张虚拟人物头像
  参数控制：性别 × 年龄段(20-29/30-39/40-49) × 脸型(5类) × 风格(知性/甜美/英气/优雅/清冷)
  2. 使用 InsightFace ArcFace 提取每张人脸 512 维特征向量
  3. 为每张图标注美学标签：{face_shape, highlight_profile, contour_style, aesthetic_label}
  4. 使用 FAISS IVFFlat 构建索引（Top-K检索 < 10ms）
  5. 查询：客户正面照 → ArcFace特征 → FAISS Top5 → 相似度% + gap_analysis 输出

  ---
  十一、项目目录结构

  face_measure/
  ├── doc/
  │   └── ARCHITECTURE.md
  │
  ├── backend/
  │   ├── main.py
  │   ├── core/
  │   │   ├── config.py
  │   │   ├── exceptions.py              # VLMError/CaptureQualityError/...
  │   │   └── logging_config.py          # structlog JSON格式
  │   ├── prompts/
  │   │   └── detector_prompt.md         # VLM Prompt版本化管理
  │   ├── routers/
  │   │   ├── session.py
  │   │   ├── capture.py
  │   │   ├── analysis.py
  │   │   ├── templates.py
  │   │   ├── treatment.py
  │   │   ├── simulation.py
  │   │   ├── report.py
  │   │   └── health.py
  │   ├── services/
  │   │   ├── vlm_detector.py
  │   │   ├── face_detector.py
  │   │   ├── defect_scorer.py
  │   │   ├── aesthetic_analyzer.py
  │   │   ├── template_matcher.py
  │   │   ├── treatment_engine.py
  │   │   ├── simulation_client.py
  │   │   ├── cache_service.py           # Redis + 内存dict降级
  │   │   ├── anonymizer.py
  │   │   └── report_exporter.py
  │   ├── models/
  │   │   └── schemas.py                 # Pydantic v2 全部模型
  │   ├── db/
  │   │   ├── database.py                # SQLite WAL模式
  │   │   └── orm_models.py
  │   └── utils/
  │       ├── image_utils.py
  │       └── cost_tracker.py            # JSONL成本记录
  │
  ├── frontend/
  │   ├── src/
  │   │   ├── pages/
  │   │   │   ├── Welcome.tsx
  │   │   │   ├── Capture.tsx
  │   │   │   ├── Analyzing.tsx
  │   │   │   ├── Templates.tsx
  │   │   │   ├── Workspace.tsx
  │   │   │   └── Summary.tsx
  │   │   ├── components/
  │   │   │   ├── capture/
  │   │   │   │   ├── WebcamCapture.tsx
  │   │   │   │   ├── AngleGuideOverlay.tsx
  │   │   │   │   └── ImageUpload.tsx
  │   │   │   ├── analysis/
  │   │   │   │   ├── FaceAnnotator.tsx
  │   │   │   │   ├── DefectList.tsx
  │   │   │   │   └── AestheticRadar.tsx
  │   │   │   ├── template/
  │   │   │   │   ├── TemplateGallery.tsx
  │   │   │   │   ├── TemplateCard.tsx
  │   │   │   │   └── GapAnalysisPanel.tsx
  │   │   │   ├── treatment/
  │   │   │   │   ├── TreatmentMenu.tsx
  │   │   │   │   └── PriceSheet.tsx
  │   │   │   └── simulation/
  │   │   │       ├── SimulationStages.tsx
  │   │   │       └── BeforeAfterSlider.tsx
  │   │   ├── core/
  │   │   │   ├── aestheticMetrics.ts
  │   │   │   ├── annotationRenderer.ts
  │   │   │   ├── morphingEngine.ts
  │   │   │   └── mediapipeLoader.ts
  │   │   ├── store/
  │   │   │   └── sessionStore.ts
  │   │   └── services/
  │   │       ├── api.ts
  │   │       └── captureUtils.ts
  │   ├── package.json
  │   └── vite.config.ts
  │
  ├── ai_models/
  │   ├── face_landmarker.task
  │   ├── insightface/
  │   └── templates/
  │       ├── features.index
  │       ├── metadata.json
  │       └── thumbnails/
  │
  ├── data/
  │   ├── price_catalog.json
  │   ├── treatment_rules.json
  │   ├── cost_log.jsonl
  │   └── temp/
  │
  ├── .env.example
  ├── .env
  ├── requirements.txt
  └── README.md

  ---
  以上是完整最终版本，11个章节全部覆盖所有优化点。