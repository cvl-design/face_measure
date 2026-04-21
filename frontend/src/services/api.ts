/**
 * Axios 封装 — 统一调用后端 REST API
 */
import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 90_000,   // VLM 最长 60s + 余量
  headers: { 'Content-Type': 'application/json' },
})

// 请求拦截：可在此注入 session_id header 等
api.interceptors.request.use((config) => config)

// 响应拦截：统一错误格式
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const detail = error.response?.data?.detail ?? error.message
    return Promise.reject(new Error(typeof detail === 'string' ? detail : JSON.stringify(detail)))
  }
)

// ── Session ──────────────────────────────────────────────────

export interface CreateSessionPayload {
  gender: 'male' | 'female'
  age_group: string
  chief_complaint?: string
  allergy_note?: string
}

export const sessionApi = {
  create: (payload: CreateSessionPayload) =>
    api.post('/sessions', payload).then((r) => r.data),

  get: (sessionId: string) =>
    api.get(`/sessions/${sessionId}`).then((r) => r.data),

  close: (sessionId: string) =>
    api.delete(`/sessions/${sessionId}`),
}

// ── Capture ──────────────────────────────────────────────────

export const captureApi = {
  upload: (sessionId: string, formData: FormData) =>
    api.post(`/sessions/${sessionId}/capture`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data),

  getQuality: (sessionId: string) =>
    api.get(`/sessions/${sessionId}/capture/quality`).then((r) => r.data),
}

// ── Analysis ─────────────────────────────────────────────────

export const analysisApi = {
  trigger: (sessionId: string) =>
    api.post(`/sessions/${sessionId}/analyze`).then((r) => r.data),

  getResult: (sessionId: string) =>
    api.get(`/sessions/${sessionId}/analysis`).then((r) => r.data),
}

// ── Templates ────────────────────────────────────────────────

export const templatesApi = {
  getMatches: (sessionId: string) =>
    api.get(`/sessions/${sessionId}/templates`).then((r) => r.data),

  selectTemplate: (sessionId: string, templateId: string) =>
    api.put(`/sessions/${sessionId}/templates/select`, { template_id: templateId }).then((r) => r.data),
}

// ── Treatment ────────────────────────────────────────────────

export const treatmentApi = {
  getRecommended: (sessionId: string) =>
    api.get(`/sessions/${sessionId}/treatment`).then((r) => r.data),

  updateSelected: (sessionId: string, items: unknown[]) =>
    api.put(`/sessions/${sessionId}/treatment`, { doctor_selected: items }).then((r) => r.data),

  getCatalog: () =>
    api.get('/catalog/treatments').then((r) => r.data),
}

// ── Simulation ────────────────────────────────────────────────

export const simulationApi = {
  trigger: (sessionId: string) =>
    api.post(`/sessions/${sessionId}/simulate`).then((r) => r.data),

  getResult: (sessionId: string, jobId: string) =>
    api.get(`/sessions/${sessionId}/simulate/${jobId}`).then((r) => r.data),
}

// ── Report ───────────────────────────────────────────────────

export const reportApi = {
  download: (sessionId: string) =>
    api.get(`/sessions/${sessionId}/report`, { responseType: 'blob' }).then((r) => r.data),
}

export default api
