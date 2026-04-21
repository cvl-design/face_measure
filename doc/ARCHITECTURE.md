# AI 辅助医生智能面诊系统 — 企业级架构文档

**项目代号**：FaceSense
**阶段**：PoC 单诊所验证
**目标周期**：4–6 周
**最后更新**：2026-04-21

---

## 一、产品 SOP（标准操作流程）

```
STAGE 0 — 会话建立（约 30s）
  医生开启系统 → 录入基本信息（年龄段 / 主诉 / 过敏史）
  → AI 风险声明确认

STAGE 1 — 多角度面部采集（约 2–3min）
  系统引导完成 5 角度拍摄：正面 0° / 左45° / 右45° / 左90° / 右90°
  采集方式（二选一）：
    ① 摄像头自动采集：MediaPipe WASM 实时检测角度/光线/遮挡/清晰度
       → 角度保持 ≥1.5s 自动触发采集
    ② 手动上传：一次上传 5 张对应角度照片
  → 医生预览确认 → 提交分析

  后台并行处理：
  ┌─────────────────┬────────────────────┬──────────────────────┐
  │  VLM 综合检测    │  MediaPipe 几何分析  │   表型匹配            │
  │  5 张图打包单次  │  （三庭五眼/面型）   │  （10 种虚拟模板）    │
  │  调用 Qwen3-VL  │  Python 后端批处理   │  FAISS 向量检索       │
  └─────────────────┴────────────────────┴──────────────────────┘

STAGE 2 — 美学表型呈现（约 3–5min）[制造期望]
  ① 骨相分析：三庭比例 / 五眼宽度 / 面型分类 / 对称性评分
  ② 表型匹配：
     "您的骨相与【知性优雅型】模板相似度 83%"
     → 展示对应风格虚拟参考人物图
  ③ 提升路径（gap_analysis）："优化下颌缘轮廓后，相似度可提升至 94%"

STAGE 3 — AI 检测报告（约 3–5min）[建立信任]
  【年轻化项目】皱纹 / 下垂 / 容量缺失（28类缺陷 × 5级严重度）
  【精致化项目】骨相调整 / 轮廓优化
  缺陷标注：MediaPipe 关键点坐标 → 引导折线（端点=关键点，另端=缺陷标签）
            仅 confidence ≥ 0.7 的缺陷渲染引导线
  医生操作：审阅结果 → 勾选 / 取消 → 标注优先级

STAGE 4+5 — 实时效果模拟 + 方案协创（约 5–10min）[促成交]
  左：Before（当前标注照片）
  右：After（实时变形预览）
  模拟分 4 阶段展示：① 当前状态 → ② 抗衰老效果 → ③ 轮廓优化效果 → ④ 综合效果
  医生逐项勾选 → TPS 本地快速预览（<500ms）→ 右下角累计价格实时更新
  [查看精细效果] → 触发 ComfyUI@AutoDL 高质量渲染（~5–15s）

STAGE 6 — 方案确认 + 报告输出（约 2min）
  医生最终审核 → 生成面诊报告（PDF，WeasyPrint）
  包含：检测结果 / 美学分析 / 模拟效果图 / 价格明细
  输出：打印 / 二维码分享 / 本地存档

STAGE 7 — 数据清除
  会话结束：原始人脸图像本地即时删除
  仅保留：会话 ID + 治疗项目选择 + 脱敏分析数据
  符合「用完即删」隐私承诺
```

---

## 二、技术路线总览

