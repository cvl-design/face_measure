import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { captureApi } from '../services/api'
import { buildCaptureFormData } from '../services/captureUtils'
import { useSessionStore, type CaptureQualityScore } from '../store/sessionStore'
import ImageUpload from '../components/capture/ImageUpload'

type Tab = 'upload' | 'webcam'

export default function Capture() {
  const navigate = useNavigate()

  const sessionId    = useSessionStore((s) => s.sessionId)
  const captureImages = useSessionStore((s) => s.captureImages)
  const setCaptureImage  = useSessionStore((s) => s.setCaptureImage)
  const setCaptureResult = useSessionStore((s) => s.setCaptureResult)

  const [tab, setTab] = useState<Tab>('upload')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qualityScores, setQualityScores] = useState<Record<string, CaptureQualityScore> | null>(null)

  // Guard — must have a valid session
  useEffect(() => {
    if (!sessionId) navigate('/', { replace: true })
  }, [sessionId, navigate])

  const uploadedCount = ['front', 'left45', 'right45', 'left90', 'right90'].filter(
    (a) => captureImages[a as keyof typeof captureImages]
  ).length

  async function handleSubmit() {
    if (!sessionId || !captureImages.front || isUploading) return
    setIsUploading(true)
    setError(null)
    try {
      const formData = await buildCaptureFormData(captureImages, 'upload')
      const result = await captureApi.upload(sessionId, formData)
      // result shape: CaptureUploadResponse
      setCaptureResult(result.capture_id, result.quality_scores)
      setQualityScores(result.quality_scores)

      // If quality issues, show them briefly before navigating
      if (!result.all_passed) {
        setError(result.message)
        // Still navigate — quality warnings don't block Phase 1
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
        <p className="text-sm text-gray-400 mt-1">请上传 5 个角度的面部照片，正面为必填</p>
      </header>

      {/* Tabs */}
      <div className="px-6 flex gap-3 mb-6">
        <button
          onClick={() => setTab('upload')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'upload'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          手动上传
        </button>
        <button
          onClick={() => setTab('webcam')}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
            tab === 'webcam'
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-800 text-gray-400 hover:text-white'
          }`}
        >
          摄像头采集
          <span className="ml-1.5 text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded-full">
            即将推出
          </span>
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
          <div className="flex flex-col items-center justify-center h-64 rounded-2xl border-2 border-dashed border-gray-700 text-gray-500">
            <p className="text-lg font-medium">摄像头采集</p>
            <p className="text-sm mt-1">Phase 2 实现（MediaPipe 实时引导）</p>
          </div>
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
          已选 <span className="text-white font-semibold">{uploadedCount}</span> / 5 张
          {!captureImages.front && (
            <span className="ml-2 text-red-400 text-xs">（正面必须上传）</span>
          )}
        </span>
        <button
          onClick={handleSubmit}
          disabled={!captureImages.front || isUploading}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-indigo-600 disabled:cursor-not-allowed text-white font-semibold px-8 py-3 rounded-xl transition-colors"
        >
          {isUploading ? '上传中...' : '提交分析'}
        </button>
      </div>
    </div>
  )
}
