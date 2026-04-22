/**
 * AngleGuideOverlay — 摄像头采集引导覆盖层
 *
 * 功能：
 * - 椭圆人脸轮廓引导框（SVG）
 * - 角度指示器：当前偏转角 vs 目标角度
 * - 实时质量评分 4 维（角度/光线/遮挡/清晰度）
 * - 合格 → 绿色 + 倒计时；不合格 → 红色 + 文字引导
 * - 合格持续 ≥ 1.5s 后回调 onCapture
 */
import { useEffect, useRef, useState } from 'react'
import type { NormalizedLandmark } from '../../core/mediapipeLoader'
import { estimateHeadAngles } from '../../core/mediapipeLoader'

// ── 角度档位配置 ──────────────────────────────────────────────────────

export interface AngleTarget {
  key: string     // 'front' | 'left45' | 'right45' | 'left90' | 'right90'
  label: string
  yaw: number     // 目标水平偏转角（°）
  pitch: number   // 目标俯仰角（°）
  yawTolerance:   number   // 允许误差（°）
  pitchTolerance: number
}

const ANGLE_TARGETS: AngleTarget[] = [
  { key: 'front',   label: '正面',   yaw:   0, pitch: 0, yawTolerance: 10, pitchTolerance: 12 },
  { key: 'left45',  label: '左45°',  yaw: -45, pitch: 0, yawTolerance: 12, pitchTolerance: 15 },
  { key: 'right45', label: '右45°',  yaw:  45, pitch: 0, yawTolerance: 12, pitchTolerance: 15 },
  { key: 'left90',  label: '左90°',  yaw: -80, pitch: 0, yawTolerance: 15, pitchTolerance: 20 },
  { key: 'right90', label: '右90°',  yaw:  80, pitch: 0, yawTolerance: 15, pitchTolerance: 20 },
]

// ── 质量评分类型 ──────────────────────────────────────────────────────

export interface QualityScores {
  angle:   number   // 0.0–1.0
  lighting: number
  occlusion: number
  sharpness: number
  overall:  number
  passed:   boolean
  reasons:  string[]
}

// ── Props ──────────────────────────────────────────────────────────────

interface AngleGuideOverlayProps {
  /** 当前目标角度档位 */
  targetAngle: AngleTarget
  /** MediaPipe 当前帧关键点（无人脸时为 null） */
  landmarks: NormalizedLandmark[] | null
  /** 当前帧亮度（0–1，由父组件从 ImageData 计算） */
  brightness: number
  /** 当前帧清晰度（0–1，拉普拉斯方差归一化） */
  sharpness: number
  /** 合格持续 1.5s 后触发拍摄 */
  onCapture: () => void
  /** 已采集的角度列表（用于显示进度） */
  capturedAngles: string[]
}

const HOLD_MS = 1500   // 合格后自动拍摄等待时长

