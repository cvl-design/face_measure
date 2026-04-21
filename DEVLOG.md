# FaceSense 开发日志

**项目代号**：FaceSense — AI 辅助医生智能面诊系统  
**技术栈**：FastAPI + SQLite / React 18 + TypeScript + Tailwind CSS v4 + Zustand  
**本文档记录**：各阶段实际开发进度、已实现功能说明、关键决策与问题修复

---

## 总体进度概览

| Phase | 内容 | 状态 | 完成日期 |
|-------|------|------|----------|
| Phase 0 | 项目骨架（后端 + 前端脚手架） | ✅ 完成 | 2026-04-21 |
| Phase 1 | 多角度面部采集（上传 + 质量评估） | ✅ 完成 | 2026-04-21 |
| Phase 2 | 本地几何分析（MediaPipe + 规则引擎） | ✅ 完成 | 2026-04-21 |
| Phase 3 | VLM 集成（Qwen3-VL + 标注渲染） | ⬜ 待开发 | — |
| Phase 4 | 表型匹配（FAISS + InsightFace） | ⬜ 待开发 | — |
| Phase 5 | 方案协创（治疗推荐 + 实时计价） | ⬜ 待开发 | — |
| Phase 6 | 模拟渲染（TPS 预览 + ComfyUI） | ⬜ 待开发 | — |
| Phase 7 | 收尾与 Demo（PDF 报告 + 联调） | ⬜ 待开发 | — |

---

## Phase 0 — 项目骨架

**完成日期**：2026-04-21

### 后端初始化

#### `backend/core/config.py`
- 使用 `pydantic-settings` 读取 `.env` 文件，所有配置字段带类型约束和默认值
- 关键配置项：`app_env` / `server_port` / `sqlite_path` / `temp_image_dir` / `mediapipe_model_path` / `max_image_size_mb` / `max_image_dimension`
- 提供 `is_development` / `temp_image_dir_path` / `data_dir_path` 等计算属性，目录在访问时自动创建

#### `backend/core/logging_config.py`
- 基于 `structlog` 的结构化日志，JSON 格式输出
- 通过 `get_logger(__name__)` 统一获取，支持 `key=value` 键值对参数

#### `backend/core/exceptions.py`
- 定义 5 类业务异常：`VLMError` / `CaptureQualityError` / `TemplateMatchError` / `SimulationError` / `SessionError`
- 继承自 `FaceSenseError`，携带 `message` + `detail` 字段

#### `backend/db/database.py`
- `create_async_engine` + `SQLite + aiosqlite`，开启 WAL 模式（`PRAGMA journal_mode=WAL`）和外键约束
- `AsyncSessionLocal`：`async_sessionmaker` 单例
- `init_db()`：FastAPI lifespan 启动时调用，建表 + WAL 配置
- `get_db()`：FastAPI `Depends` 注入，自动 commit/rollback

#### `backend/db/models.py`
定义 5 张 ORM 表：

| 表名 | 主要字段 | 说明 |
|------|----------|------|
| `sessions` | `session_id` / `gender` / `age_group` / `chief_complaint` / `allergy_note` / `status` | 会话状态机：`capturing→analyzing→consulting→closed` |
| `face_captures` | `capture_id` / `{angle}_path` × 5 / `quality_scores(JSON)` / `landmarks_json(JSON)` | 图片路径 + 质量评分 + 关键点存储 |
| `detection_results` | `result_id` / `face_detected` / `defects(JSON)` / `aesthetic_metrics(JSON)` / `overall(JSON)` | VLM + 几何分析输出 |
| `phenotype_matches` | `match_id` / `best_match` / `all_matches` / `gap_analysis` / `selected_id` | 表型匹配结果（Phase 4） |
| `treatment_plans` | `plan_id` / `ai_recommended` / `doctor_selected` / `total_price` / `simulation_url` | 治疗方案（Phase 5） |

#### `backend/models/schemas.py`
- Pydantic v2 请求/响应模型，与 ORM 层完全解耦
- 核心模型：`SessionCreate` / `SessionResponse` / `CaptureQualityScore` / `CaptureUploadResponse` / `DefectItem` / `AestheticMetricsResult` / `DetectionResultResponse`

#### `backend/main.py`
- FastAPI 应用入口，`asynccontextmanager` lifespan 钩子管理生命周期
- CORS 配置：仅允许 `localhost:5173`（Vite dev）+ `localhost:3000`
- 全局异常处理：`FaceSenseError` → JSON 500 响应
- 路由注册：`health` / `session` / `capture` / `analysis` / `templates` / `treatment` / `simulation` / `report` / `catalog`