```
用户照片（5角度）
   │
   ▼
[采集引导层]         frontend/components/capture/
   │  MediaPipe WASM 实时角度/质量校验（摄像头模式）
   │  或 5张图片批量上传（手动模式）
   ▼
[图片预处理]          backend/utils/image_utils.py
   │  resize ≤1024px / EXIF strip / JPEG 转换
   ▼
[SHA256 缓存检查]     backend/services/cache_service.py
   │  命中 → 直接返回（零 API 成本）
   │  未命中 ↓
   ├─────────────────────────────────────────────┐
   ▼                                             ▼
[VLM 综合检测]                            [几何分析]
backend/services/vlm_detector.py          backend/services/face_detector.py
Qwen3-VL-8B-Instruct（SiliconFlow）       MediaPipe Python 批处理
5张图打包单次 API 调用                     478关键点 → 三庭五眼/面型
28类缺陷 + 5级严重度                       几何规则引擎 → 缺陷评分
                  │                              │
                  └──────────────┬───────────────┘
                                 ▼
                    [表型匹配]   backend/services/template_matcher.py
                       │  InsightFace ArcFace 512维向量 → FAISS IVFFlat
                       │  Top5 虚拟参考面 + gap_analysis
                       ▼
                    [标注渲染]   backend/services/annotation_renderer.py
                       │  MediaPipe 关键点坐标 → 引导折线（confidence≥0.7）
                       ▼
                    [2D变形模拟]  frontend/core/morphingEngine.ts
                       │  TPS 本地快速预览（<500ms）
                       │  ComfyUI@AutoDL 高质量渲染（按需，~5–15s）
                       ▼
                    [治疗选择+计价]  frontend/stores/sessionStore.ts
                       │  28类缺陷 → 治疗项目映射 → 实时价格汇总
                       ▼
                    [报告生成]   backend/services/report_exporter.py
                       │  WeasyPrint → PDF 导出
                       ▼
                    [成本记录]   backend/utils/cost_tracker.py
                          JSONL 追加每次 API 调用成本
```

---

## 三、分层架构详述

### 3.1 后端（Python FastAPI）

```
backend/
├── main.py                          # FastAPI 入口 + CORS + 路由注册 + 生命周期
├── core/
│   ├── config.py                    # pydantic-settings 环境变量读取
│   ├── exceptions.py                # 自定义异常（5类：VLMError / CaptureQualityError /
│   │                                #   TemplateMatchError / SimulationError / SessionError）
│   └── logging_config.py            # structlog 结构化日志（JSON 格式）
├── models/
│   └── schemas.py                   # Pydantic v2 数据模型（含28类缺陷/5级严重度）
├── prompts/
│   └── detector_prompt.md           # VLM System Prompt（版本化维护）
├── services/
│   ├── vlm_detector.py              # 5张图打包 → Qwen3-VL-8B 单次调用
│   ├── face_detector.py             # MediaPipe Python 关键点提取（CPU 单例预加载）
│   ├── defect_scorer.py             # 几何规则引擎 → 缺陷评分（纯计算，无 IO）
│   ├── template_matcher.py          # InsightFace ArcFace + FAISS IVFFlat 检索
│   ├── annotation_renderer.py       # 关键点坐标 → 引导折线标注叠加（PIL）
│   ├── treatment_engine.py          # 28类缺陷 → 治疗项目映射 + LLM 联合推荐
│   ├── simulation_client.py         # ComfyUI@AutoDL API 调用
│   ├── anonymizer.py                # API 调用前：人脸区域模糊 / 元数据剥离
│   ├── cache_service.py             # Redis SHA256 缓存（降级为内存 dict）
│   └── report_exporter.py           # WeasyPrint 生成 PDF 报告
├── api/routes/
│   ├── session.py                   # POST/DELETE /api/v1/sessions
│   ├── capture.py                   # POST /api/v1/sessions/{id}/capture
│   ├── analysis.py                  # POST/GET /api/v1/sessions/{id}/analyze
│   ├── templates.py                 # GET/PUT /api/v1/sessions/{id}/templates
│   ├── treatment.py                 # GET/PUT /api/v1/sessions/{id}/treatment
│   ├── simulation.py                # POST /api/v1/sessions/{id}/simulate (+ WS)
│   ├── report.py                    # GET /api/v1/sessions/{id}/report
│   ├── catalog.py                   # GET /api/v1/catalog/treatments
│   └── health.py                    # GET /health
├── db/
│   ├── database.py                  # SQLite + SQLAlchemy（WAL 模式）
│   └── models.py                    # ORM 表定义
└── utils/
    ├── image_utils.py               # resize / EXIF strip / base64 / SHA256
    └── cost_tracker.py              # JSONL 成本追加记录
```

### 3.2 前端（React 18 + TypeScript）

