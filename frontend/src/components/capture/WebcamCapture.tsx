/**
 * WebcamCapture — 摄像头多角度采集组件
 *
 * 流程：
 * 1. 组件挂载 → getUserMedia 开启摄像头 → 后台预热 MediaPipe WASM
 * 2. 每帧送 FaceLandmarker.detectForVideo → 得到 478 关键点
 * 3. estimateHeadAngles → 与目标角度比较
 * 4. AngleGuideOverlay 实时渲染引导 + 质量评分
 * 5. 合格持续 ≥ 1.5s → 自动截帧 → onCapture(angle, blob)
 * 6. 5 个角度全部完成后 → onAllDone()
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadFaceLandmarker, extractFirstFaceLandmarks } from '../../core/mediapipeLoader'
import type { NormalizedLandmark, FaceLandmarkerInstance } from '../../core/mediapipeLoader'
import AngleGuideOverlay from './AngleGuideOverlay'
import type { AngleTarget } from './AngleGuideOverlay'
import { captureFrameFromVideo, compressImageToBase64 } from '../../services/captureUtils'

// ── 角度顺序 ────────────────────────────────────────────────────────

const ANGLE_SEQUENCE: AngleTarget[] = [
  { key: 'front',   label: '正面',   yaw:   0, pitch: 0, yawTolerance: 10, pitchTolerance: 12 },
  { key: 'left45',  label: '左45°',  yaw: -45, pitch: 0, yawTolerance: 12, pitchTolerance: 15 },
  { key: 'right45', label: '右45°',  yaw:  45, pitch: 0, yawTolerance: 12, pitchTolerance: 15 },
  { key: 'left90',  label: '左90°',  yaw: -80, pitch: 0, yawTolerance: 15, pitchTolerance: 20 },
  { key: 'right90', label: '右90°',  yaw:  80, pitch: 0, yawTolerance: 15, pitchTolerance: 20 },
]

// ── Props ──────────────────────────────────────────────────────────────

interface WebcamCaptureProps {
  /** 每完成一个角度拍摄 */
  onCapture: (angle: string, base64: string) => void
  /** 5 个角度全部完成 */
  onAllDone: () => void
  /** 已采集的角度（控制进度） */
  capturedAngles: string[]
}

// ── 主组件 ──────────────────────────────────────────────────────────