#### `backend/api/routes/health.py`
- `GET /health`：返回服务版本、数据库状态、`mediapipe_loaded`、`faiss_loaded` 标志位
- 模块级 `set_mediapipe_loaded()` / `set_faiss_loaded()` 供 lifespan 钩子调用

### 前端初始化

#### `frontend/` 项目结构
- Vite + React 18 + TypeScript 脚手架
- Tailwind CSS v4 配置（深色主题主色板：`gray-900` 背景 + `indigo-600` 强调色）
- Vite 开发代理：`/api → http://127.0.0.1:8000`

#### `frontend/src/store/sessionStore.ts`
Zustand 单一状态树，覆盖全流程所有状态：
- **会话信息**：`sessionId` / `gender` / `ageGroup` / `chiefComplaint` / `allergyNote` / `sessionStatus`
- **采集状态**：`captureMethod` / `captureImages`（5角度 File/string）/ `captureId` / `qualityScores`
- **分析结果**：`defects` / `aestheticMetrics` / `annotatedImageUrl` / `isAnalyzing`
- **表型匹配**：`templateMatches` / `selectedTemplateId` / `gapAnalysis`
- **治疗方案**：`aiRecommended` / `doctorSelected` / `totalPrice` / `planNotes`
- **模拟状态**：`simulationJobId` / `simulationUrl` / `isSimulating` / `simulationProgress`
- Actions：`setSessionInfo` / `setCaptureImage` / `setCaptureResult` / `setAnalysisResult` / `toggleTreatment` / `reset` 等

#### `frontend/src/services/api.ts`
- Axios 实例封装：`baseURL='/api/v1'`，超时 90s
- 响应拦截器：统一提取 `error.response.data.detail` 为 `Error` 对象
- 导出模块：`sessionApi` / `captureApi` / `analysisApi` / `templatesApi` / `treatmentApi` / `simulationApi` / `reportApi`

#### `frontend/src/App.tsx`
- `BrowserRouter` + `Routes`，6 条路由：`/` → `Welcome`，`/capture` → `Capture`，`/analyzing` → `Analyzing`，`/workspace` → `Workspace`，`/templates` → `Templates`，`/summary` → `Summary`

**启动方式**：
```bash
# 后端（项目根目录）
python -m uvicorn backend.main:app --reload --port 8000

# 前端
cd frontend && npm run dev
```

---

## Phase 1 — 多角度面部采集

**完成日期**：2026-04-21

### 后端实现

#### `backend/utils/image_utils.py`

图片预处理管线：

```
原始字节 → EXIF 剥离 → RGB 转换 → 等比缩放（≤1024px）→ JPEG 保存 → SHA256 计算
```

- `preprocess_and_save(raw_bytes, dest_dir, filename, max_dim)` → `(Path, sha256_str)`
- `assess_image_quality(image_bytes, angle_label)` → `dict`，包含：
  - `sharpness`：拉普拉斯方差 / 500，截断到 1.0（值越高越清晰）
  - `lighting`：`1 - 2 × |mean/255 - 0.5|`（中灰为最优）
  - `occlusion`：当前版本固定 1.0（Phase 3 用 VLM 检测）
  - `overall`：`0.5 × sharpness + 0.5 × lighting`，`passed = overall ≥ 0.5`
  - `reasons`：不合格时的中文说明列表

#### `backend/api/routes/capture.py`

**`POST /api/v1/sessions/{session_id}/capture`**
1. 校验 session 存在且 `status == 'capturing'`
2. 收集非空文件（`front` 为必填，其余可选）
3. 按角度遍历：大小限制检查 → `preprocess_and_save` → `assess_image_quality`
4. Upsert `FaceCapture` ORM（已有记录则更新路径和质量分）
5. 返回 `CaptureUploadResponse`（含 `capture_id` / `quality_scores` / `all_passed` / `message`）

**`GET /api/v1/sessions/{session_id}/capture/quality`**
- 查询已存储的质量评分，反序列化后返回 `CaptureQualityReport`

> **关键修复**：`CaptureQualityScore.angle` 字段类型从 `float` 修正为 `str`（角度标签如 `'front'`，非数值）

#### `backend/api/routes/session.py`
- `POST /api/v1/sessions`：创建会话，写入 `gender` / `age_group` / `chief_complaint` / `allergy_note`，返回 `session_id`
- `GET /api/v1/sessions/{id}`：查询会话详情
- `DELETE /api/v1/sessions/{id}`：关闭会话（`status='closed'`，Phase 7 添加文件删除钩子）

