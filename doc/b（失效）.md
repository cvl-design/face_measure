# AI 智能面诊系统 — 架构说明

**版本**: v0.2.0  
**最后更新**: 2026-04-20  
**定位**: 医美诊室辅助沟通工具（非医疗诊断设备）  
**终端**: Web 应用，优先适配平板，医生+客户共用同一界面

---

## 一、产品 SOP（标准操作流程）

```
STAGE 0 — 会话建立（约30s）
  医生开启系统 → 录入基本信息（年龄段/主诉/过敏史）
  → AI 风险声明确认

STAGE 1 — 多角度面部采集（约2-3min）
  系统引导完成5角度拍摄：正面 / 左45° / 右45° / 左90° / 右90°
  → MediaPipe 实时质检（角度/光线/遮挡/清晰度）
  → 医生预览确认 → 提交分析

  后台并行处理：
  ┌─────────────┬────────────────┬──────────────────┐
  │  VLM检测     │  MediaPipe几何  │   表型匹配        │
  │ （28类问题） │  （三庭五眼）   │  （10种模板）     │
  └─────────────┴────────────────┴──────────────────┘

STAGE 2 — 美学表型呈现（约3-5min）[制造期望]
  ① 骨相分析：三庭比例 / 五眼宽度 / 面型分类
  ② 表型匹配：
     "您的骨相与【知性优雅型】模板相似度 83%"
     → 展示对应风格虚拟参考人物图
  ③ 提升路径："优化下颌缘轮廓后，相似度可提升至 94%"

STAGE 3 — AI 检测报告（约3-5min）[建立信任]
  【年轻化项目】抗衰老：皱纹 / 下垂 / 容量缺失
  【精致化项目】变美：骨相调整 / 轮廓优化
  医生操作：审阅结果 → 勾选/取消 → 标注优先级

STAGE 4 — 实时效果模拟（约5-10min）[促成交]
  左：Before（当前标注照片）
  右：After（2D变形实时预览）
  医生逐项勾选 → 效果实时更新 → 右下角累计价格
  [查看精细效果] → 触发 API 高质量渲染

STAGE 5 — 方案确认 + 报告输出（约2min）
  医生最终审核 → 生成面诊报告（PDF）
  包含：检测结果 / 美学分析 / 模拟效果图 / 价格明细
  输出：打印 / 二维码分享 / 本地存档
```

---

## 二、技术路线总览

```
用户照片（5角度）
   │
   ▼
[采集引导层]         frontend/components/capture/GuidedCapture.vue
   │  MediaPipe 实时角度/质量校验
   ▼
[图片预处理]          backend/utils/image_utils.py
   │  resize ≤1024px / EXIF strip / JPEG 转换
   ▼
[SHA256 缓存检查]     backend/services/cache_service.py
   │  命中 → 直接返回（零 API 成本）
   │  未命中 ↓
   ├──────────────────────────────┐
   ▼                              ▼
[VLM 检测]                   [几何分析]
backend/services/             frontend/core/
vlm_detector.py               aestheticMetrics.js
Kimi-K2.5 API                 MediaPipe 478点
28类缺陷 + 严重度               三庭五眼 + 面型 + 高光点
   │                              │
   └──────────────┬───────────────┘
                  ▼
[表型匹配]        frontend/core/phenotypeEngine.js
   │  几何指标 → 10种模板相似度评分
   ▼
[标注渲染]        backend/services/annotation_renderer.py
   │  PIL 绘制彩色 bounding box + 标签
   ▼
[2D变形模拟]      frontend/core/morphingEngine.js
   │  TPS 本地快速变形（< 16ms）
   │  Face++ API 高质量渲染（按需）
   ▼
[治疗选择+计价]   frontend/stores/treatmentStore.js
   │  28类缺陷 → 治疗项目映射 → 实时价格汇总
   ▼
[报告生成]        frontend/views/ReportView.vue
   │  jsPDF + html2canvas → PDF 导出
   ▼
[API 响应]        backend/api/routes/detection.py
```

---

## 三、分层架构

### 后端（Python FastAPI）

