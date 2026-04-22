/**
 * DefectList — 缺陷列表（独立组件）
 *
 * 功能：
 * - 按 category 分组（皱纹 / 容量缺失 / 轮廓 / 下垂）
 * - 每项：勾选框 + 严重度条形图 + 优先级选择 + 置信度
 * - 医生可勾选/取消纳入方案、调整优先级 1–3
 */
import { useState } from 'react'
import type { DefectItem, DefectCategory } from '../../store/sessionStore'

// ── 分类配置 ────────────────────────────────────────────────────────

const CATEGORY_META: Record<DefectCategory, { label: string; icon: string; order: number }> = {
  wrinkle:     { label: '皱纹',     icon: '〰️', order: 1 },
  volume_loss: { label: '容量缺失', icon: '💧', order: 2 },
  contour:     { label: '轮廓问题', icon: '◻️', order: 3 },
  ptosis:      { label: '下垂松弛', icon: '↘️', order: 4 },
}

// ── 严重度配置 ──────────────────────────────────────────────────────

const SEVERITY_LABEL: Record<number, string> = {
  1: '极轻', 2: '轻度', 3: '中度', 4: '重度', 5: '严重',
}

const SEVERITY_BAR_COLOR = (s: number) => {
  if (s <= 1) return 'bg-blue-400'
  if (s <= 2) return 'bg-yellow-400'
  if (s <= 3) return 'bg-orange-400'
  if (s <= 4) return 'bg-red-400'
  return 'bg-red-600'
}

const SEVERITY_TEXT_COLOR = (s: number) => {
  if (s <= 1) return 'text-blue-600'
  if (s <= 2) return 'text-yellow-600'
  if (s <= 3) return 'text-orange-600'
  return 'text-red-600'
}

// ── 优先级配置 ──────────────────────────────────────────────────────

const PRIORITY_META: Record<number, { label: string; color: string }> = {
  1: { label: '高', color: 'bg-red-100 text-red-700 ring-red-200' },
  2: { label: '中', color: 'bg-yellow-100 text-yellow-700 ring-yellow-200' },
  3: { label: '低', color: 'bg-gray-100 text-gray-500 ring-gray-200' },
}

// ── Props ───────────────────────────────────────────────────────────

interface DefectListProps {
  defects: DefectItem[]
  onToggle: (defectId: string) => void
  onPriorityChange: (defectId: string, priority: number) => void
}

// ── 组件入口 ────────────────────────────────────────────────────────

export default function DefectList({ defects, onToggle, onPriorityChange }: DefectListProps) {
  if (!defects.length) {
    return (
      <div className="bg-green-50 rounded-2xl p-5 text-center">
        <div className="text-2xl mb-2">✅</div>
        <p className="text-green-700 font-semibold">未发现明显面部问题</p>
        <p className="text-green-500 text-sm mt-1">面部比例整体协调，继续保持</p>
      </div>
    )
  }

  // 按 category 分组
  const grouped = new Map<DefectCategory, DefectItem[]>()
  for (const d of defects) {
    const cat = d.category as DefectCategory
    if (!grouped.has(cat)) grouped.set(cat, [])
    grouped.get(cat)!.push(d)
  }

  // 按 category order 排序分组
  const sortedGroups = [...grouped.entries()].sort(
    ([a], [b]) =>
      (CATEGORY_META[a]?.order ?? 9) - (CATEGORY_META[b]?.order ?? 9)
  )

  const checkedCount = defects.filter((d) => d.checked).length

  return (
    <div className="space-y-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          检出问题{' '}
          <span className="text-gray-800 normal-case font-bold">{defects.length}</span> 项
        </h3>
        <span className="text-xs text-indigo-600 font-medium">
          已纳入方案 {checkedCount} 项
        </span>
      </div>

      {/* 分组列表 */}
      {sortedGroups.map(([cat, items]) => (
        <CategoryGroup
          key={cat}
          category={cat}
          items={items}
          onToggle={onToggle}
          onPriorityChange={onPriorityChange}
        />
      ))}
    </div>
  )
}

// ── 分组组件 ────────────────────────────────────────────────────────

