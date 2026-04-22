import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { captureApi } from '../services/api'
import { buildCaptureFormData } from '../services/captureUtils'
import { useSessionStore, type CaptureQualityScore } from '../store/sessionStore'
import ImageUpload from '../components/capture/ImageUpload'
import WebcamCapture from '../components/capture/WebcamCapture'

type Tab = 'upload' | 'webcam'

export default function Capture() {
  const navigate = useNavigate()

  const sessionId    = useSessionStore((s) => s.sessionId)
  const captureImages = useSessionStore((s) => s.captureImages)
  const setCaptureImage  = useSessionStore((s) => s.setCaptureImage)
  const setCaptureResult = useSessionStore((s) => s.setCaptureResult)
  const setCaptureMethod = useSessionStore((s) => s.setCaptureMethod)

  const [tab, setTab] = useState<Tab>('upload')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qualityScores, setQualityScores] = useState<Record<string, CaptureQualityScore> | null>(null)

  // 切 tab 时同步 captureMethod 到 store
  function handleTabChange(next: Tab) {
    setTab(next)
    setCaptureMethod(next)
  }

  // Guard — must have a valid session
  useEffect(() => {
    if (!sessionId) navigate('/', { replace: true })
  }, [sessionId, navigate])

  // 摄像头模式下：已采集的角度列表（从 captureImages 推导）
  const ANGLE_KEYS = ['front', 'left45', 'right45', 'left90', 'right90'] as const
  const capturedAngles = ANGLE_KEYS.filter(
    (a) => !!captureImages[a as keyof typeof captureImages]
  )

  const uploadedCount = ANGLE_KEYS.filter(
    (a) => captureImages[a as keyof typeof captureImages]
  ).length

  async function handleSubmit() {
    // 摄像头模式必须 5 张全拍；上传模式至少有正面
    if (!sessionId || isUploading) return
    if (tab === 'upload' && !captureImages.front) return
    if (tab === 'webcam' && capturedAngles.length < 5) return

    setIsUploading(true)
    setError(null)
    try {
      const method   = tab === 'webcam' ? 'webcam' : 'upload'
      const formData = await buildCaptureFormData(captureImages, method)
      const result   = await captureApi.upload(sessionId, formData)
      setCaptureResult(result.capture_id, result.quality_scores)
      setQualityScores(result.quality_scores)

      if (!result.all_passed) {
        setError(result.message)
        setTimeout(() => navigate('/analyzing'), 1500)
      } else {
        navigate('/analyzing')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请检查网络后重试')
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-900">
      {/* Header */}
      <header className="px-6 pt-8 pb-4">
        <h1 className="text-2xl font-bold text-white">面部采集</h1>
        <p className="text-sm text-gray-400 mt-1">
          {tab === 'upload'
            ? '请上传 5 个角度的面部照片，正面为必填'
            : '请按提示依次完成 5 个角度的摄像头采集'}
        </p>
      </header>

      {/* Tabs */}
      <div className="px-6 flex gap-3 mb-6">
        <button
          onClick={() => handleTabChange('upload')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'upload'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          手动上传
        </button>
        <button
          onClick={() => handleTabChange('webcam')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'webcam'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          摄像头采集
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 px-6">
        {tab === 'upload' ? (
          <ImageUpload
            images={captureImages}
            onImageChange={(angle, file) =>
              setCaptureImage(angle as keyof typeof captureImages, file)
            }
            qualityScores={qualityScores}
            disabled={isUploading}
          />
        ) : (
          <WebcamCapture
            capturedAngles={capturedAngles}
            onCapture={(angle, base64) =>
              setCaptureImage(angle as keyof typeof captureImages, base64)
            }
            onAllDone={() => {
              // 5 张全拍完后自动触发提交
              handleSubmit()
            }}
          />
        )}

        {/* Error / warning message */}
        {error && (
          <p className="mt-4 text-sm text-orange-400 bg-orange-950 rounded-lg px-4 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Bottom bar */}
      <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 flex items-center justify-between">
        <span className="text-sm text-gray-400">
          已选{' '}
          <span className="text-white font-semibold">{uploadedCount}</span> / 5 张
          {tab === 'upload' && !captureImages.front && (
            <span className="ml-2 text-red-400 text-xs">（正面必须上传）</span>
          )}
          {tab === 'webcam' && capturedAngles.length < 5 && (
            <span className="ml-2 text-gray-500 text-xs">（摄像头采集完成后自动提交）</span>
          )}
        </span>
        {/* 上传模式保留手动提交按钮；摄像头模式自动提交，但允许手动强制提交（已有正面则可用）*/}
        {tab === 'upload' ? (
          <button
            onClick={handleSubmit}
            disabled={!captureImages.front || isUploading}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-indigo-600 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-xl transition-colors"
          >
            {isUploading ? '上传中...' : '提交分析'}
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!captureImages.front || isUploading || capturedAngles.length < 5}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-indigo-600 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-xl transition-colors"
          >
            {isUploading ? '上传中...' : `提交分析（${uploadedCount}/5）`}
          </button>
        )}
      </div>
    </div>
  )
}