### 前端实现

#### `frontend/src/pages/Welcome.tsx`
接诊登记表单（STAGE 0）：
- **性别选择**：两个大按钮（男 / 女），点击高亮，必填
- **年龄段选择**：4 格按钮（20-29 / 30-39 / 40-49 / 50+），必填
- **主诉输入**：textarea，最多 500 字，右下角字数计数
- **过敏史输入**：单行输入，最多 200 字，选填
- 提交：调用 `sessionApi.create()` → 写入 `setSessionInfo()` → 跳转 `/capture`
- 禁用态：未选性别或年龄段时按钮变灰不可点

#### `frontend/src/components/capture/ImageUpload.tsx`
5 角度图片上传组件：
- `3列 grid（移动端）/ 5列 grid（≥md 桌面）`
- 每个格子：空态显示上传图标 + "点击上传"；已选显示缩略图预览
- 文件选择后：`validateImageFile()` 校验格式（jpg/png/webp）和大小（≤10MB）
- 使用 `URL.createObjectURL()` 生成预览 URL，组件卸载时 `URL.revokeObjectURL()` 释放
- 质量评分 badge（服务端返回后显示）：绿色 ✓（passed）/ 橙色 ⚠（未通过）+ 百分比分值
- 不合格原因文字显示在格子下方

#### `frontend/src/services/captureUtils.ts`
- `validateImageFile(file)`：检查 MIME 类型（`image/jpeg` / `image/png` / `image/webp`）和文件大小，返回错误信息字符串或 `null`
- `buildCaptureFormData(images, method)`：将 `CaptureImages` 对象转为 `FormData`（File 直接附加，base64 字符串转 Blob）

#### `frontend/src/pages/Capture.tsx`
STAGE 1 采集页面：
- **Session 守卫**：`useEffect` 检测 `sessionId`，无效时强制跳回 `/`
- **Tab 切换**：手动上传（已实现）/ 摄像头采集（Phase 2 占位，标注"即将推出"）
- **底部操作栏**（sticky bottom）：
  - 左侧：已选 N/5 张，无正面图时红色警示
  - 右侧："提交分析"按钮，无正面图或上传中时禁用
- 提交流程：`buildCaptureFormData` → `captureApi.upload()` → `setCaptureResult()` → `setQualityScores()`
  - 全部通过：直接跳转 `/analyzing`
  - 质量警告：显示橙色提示 1.5s 后自动跳转（质量问题不阻断 Phase 1 流程）

---

## Phase 2 — 本地几何分析

**完成日期**：2026-04-21

### 关键技术决策

**mediapipe 版本**：安装版本为 `0.10.33`，`mp.solutions` API 已完全移除，必须使用 Tasks API：
```python
from mediapipe.tasks.python.vision import FaceLandmarker
from mediapipe.tasks.python.vision.face_landmarker import FaceLandmarkerOptions
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision.core.vision_task_running_mode import VisionTaskRunningMode
```

**模型文件**：`./ai_models/face_landmarker.task`（float16，约 3.6MB），从 MediaPipe 官方存储桶下载。

**分析范围**：Phase 2 仅对正面图（`front.jpg`）进行几何分析；侧面图留给 Phase 3 VLM 综合检测。

**异步策略**：MediaPipe 为同步阻塞调用，通过 `asyncio.get_event_loop().run_in_executor(None, ...)` 包装，避免阻塞 FastAPI 事件循环。

### 后端实现

#### `backend/services/face_detector.py`

MediaPipe FaceLandmarker 单例封装：

```
FastAPI 启动 → lifespan 调用 face_detector.load() [run_in_executor]
  → FaceLandmarkerOptions 初始化（IMAGE 模式，num_faces=1，confidence=0.3）
  → 模型加载完成，set_mediapipe_loaded(True)

HTTP 请求到来 → _run_analysis() 后台任务
  → face_detector.detect(image_path)
     → PIL 打开图片 → mp.Image 转换 → detector.detect()
     → 返回 478 个关键点 list[{x, y, z}]（归一化坐标 0.0–1.0）
     → 未检测到人脸返回 None
```

关键设计：
- `FaceDetectorService` 类封装，`face_detector = FaceDetectorService()` 为模块级单例
- `load()` 同步方法，在 lifespan 的 `run_in_executor` 中调用，不阻塞主事件循环
- `detect()` 同步方法，在后台任务的 `run_in_executor` 中调用