```
backend/
├── main.py                          # FastAPI 入口 + CORS + 路由注册
├── core/
│   ├── config.py                    # 配置（含双模型字段）
│   ├── exceptions.py                # 自定义异常（5类）
│   └── logging_config.py            # structlog 结构化日志
├── models/
│   └── schemas.py                   # Pydantic v2 模型（含5级严重度）
├── prompts/
│   └── detector_prompt.md           # VLM System Prompt v1.1
├── services/
│   ├── vlm_detector.py              # VLM 检测（Kimi-K2.5）
│   ├── annotation_renderer.py       # PIL 标注叠加
│   └── cache_service.py             # Redis SHA256 缓存
├── api/routes/
│   ├── detection.py                 # POST /api/v1/detect（含内存存储）
│   └── health.py                    # GET /health
└── utils/
    ├── image_utils.py               # resize / EXIF / base64
    └── cost_tracker.py              # JSONL 成本记录
```

**待新增**：
```
backend/
├── api/routes/
│   ├── treatments.py                # GET /api/v1/treatments（治疗目录）
│   └── report.py                    # POST /api/v1/report（AI叙述生成）
├── data/
│   └── treatment_catalog.json       # 治疗项目 + 价格范围数据
└── services/
    └── reasoning_service.py         # Kimi-K2.5 文本推理（报告/方案）
```

### 前端（Vue 3 + Vite）

```
frontend/src/
├── core/                            # 纯算法层（无UI依赖）
│   ├── apiClient.js                 # Axios 封装
│   ├── aestheticMetrics.js          # 【待实现】三庭五眼/面型/高光点几何算法
│   ├── phenotypeEngine.js           # 【待实现】10模板相似度评分
│   ├── morphingEngine.js            # 【待实现】TPS变形 + API封装
│   └── anatomicalMapping.js         # 【待实现】478关键点→28类区域映射
├── stores/
│   ├── detectionStore.js            # 检测状态机（含计时器）
│   ├── treatmentStore.js            # 【待实现】治疗选择 + 计价
│   └── sessionStore.js              # 【待实现】患者会话管理
├── components/
│   ├── capture/
│   │   ├── GuidedCapture.vue        # 【待实现】5角度引导拍摄
│   │   ├── WebcamCapture.vue        # 摄像头采集（现有）
│   │   └── ImageUpload.vue          # 文件上传（现有）
│   ├── detection/
│   │   ├── AnnotationOverlay.vue    # 标注对比（现有）
│   │   └── DetectionPanel.vue       # 检测结果列表（现有）
│   ├── analysis/
│   │   ├── PhenotypeCard.vue        # 【待实现】表型匹配结果展示
│   │   └── MetricsRadar.vue         # 【待实现】雷达图美学评分
│   └── simulation/
│       ├── MorphingPreview.vue      # 【待实现】Before/After 变形预览
│       └── TreatmentSelector.vue    # 【待实现】治疗项目勾选+计价面板
└── views/
    ├── ConsultationView.vue         # 主工作流（现有）
    ├── ReportView.vue               # 【待实现】面诊报告
    └── DebugView.vue                # 调试视图（现有）
```

---

## 四、核心数据模型

### DetectionResult（VLM 输出）

```
DetectionResult
├── face_detected: bool
├── defects: List[DefectItem]
│   ├── defect_id: str
│   ├── name_zh: str
│   ├── category: DefectCategory（7类）
│   ├── severity: int 1-5
│   ├── confidence: float 0-1
│   ├── bounding_box: BoundingBox | null
│   ├── clinical_description: str | null
│   ├── treatment_suggestion: str | null
│   └── anatomical_regions: List[str]
├── age_assessment: AgeAssessment | null
├── overall: OverallAssessment | null
└── raw_vlm_notes: str | null
```

### AestheticMetricsResult（几何分析输出）

```
AestheticMetricsResult
├── three_sections: { upper, middle, lower, ratios, score, advice }
├── five_eyes: { eye_width, face_width, ratio, score, advice }
├── face_shape: { classification, width_height_ratio, score }
├── malar_prominence: { ratio, score, advice }
├── brow_arch: { left_q_point, right_q_point, score }
├── highlight_points: { malar, cheek, brow }
├── symmetry: { score, asymmetric_features }
└── composite_score: int 0-100
```

