/**
 * FaceSense 全局状态（Zustand）
 * 单一 store 覆盖整个 SOP 流程的所有状态
 */
import { create } from 'zustand'

// ── 类型定义 ───────────────────────────────────────────────────

export type Gender = 'male' | 'female'
export type AgeGroup = '20-29' | '30-39' | '40-49' | '50+'
export type SessionStatus = 'capturing' | 'analyzing' | 'consulting' | 'closed'
export type CaptureMethod = 'webcam' | 'upload'
export type DefectCategory = 'wrinkle' | 'volume_loss' | 'contour' | 'ptosis'
export type TreatmentCategory = 'anti_aging' | 'contouring' | 'refinement'

export interface CaptureQualityScore {
  angle: string
  sharpness: number
  lighting: number
  occlusion: number
  overall: number
  passed: boolean
  reasons: string[]
}

export interface DefectItem {
  defect_id: string
  name_zh: string
  category: DefectCategory
  severity: number       // 1–5
  confidence: number     // 0.0–1.0
  landmark_refs: number[]
  clinical_description?: string
  treatment_suggestion?: string
  anatomical_regions: string[]
  // 医生操作状态（前端本地，不上传后端）
  checked?: boolean      // 是否勾选纳入方案
  priority?: number      // 医生设置的优先级 1–3（1=高，2=中，3=低）
}

export interface AestheticMetrics {
  three_sections: Record<string, unknown>
  five_eyes: Record<string, unknown>
  face_shape: { classification: string; width_height_ratio: number; score: number }
  malar_prominence: Record<string, unknown>
  brow_arch: Record<string, unknown>
  highlight_points: Record<string, unknown>
  symmetry: Record<string, unknown>
  composite_score: number
}

export interface TemplateMatch {
  template_id: string
  name_zh: string
  similarity: number
  aesthetic_tags: Record<string, string>
  thumbnail_url: string
}

export interface GapAnalysisItem {
  metric: string
  current: number
  ideal: number
  delta: number
  treatment_hint: string
}

export interface TreatmentItem {
  item_id: string
  name: string
  category: TreatmentCategory
  intensity: number     // 0.0–1.0
  unit_price: number
  priority: number
}

export interface CaptureImages {
  front?: File | string    // File（上传）or base64（摄像头）
  left45?: File | string
  right45?: File | string
  left90?: File | string
  right90?: File | string
}

// ── Store 状态 ────────────────────────────────────────────────

interface SessionState {
  // 会话基本信息
  sessionId: string | null
  gender: Gender | null
  ageGroup: AgeGroup | null
  chiefComplaint: string
  allergyNote: string
  sessionStatus: SessionStatus

  // 采集
  captureMethod: CaptureMethod
  captureImages: CaptureImages
  captureId: string | null
  qualityScores: Record<string, CaptureQualityScore> | null

  // 分析结果
  defects: DefectItem[]
  aestheticMetrics: AestheticMetrics | null
  annotatedImageUrl: string | null   // 后端返回的标注图 URL
  isAnalyzing: boolean

  // 表型匹配
  templateMatches: TemplateMatch[]
  selectedTemplateId: string | null
  gapAnalysis: GapAnalysisItem[]

  // 治疗方案
  aiRecommended: TreatmentItem[]
  doctorSelected: TreatmentItem[]
  totalPrice: number
  planNotes: string

  // 模拟
  simulationJobId: string | null
  simulationUrl: string | null
  isSimulating: boolean
  simulationProgress: number   // 0–100
}

interface SessionActions {
  // 会话
  setSessionInfo: (info: { sessionId: string; gender: Gender; ageGroup: AgeGroup; chiefComplaint: string; allergyNote: string }) => void
  setSessionStatus: (status: SessionStatus) => void

  // 采集
  setCaptureMethod: (method: CaptureMethod) => void
  setCaptureImage: (angle: keyof CaptureImages, image: File | string) => void
  setCaptureResult: (captureId: string, qualityScores: Record<string, CaptureQualityScore>) => void

  // 分析
  setAnalysisResult: (defects: DefectItem[], metrics: AestheticMetrics, annotatedUrl: string) => void
  setAnalyzing: (v: boolean) => void
  toggleDefect: (defectId: string) => void
  setDefectPriority: (defectId: string, priority: number) => void

