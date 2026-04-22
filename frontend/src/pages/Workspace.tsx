/**
 * Workspace — 分析报告页
 * 左栏：综合评分 + 美学指标 + DefectList（独立组件，含勾选/优先级）
 * 右栏：FaceAnnotator（Canvas 折线叠加）或占位图
 */
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../store/sessionStore'
import type { AestheticMetrics } from '../store/sessionStore'
import DefectList from '../components/analysis/DefectList'
import FaceAnnotator from '../components/analysis/FaceAnnotator'

export default function Workspace() {
  const navigate          = useNavigate()
  const sessionId         = useSessionStore((s) => s.sessionId)
  const defects           = useSessionStore((s) => s.defects)
  const aestheticMetrics  = useSessionStore((s) => s.aestheticMetrics)
  const annotatedImageUrl = useSessionStore((s) => s.annotatedImageUrl)
  const toggleDefect      = useSessionStore((s) => s.toggleDefect)
  const setDefectPriority = useSessionStore((s) => s.setDefectPriority)

  useEffect(() => {
    if (!sessionId) navigate('/', { replace: true })
  }, [sessionId, navigate])

  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* 左栏：分析报告 */}
      <div className="w-1/2 bg-white overflow-y-auto border-r border-gray-200">
        <div className="p-6 space-y-6">
          <h2 className="text-xl font-semibold text-gray-800">面部分析报告</h2>

          {aestheticMetrics ? (
            <>
              <CompositeScore score={aestheticMetrics.composite_score} />
              <MetricCards metrics={aestheticMetrics} />
              <DefectList
                defects={defects}
                onToggle={toggleDefect}
                onPriorityChange={setDefectPriority}
              />
            </>
          ) : (
            <p className="text-gray-400 text-sm">暂无分析数据，请返回重新提交。</p>
          )}
        </div>
      </div>

      {/* 右栏：标注图 */}
      <div className="w-1/2 bg-gray-900 flex flex-col overflow-hidden">
        {annotatedImageUrl ? (
          <>
            {/* 标题栏 */}
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-800 border-b border-gray-700 flex-shrink-0">
              <span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />
              <span className="text-sm font-medium text-gray-300">面部关键点标注</span>
              <span className="ml-auto text-xs text-gray-500">MediaPipe 478 点 · 点击标签查看详情</span>
            </div>

            {/* 标注图 + Canvas 折线 */}
            <div className="flex-1 overflow-hidden p-4">
              <FaceAnnotator
                annotatedImageUrl={annotatedImageUrl}
                defects={defects}
                // Phase 4 接入：从 store 传入 landmarks
                landmarks={undefined}
              />
            </div>

            {/* 图例 */}
            <div className="flex items-center gap-4 px-4 py-2 bg-gray-800 border-t border-gray-700 flex-shrink-0">
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-indigo-400 opacity-70" />
                <span className="text-xs text-gray-500">轮廓引导线</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />
                <span className="text-xs text-gray-500">美学高光点</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-0.5 bg-orange-400 opacity-70 border-dashed" />
                <span className="text-xs text-gray-500">缺陷折线</span>
              </div>
            </div>
          </>
        ) : (
          <SimulationPlaceholder />
        )}
      </div>
    </div>
  )
}

// ── 占位图 ───────────────────────────────────────────────────────────

function SimulationPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center text-center">
      <div>
        <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center mx-auto mb-4">
          <svg className="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-gray-500 font-medium">效果模拟预览</p>
        <p className="text-gray-600 text-sm mt-1">Phase 6 实现（Before/After 对比）</p>
      </div>
    </div>
  )
}

// ── 综合评分圆形进度条 ────────────────────────────────────────────────

function CompositeScore({ score }: { score: number }) {
  const radius       = 54
  const stroke       = 8
  const normalRadius = radius - stroke / 2
  const circumference = 2 * Math.PI * normalRadius
  const progress     = Math.min(100, Math.max(0, score))
  const dash         = (progress / 100) * circumference
  const gap          = circumference - dash

  const color =
    progress >= 80 ? '#6366f1' :
    progress >= 60 ? '#f59e0b' :
    '#ef4444'

  return (
    <div className="flex items-center gap-6 bg-gray-50 rounded-2xl p-4">
      <svg width={radius * 2} height={radius * 2} className="flex-shrink-0">
        <circle cx={radius} cy={radius} r={normalRadius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle
          cx={radius} cy={radius} r={normalRadius}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform={`rotate(-90 ${radius} ${radius})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text x={radius} y={radius + 6} textAnchor="middle"
          style={{ fill: color, fontSize: 22, fontWeight: 700 }}>
          {progress}
        </text>
      </svg>
      <div>
        <p className="text-gray-500 text-xs mb-0.5">综合美学评分</p>
        <p className="text-2xl font-bold text-gray-800">
          {progress} <span className="text-base text-gray-400">/ 100</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">
          {progress >= 80 ? '面部结构比例优秀' :
           progress >= 60 ? '整体比例良好，局部可优化' :
           '建议关注多项面部指标'}
        </p>
      </div>
    </div>
  )
}

// ── 美学指标卡片 ──────────────────────────────────────────────────────

function MetricCards({ metrics }: { metrics: AestheticMetrics }) {
  const ts  = metrics.three_sections as Record<string, number & string>
  const fe  = metrics.five_eyes     as Record<string, number & string>
  // const fs  = metrics.face_shape    as Record<string, number & string> // 修改后：表示值可以是数字，也可以是字符串
  const fs = metrics.face_shape as Record<string, number | string>
  const sym = metrics.symmetry      as Record<string, number & string>

  const cards = [
    { label: '三庭比例', score: (ts as { score?: number }).score ?? 0, detail: (ts as { advice?: string }).advice ?? '' },
    { label: '五眼宽度', score: (fe as { score?: number }).score ?? 0, detail: (fe as { advice?: string }).advice ?? '' },
    { label: '面型',     score: (fs as { score?: number }).score ?? 0, detail: (fs as { classification?: string }).classification ?? '' },
    { label: '对称性',   score: (sym as { score?: number }).score ?? 0, detail: '' },
  ]

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">美学指标</h3>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => <MetricCard key={card.label} {...card} />)}
      </div>
    </div>
  )
}

function MetricCard({ label, score, detail }: { label: string; score: number; detail: string }) {
  const pct      = Math.min(100, Math.max(0, Math.round(score)))
  const barColor = pct >= 80 ? 'bg-indigo-500' : pct >= 60 ? 'bg-yellow-400' : 'bg-red-400'

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <span className="text-sm font-bold text-gray-800">{pct}</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {detail && <p className="text-xs text-gray-400 mt-2 leading-tight">{detail}</p>}
    </div>
  )
}
