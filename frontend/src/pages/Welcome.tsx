import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sessionApi } from '../services/api'
import { useSessionStore, type AgeGroup } from '../store/sessionStore'

const AGE_GROUPS: { value: AgeGroup; label: string }[] = [
  { value: '20-29', label: '20–29' },
  { value: '30-39', label: '30–39' },
  { value: '40-49', label: '40–49' },
  { value: '50+',   label: '50+' },
]

export default function Welcome() {
  const navigate = useNavigate()
  const setSessionInfo = useSessionStore((s) => s.setSessionInfo)

  const [gender, setGender] = useState<'male' | 'female' | null>(null)
  const [ageGroup, setAgeGroup] = useState<AgeGroup | null>(null)
  const [chiefComplaint, setChiefComplaint] = useState('')
  const [allergyNote, setAllergyNote] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!gender || !ageGroup) return
    setIsSubmitting(true)
    setError(null)
    try {
      const data = await sessionApi.create({
        gender,
        age_group: ageGroup,
        chief_complaint: chiefComplaint,
        allergy_note: allergyNote || undefined,
      })
      setSessionInfo({
        sessionId: data.session_id,
        gender,
        ageGroup,
        chiefComplaint,
        allergyNote,
      })
      navigate('/capture')
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建会话失败，请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-8">
      <h1 className="text-4xl font-bold text-gray-900 mb-2">FaceSense</h1>
      <p className="text-lg text-gray-500 mb-10">AI 智能面诊系统</p>

      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 space-y-6"
      >
        <h2 className="text-2xl font-semibold text-gray-800">接诊登记</h2>

        {/* 性别 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            性别 <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {(['male', 'female'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGender(g)}
                className={`py-3 rounded-xl border-2 text-base font-medium transition-colors ${
                  gender === g
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {g === 'male' ? '男' : '女'}
              </button>
            ))}
          </div>
        </div>

        {/* 年龄段 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            年龄段 <span className="text-red-500">*</span>
          </label>
          <div className="grid grid-cols-4 gap-2">
            {AGE_GROUPS.map((ag) => (
              <button
                key={ag.value}
                type="button"
                onClick={() => setAgeGroup(ag.value)}
                className={`py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                  ageGroup === ag.value
                    ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {ag.label}
              </button>
            ))}
          </div>
        </div>

        {/* 主诉 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            主诉 / 就诊目的
          </label>
          <textarea
            rows={3}
            maxLength={500}
            value={chiefComplaint}
            onChange={(e) => setChiefComplaint(e.target.value)}
            placeholder="请描述主要困扰（皱纹、松弛、不对称等）"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
          <p className="text-right text-xs text-gray-400 mt-1">
            {chiefComplaint.length} / 500
          </p>
        </div>

        {/* 过敏史 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            过敏史 / 禁忌
            <span className="ml-1 text-xs text-gray-400 font-normal">（选填）</span>
          </label>
          <input
            type="text"
            maxLength={200}
            value={allergyNote}
            onChange={(e) => setAllergyNote(e.target.value)}
            placeholder="如：对利多卡因过敏"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400"
          />
        </div>

        {/* 错误提示 */}
        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-4 py-2">{error}</p>
        )}

        {/* 提交 */}
        <button
          type="submit"
          disabled={!gender || !ageGroup || isSubmitting}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white font-semibold text-xl py-4 rounded-xl transition-colors"
        >
          {isSubmitting ? '正在创建...' : '开始面诊'}
        </button>
      </form>
    </div>
  )
}