```
frontend/src/
├── pages/                           # 页面层（SOP 流程顺序）
│   ├── Welcome.tsx                  # STAGE 0：会话建立（年龄段/主诉/过敏史）
│   ├── Capture.tsx                  # STAGE 1：多角度采集引导
│   ├── Analyzing.tsx                # 分析中（加载动画 + 进度反馈）
│   ├── Templates.tsx                # STAGE 2：美学表型呈现（Top5 参考面 + gap分析）
│   ├── Workspace.tsx                # STAGE 3+4+5：AI报告 + 方案协创 + 模拟预览
│   └── Summary.tsx                  # STAGE 6：方案确认 + 报价 + PDF 导出
│
├── components/                      # 按功能分组
│   ├── capture/
│   │   ├── WebcamCapture.tsx        # 摄像头实时采集（含 WASM 引导层）
│   │   ├── AngleGuideOverlay.tsx    # 角度引导覆盖层（人脸框 + 角度指示 + 质量评分）
│   │   └── ImageUpload.tsx          # 手动 5 张上传
│   ├── analysis/
│   │   ├── FaceAnnotator.tsx        # 引导折线渲染（关键点 → 缺陷标签）
│   │   ├── DefectList.tsx           # 28类缺陷列表（严重度排序）
│   │   └── AestheticRadar.tsx       # 雷达图：三庭/五眼/对称/轮廓综合评分
│   ├── template/
│   │   ├── TemplateGallery.tsx      # Top5 虚拟参考面展示
│   │   ├── TemplateCard.tsx         # 单个模板卡片（相似度 + 美学标签）
│   │   └── GapAnalysisPanel.tsx     # 差距分析 + 提升路径展示
│   ├── treatment/
│   │   ├── TreatmentMenu.tsx        # 菜单式项目勾选 + 强度滑块
│   │   └── PriceSheet.tsx           # 实时价格汇总
│   └── simulation/
│       ├── SimulationStages.tsx     # 4阶段效果切换（当前/抗衰/轮廓/综合）
│       └── BeforeAfterSlider.tsx    # 原图/模拟图滑动对比
│
├── core/                            # 纯算法层（无 UI 依赖）
│   ├── aestheticMetrics.ts          # 三庭五眼/面型/高光点/对称性几何算法
│   ├── annotationRenderer.ts        # Canvas 引导折线绘制逻辑
│   ├── morphingEngine.ts            # TPS 变形算法 + ComfyUI API 封装
│   └── mediapipeLoader.ts           # MediaPipe WASM 单例加载与复用
│
├── store/
│   └── sessionStore.ts              # Zustand 单一状态树
│                                    # （会话ID / 图像 / 分析结果 / 选定项目 / 价格）
│
└── services/
    ├── api.ts                       # Axios 封装，统一调用后端 REST + WS
    └── captureUtils.ts              # 图像压缩 / Canvas 截帧 / base64 转换
```

UI 交互原则：
- 全程大字体 + 高对比度（医生和客户共用同屏）
- Workspace 页面：左栏「医生操作区」，右栏「客户视觉展示区」
- 模拟渲染中显示骨架屏（不显示旋转加载圈）
- MediaPipe WASM 在 STAGE 0 期间后台预加载，消除 STAGE 1 等待

---

## 四、核心数据模型

