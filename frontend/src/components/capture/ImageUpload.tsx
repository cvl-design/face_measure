import { useRef, useEffect, useState } from 'react'
import { validateImageFile } from '../../services/captureUtils'
import type { CaptureQualityScore } from '../../store/sessionStore'

interface ImageUploadProps {
  images: Record<string, File | string | undefined>
  onImageChange: (angle: string, file: File) => void
  qualityScores?: Record<string, CaptureQualityScore> | null
  disabled?: boolean
}

const ANGLE_SLOTS = [
  { key: 'front',   label: '正面 0°',  required: true  },
  { key: 'left45',  label: '左侧 45°', required: false },
  { key: 'right45', label: '右侧 45°', required: false },
  { key: 'left90',  label: '左侧 90°', required: false },
  { key: 'right90', label: '右侧 90°', required: false },
]

interface SlotState {
  previewUrl: string | null
  error: string | null
}

export default function ImageUpload({
  images,
  onImageChange,
  qualityScores,
  disabled = false,
}: ImageUploadProps) {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [slotStates, setSlotStates] = useState<Record<string, SlotState>>(() =>
    Object.fromEntries(ANGLE_SLOTS.map((s) => [s.key, { previewUrl: null, error: null }]))
  )

  // Revoke stale object URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(slotStates).forEach((s) => {
        if (s.previewUrl && s.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(s.previewUrl)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFileChange(angle: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate
    const errMsg = validateImageFile(file)
    if (errMsg) {
      setSlotStates((prev) => ({ ...prev, [angle]: { ...prev[angle], error: errMsg } }))
      e.target.value = ''
      return
    }

    // Revoke old blob URL
    const oldUrl = slotStates[angle]?.previewUrl
    if (oldUrl && oldUrl.startsWith('blob:')) {
      URL.revokeObjectURL(oldUrl)
    }

    const newUrl = URL.createObjectURL(file)
    setSlotStates((prev) => ({
      ...prev,
      [angle]: { previewUrl: newUrl, error: null },
    }))
    onImageChange(angle, file)
    e.target.value = ''
  }

  function resolvePreview(angle: string): string | null {
    const local = slotStates[angle]?.previewUrl
    if (local) return local
    const img = images[angle]
    if (!img) return null
    if (typeof img === 'string') return img
    return null
  }

  return (
    <div className="grid grid-cols-3 gap-4 md:grid-cols-5">
      {ANGLE_SLOTS.map((slot) => {
        const preview = resolvePreview(slot.key)
        const score = qualityScores?.[slot.key]
        const slotError = slotStates[slot.key]?.error

        return (
          <div key={slot.key} className="flex flex-col gap-1">
            {/* Slot button */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => fileInputRefs.current[slot.key]?.click()}
              className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-colors ${
                preview
                  ? 'border-transparent'
                  : 'border-dashed border-gray-600 hover:border-indigo-400'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {preview ? (
                <img
                  src={preview}
                  alt={slot.label}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-500">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-8 h-8"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5V19a1.5 1.5 0 001.5 1.5H19a1.5 1.5 0 001.5-1.5V16.5M12 3v13m0 0l-3.5-3.5M12 16l3.5-3.5"
                    />
                  </svg>
                  <span className="text-xs">点击上传</span>
                  {slot.required && (
                    <span className="text-xs text-red-400">必填</span>
                  )}
                </div>
              )}

              {/* Quality badge */}
              {score && (
                <div
                  className={`absolute top-1 right-1 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                    score.passed
                      ? 'bg-green-500 text-white'
                      : 'bg-orange-400 text-white'
                  }`}
                >
                  {score.passed ? '✓' : '⚠'}{' '}
                  {Math.round(score.overall * 100)}%
                </div>
              )}
            </button>

            {/* Label */}
            <p className="text-center text-xs text-gray-400">{slot.label}</p>

            {/* Validation error */}
            {slotError && (
              <p className="text-red-400 text-xs text-center leading-tight">{slotError}</p>
            )}

            {/* Quality failure reason */}
            {score && !score.passed && score.reasons[0] && (
              <p className="text-red-400 text-xs text-center leading-tight">
                {score.reasons[0]}
              </p>
            )}

            {/* Hidden file input */}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={disabled}
              ref={(el) => { fileInputRefs.current[slot.key] = el }}
              onChange={(e) => handleFileChange(slot.key, e)}
            />
          </div>
        )
      })}
    </div>
  )
}
