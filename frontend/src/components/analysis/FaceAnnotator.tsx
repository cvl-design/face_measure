/**
 * FaceAnnotator — Canvas 层叠缺陷标注组件
 *
 * 功能：
 * - 底层显示 PIL 渲染的静态标注图（来自后端 base64）
 * - Canvas 层叠绘制缺陷引导折线（landmark_refs → 连线）
 * - 点击标签展开/收起缺陷详情浮层
 * - confidence ≥ 0.7 才绘制折线
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DefectItem } from '../../store/sessionStore'

// ── 类型 ────────────────────────────────────────────────────────────

interface LabelAnchor {
  defect: DefectItem
  x: number  // canvas px
  y: number
}

interface FaceAnnotatorProps {
  /** 后端返回的 base64 标注图 data URL */
  annotatedImageUrl: string
  /** 缺陷列表（含 landmark_refs，归一化坐标索引） */
  defects: DefectItem[]
  /** MediaPipe 478 关键点（归一化 0–1，来自 analysisResult） */
  landmarks?: Array<{ x: number; y: number; z: number }>
}

// ── 颜色方案（按严重度） ─────────────────────────────────────────────

function severityColor(s: number): string {
  if (s <= 1) return 'rgba(96,165,250,0.85)'   // blue-400
  if (s <= 2) return 'rgba(251,191,36,0.85)'   // yellow-400
  if (s <= 3) return 'rgba(251,146,60,0.85)'   // orange-400
  if (s <= 4) return 'rgba(248,113,113,0.85)'  // red-400
  return 'rgba(220,38,38,0.90)'               // red-600
}

// ── 主组件 ──────────────────────────────────────────────────────────

export default function FaceAnnotator({ annotatedImageUrl, defects, landmarks }: FaceAnnotatorProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const imgRef      = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [imgSize, setImgSize]           = useState({ w: 0, h: 0 })
  const [labels, setLabels]             = useState<LabelAnchor[]>([])
  const [activeDefect, setActiveDefect] = useState<DefectItem | null>(null)
  const [popupPos, setPopupPos]         = useState({ x: 0, y: 0 })

  // ── 绘制 Canvas ──────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img || imgSize.w === 0) return

    canvas.width  = imgSize.w
    canvas.height = imgSize.h
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, imgSize.w, imgSize.h)

    if (!landmarks || landmarks.length === 0) return

    const newLabels: LabelAnchor[] = []

    for (const d of defects) {
      // 只绘制置信度 ≥ 0.7 且已勾选的缺陷
      if (d.confidence < 0.7) continue
      if (d.checked === false) continue
      const refs = d.landmark_refs
      if (!refs || refs.length === 0) continue

      const pts = refs
        .map((i) => landmarks[i])
        .filter(Boolean)
        .map((lm) => ({ x: lm.x * imgSize.w, y: lm.y * imgSize.h }))

      if (pts.length === 0) continue

      const color = severityColor(d.severity)

      // 绘制折线
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth   = 2
      ctx.lineCap     = 'round'
      ctx.lineJoin    = 'round'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      if (pts.length > 2) ctx.closePath()
      ctx.stroke()

      // 端点小圆
      ctx.setLineDash([])
      for (const p of pts) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
      }
      ctx.restore()

      // 计算标签锚点（所有关键点的质心）
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length

      // 绘制标签背景 + 文字
      const label = d.name_zh
      ctx.save()
      ctx.font = 'bold 11px system-ui, sans-serif'
      const tw  = ctx.measureText(label).width
      const pad = 4
      const lx  = Math.max(4, Math.min(cx - tw / 2 - pad, imgSize.w - tw - pad * 2 - 4))
      const ly  = Math.max(20, cy - 18)

      // 标签背景
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.roundRect(lx, ly - 13, tw + pad * 2, 18, 4)
      ctx.fill()

      // 标签文字
      ctx.fillStyle = '#fff'
      ctx.fillText(label, lx + pad, ly)
      ctx.restore()

      newLabels.push({ defect: d, x: lx + (tw + pad * 2) / 2, y: ly - 6 })
    }

    setLabels(newLabels)
  }, [defects, landmarks, imgSize])

  // ── 图片加载后获取尺寸 ───────────────────────────────────────────
  const handleImgLoad = () => {
    const img = imgRef.current
    if (!img) return
    setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
  }

  useEffect(() => {
    draw()
  }, [draw])

  // ── Canvas 点击（命中检测） ──────────────────────────────────────
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect   = canvas.getBoundingClientRect()
    const scaleX = imgSize.w / rect.width
    const scaleY = imgSize.h / rect.height
    const cx     = (e.clientX - rect.left) * scaleX
    const cy     = (e.clientY - rect.top)  * scaleY

    // 查找被点击的标签
    const hit = labels.find((l) => Math.abs(cx - l.x) < 50 && Math.abs(cy - l.y) < 16)
    if (hit) {
      if (activeDefect?.defect_id === hit.defect.defect_id) {
        setActiveDefect(null)
      } else {
        setActiveDefect(hit.defect)
        // 弹层定位（转换回屏幕坐标）
        setPopupPos({
          x: (hit.x / imgSize.w) * rect.width  + rect.left,
          y: (hit.y / imgSize.h) * rect.height + rect.top,
        })
      }
    } else {
      setActiveDefect(null)
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="relative w-full h-full flex items-center justify-center">
      {/* 底层：PIL 静态标注图 */}
      <div className="relative inline-block">
        <img
          ref={imgRef}
          src={annotatedImageUrl}
          alt="面部标注图"
          onLoad={handleImgLoad}
          className="max-w-full max-h-full object-contain rounded-xl select-none"
          draggable={false}
        />

        {/* Canvas 覆盖层（缺陷引导折线） */}
        {imgSize.w > 0 && (
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="absolute inset-0 w-full h-full cursor-pointer rounded-xl"
            style={{ pointerEvents: 'auto' }}
            title="点击标签查看缺陷详情"
          />
        )}
      </div>

      {/* 缺陷详情浮层 */}
      {activeDefect && (
        <DefectPopup
          defect={activeDefect}
          screenX={popupPos.x}
          screenY={popupPos.y}
          onClose={() => setActiveDefect(null)}
        />
      )}

      {/* 无关键点时的提示 */}
      {(!landmarks || landmarks.length === 0) && (
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span className="text-xs text-gray-500 bg-gray-900/60 rounded-full px-3 py-1">
            关键点数据加载中，折线标注暂不可用
          </span>
        </div>
      )}
    </div>
  )
}