```
# ── Session（会话，生命周期 = 一次面诊）─────────────────────────────
Session:
  session_id:     UUID
  gender:         str           # 'male' | 'female'
  age_group:      str           # '20-29' | '30-39' | '40-49' | '50+'
  chief_complaint:str           # 主诉（自由文本）
  allergy_note:   str | None    # 过敏史
  status:         str           # 'capturing'|'analyzing'|'consulting'|'closed'
  created_at:     datetime
  closed_at:      datetime | None

# ── FaceCapture（采集，会话关闭后删除原始文件）─────────────────────
FaceCapture:
  capture_id:     UUID
  session_id:     UUID  (FK)
  front_path:     str           # 临时文件路径，会话关闭后删除
  left45_path:    str
  right45_path:   str
  left90_path:    str
  right90_path:   str
  quality_scores: JSON          # { front: 0.92, left45: 0.87, ... }
  landmarks_json: JSON          # MediaPipe 478点坐标（5视角分别存储）
  capture_method: str           # 'webcam' | 'upload'

# ── DetectionResult（VLM 输出）────────────────────────────────────
DetectionResult:
  result_id:      UUID
  session_id:     UUID  (FK)
  face_detected:  bool
  defects:        JSON          # List[DefectItem]，见下
  age_assessment: JSON | None   # AgeAssessment
  overall:        JSON | None   # OverallAssessment
  raw_vlm_notes:  str | None
  api_provider:   str           # 'siliconflow/Qwen3-VL-8B-Instruct'
  api_cost_cny:   float         # 本次调用成本（元）

# DefectItem（内嵌）:
  defect_id:      str
  name_zh:        str           # '法令纹'
  category:       str           # 'wrinkle'|'volume_loss'|'contour'|'ptosis'
  severity:       int           # 1–5（1=极轻，5=严重）
  confidence:     float         # 0.0–1.0
  landmark_refs:  list[int]     # MediaPipe 关键点索引（用于引导折线渲染）
  clinical_description: str | None
  treatment_suggestion: str | None
  anatomical_regions:   list[str]

# ── AestheticMetricsResult（几何分析输出）────────────────────────
AestheticMetricsResult:
  three_sections:   JSON        # { upper, middle, lower, ratios, score, advice }
  five_eyes:        JSON        # { eye_width, face_width, ratio, score, advice }
  face_shape:       JSON        # { classification, width_height_ratio, score }
  malar_prominence: JSON        # { ratio, score, advice }
  brow_arch:        JSON        # { left_q_point, right_q_point, score }
  highlight_points: JSON        # { malar, cheek, brow }
  symmetry:         JSON        # { score, asymmetric_features }
  composite_score:  int         # 0–100

# ── PhenotypeMatchResult（表型匹配输出）──────────────────────────
PhenotypeMatchResult:
  session_id:     UUID  (FK)
  best_match:     JSON          # { template_id, name_zh, similarity: float }
  all_matches:    JSON          # List[{ template_id, similarity }] Top5
  gap_analysis:   JSON          # List[{ metric, current, ideal, delta, treatment_hint }]
  selected_id:    str | None    # 医生最终选定的参考面 ID
  reference_image_url: str

# ── TreatmentPlan（治疗方案）──────────────────────────────────────
TreatmentPlan:
  plan_id:        UUID
  session_id:     UUID  (FK)
  ai_recommended: JSON          # AI 推荐项目组合
  doctor_selected:JSON          # 医生最终勾选项目
  total_price:    float
  simulation_url: str | None    # 最新高质量模拟图临时 URL
  notes:          str | None    # 医生备注

# TreatmentItem（内嵌）:
  item_id:        str           # 'hyaluronic_nasolabial'
  name:           str           # '玻尿酸 · 法令纹填充'
  category:       str           # 'anti_aging' | 'contouring' | 'refinement'
  intensity:      float         # 0.0–1.0（滑块值）
  unit_price:     float
  priority:       int           # AI 推荐优先级
```

---

## 五、关键配置（.env）

