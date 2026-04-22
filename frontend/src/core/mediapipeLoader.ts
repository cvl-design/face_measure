/**
 * mediapipeLoader — MediaPipe Face Landmarker 单例加载器
 *
 * 策略：
 * - 首次调用 loadFaceLandmarker() 触发 WASM 下载，返回 Promise
 * - 后续调用复用同一 Promise（单例缓存），避免重复下载
 * - 在 Capture 页 STAGE 0 后台预热，消除摄像头采集冷启动
 *
 * 依赖（需在 index.html 或 package.json 安装）：
 *   @mediapipe/tasks-vision  （CDN 或 npm）
 *
 * 用法：
 *   import { loadFaceLandmarker } from '../core/mediapipeLoader'
 *   const detector = await loadFaceLandmarker()
 *   const result   = detector.detect(mpImage)
 */

// MediaPipe Tasks Vision CDN（与后端版本一致：0.10.x）
const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm'
const MODEL_URL = '/ai_models/face_landmarker.task'   // Vite proxy 或直接放 public/

// ── 类型声明（避免依赖完整 @types） ──────────────────────────────────

export interface NormalizedLandmark {
  x: number   // 0.0–1.0
  y: number
  z: number
}

export interface FaceLandmarkerResult {
  faceLandmarks: NormalizedLandmark[][]  // [face][landmark]
}

export interface FaceLandmarkerInstance {
  detect(image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): FaceLandmarkerResult
  detectForVideo(image: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult
  close(): void
}

// ── 单例缓存 ─────────────────────────────────────────────────────────

let _promise: Promise<FaceLandmarkerInstance> | null = null
let _instance: FaceLandmarkerInstance | null = null

/**
 * 获取 FaceLandmarker 单例（懒加载，自动缓存）
 * @param modelUrl  .task 模型文件路径（默认 /ai_models/face_landmarker.task）
 */
export async function loadFaceLandmarker(
  modelUrl: string = MODEL_URL
): Promise<FaceLandmarkerInstance> {
  // 已有实例直接返回
  if (_instance) return _instance

  // 正在加载中：复用同一 Promise，避免重复请求
  if (_promise) return _promise

  _promise = _doLoad(modelUrl)
  return _promise
}

/**
 * 返回当前实例（同步，未加载时返回 null）
 */
export function getFaceLandmarker(): FaceLandmarkerInstance | null {
  return _instance
}

/**
 * 关闭并重置实例（换模型 / 测试用）
 */
export function disposeFaceLandmarker(): void {
  _instance?.close()
  _instance = null
  _promise  = null
}

// ── 内部加载逻辑 ──────────────────────────────────────────────────────

async function _doLoad(modelUrl: string): Promise<FaceLandmarkerInstance> {
  // 动态导入（避免 SSR 问题，且允许 tree-shaking）
  const vision = await import(
    /* webpackIgnore: true */
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/vision_bundle.mjs'
  )

  const { FaceLandmarker, FilesetResolver } = vision

  // 初始化 WASM 运行时
  const filesetResolver = await FilesetResolver.forVisionTasks(WASM_CDN)

  // 创建检测器
  const landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: modelUrl,
      delegate: 'GPU',  // 优先 GPU；不支持时自动降级 CPU
    },
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    runningMode: 'VIDEO',   // VIDEO 模式支持 detectForVideo（摄像头）
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence:  0.5,
    minTrackingConfidence:      0.5,
  })

  _instance = landmarker as unknown as FaceLandmarkerInstance
  return _instance
}

// ── 工具：从 FaceLandmarkerResult 提取第一张脸的关键点 ──────────────

export function extractFirstFaceLandmarks(
  result: FaceLandmarkerResult
): NormalizedLandmark[] | null {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null
  return result.faceLandmarks[0]
}

// ── 工具：计算两点距离（归一化坐标系） ────────────────────────────────

export function landmarkDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark
): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
}

// ── 工具：估算头部偏转角度（用于 AngleGuideOverlay） ─────────────────
// 基于左眼外角(33)、右眼外角(263)、鼻尖(4) 的相对位置

export function estimateHeadAngles(landmarks: NormalizedLandmark[]): {
  yaw: number    // 水平偏转角（°），正=向右，负=向左
  pitch: number  // 俯仰角（°），正=抬头，负=低头
} {
  if (landmarks.length < 478) return { yaw: 0, pitch: 0 }

  const leftEye  = landmarks[33]   // 左眼外角
  const rightEye = landmarks[263]  // 右眼外角
  const noseTip  = landmarks[4]    // 鼻尖
  const chin     = landmarks[152]  // 下颌

  // 面部宽度中点
  const faceCenterX = (leftEye.x + rightEye.x) / 2
  // yaw：鼻尖相对于面部中线的水平偏移（归一化到 ±90°）
  const yawRaw = (noseTip.x - faceCenterX) / ((rightEye.x - leftEye.x) / 2)
  const yaw    = Math.round(Math.asin(Math.max(-1, Math.min(1, yawRaw))) * (180 / Math.PI))

  // pitch：鼻尖相对于眼-颌中线的垂直位置
  const eyeMidY  = (leftEye.y + rightEye.y) / 2
  const faceH    = chin.y - eyeMidY
  const pitchRaw = ((noseTip.y - eyeMidY) / faceH - 0.45) * 2  // 正常约0.45
  const pitch    = Math.round(Math.asin(Math.max(-1, Math.min(1, pitchRaw))) * (180 / Math.PI) * -1)

  return { yaw, pitch }
}