#### `backend/services/defect_scorer.py`

纯计算几何规则引擎，无 IO 无 ORM 依赖。输入 478 个归一化关键点，输出美学指标字典 + 缺陷列表。

**关键点索引常量**（MediaPipe 478点 FaceMesh 标准编号）：

| 位置 | 左侧 | 右侧 |
|------|------|------|
| 发际近似 | 9 | — |
| 下颌底 | 152 | — |
| 鼻底 | 2 | — |
| 眉内角 | 55 | 285 |
| 眉峰 | 105 | 334 |
| 眼内角 | 133 | 362 |
| 眼外角 | 33 | 263 |
| 颧骨高点 | 116 | 345 |
| 面颊外缘 | 234 | 454 |
| 嘴角 | 61 | 291 |

**六项几何算法**：

1. **三庭比例**（`_calc_three_sections`）
   - 上庭：发际(9) → 眉间中点；中庭：眉间中点 → 鼻底(2)；下庭：鼻底(2) → 下颌(152)
   - 理想比例 1:1:1，偏差越大扣分越多
   - `score = 100 - 200 × (|u/total - 1/3| + |m/total - 1/3| + |l/total - 1/3|)`
   - 输出：`{ upper, middle, lower, ratios, score, advice }`

2. **五眼宽度**（`_calc_five_eyes`）
   - `face_width = x(454) - x(234)`；`eye_width = x(33) - x(133)`（左眼外角到内角）
   - 理想比例 5.0，`score = 100 - 40 × |ratio - 5.0|`
   - 输出：`{ eye_width, face_width, ratio, score, advice }`

3. **面型分类**（`_calc_face_shape`）
   - 宽高比 = 面宽 / 面高
   - 分类阈值：< 0.75 → 长形；0.75–0.85 → 鹅蛋形；0.85–0.95 → 瓜子形；0.95–1.05 → 心形；≥ 1.05 → 方形
   - 理想中心 0.88，±0.10 内满分，超出线性扣分
   - 输出：`{ classification, width_height_ratio, score }`

4. **对称性**（`_calc_symmetry`）
   - 7 组成对关键点（眉内角 / 眉峰 / 眼角 / 颧骨 / 面颊 / 嘴角）
   - 理想：`x_left + x_right == 1.0`（面部中轴 = 0.5）
   - `mean_dev = mean(|x_left + x_right - 1.0|)`；`score = 100 - 200 × mean_dev`
   - 输出：`{ score, mean_deviation, asymmetric_features }`

5. **苹果肌突出度**（`_calc_malar`）
   - `malar_ratio = 颧骨宽 / 面宽`，理想 0.60–0.65（中心 0.625）
   - ±0.025 内满分，超出 `score = 100 - 200 × 超出量`
   - 输出：`{ malar_width, face_width, ratio, score, advice }`

6. **眉弓 Q 点**（`_calc_brow_arch`）
   - `arch = (眉内角_y - 眉峰_y) / 面高`（y 轴向下，正值表示眉峰高于眉内角）
   - 理想 0.03–0.05，偏差超出区间线性扣分
   - 输出：`{ left_q_point, right_q_point, mean_arch, score }`

**综合评分**：
```
composite_score = int(
    0.30 × three_sections.score
  + 0.25 × five_eyes.score
  + 0.20 × symmetry.score
  + 0.15 × face_shape.score
  + 0.10 × malar.score
)
```

**几何缺陷触发规则**：

| 缺陷名 | 触发条件 | severity 计算 | confidence |
|--------|----------|---------------|------------|
| 三庭比例失调 | `three_sections.score < 70` | `1 + (70 - score) / 15` | 0.85 |
| 下颌缘松弛（初步） | `lower/total > 0.38` | 固定 1 | 0.70 |
| 五眼宽度比例欠佳 | `five_eyes.score < 70` | `1 + (70 - score) / 15` | 0.80 |
| 面部不对称 | `symmetry.score < 75` | `1 + (75 - score) / 12` | 0.80 |
| 苹果肌不足 | `malar.ratio < 0.58` | 固定 2 | 0.75 |

每个缺陷生成完整 `DefectItem`：`defect_id`（UUID）/ `name_zh` / `category` / `severity`（1–5）/ `confidence` / `landmark_refs`（关键点索引列表）/ `clinical_description` / `treatment_suggestion` / `anatomical_regions`

**主入口**：
```python
aesthetic_metrics, defects = score_from_landmarks(landmarks, gender, age_group)
```