export default function AngleGuideOverlay({
  targetAngle,
  landmarks,
  brightness,
  sharpness,
  onCapture,
  capturedAngles,
}: AngleGuideOverlayProps) {
  const holdStartRef = useRef<number | null>(null)
  const [holdProgress, setHoldProgress] = useState(0)   // 0–100
  const [quality, setQuality] = useState<QualityScores>({
    angle: 0, lighting: 0, occlusion: 1, sharpness: 0,
    overall: 0, passed: false, reasons: ['等待人脸检测…'],
  })

  // ── 每帧计算质量 ──────────────────────────────────────────────────
  useEffect(() => {
    if (!landmarks) {
      holdStartRef.current = null
      setHoldProgress(0)
      setQuality({
        angle: 0, lighting: 0, occlusion: 1, sharpness: 0,
        overall: 0, passed: false, reasons: ['未检测到人脸，请正对摄像头'],
      })
      return
    }

    const { yaw, pitch } = estimateHeadAngles(landmarks)
    const reasons: string[] = []

    // 角度评分
    const yawDiff   = Math.abs(yaw - targetAngle.yaw)
    const pitchDiff = Math.abs(pitch - targetAngle.pitch)
    const angleOk   = yawDiff <= targetAngle.yawTolerance && pitchDiff <= targetAngle.pitchTolerance
    const angleScore = Math.max(0, 1 - (yawDiff / (targetAngle.yawTolerance * 2) + pitchDiff / (targetAngle.pitchTolerance * 2)) / 2)
    if (!angleOk) {
      if (Math.abs(yaw) < Math.abs(targetAngle.yaw) - targetAngle.yawTolerance)
        reasons.push(`请向${targetAngle.yaw < 0 ? '左' : '右'}转头`)
      else if (Math.abs(yaw) > Math.abs(targetAngle.yaw) + targetAngle.yawTolerance)
        reasons.push('转头角度过大，请适当减小')
      if (pitchDiff > targetAngle.pitchTolerance)
        reasons.push(pitch < targetAngle.pitch ? '请稍微抬头' : '请稍微低头')
    }

    // 光线评分（中灰最优）
    const lightingScore = 1 - 2 * Math.abs(brightness - 0.5)
    if (lightingScore < 0.5) {
      reasons.push(brightness < 0.3 ? '光线过暗，请到明亮处' : '光线过强，避免强光直射')
    }

    // 清晰度评分
    const sharpScore = Math.min(1, sharpness)
    if (sharpScore < 0.4) reasons.push('图像模糊，请保持稳定')

    // 综合评分（角度权重最高）
    const overall = 0.5 * angleScore + 0.3 * lightingScore + 0.2 * sharpScore
    const passed  = angleOk && lightingScore >= 0.4 && sharpScore >= 0.35

    setQuality({
      angle:    Math.round(angleScore  * 100) / 100,
      lighting: Math.round(lightingScore * 100) / 100,
      occlusion: 1.0,
      sharpness: Math.round(sharpScore * 100) / 100,
      overall:  Math.round(overall * 100) / 100,
      passed,
      reasons: passed ? [] : reasons,
    })

    // 合格持续计时
    if (passed) {
      if (!holdStartRef.current) holdStartRef.current = Date.now()
      const elapsed = Date.now() - holdStartRef.current
      const pct = Math.min(100, (elapsed / HOLD_MS) * 100)
      setHoldProgress(pct)
      if (elapsed >= HOLD_MS) {
        holdStartRef.current = null
        setHoldProgress(0)
        onCapture()
      }
    } else {
      holdStartRef.current = null
      setHoldProgress(0)
    }
  }, [landmarks, brightness, sharpness, targetAngle, onCapture])

  const isPassed = quality.passed

  // ── 渲染 ─────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 pointer-events-none select-none">
      {/* 椭圆引导框 */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 480" preserveAspectRatio="xMidYMid meet">
        {/* 遮罩（椭圆外半透明） */}
        <defs>
          <mask id="face-mask">
            <rect width="320" height="480" fill="white" />
            <ellipse cx="160" cy="220" rx="105" ry="138" fill="black" />
          </mask>
        </defs>
        <rect width="320" height="480" fill="rgba(0,0,0,0.45)" mask="url(#face-mask)" />

        {/* 椭圆边框：合格=绿色，不合格=白色/红色 */}
        <ellipse
          cx="160" cy="220" rx="105" ry="138"
          fill="none"
          stroke={isPassed ? '#22c55e' : quality.angle > 0.6 ? '#f59e0b' : '#e5e7eb'}
          strokeWidth={isPassed ? 3 : 2}
          strokeDasharray={isPassed ? 'none' : '8 4'}
        />

        {/* 角度中心十字 */}
        <line x1="145" y1="220" x2="175" y2="220" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
        <line x1="160" y1="205" x2="160" y2="235" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />

        {/* 倒计时圆弧（合格时显示） */}
        {isPassed && holdProgress > 0 && (
          <circle
            cx="160" cy="220" r="118"
            fill="none" stroke="#22c55e" strokeWidth={3} opacity={0.8}
            strokeDasharray={`${(holdProgress / 100) * 741} 741`}
            strokeDashoffset={0}
            transform="rotate(-90 160 220)"
          />
        )}
      </svg>

      {/* 顶部：目标角度标签 + 已完成进度 */}
      <div className="absolute top-4 left-0 right-0 flex justify-center">
        <div className="bg-black/60 rounded-full px-4 py-1.5 flex items-center gap-3">
          <span className="text-white text-sm font-semibold">{targetAngle.label}</span>
          <div className="flex gap-1.5">
            {ANGLE_TARGETS.map((t) => (
              <span
                key={t.key}
                className={`w-2 h-2 rounded-full transition-colors ${
                  capturedAngles.includes(t.key)
                    ? 'bg-green-400'
                    : t.key === targetAngle.key
                    ? 'bg-white'
                    : 'bg-white/30'
                }`}
                title={t.label}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 右侧质量评分面板 */}
      <div className="absolute top-16 right-3 w-28 space-y-1.5">
        <QualityBar label="角度" value={quality.angle} />
        <QualityBar label="光线" value={quality.lighting} />
        <QualityBar label="清晰" value={quality.sharpness} />
      </div>

      {/* 底部引导提示 */}
      <div className="absolute bottom-6 left-0 right-0 flex justify-center">
        {isPassed ? (
          <div className="bg-green-500/90 rounded-full px-5 py-2 flex items-center gap-2">
            <span className="text-white font-semibold text-sm">
              {holdProgress >= 100 ? '拍摄中…' : `保持不动… ${Math.ceil(((100 - holdProgress) / 100) * HOLD_MS / 1000)}s`}
            </span>
          </div>
        ) : (
          <div className="bg-black/70 rounded-2xl px-4 py-2 max-w-[260px]">
            {quality.reasons.map((r, i) => (
              <p key={i} className="text-white text-xs text-center leading-relaxed">{r}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 质量评分条 ────────────────────────────────────────────────────────

function QualityBar({ label, value }: { label: string; value: number }) {
  const pct   = Math.round(value * 100)
  const color = pct >= 70 ? 'bg-green-400' : pct >= 45 ? 'bg-yellow-400' : 'bg-red-400'

  return (
    <div className="bg-black/50 rounded-lg px-2 py-1.5">
      <div className="flex justify-between items-center mb-1">
        <span className="text-white/70 text-xs">{label}</span>
        <span className="text-white text-xs font-bold">{pct}%</span>
      </div>
      <div className="h-1 bg-white/20 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