```ini
# ── 服务配置 ──────────────────────────────────────────────────────
APP_ENV=development
SERVER_HOST=127.0.0.1
SERVER_PORT=8000
LOG_LEVEL=INFO

# ── VLM API（SiliconFlow / Qwen3-VL）────────────────────────────
SILICONFLOW_API_KEY=your_key_here
SILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1
VLM_MODEL_NAME=Qwen/Qwen3-VL-8B-Instruct   # 主力：5图打包，~18s/批
VLM_TIMEOUT_SECONDS=60
VLM_TEMPERATURE=0.1
VLM_MAX_TOKENS=2048
DEFECT_CONFIDENCE_THRESHOLD=0.7             # 低于此值不渲染引导折线

# ── 本地 AI 模型 ──────────────────────────────────────────────────
MEDIAPIPE_MODEL_PATH=./ai_models/face_landmarker.task
INSIGHTFACE_MODEL_DIR=./ai_models/insightface/
TEMPLATE_DB_PATH=./ai_models/templates/features.index   # FAISS 索引
TEMPLATE_META_PATH=./ai_models/templates/metadata.json

# ── 缓存（Redis 可选，不填则降级为内存 dict）────────────────────────
REDIS_URL=                                  # 如: redis://localhost:6379/0

# ── 模拟 API ─────────────────────────────────────────────────────
SIMULATION_PROVIDER=comfyui_autodl
COMFYUI_ENDPOINT=http://your-autodl-instance:8188
COMFYUI_WORKFLOW_ID=face_aesthetic_sim_v1

# ── 数据 & 隐私 ───────────────────────────────────────────────────
SQLITE_PATH=./data/facesense.db
TEMP_IMAGE_DIR=./data/temp/
ANONYMIZE_BEFORE_API=true
SESSION_AUTO_PURGE=true

# ── 价格 & 成本 ────────────────────────────────────────────────────
PRICE_CATALOG_PATH=./data/price_catalog.json
TREATMENT_RULES_PATH=./data/treatment_rules.json
COST_LOG_PATH=./data/cost_log.jsonl
MAX_IMAGE_SIZE_MB=10
MAX_IMAGE_DIMENSION=1024
```

---

## 六、API 端点速览

```
POST   /api/v1/sessions                          创建会话（接诊登记）
DELETE /api/v1/sessions/{id}                     关闭会话（触发数据清除）

POST   /api/v1/sessions/{id}/capture             上传5角度照片，触发质量评估
GET    /api/v1/sessions/{id}/capture/quality     获取采集质量报告

POST   /api/v1/sessions/{id}/analyze             触发完整分析（VLM + 几何 + 表型，并行）
GET    /api/v1/sessions/{id}/analysis            获取分析结果

GET    /api/v1/sessions/{id}/templates           获取 Top5 匹配虚拟参考面
PUT    /api/v1/sessions/{id}/templates/select    医生选定参考面

GET    /api/v1/sessions/{id}/treatment           获取 AI 推荐方案
PUT    /api/v1/sessions/{id}/treatment           医生更新选定项目

POST   /api/v1/sessions/{id}/simulate            请求高质量模拟图（异步，返回 job_id）
GET    /api/v1/sessions/{id}/simulate/{job_id}   轮询模拟结果
WS     /ws/sessions/{id}/simulate                WebSocket 实时接收渲染进度和结果

GET    /api/v1/sessions/{id}/report              导出 PDF 面诊报告（二进制流）

GET    /api/v1/catalog/treatments                获取完整治疗项目目录（含价格）
GET    /health                                   服务健康检查
```

---

## 七、开发阶段路线（4–6 周 Demo）