#### `backend/api/routes/analysis.py`

**`POST /api/v1/sessions/{session_id}/analyze`**（返回 202）

幂等设计：
- `status == 'consulting'`：已完成，直接返回提示
- `status == 'analyzing'`：正在进行中，返回提示
- `status == 'capturing'`：验证正面图存在 → 切换状态 → 添加后台任务 → 返回 202

**后台任务 `_run_analysis(session_id)`**：

```
1. 新建独立 AsyncSessionLocal() 会话
2. 查 FaceCapture → 取 front_path
3. 查 Session → 取 gender / age_group
4. run_in_executor(face_detector.detect, front_path) → landmarks
5. FaceCapture.landmarks_json ← { "front": landmarks }
6. score_from_landmarks() → aesthetic_metrics + defects_list
7. Upsert DetectionResult（result_id / face_detected / defects / aesthetic_metrics / overall）
8. session.status → 'consulting'
9. commit
```

失败时：`session.status` 回退为 `'capturing'`，允许前端重试。

**`GET /api/v1/sessions/{session_id}/analysis`**（轮询端点）

- `status == 'analyzing'`：响应码设为 202，返回空壳 `DetectionResultResponse`（`result_id=""`）
- 其他：查询 `DetectionResult` → 反序列化 `aesthetic_metrics` / `defects` / `overall` → 返回 200

#### `backend/main.py` — MediaPipe 预加载

```python
# lifespan 中启用（Phase 2）
from backend.services.face_detector import face_detector
loop = asyncio.get_event_loop()
await loop.run_in_executor(None, face_detector.load)
set_mediapipe_loaded(True)
```

服务启动时同步加载模型到内存，后续所有请求复用同一 `FaceLandmarker` 实例，避免每次请求重新初始化（节省 8–15s）。

### 前端实现

#### `frontend/src/pages/Analyzing.tsx`

分析过渡页，完整实现轮询逻辑：

**流程**：
```
组件挂载
  → POST /analyze（触发分析）
  → setCurrentStep('geometry')
  → setInterval 每 2s 调用 GET /analysis
      → result_id 为空 → 继续等待（后端返回 202）
      → result_id 非空 → 写入 Zustand setAnalysisResult()
                      → setCurrentStep('report')
                      → setTimeout 800ms → navigate('/workspace')
  → 60s 超时 → 显示重试按钮
```

**UI 组成**：
- 三步进度条：采集完成 → 几何分析 → 生成报告（含连接线，完成变蓝）
- 骨架屏动画：4个 `animate-pulse` 占位块（深灰背景，无旋转圈）
- 错误态：红色文字 + "返回重新上传"按钮
- 超时态：橙色文字 + "重试分析"按钮（`window.location.reload()`）
- React StrictMode 双重触发保护：`triggeredRef` 控制 POST 请求只发送一次

#### `frontend/src/pages/Workspace.tsx`

分析报告展示页（左右双栏布局）：

**左栏（医生操作区）**：
1. **综合评分圆形进度条** (`CompositeScore`)
   - SVG 圆弧，`strokeDasharray` 驱动进度
   - 颜色分级：≥80 → indigo；≥60 → amber；< 60 → red
   - 文字：分值 + 一行描述语

2. **美学指标卡片** (`MetricCards` + `MetricCard`)
   - 4 张卡片：三庭比例 / 五眼宽度 / 面型（显示分类名称）/ 对称性
   - 每张：标签 + 分值 + 细条进度条（颜色分级）+ 一行说明文字

3. **缺陷列表** (`DefectList`)
   - 按 `severity` 降序排列
   - 每项：缺陷名 + 严重度 badge（颜色：极轻蓝→轻度黄→中度橙→重度红→严重深红）+ 临床描述 + 治疗建议 + 右侧置信度百分比
   - 无缺陷时：绿色"未发现明显面部问题"提示框

**右栏（客户视觉区）**：
- 深灰背景占位，图标 + "效果模拟预览" + "Phase 6 实现"说明

---

## 关键问题与修复记录

### 1. mediapipe 0.10.x API 变更
**问题**：`mediapipe==0.10.33` 移除了 `mp.solutions` 接口（包括 `mp.solutions.face_mesh`），直接调用会报 `AttributeError`。  
**修复**：改用 Tasks API，通过 `FaceLandmarker.create_from_options()` 创建检测器，`VisionTaskRunningMode.IMAGE` 模式运行。