  // 表型
  setTemplateMatches: (matches: TemplateMatch[], gap: GapAnalysisItem[]) => void
  selectTemplate: (templateId: string) => void

  // 治疗
  setAiRecommended: (items: TreatmentItem[]) => void
  toggleTreatment: (item: TreatmentItem) => void
  setTreatmentIntensity: (itemId: string, intensity: number) => void
  setPlanNotes: (notes: string) => void

  // 模拟
  setSimulationJob: (jobId: string) => void
  setSimulationResult: (url: string) => void
  setSimulationProgress: (progress: number) => void

  // 重置（新会话）
  reset: () => void
}

const initialState: SessionState = {
  sessionId: null,
  gender: null,
  ageGroup: null,
  chiefComplaint: '',
  allergyNote: '',
  sessionStatus: 'capturing',

  captureMethod: 'upload',
  captureImages: {},
  captureId: null,
  qualityScores: null,

  defects: [],
  aestheticMetrics: null,
  annotatedImageUrl: null,
  isAnalyzing: false,

  templateMatches: [],
  selectedTemplateId: null,
  gapAnalysis: [],

  aiRecommended: [],
  doctorSelected: [],
  totalPrice: 0,
  planNotes: '',

  simulationJobId: null,
  simulationUrl: null,
  isSimulating: false,
  simulationProgress: 0,
}

function calcTotalPrice(items: TreatmentItem[]): number {
  return items.reduce((sum, item) => sum + item.unit_price * item.intensity, 0)
}

export const useSessionStore = create<SessionState & SessionActions>((set) => ({
  ...initialState,

  setSessionInfo: (info) => set({ ...info }),
  setSessionStatus: (sessionStatus) => set({ sessionStatus }),

  setCaptureMethod: (captureMethod) => set({ captureMethod }),
  setCaptureImage: (angle, image) =>
    set((s) => ({ captureImages: { ...s.captureImages, [angle]: image } })),
  setCaptureResult: (captureId, qualityScores) => set({ captureId, qualityScores }),

  setAnalysisResult: (defects, aestheticMetrics, annotatedImageUrl) =>
    set({
      defects: defects.map((d) => ({ ...d, checked: true, priority: 2 })),
      aestheticMetrics,
      annotatedImageUrl,
      isAnalyzing: false,
    }),
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  toggleDefect: (defectId) =>
    set((s) => ({
      defects: s.defects.map((d) =>
        d.defect_id === defectId ? { ...d, checked: !d.checked } : d
      ),
    })),
  setDefectPriority: (defectId, priority) =>
    set((s) => ({
      defects: s.defects.map((d) =>
        d.defect_id === defectId ? { ...d, priority } : d
      ),
    })),

  setTemplateMatches: (templateMatches, gapAnalysis) => set({ templateMatches, gapAnalysis }),
  selectTemplate: (selectedTemplateId) => set({ selectedTemplateId }),

  setAiRecommended: (aiRecommended) => set({ aiRecommended }),
  toggleTreatment: (item) =>
    set((s) => {
      const exists = s.doctorSelected.some((d) => d.item_id === item.item_id)
      const next = exists
        ? s.doctorSelected.filter((d) => d.item_id !== item.item_id)
        : [...s.doctorSelected, item]
      return { doctorSelected: next, totalPrice: calcTotalPrice(next) }
    }),
  setTreatmentIntensity: (itemId, intensity) =>
    set((s) => {
      const next = s.doctorSelected.map((d) =>
        d.item_id === itemId ? { ...d, intensity } : d
      )
      return { doctorSelected: next, totalPrice: calcTotalPrice(next) }
    }),
  setPlanNotes: (planNotes) => set({ planNotes }),

  setSimulationJob: (simulationJobId) => set({ simulationJobId, isSimulating: true, simulationProgress: 0 }),
  setSimulationResult: (simulationUrl) => set({ simulationUrl, isSimulating: false, simulationProgress: 100 }),
  setSimulationProgress: (simulationProgress) => set({ simulationProgress }),

  reset: () => set({ ...initialState }),
}))
