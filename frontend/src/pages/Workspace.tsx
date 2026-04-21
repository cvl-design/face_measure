import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSessionStore } from '../store/sessionStore'
import type { AestheticMetrics, DefectItem } from '../store/sessionStore'

export default function Workspace() {
  const navigate          = useNavigate()
  const sessionId         = useSessionStore((s) => s.sessionId)
  const defects           = useSessionStore((s) => s.defects)
  const aestheticMetrics  = useSessionStore((s) => s.aestheticMetrics)

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
              <DefectList defects={defects} />
            </>
          ) : (
            <p className="text-gray-400 text-sm">暂无分析数据，请返回重新提交。</p>
          )}
        </div>
      </div>

      {/* 右栏：效果预览占位 */}
      <div className="w-1/2 bg-gray-900 flex flex-col items-center justify-center">
        <div className="text-center">
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
    </div>
  )
}

// ── 综合评分圆形进度条 ─────────────────────────────────────────────

function CompositeScore({ score }: { score: number }) {
  const radius      = 54
  const stroke      = 8
  const normalRadius = radius - stroke / 2
  const circumference = 2 * Math.PI * normalRadius
  const progress    = Math.min(100, Math.max(0, score))
  const dash        = (progress / 100) * circumference
  const gap         = circumference - dash

  const color =
    progress >= 80 ? '#6366f1' :
    progress >= 60 ? '#f59e0b' :
    '#ef4444'

  return (
    <div className="flex items-center gap-6 bg-gray-50 rounded-2xl p-4">
      <svg width={radius * 2} height={radius * 2} className="flex-shrink-0">
        {/* 背景圆 */}
        <circle
          cx={radius} cy={radius} r={normalRadius}
          fill="none" stroke="#e5e7eb" strokeWidth={stroke}
        />
        {/* 进度圆弧 */}
        <circle
          cx={radius} cy={radius} r={normalRadius}
          fill="none" stroke={color} strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform={`rotate(-90 ${radius} ${radius})`}
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        <text
          x={radius} y={radius + 6}
          textAnchor="middle"
          className="font-bold"
          style={{ fill: color, fontSize: 22, fontWeight: 700 }}
        >
          {progress}
        </text>
      </svg>
      <div>
        <p className="text-gray-500 text-xs mb-0.5">综合美学评分</p>
        <p className="text-2xl font-bold text-gray-800">{progress} <span className="text-base text-gray-400">/ 100</span></p>
        <p className="text-xs text-gray-400 mt-1">
          {progress >= 80 ? '面部结构比例优秀' :
           progress >= 60 ? '整体比例良好，局部可优化' :
           '建议关注多项面部指标'}
        </p>
      </div>
    </div>
  )
}

// ── 美学指标卡片 ──────────────────────────────────────────────────

function MetricCards({ metrics }: { metrics: AestheticMetrics }) {
  const ts  = metrics.three_sections as Record<string, number & string>
  const fe  = metrics.five_eyes     as Record<string, number & string>
  const fs  = metrics.face_shape    as Record<string, number & string>
  const sym = metrics.symmetry      as Record<string, number & string>

  const cards = [
    {
      label:  '三庭比例',
      score:  (ts as { score?: number }).score ?? 0,
      detail: (ts as { advice?: string }).advice ?? '',
    },
    {
      label:  '五眼宽度',
      score:  (fe as { score?: number }).score ?? 0,
      detail: (fe as { advice?: string }).advice ?? '',
    },
    {
      label:  '面型',
      score:  (fs as { score?: number }).score ?? 0,
      detail: (fs as { classification?: string }).classification ?? '',
    },
    {
      label:  '对称性',
      score:  (sym as { score?: number }).score ?? 0,
      detail: '',
    },
  ]

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">美学指标</h3>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </div>
    </div>
  )
}

function MetricCard({ label, score, detail }: { label: string; score: number; detail: string }) {
  const pct = Math.min(100, Math.max(0, Math.round(score)))
  const barColor =
    pct >= 80 ? 'bg-indigo-500' :
    pct >= 60 ? 'bg-yellow-400' :
    'bg-red-400'

  return (
    <div className="bg-gray-50 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <span className="text-sm font-bold text-gray-800">{pct}</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      {detail && (
        <p className="text-xs text-gray-400 mt-2 leading-tight">{detail}</p>
      )}
    </div>
  )
}

// ── 缺陷列表 ─────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<number, string> = {
  1: 'bg-blue-100 text-blue-700',
  2: 'bg-yellow-100 text-yellow-700',
  3: 'bg-orange-100 text-orange-700',
  4: 'bg-red-100 text-red-700',
  5: 'bg-red-200 text-red-800',
}

const SEVERITY_LABEL: Record<number, string> = {
  1: '极轻',
  2: '轻度',
  3: '中度',
  4: '重度',
  5: '严重',
}

function DefectList({ defects }: { defects: DefectItem[] }) {
  if (!defects.length) {
    return (
      <div className="bg-green-50 rounded-2xl p-4 text-center">
        <p className="text-green-600 font-medium">未发现明显面部问题</p>
        <p className="text-green-500 text-sm mt-1">面部比例整体协调</p>
      </div>
    )
  }

  const sorted = [...defects].sort((a, b) => b.severity - a.severity)

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
        检出问题 <span className="text-gray-800 normal-case font-bold">{sorted.length}</span> 项
      </h3>
      <div className="space-y-3">
        {sorted.map((d) => (
          <div key={d.defect_id} className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-gray-800 text-sm">{d.name_zh}</span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                      SEVERITY_COLOR[d.severity] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {SEVERITY_LABEL[d.severity] ?? d.severity}
                  </span>
                </div>
                {d.clinical_description && (
                  <p className="text-xs text-gray-500 leading-relaxed mb-1">{d.clinical_description}</p>
                )}
                {d.treatment_suggestion && (
                  <p className="text-xs text-indigo-600 leading-relaxed">
                    建议：{d.treatment_suggestion}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 text-right">
                <span className="text-xs text-gray-400">置信度</span>
                <p className="text-sm font-semibold text-gray-700">
                  {Math.round(d.confidence * 100)}%
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
