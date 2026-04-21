 Phase 0 — 项目骨架                                                                                                                                                                                                                         t

  后端
  - pip install fastapi uvicorn pydantic-settings sqlalchemy aiosqlite structlog python-multipart
  - 初始化目录结构（按架构文档第十一节）
  - core/config.py：pydantic-settings 读取 .env，所有字段带类型和默认值
  - core/logging_config.py：structlog 配置（JSON 格式，含 request_id 上下文）
  - core/exceptions.py：定义 5 类异常（VLMError / CaptureQualityError / TemplateMatchError / SimulationError / SessionError）
  - db/database.py：SQLite + SQLAlchemy async + WAL 模式（PRAGMA journal_mode=WAL）
  - db/models.py：Session / FaceCapture / DetectionResult / AestheticMetricsResult / PhenotypeMatchResult / TreatmentPlan 表定义
  - api/routes/health.py：GET /health 返回版本和依赖状态
  - main.py：挂载路由、CORS（仅 localhost）、lifespan 钩子（模型预加载）
  - .env.example 完整填写

  前端
  - npm create vite@latest frontend -- --template react-ts
  - 安装：tailwindcss zustand axios react-router-dom
  - vite.config.ts：配置开发代理 /api → http://127.0.0.1:8000
  - 配置 Tailwind（大字体主题，高对比度色板）
  - store/sessionStore.ts：定义完整状态类型 + 初始化
  - services/api.ts：Axios 实例封装（baseURL / 超时 / 错误拦截）
  - 路由配置：6 个页面 + Analyzing 过渡页

  验收标准：uvicorn main:app 启动无报错，/health 返回 200，前端页面路由可切换。
    在路径D:\Py_Project\face_measure下：  运行python -m uvicorn backend.main:app --reload --port 8080
    在路径下：cd frontend && npm run dev

  ---
  Phase 1 — 面部采集

  前端
  - core/mediapipeLoader.ts：单例加载 face_landmarker.task（WASM），Promise 缓存
  - Capture.tsx：STAGE 0 结束后在后台调用 mediapipeLoader，消除冷启动
  - components/capture/WebcamCapture.tsx：
    - getUserMedia 摄像头开启
    - 每帧送 MediaPipe WASM → 返回关键点
    - 计算实时角度偏差（正面/左45°/右45°/左90°/右90°）
    - 角度在容差内持续 ≥1.5s → 自动拍摄
  - components/capture/AngleGuideOverlay.tsx：
    - 人脸轮廓引导框（椭圆）
    - 当前角度指示器
    - 实时质量评分：角度 / 光线 / 遮挡 / 清晰度
    - 不合格 → 红色提示 + 文字引导
  - components/capture/ImageUpload.tsx：
    - 5 格上传区（对应 5 角度）
    - 格式校验（jpg/png）+ 尺寸预览
  - services/captureUtils.ts：Canvas 截帧、图片压缩至 1024px、base64 转换
  - 采集确认页：5 张预览图 + 重拍按钮 + 提交按钮

  后端
  - utils/image_utils.py：resize ≤1024px / EXIF strip / JPEG 转换 / SHA256 计算
  - api/routes/capture.py：
    - POST /api/v1/sessions/{id}/capture：接收 5 张图，保存临时文件，返回 capture_id
    - GET /api/v1/sessions/{id}/capture/quality：返回质量评分报告
  - api/routes/session.py：POST 创建会话 / DELETE 关闭会话（触发文件删除）

  验收标准：5 角度照片可采集/上传，质量不合格时有实时提示，照片成功上传后端。

  ---
  Phase 2 — 本地几何分析

  后端
  - 安装：mediapipe insightface opencv-python numpy
  - services/face_detector.py：
    - FastAPI lifespan 预加载 MediaPipe Python 模型（单例）
    - extract_landmarks(image_path) → List[478个坐标点]
    - 5 张图并行批处理（asyncio.gather）
  - services/defect_scorer.py：
    - 输入：478 关键点坐标
    - 实现三庭比例计算（发际线/眉骨/鼻底/下颌）
    - 实现五眼宽度计算（双眼内外眦/面宽）
    - 实现面型分类（鹅蛋/瓜子/心形/方形/长形）
    - 实现苹果肌突出度评分
    - 实现眉弓 Q 点计算
    - 实现对称性评分（左右关键点镜像距离）
    - 输出：AestheticMetricsResult
  - models/schemas.py：定义 AestheticMetricsResult Pydantic 模型
  - api/routes/analysis.py：POST /analyze 启动并行分析任务（几何分析立即返回）

  验收标准：上传照片后，几何分析结果（三庭/五眼/面型/对称性评分）在 2s 内返回。

  ---
  Phase 3 — VLM 集成

  后端
  - prompts/detector_prompt.md：
    - 定义 28 类缺陷（中英文名、category、解释）
    - 定义 5 级严重度量表
    - 定义结构化 JSON 输出格式（含 confidence / anatomical_regions）
    - 说明 5 张图输入顺序和角度信息
  - services/vlm_detector.py：
    - 5 张图 base64 编码 → 构建多图 message
    - 调用 SiliconFlow OpenAI 兼容接口（httpx async）
    - 解析响应 JSON → DetectionResult
    - 超时处理（60s）+ 指数退避重试（最多 3 次）
  - services/cache_service.py：
    - SHA256(5张图) → cache key
    - Redis 存储（有则用）/ 降级为内存 dict
    - TTL 24h，命中直接返回，跳过 VLM 调用
  - utils/cost_tracker.py：
    - log_api_call(model, input_tokens, output_tokens, cost_cny, session_id)
    - JSONL 追加写入
  - services/annotation_renderer.py：
    - 输入：原图 + DefectItem 列表（含 landmark_refs）+ AestheticMetricsResult 关键点坐标
    - 对 confidence ≥ 0.7 的缺陷：从关键点出发绘制引导折线 + 标签文字
    - 输出：标注后的图片（base64 or 临时文件路径）

  前端
  - components/analysis/FaceAnnotator.tsx：
    - Canvas 层叠加在原图上
    - 接收引导折线数据（端点坐标 + 颜色 + 标签文字）
    - 渲染折线 + 标签（仅 confidence ≥ 0.7）
    - 点击标签展开缺陷详情
  - components/analysis/DefectList.tsx：
    - 按 category 分组展示
    - 严重度条形图（1–5 级）
    - 医生勾选/取消 + 设置优先级
  - Analyzing.tsx：骨架屏动画（几何分析完成先显示，VLM 结果后续推入）

  验收标准：VLM 返回 28 类缺陷（含严重度 + confidence），标注折线正确渲染在对应面部位置。

  ---
  Phase 4 — 表型匹配

  模板库生成（离线，AutoDL）
  - 准备 SDXL + 亚洲面孔 LoRA 环境（AutoDL 按量租用）
  - 编写批量生成脚本：性别(2) × 年龄段(4) × 脸型(4) × 风格(4) = 128 组合，每组 4–8 张
  - 生成 500–1000 张虚拟人脸图像
  - 人工审查过滤（质量/多样性检查）
  - InsightFace ArcFace 提取 512 维特征向量
  - 为每张图打美学标签 JSON（face_shape / aesthetic_style / name_zh / highlight_profile）
  - 构建 FAISS IVFFlat 索引 → 保存 features.index
  - 生成 metadata.json（template_id → 标签 + 缩略图路径）
  - 缩略图生成（256×256，存入 ai_models/templates/thumbnails/）

  后端
  - 安装：faiss-cpu insightface
  - services/template_matcher.py：
    - FastAPI lifespan 预加载 FAISS 索引（内存）
    - 用客户正面照 ArcFace 向量 → FAISS Top5 检索（<10ms）
    - gap_analysis：逐维度比较客户几何指标 vs 匹配模板指标 → 差值 + 治疗提示
    - 返回：PhenotypeMatchResult
  - api/routes/templates.py：GET 返回 Top5 / PUT 医生选定

  前端
  - components/template/TemplateGallery.tsx：5张参考面横向展示 + 相似度百分比
  - components/template/TemplateCard.tsx：头像 + 美学风格标签 + 选中状态
  - components/template/GapAnalysisPanel.tsx：
    - 表格展示各维度（三庭/五眼/对称性...）当前值 vs 理想值 vs 差距
    - 差距对应治疗提示（可点击跳转至 TreatmentMenu）
  - Templates.tsx：整合 Gallery + GapAnalysis + 确认选定按钮

  验收标准：Top5 匹配结果 < 10ms 返回，gap_analysis 正确映射到可改善项目。

  ---
  Phase 5 — 方案协创

  数据准备
  - data/treatment_catalog.json：定义所有治疗项目（item_id / name / category / default_price / intensity_range / description）
  - data/treatment_rules.json：28类缺陷 → 推荐治疗项目映射规则（含优先级权重）
  - data/price_catalog.json：价格配置（区间定价，医生可覆盖）

  后端
  - services/treatment_engine.py：
    - 规则引擎：根据 DefectItem 列表 + 严重度 → 推荐项目 + 优先级
    - Qwen3 文本推理（可选）：生成个性化推荐说明文字
    - 输出：TreatmentPlan.ai_recommended
  - api/routes/treatment.py：GET 推荐方案 / PUT 医生更新选定项目
  - api/routes/catalog.py：GET /api/v1/catalog/treatments 完整目录

  前端
  - components/treatment/TreatmentMenu.tsx：
    - 按 category 分组（抗衰老 / 轮廓优化 / 精致化）
    - 每项：勾选框 + 项目名 + AI 推荐理由 + 强度滑块（0.0–1.0）
    - 勾选/取消 → 触发 TPS 快速预览
  - components/treatment/PriceSheet.tsx：
    - 实时汇总已选项目
    - 每项价格（强度 × 单价）
    - 总价 + 备注输入
  - store/sessionStore.ts：添加治疗选择状态（已选项目 / 强度 / 总价）

  验收标准：治疗项目勾选后价格实时更新，推荐方案与缺陷分析结果对应。

  ---
  Phase 6 — 模拟渲染

  前端
  - core/morphingEngine.ts：
    - TPS（薄板样条）变形算法实现（纯 TS，无外部依赖）
    - 控制点：MediaPipe 关键点 → 根据治疗项目 + 强度计算位移
    - Web Worker 运行，主线程不阻塞
    - 输出：变形后的 ImageData，< 500ms
  - components/simulation/SimulationStages.tsx：
    - 4 阶段切换：① 当前状态 → ② 抗衰老效果 → ③ 轮廓优化效果 → ④ 综合效果
    - 每阶段 TPS 预览图
    - 「查看精细效果」按钮 → 触发 ComfyUI API
  - components/simulation/BeforeAfterSlider.tsx：
    - 左右分割线拖动对比
    - 原图（含标注）↔ 高质量模拟图
    - 渲染中：显示骨架屏（非旋转圈）
  - WebSocket 客户端：连接 /ws/sessions/{id}/simulate，实时接收渲染进度

  后端
  - services/anonymizer.py：发送前人脸区域高斯模糊 + 元数据剥离（仅正面图）
  - services/simulation_client.py：
    - ComfyUI API 调用（提交 workflow → 轮询任务状态 → 获取结果图）
    - WebSocket 推送进度（节流 2fps）
    - 最终图一次性推送
  - api/routes/simulation.py：
    - POST /simulate：异步提交，返回 job_id
    - GET /simulate/{job_id}：轮询结果
    - WebSocket /ws/sessions/{id}/simulate

  验收标准：勾选治疗项目后 <500ms 显示 TPS 预览；「查看精细效果」触发 ComfyUI，进度实时显示，最终图滑动对比正常。

  ---
  Phase 7 — 收尾 & Demo

  后端
  - services/report_exporter.py：
    - WeasyPrint 生成 PDF
    - 内容：患者基本信息 / 面部标注图 / 美学评分雷达图 / 缺陷列表 / 治疗方案 / 价格明细 / 模拟效果图
  - 会话关闭钩子（DELETE /sessions/{id}）：
    - 删除 TEMP_IMAGE_DIR 下对应文件
    - 更新 closed_at + status='closed'
  - 定时清理任务（FastAPI lifespan）：每小时扫描 temp/ 删除超过 2h 的文件
  - api/routes/report.py：GET /sessions/{id}/report 返回 PDF 二进制流

  前端
  - pages/Summary.tsx：
    - 最终方案汇总展示
    - PDF 下载按钮
    - 二维码分享（jsPDF 生成）
    - 「结束会话」按钮 → 调用 DELETE session → 跳转 Welcome

  端到端联调
  - STAGE 0 → 1 → 2 → 3 → 4+5 → 6 全流程走通（Happy Path）
  - 质量不合格重拍流程
  - 缓存命中流程（相同图片零 API 成本）
  - 会话关闭后确认临时文件已删除
  - 检查 cost_log.jsonl 记录是否完整

  演示数据
  - 准备 3 套标准演示案例（不同年龄/性别/主要诉求）
  - 每套：5 张照片 + 预期缺陷列表 + 推荐方案

  部署
  - requirements.txt 锁版本
  - README.md：启动步骤 / 模型下载说明 / .env 配置说明
  - PoC 本地部署验证（Windows 11 + CPU 推理）

  ---
  里程碑检查点

  ┌─────────────┬──────────────────────────────────────────────────┐
  │  时间节点   │                      交付物                      │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ Week 1 结束 │ Phase 0+1 完成，5角度采集可用                    │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ Week 2 结束 │ Phase 2+3 完成，几何分析+VLM检测可用，标注图可见 │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ Week 3 结束 │ Phase 4 完成，Top5 表型匹配可用                  │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ Week 4 结束 │ Phase 5+6 完成，方案协创+TPS预览可用             │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ Week 5–6    │ Phase 7 完成，端到端联调+演示数据+PDF报告        │
  └─────────────┴──────────────────────────────────────────────────┘