### PhenotypeMatchResult（表型匹配输出）

```
PhenotypeMatchResult
├── best_match: { template_id, name_zh, similarity: float }
├── all_matches: List[{ template_id, similarity }]
├── gap_analysis: List[{ metric, current, ideal, delta, treatment_hint }]
└── reference_image_url: str
```

---

## 五、关键配置（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SILICONFLOW_API_KEY` | —（必填） | 硅基流动 API Key |
| `SILICONFLOW_BASE_URL` | `https://api.siliconflow.cn/v1` | OpenAI 兼容接口 |
| `VLM_MODEL_NAME` | `Pro/moonshotai/Kimi-K2.5` | 视觉检测主力模型 |
| `VLM_VISION_MODEL` | null | 速度优先时切换（如 Qwen2.5-VL-7B） |
| `VLM_REASONING_MODEL` | `Pro/moonshotai/Kimi-K2.5` | 文本推理任务模型 |
| `VLM_TIMEOUT_SECONDS` | 90 | 超时（Kimi-K2.5 预计 20-50s） |
| `VLM_TEMPERATURE` | 0.1 | 低温保证结构化输出 |
| `VLM_MAX_TOKENS` | 2048 | 最大输出 token |
| `MAX_IMAGE_SIZE_MB` | 10 | 图片大小上限 |
| `MAX_IMAGE_DIMENSION` | 1024 | resize 上限（px） |
| `REDIS_URL` | null | Redis（不填则禁用缓存） |
| `AGE_ARBITRATION_DELTA` | 8 | 年龄仲裁触发阈值 |

---

## 六、API 端点速览

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| GET | `/health` | 系统健康检查 | ✅ |
| POST | `/api/v1/detect` | 上传图片 VLM 检测 | ✅ |
| GET | `/api/v1/detect/{id}/annotated-image` | 获取标注图 | ✅ |
| GET | `/api/v1/detect/{id}` | 查询检测结果 | ✅ |
| GET | `/api/v1/treatments` | 获取治疗项目目录 | 🔲 待实现 |
| POST | `/api/v1/report/narrative` | Kimi-K2.5 生成AI叙述 | 🔲 待实现 |

---

## 七、开发阶段路线（更新后）

| Phase | 核心模块 | 状态 |
|-------|---------|------|
| Phase 0 | VLM检测MVP（28类/5级/标注图）| 🟡 基本完成，模型切换验证中 |
| Phase 1 | 多角度采集 + MediaPipe几何层 + 表型匹配 | 🔲 下一阶段 |
| Phase 2 | 治疗目录 + 2D变形模拟 + 实时计价 | 🔲 待开始 |
| Phase 3 | 面诊报告 + 患者记录 + UI完整打磨 | 🔲 待开始 |
| Phase 4 | SaaS 多诊所 + AI语音对话（可选） | 🔲 待开始 |

详细子任务见 `docs/implementation_plan.md`。

---

## 八、性能陷阱与规避策略

| 陷阱 | 影响 | 规避方案 |
|------|------|---------|
| MediaPipe WASM 首次加载 2-4s | 首次采集冻结 | STAGE 0 期间后台预加载 |
| VLM 推理 20-50s（Kimi-K2.5） | 等待体验差 | 异步任务模式 + 进度动画 |
| 2D变形 API 延迟 200-500ms | 治疗勾选卡顿 | TPS 本地即时预览 + API 按需 |
| 五照片串行分析 | 分析慢 | Web Worker 并行 + 逐张显示 |
| VLM bounding_box ±15% 偏差 | 标注框不准 | Phase 1 MediaPipe 精确坐标替代 |

---

## 九、成本控制机制

1. **SHA256 图片缓存**：同一图片24小时内不重复调用 VLM
2. **图片 resize**：最大 1024px，防止 4K 图片膨胀 token
3. **年龄仲裁按需触发**：仅 |Δage| > 8 时触发（约20%场景）
4. **TPS 本地变形**：变形预览无 API 成本
5. **AI叙述单次调用**：报告生成仅在 STAGE 5 调用一次 Kimi-K2.5

---

*最后更新：2026-04-20（产品方向确认，加入SOP/新模块/性能分析）*
