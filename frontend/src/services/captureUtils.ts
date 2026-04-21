/**
 * 图像工具函数 — 压缩 / Canvas 截帧 / base64 转换
 */
import { MAX_DIMENSION } from './constants'

/**
 * 将 File 或 Blob 压缩到 maxDimension 以内，返回 base64 字符串
 */
export async function compressImageToBase64(
  source: File | Blob,
  maxDimension = MAX_DIMENSION,
  quality = 0.88
): Promise<string> {
  const bitmap = await createImageBitmap(source)
  const { width, height } = bitmap

  let targetW = width
  let targetH = height
  if (width > maxDimension || height > maxDimension) {
    const ratio = Math.min(maxDimension / width, maxDimension / height)
    targetW = Math.round(width * ratio)
    targetH = Math.round(height * ratio)
  }

  const canvas = new OffscreenCanvas(targetW, targetH)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)

  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return blobToBase64(blob)
}

/**
 * Blob → base64 data URL
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * HTMLVideoElement 当前帧 → Blob（用于摄像头截图）
 */
export function captureFrameFromVideo(
  video: HTMLVideoElement,
  quality = 0.92
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(video, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))),
      'image/jpeg',
      quality
    )
  })
}

/**
 * 构建上传用的 FormData（5张图）
 */
export async function buildCaptureFormData(
  images: Record<string, File | string | undefined>,
  method: 'webcam' | 'upload'
): Promise<FormData> {
  const form = new FormData()
  form.append('capture_method', method)

  const angles = ['front', 'left45', 'right45', 'left90', 'right90']
  for (const angle of angles) {
    const img = images[angle]
    if (!img) continue
    if (img instanceof File) {
      form.append(angle, img, `${angle}.jpg`)
    } else {
      // base64 → Blob
      const res = await fetch(img)
      const blob = await res.blob()
      form.append(angle, blob, `${angle}.jpg`)
    }
  }
  return form
}

/**
 * 校验文件格式和大小
 */
export function validateImageFile(file: File, maxMb = 10): string | null {
  const allowed = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowed.includes(file.type)) {
    return `不支持的格式：${file.type}，请上传 JPG / PNG / WebP`
  }
  if (file.size > maxMb * 1024 * 1024) {
    return `文件过大（${(file.size / 1024 / 1024).toFixed(1)}MB），最大 ${maxMb}MB`
  }
  return null
}