// ── 缺陷详情浮层 ─────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<number, string> = {
  1: '极轻', 2: '轻度', 3: '中度', 4: '重度', 5: '严重',
}

const SEVERITY_BAR_BG = (s: number) => {
  if (s <= 1) return 'bg-blue-400'
  if (s <= 2) return 'bg-yellow-400'
  if (s <= 3) return 'bg-orange-400'
  if (s <= 4) return 'bg-red-400'
  return 'bg-red-600'
}

function DefectPopup({
  defect,
  screenX,
  screenY,
  onClose,
}: {
  defect: DefectItem
  screenX: number
  screenY: number
  onClose: () => void
}) {
  // 浮层固定宽 260px，避免出屏
  const left = Math.min(screenX - 130, window.innerWidth - 270)
  const top  = screenY + 12

  return (
    <div
      className="fixed z-50 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4"
      style={{ left, top }}
    >
      {/* 头部 */}
      <div className="flex items-start justify-between mb-2">
        <span className="font-bold text-gray-800 text-sm">{defect.name_zh}</span>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 ml-2 flex-shrink-0 text-lg leading-none"
        >
          ×
        </button>
      </div>

      {/* 严重度条 */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-gray-500 flex-shrink-0">
          {SEVERITY_LABEL[defect.severity] ?? defect.severity}
        </span>
        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${SEVERITY_BAR_BG(defect.severity)}`}
            style={{ width: `${(defect.severity / 5) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-400 flex-shrink-0">
          置信度 {Math.round(defect.confidence * 100)}%
        </span>
      </div>

      {/* 临床描述 */}
      {defect.clinical_description && (
        <p className="text-xs text-gray-600 leading-relaxed mb-2">
          {defect.clinical_description}
        </p>
      )}

      {/* 治疗建议 */}
      {defect.treatment_suggestion && (
        <div className="bg-indigo-50 rounded-lg px-3 py-2">
          <p className="text-xs text-indigo-700 leading-relaxed">
            💊 {defect.treatment_suggestion}
          </p>
        </div>
      )}

      {/* 解剖区域 */}
      {defect.anatomical_regions?.length > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          📍 {defect.anatomical_regions.join('、')}
        </p>
      )}
    </div>
  )
}