function CategoryGroup({
  category,
  items,
  onToggle,
  onPriorityChange,
}: {
  category: DefectCategory
  items: DefectItem[]
  onToggle: (id: string) => void
  onPriorityChange: (id: string, p: number) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const meta = CATEGORY_META[category] ?? { label: category, icon: '•', order: 9 }
  const checkedInGroup = items.filter((d) => d.checked).length

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden">
      {/* 分组标题 */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-base leading-none">{meta.icon}</span>
        <span className="font-semibold text-sm text-gray-700">{meta.label}</span>
        <span className="text-xs text-gray-400 ml-1">
          ({checkedInGroup}/{items.length} 已选)
        </span>
        <span className="ml-auto text-gray-400 text-xs">{collapsed ? '▶' : '▼'}</span>
      </button>

      {/* 缺陷列表 */}
      {!collapsed && (
        <div className="divide-y divide-gray-50">
          {items
            .slice()
            .sort((a, b) => b.severity - a.severity)
            .map((d) => (
              <DefectRow
                key={d.defect_id}
                defect={d}
                onToggle={onToggle}
                onPriorityChange={onPriorityChange}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ── 单条缺陷行 ──────────────────────────────────────────────────────

function DefectRow({
  defect,
  onToggle,
  onPriorityChange,
}: {
  defect: DefectItem
  onToggle: (id: string) => void
  onPriorityChange: (id: string, p: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const isChecked = defect.checked ?? true
  const priority  = defect.priority ?? 2
  const pct       = Math.min(100, Math.max(0, (defect.severity / 5) * 100))

  return (
    <div className={`px-4 py-3 transition-colors ${isChecked ? 'bg-white' : 'bg-gray-50 opacity-60'}`}>
      <div className="flex items-start gap-3">
        {/* 勾选框 */}
        <button
          onClick={() => onToggle(defect.defect_id)}
          className="mt-0.5 flex-shrink-0"
          title={isChecked ? '点击取消纳入方案' : '点击纳入方案'}
        >
          <span
            className={`flex items-center justify-center w-5 h-5 rounded-md border-2 transition-colors ${
              isChecked
                ? 'bg-indigo-600 border-indigo-600'
                : 'bg-white border-gray-300 hover:border-indigo-400'
            }`}
          >
            {isChecked && (
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 12 12">
                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        </button>

        {/* 主信息区 */}
        <div className="flex-1 min-w-0">
          {/* 标题行 */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="font-semibold text-sm text-gray-800 hover:text-indigo-600 transition-colors text-left"
            >
              {defect.name_zh}
            </button>
            <span className={`text-xs font-bold ${SEVERITY_TEXT_COLOR(defect.severity)}`}>
              {SEVERITY_LABEL[defect.severity] ?? defect.severity}
            </span>
            {/* 展开指示 */}
            {(defect.clinical_description || defect.treatment_suggestion) && (
              <span className="text-xs text-gray-400">{expanded ? '▲' : '▼'}</span>
            )}
          </div>

          {/* 严重度条形图 */}
          <div className="mt-1.5 flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${SEVERITY_BAR_COLOR(defect.severity)}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-xs text-gray-400 flex-shrink-0 tabular-nums">
              {Math.round(defect.confidence * 100)}%
            </span>
          </div>

          {/* 展开详情 */}
          {expanded && (
            <div className="mt-2 space-y-1.5">
              {defect.clinical_description && (
                <p className="text-xs text-gray-500 leading-relaxed">
                  📋 {defect.clinical_description}
                </p>
              )}
              {defect.treatment_suggestion && (
                <p className="text-xs text-indigo-600 leading-relaxed">
                  💊 {defect.treatment_suggestion}
                </p>
              )}
              {defect.anatomical_regions?.length > 0 && (
                <p className="text-xs text-gray-400">
                  📍 {defect.anatomical_regions.join('、')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* 优先级选择器（仅已勾选时显示） */}
        {isChecked && (
          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            <span className="text-xs text-gray-400">优先级</span>
            <div className="flex gap-1">
              {[1, 2, 3].map((p) => {
                const pm = PRIORITY_META[p]
                return (
                  <button
                    key={p}
                    onClick={() => onPriorityChange(defect.defect_id, p)}
                    className={`text-xs px-1.5 py-0.5 rounded-full ring-1 font-semibold transition-all ${
                      priority === p ? pm.color : 'bg-transparent text-gray-300 ring-gray-200 hover:ring-gray-300'
                    }`}
                    title={`优先级：${pm.label}`}
                  >
                    {pm.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