### 2. FaceLandmarkerOptions 参数变更
**问题**：`min_face_presence_score` 参数在该版本中不存在，调用时报 `TypeError`。  
**修复**：移除该参数，仅保留 `min_face_detection_confidence` 和 `min_tracking_confidence`。

### 3. CaptureQualityScore.angle 类型错误
**问题**：`schemas.py` 中 `angle` 字段类型为 `float`，但 `assess_image_quality()` 返回的是字符串标签（如 `'front'`），导致 Pydantic 验证失败。  
**修复**：将 `angle: float` 改为 `angle: str = ""`。

### 4. FastAPI `Path` 与 `pathlib.Path` 命名冲突
**问题**：路由文件同时需要 `fastapi.Path`（路径参数）和 `pathlib.Path`（文件路径），直接导入会冲突。  
**修复**：`from fastapi import Path as PathParam`，路径参数处使用 `PathParam(...)`。

### 5. 后台任务数据库会话
**问题**：FastAPI 路由的 `db: AsyncSession` 是请求级会话，HTTP 响应结束后会被关闭；后台任务在响应后继续执行，不能复用路由的 db session。  
**修复**：后台任务 `_run_analysis()` 使用 `async with AsyncSessionLocal() as db:` 独立创建新会话。

---

## 待实现功能（后续 Phase）

### Phase 3 — VLM 集成
- `backend/services/vlm_detector.py`：5 张图 base64 打包，调用 SiliconFlow Qwen3-VL-8B-Instruct
- `backend/prompts/detector_prompt.md`：28 类缺陷定义 + 结构化 JSON 输出格式
- `backend/services/annotation_renderer.py`：关键点坐标 → PIL 引导折线标注图
- `backend/services/cache_service.py`：SHA256 缓存（Redis / 内存 dict）
- `backend/utils/cost_tracker.py`：JSONL API 成本追踪
- 前端：`FaceAnnotator.tsx` Canvas 标注渲染 + `DefectList.tsx` 医生审阅交互

### Phase 4 — 表型匹配
- 模板库生成：SDXL + 亚洲面孔 LoRA，500–1000 张虚拟人脸
- `backend/services/template_matcher.py`：InsightFace ArcFace 512维 + FAISS IVFFlat 检索
- 前端：`TemplateGallery.tsx` + `GapAnalysisPanel.tsx`

### Phase 5 — 方案协创
- `data/treatment_catalog.json` + `data/treatment_rules.json`
- `backend/services/treatment_engine.py`：规则推荐 + 实时计价
- 前端：`TreatmentMenu.tsx`（勾选 + 强度滑块）+ `PriceSheet.tsx`

### Phase 6 — 模拟渲染
- `frontend/core/morphingEngine.ts`：TPS 薄板样条变形（Web Worker，< 500ms）
- `backend/services/simulation_client.py`：ComfyUI@AutoDL API + WebSocket 进度推送
- 前端：`BeforeAfterSlider.tsx` + `SimulationStages.tsx`

### Phase 7 — 收尾与 Demo
- `backend/services/report_exporter.py`：WeasyPrint PDF 报告生成
- `frontend/src/pages/Summary.tsx`：方案确认 + PDF 下载 + 会话关闭
- 会话关闭钩子：临时图像即时删除 + 定时清理
- 端到端 SOP 全流程联调
- 演示数据准备（3 套标准案例）

---

## 环境与依赖说明

### 后端关键依赖版本

| 包 | 版本 | 用途 |
|----|------|------|
| fastapi | 最新稳定版 | Web 框架 |
| uvicorn | — | ASGI 服务器 |
| sqlalchemy | 2.x | ORM（异步） |
| aiosqlite | — | SQLite 异步驱动 |
| pydantic-settings | 2.x | 配置读取 |
| structlog | — | 结构化日志 |
| mediapipe | **0.10.33** | 人脸关键点检测（Tasks API） |
| Pillow | — | 图片处理 |
| numpy | — | 关键点坐标数组运算 |
| python-multipart | — | 文件上传 FormData 解析 |

### 本地 AI 模型

| 文件 | 大小 | 来源 |
|------|------|------|
| `ai_models/face_landmarker.task` | ~3.6MB（float16） | MediaPipe 官方存储桶 |

### 前端关键依赖

| 包 | 用途 |
|----|------|
| react 18 | UI 框架 |
| typescript | 类型安全 |
| tailwindcss v4 | 样式系统 |
| zustand | 状态管理 |
| react-router-dom | 客户端路由 |
| axios | HTTP 客户端 |
| vite | 构建工具 + 开发代理 |