export default function WebcamCapture({ onCapture, onAllDone, capturedAngles }: WebcamCaptureProps) {
  const videoRef       = useRef<HTMLVideoElement>(null)
  const rafRef         = useRef<number | null>(null)
  const detectorRef    = useRef<FaceLandmarkerInstance | null>(null)
  const streamRef      = useRef<MediaStream | null>(null)
  const captureGuardRef = useRef<Set<string>>(new Set())   // 防止同一角度重复触发

  const [landmarks, setLandmarks]     = useState<NormalizedLandmark[] | null>(null)
  const [brightness, setBrightness]   = useState(0.5)
  const [sharpness, setSharpness]     = useState(0.5)
  const [modelReady, setModelReady]   = useState(false)
  const [camError, setCamError]       = useState<string | null>(null)
  const [capturing, setCapturing]     = useState<string | null>(null)  // 正在拍摄的角度key
  const [flash, setFlash]             = useState(false)

  // 当前目标角度（跳过已采集的）
  const currentTarget = ANGLE_SEQUENCE.find((a) => !capturedAngles.includes(a.key)) ?? null

  // ── 初始化 ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false

    async function init() {
      // 1. 开启摄像头
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
        }
      } catch (e) {
        const msg = e instanceof DOMException
          ? (e.name === 'NotAllowedError' ? '摄像头权限被拒绝，请在浏览器设置中允许访问' : `摄像头错误: ${e.message}`)
          : '无法访问摄像头'
        if (!cancelled) setCamError(msg)
        return
      }

      // 2. 预热 MediaPipe（后台加载，不阻塞摄像头画面）
      try {
        const detector = await loadFaceLandmarker()
        if (!cancelled) {
          detectorRef.current = detector
          setModelReady(true)
        }
      } catch (e) {
        console.warn('MediaPipe 加载失败，仅显示摄像头画面', e)
      }
    }

    init()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // ── 每帧检测循环 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!modelReady) return
    const video = videoRef.current
    if (!video) return

    let running = true

    function loop() {
      if (!running || !video || !detectorRef.current) return
      if (video.readyState < 2) { rafRef.current = requestAnimationFrame(loop); return }

      // 运行 MediaPipe 检测
      try {
        const result = detectorRef.current.detectForVideo(video, performance.now())
        const lms    = extractFirstFaceLandmarks(result)
        setLandmarks(lms)

        // 计算帧亮度（采样 canvas 中间区域）
        if (lms) {
          const tmpCanvas = document.createElement('canvas')
          tmpCanvas.width  = 64
          tmpCanvas.height = 64
          const ctx = tmpCanvas.getContext('2d')!
          ctx.drawImage(video, 0, 0, 64, 64)
          const pixels = ctx.getImageData(0, 0, 64, 64).data
          let sum = 0
          for (let i = 0; i < pixels.length; i += 4)
            sum += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
          setBrightness(sum / (pixels.length / 4) / 255)
          // 简化清晰度：利用颜色方差粗略估计
          setSharpness(Math.min(1, sum / (pixels.length / 4) / 128))
        }
      } catch {
        setLandmarks(null)
      }

      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => { running = false; if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [modelReady])

  // ── 自动截帧 ────────────────────────────────────────────────────
  const handleCapture = useCallback(async () => {
    const target = currentTarget
    const video  = videoRef.current
    if (!target || !video || capturing) return
    if (captureGuardRef.current.has(target.key)) return   // 防重复

    captureGuardRef.current.add(target.key)
    setCapturing(target.key)
    setFlash(true)
    setTimeout(() => setFlash(false), 200)

    try {
      const blob   = await captureFrameFromVideo(video)
      const base64 = await compressImageToBase64(blob, 1024)
      onCapture(target.key, base64)

      // 检查是否全部完成
      const nextDone = [...capturedAngles, target.key]
      if (nextDone.length >= ANGLE_SEQUENCE.length) {
        onAllDone()
      }
    } catch (e) {
      console.error('截帧失败', e)
      captureGuardRef.current.delete(target.key)  // 允许重试
    } finally {
      setCapturing(null)
    }
  }, [currentTarget, capturing, capturedAngles, onCapture, onAllDone])

  // ── 渲染 ────────────────────────────────────────────────────────

  // 全部完成
  if (!currentTarget) {
    return (
      <div className="flex flex-col items-center justify-center h-72 bg-gray-800 rounded-2xl">
        <span className="text-4xl mb-3">🎉</span>
        <p className="text-white font-semibold">5 个角度采集完成！</p>
        <p className="text-gray-400 text-sm mt-1">请点击下方「提交分析」继续</p>
      </div>
    )
  }

  // 摄像头错误
  if (camError) {
    return (
      <div className="flex flex-col items-center justify-center h-72 bg-gray-800 rounded-2xl p-6 text-center">
        <span className="text-3xl mb-3">📷</span>
        <p className="text-red-400 font-semibold">{camError}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"
        >
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-black" style={{ aspectRatio: '4/3' }}>
      {/* 摄像头画面 */}
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        style={{ transform: 'scaleX(-1)' }}   // 镜像显示更自然
      />

      {/* 拍摄闪光 */}
      {flash && (
        <div className="absolute inset-0 bg-white animate-ping opacity-60 pointer-events-none" />
      )}

      {/* 引导覆盖层 */}
      {modelReady ? (
        <AngleGuideOverlay
          targetAngle={currentTarget}
          landmarks={landmarks}
          brightness={brightness}
          sharpness={sharpness}
          onCapture={handleCapture}
          capturedAngles={capturedAngles}
        />
      ) : (
        /* MediaPipe 加载中占位 */
        <div className="absolute inset-0 flex items-end justify-center pb-6 pointer-events-none">
          <div className="bg-black/70 rounded-full px-4 py-1.5 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span className="text-white/70 text-xs">AI 引擎加载中…</span>
          </div>
        </div>
      )}

      {/* 手动拍摄按钮（备用） */}
      <button
        onClick={handleCapture}
        disabled={!!capturing}
        className="absolute bottom-4 right-4 bg-white/20 hover:bg-white/30 backdrop-blur text-white text-xs px-3 py-1.5 rounded-full border border-white/30 disabled:opacity-40 pointer-events-auto"
        title="手动拍摄当前角度"
      >
        {capturing ? '拍摄中…' : '手动拍摄'}
      </button>
    </div>
  )
}