```
Phase 0 — 项目骨架（第 1 周前半）
  □ 初始化 FastAPI 项目结构（含 structlog / pydantic-settings / CORS）
  □ 初始化 React 18 + TypeScript + Tailwind + Zustand 项目
  □ SQLite + SQLAlchemy WAL 模式配置
  □ .env.example 完整填写 + config.py 读取验证
  □ /health 端点 + 前端开发代理配置

Phase 1 — 面部采集（第 1 周后半）
  □ MediaPipe WASM 加载（STAGE 0 预加载，消除冷启动）
  □ WebcamCapture：5角度自动采集（保持≥1.5s 触发）
  □ AngleGuideOverlay：实时角度/光线/遮挡/清晰度引导
  □ ImageUpload：手动 5 张批量上传（格式/尺寸校验）
  □ 后端图片预处理：resize ≤1024px / EXIF strip / SHA256 计算
  □ 采集质量评估 API + 前端预览确认页

Phase 2 — 本地几何分析（第 2 周前半）
  □ MediaPipe Python 单例预加载（FastAPI 启动时）
  □ 478关键点提取 → landmarks_json 持久化
  □ 几何算法实现：三庭比例 / 五眼宽度 / 面型分类
  □ 几何算法实现：苹果肌 / 眉弓 Q 点 / 高光点 / 对称性评分
  □ 缺陷评分规则引擎（基于关键点几何比值）
  □ AestheticMetricsResult 组装 + API 响应

Phase 3 — VLM 集成（第 2 周后半）
  □ SiliconFlow 客户端封装（含超时/重试/指数退避）
  □ detector_prompt.md 编写（28类缺陷定义 + 结构化输出格式）
  □ vlm_detector.py：5张图打包单次调用（base64 编码）
  □ DefectItem 解析 + confidence 过滤（≥0.7）
  □ annotation_renderer.py：关键点索引 → PIL 引导折线绘制
  □ SHA256 缓存层（Redis / 降级内存 dict）
  □ cost_tracker.py：JSONL 成本记录
  □ 前端：FaceAnnotator Canvas 渲染 + DefectList 展示

Phase 4 — 表型匹配（第 3 周）
  □ 虚拟模板库生成：SDXL + 亚洲面孔 LoRA（AutoDL）500–1000 张
  □ InsightFace ArcFace 512维特征提取
  □ FAISS IVFFlat 索引构建（< 50MB，启动时预加载）
  □ template_matcher.py：Top5 检索 + gap_analysis 生成
  □ 前端：TemplateGallery + TemplateCard + GapAnalysisPanel

Phase 5 — 方案协创（第 4 周前半）
  □ treatment_catalog.json：28类缺陷 → 治疗项目映射
  □ price_catalog.json：治疗项目 + 价格范围
  □ treatment_engine.py：规则推荐 + Qwen3 文本推理联合输出
  □ 前端：TreatmentMenu（勾选 + 强度滑块）+ PriceSheet 实时计价
  □ sessionStore.ts：治疗选择状态管理

Phase 6 — 模拟渲染（第 4 周后半–第 5 周）
  □ morphingEngine.ts：TPS 本地 2D 变形（<500ms 快速预览）
  □ SimulationStages：4阶段效果展示（当前/抗衰/轮廓/综合）
  □ BeforeAfterSlider：原图↔模拟图滑动对比组件
  □ simulation_client.py：ComfyUI@AutoDL API 对接（异步 + WS 进度推送）
  □ anonymizer.py：API 发送前人脸脱敏

Phase 7 — 收尾 & Demo（第 5–6 周）
  □ report_exporter.py：WeasyPrint PDF 报告生成
  □ Summary 页面：方案确认 + PDF 导出 + 二维码分享
  □ 会话关闭钩子：原始图像即时删除 + 定时清理
  □ 端到端 SOP 流程联调（6个 STAGE 全链路）
  □ 演示数据准备（标准案例 3 套）
  □ PoC 环境部署文档

▎ 后续拓展（PoC 验证后）：
▎ - Phase 8：多缺陷联合建模、自定义模板库扩充
▎ - Phase 9：语音引导（TTS）、视频面诊
▎ - Phase 10：多诊所 SaaS 化、HIS 对接
```

---

## 八、性能陷阱与规避策略

| 陷阱 | 影响 | 规避策略 |
|------|------|---------|
| MediaPipe Python 每次请求重新加载 | 首次延迟 8–15s | FastAPI 启动时单例预加载 |
| MediaPipe WASM 首次加载 2–4s | 采集页冻结 | STAGE 0 期间后台预加载 |
| 5张高清图同时上传 | 前端卡顿 / OOM | 前端压缩至 1024px，后端限制 10MB |
| VLM 推理 20–50s（Qwen3-VL） | 等待体验差 | 异步执行，本地分析先展示，VLM 结果后续推送 |
| VLM bounding_box ±15% 偏差 | 标注框不准 | 替换为 MediaPipe 关键点坐标引导折线 |
| FAISS 向量检索冷启动 | 首次匹配慢 | 启动时预加载索引到内存（<50MB） |
| TPS 变形计算量大 | 实时预览卡顿 | Web Worker 独立线程，主线程不阻塞 |
| WebSocket 模拟推送频率过高 | 前端渲染抖动 | 节流：最高 2fps 进度更新，最终图一次推送 |
| 临时图像文件未清理 | 磁盘泄漏 | 会话关闭钩子 + 每小时定时清理过期文件 |
| SQLite 写入锁 | 并发面诊卡死 | WAL 模式开启（单诊所并发低） |

---

## 九、成本控制机制

API 调用成本估算（单次面诊）：

