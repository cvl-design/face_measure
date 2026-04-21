import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { analysisApi } from '../services/api'
import { useSessionStore } from '../store/sessionStore'
import type { AestheticMetrics, DefectItem } from '../store/sessionStore'

const POLL_INTERVAL_MS = 2000
const TIMEOUT_MS       = 60_000   // 60s 超时

type Step = 'capture' | 'geometry' | 'report'

const STEPS: { key: Step; label: string }[] = [
  { key: 'capture',  label: '采集完成' },
  { key: 'geometry', label: '几何分析' },
  { key: 'report',   label: '生成报告' },
]

export default function Analyzing() {
  const navigate = useNavigate()
  const sessionId        = useSessionStore((s) => s.sessionId)
  const setAnalysisResult = useSessionStore((s) => s.setAnalysisResult)

  const [currentStep, setCurrentStep] = useState<Step>('capture')
  const [error, setError]             = useState<string | null>(null)
  const [timedOut, setTimedOut]       = useState(false)

  const triggeredRef = useRef(false)
  const startTime    = useRef(Date.now())

  // Guard
  useEffect(() => {
    if (!sessionId) navigate('/', { replace: true })
  }, [sessionId, navigate])

  useEffect(() => {
    if (!sessionId) return

    let timerId: ReturnType<typeof setInterval>
    let unmounted = false

    async function triggerAndPoll() {
      // 1. POST /analyze（幂等，已 analyzing 时也会正常返回）
      try {
        await analysisApi.trigger(sessionId!)
      } catch (e) {
        if (!unmounted) {
          setError(e instanceof Error ? e.message : '触发分析失败，请重试')
          return
        }
      }

      setCurrentStep('geometry')

      // 2. 轮询 GET /analysis
      timerId = setInterval(async () => {
        if (unmounted) {
          clearInterval(timerId)
          return
        }

        // 超时检测
        if (Date.now() - startTime.current > TIMEOUT_MS) {
          clearInterval(timerId)
          setTimedOut(true)
          return
        }

        try {
          const result = await analysisApi.getResult(sessionId!)

          // result_id 为空说明后端返回 202（仍在分析中）
          if (!result.result_id) return

          clearInterval(timerId)
          setCurrentStep('report')

          // 写入 Zustand
          const metrics: AestheticMetrics = result.aesthetic_metrics ?? {
            three_sections:   { upper: 0, middle: 0, lower: 0, ratios: {}, score: 0, advice: '' },
            five_eyes:        { eye_width: 0, face_width: 0, ratio: 0, score: 0, advice: '' },
            face_shape:       { classification: '未知', width_height_ratio: 0, score: 0 },
            malar_prominence: {},
            brow_arch:        {},
            highlight_points: {},
            symmetry:         {},
            composite_score:  0,
          }

          const defects: DefectItem[] = (result.defects ?? []).map((d: DefectItem) => d)

          setAnalysisResult(defects, metrics, '')

          // 短暂停留显示"生成报告"再跳转
          setTimeout(() => {
            if (!unmounted) navigate('/workspace')
          }, 800)
        } catch (e) {
          // 忽略单次轮询错误，继续重试
          console.warn('Poll error', e)
        }
      }, POLL_INTERVAL_MS)
    }

    // 防止 StrictMode 双重触发
    if (!triggeredRef.current) {
      triggeredRef.current = true
      triggerAndPoll()
    }

    return () => {
      unmounted = true
      clearInterval(timerId)
    }
  }, [sessionId, navigate, setAnalysisResult])

  function handleRetry() {
    triggeredRef.current = false
    startTime.current = Date.now()
    setError(null)
    setTimedOut(false)
    setCurrentStep('capture')
    // 重新挂载效果：重置 ref 后重新触发
    window.location.reload()
  }

  const stepIndex  = STEPS.findIndex((s) => s.key === currentStep)

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 px-6">
      {/* 标题 */}
      <h1 className="text-2xl font-bold text-white mb-2">AI 分析中</h1>
      <p className="text-gray-400 text-sm mb-10">请稍候，正在处理您的面部数据…</p>

      {/* 进度步骤 */}
      <div className="flex items-center gap-0 mb-12 w-full max-w-xs">
        {STEPS.map((step, i) => {
          const done    = i < stepIndex
          const active  = i === stepIndex
          const pending = i > stepIndex

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                    done
                      ? 'bg-indigo-600 text-white'
                      : active
                      ? 'bg-indigo-400 text-white ring-4 ring-indigo-900'
                      : 'bg-gray-700 text-gray-500'
                  }`}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span
                  className={`mt-2 text-xs text-center whitespace-nowrap ${
                    done ? 'text-indigo-400' : active ? 'text-white' : 'text-gray-600'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 transition-colors ${
                    done ? 'bg-indigo-600' : 'bg-gray-700'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* 骨架屏 */}
      {!error && !timedOut && (
        <div className="space-y-4 w-full max-w-sm">
          <div className="h-6 bg-gray-800 rounded-lg animate-pulse w-48 mx-auto" />
          <div className="h-40 bg-gray-800 rounded-2xl animate-pulse w-full" />
          <div className="h-4 bg-gray-800 rounded animate-pulse w-full" />
          <div className="h-4 bg-gray-800 rounded animate-pulse w-3/4" />
          <div className="h-4 bg-gray-800 rounded animate-pulse w-5/6" />
        </div>
      )}

      {/* 超时提示 */}
      {timedOut && (
        <div className="text-center">
          <p className="text-orange-400 mb-4">分析超时，请检查服务状态后重试</p>
          <button
            onClick={handleRetry}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
          >
            重试分析
          </button>
        </div>
      )}

      {/* 错误提示 */}
      {error && !timedOut && (
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate('/capture')}
            className="bg-gray-700 hover:bg-gray-600 text-white font-semibold px-8 py-3 rounded-xl transition-colors"
          >
            返回重新上传
          </button>
        </div>
      )}
    </div>
  )
}