```
VLM 检测（5图打包单次调用）     ≈ ¥0.10–0.40（Qwen3-VL-8B，SiliconFlow）
ComfyUI@AutoDL 模拟图生成       ≈ ¥0.05–0.15（按需触发，AutoDL 按量）
─────────────────────────────────────────────────────────
单次面诊 API 总成本              ≈ ¥0.15–0.55（比原方案节省 70%+）
```

控制策略：
1. **本地优先**：MediaPipe 几何分析 + TPS 变形预览 0 API 成本
2. **5图打包**：5张图单次 VLM 调用，而非 5 次串行（节省 4 次请求开销）
3. **SHA256 缓存**：同一图片 24h 内不重复调用 VLM（Redis / 内存 dict）
4. **按需触发模拟**：仅医生点击「查看精细效果」才调用 ComfyUI，非每次勾选
5. **AutoDL 按量**：GPU 渲染 AutoDL 单次租用，非长期持有
6. **JSONL 成本追踪**：每次 API 调用记录 model / tokens / cost_cny，便于核算

---

## 十、虚拟美学表型库构建方案

▎ 规避版权风险、实现「骨相参考面」功能的核心技术资产。

生成策略：
1. 使用 SDXL + 亚洲面孔 LoRA（AutoDL GPU 租用）生成 500–1000 张虚拟人物头像
   参数控制：性别 × 年龄段（20-29/30-39/40-49）× 脸型（鹅蛋/瓜子/心形/方形）× 风格（知性/甜美/御姐/清纯）
   → 所有图像 AI 生成，无版权问题

2. 使用 InsightFace ArcFace 提取每张人脸 512 维特征向量

3. 为每张模板图打「美学标签」：
   `{ face_shape, highlight_profile, contour_sharpness, aesthetic_style, name_zh }`

4. 使用 FAISS 构建 IVFFlat 索引（支持 Top-K 相似度检索，< 10ms）

5. gap_analysis 生成：
   客户几何指标 vs 匹配模板几何指标 → 逐维度差值 → 对应治疗提示

---

## 十一、目录结构

```
face_measure/
├── doc/
│   └── ARCHITECTURE.md
├── backend/
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   ├── exceptions.py
│   │   └── logging_config.py
│   ├── models/
│   │   └── schemas.py
│   ├── prompts/
│   │   └── detector_prompt.md
│   ├── services/
│   │   ├── vlm_detector.py
│   │   ├── face_detector.py
│   │   ├── defect_scorer.py
│   │   ├── template_matcher.py
│   │   ├── annotation_renderer.py
│   │   ├── treatment_engine.py
│   │   ├── simulation_client.py
│   │   ├── anonymizer.py
│   │   ├── cache_service.py
│   │   └── report_exporter.py
│   ├── api/routes/
│   │   ├── session.py
│   │   ├── capture.py
│   │   ├── analysis.py
│   │   ├── templates.py
│   │   ├── treatment.py
│   │   ├── simulation.py
│   │   ├── report.py
│   │   ├── catalog.py
│   │   └── health.py
│   ├── db/
│   │   ├── database.py
│   │   └── models.py
│   └── utils/
│       ├── image_utils.py
│       └── cost_tracker.py
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
│   │   │   ├── analysis/
│   │   │   ├── template/
│   │   │   ├── treatment/
│   │   │   └── simulation/
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
├── ai_models/
│   ├── face_landmarker.task         # MediaPipe 模型文件
│   ├── insightface/
│   └── templates/
│       ├── features.index           # FAISS 索引
│       ├── metadata.json
│       └── thumbnails/
├── data/
│   ├── price_catalog.json
│   ├── treatment_catalog.json
│   ├── treatment_rules.json
│   ├── cost_log.jsonl               # API 成本追踪（自动生成）
│   └── temp/                        # 临时图像（自动清除）
├── .env.example
├── .env                             # 本地，不提交 git
├── requirements.txt
└── README.md
```

---

以上为完整架构文档，共 11 个章节。涵盖 SOP 流程、技术路线、分层架构、数据模型、配置、API 端点、开发路线、性能策略、成本控制、模板库构建及目录结构。
