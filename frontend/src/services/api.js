/**
 * services/api.js
 * Capa de servicio centralizada para todas las llamadas al backend FastAPI.
 * Incluye cache de GET requests para evitar refetch en navegación.
 */
import axios from 'axios'

export const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

// ── Cache de respuestas GET ───────────────────────────────────────
// TTLs: datos que cambian poco = 30s, notificaciones = 8s
const _cache = new Map()

const CACHE_TTLS = {
  '/products':     30_000,
  '/categories':   60_000,
  '/warehouses':   60_000,
  '/dashboard':    20_000,
  '/reservations': 15_000,
  '/stock':        20_000,
  '/notifications':  8_000,
  '/auth/me':      60_000,
  '/companies/me': 60_000,
}

function getTTL(url) {
  for (const [prefix, ttl] of Object.entries(CACHE_TTLS)) {
    if (url.includes(prefix)) return ttl
  }
  return 15_000 // default 15s
}

function getCacheKey(config) {
  const token = localStorage.getItem('access_token') || ''
  return `${token.slice(-12)}::${config.url}::${JSON.stringify(config.params || {})}`
}

export function clearCache(urlFragment) {
  if (!urlFragment) { _cache.clear(); return }
  for (const key of _cache.keys()) {
    if (key.includes(urlFragment)) _cache.delete(key)
  }
}

// ── Instancia axios ───────────────────────────────────────────────
const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
})

// ── Interceptor: inyectar token JWT ──────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  // Cache hit para GET
  if (config.method === 'get' && !config.noCache) {
    const key = getCacheKey(config)
    const hit = _cache.get(key)
    if (hit && Date.now() < hit.expiresAt) {
      config._cacheHit = hit.data
    }
  }
  return config
})

// ── Interceptor: cache de respuestas + errores globales ──────────
api.interceptors.response.use(
  (res) => {
    // Guardar GET en cache
    if (res.config.method === 'get' && !res.config.noCache) {
      const key = getCacheKey(res.config)
      _cache.set(key, { data: res, expiresAt: Date.now() + getTTL(res.config.url) })
    }
    // Invalidar cache en mutaciones
    if (['post', 'put', 'patch', 'delete'].includes(res.config.method)) {
      clearCache()
    }
    return res
  },
  (error) => {
    if (error.response?.status === 401) {
      clearCache()
      localStorage.removeItem('access_token')
      localStorage.removeItem('user')
      window.location.href = '/admin/login'
    }
    return Promise.reject(error)
  }
)

// ── Wrapper que devuelve cache hit sin hacer request ─────────────
const _originalRequest = api.request.bind(api)
api.request = function(config) {
  return _originalRequest(config).catch(err => {
    if (err.config?._cacheHit) return err.config._cacheHit
    throw err
  })
}

// Monkey-patch get para retornar cache hit antes de la llamada HTTP
const _originalGet = api.get.bind(api)
api.get = function(url, config = {}) {
  if (!config.noCache) {
    const fakeConfig = { ...config, url, method: 'get', baseURL: BASE_URL }
    const token = localStorage.getItem('access_token') || ''
    const key = `${token.slice(-12)}::${url}::${JSON.stringify(config.params || {})}`
    const hit = _cache.get(key)
    if (hit && Date.now() < hit.expiresAt) {
      return Promise.resolve(hit.data)
    }
  }
  return _originalGet(url, config)
}

// ============================================================
// AUTH
// ============================================================
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  updateMe: (data) => api.put('/auth/me', data),
  refresh: (refreshToken) => api.post('/auth/refresh', null, { params: { refresh_token: refreshToken } }),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  createEmployee: (data) => api.post('/auth/employees', data),
  listEmployees: () => api.get('/auth/employees'),
  deleteEmployee: (id) => api.delete(`/auth/employees/${id}`),
  toggleEmployeeActive: (id) => api.patch(`/auth/employees/${id}/toggle-active`),
}

// ============================================================
// COMPANIES
// ============================================================
export const companiesAPI = {
  listPublic: () => api.get('/companies/'),
  listAll: () => api.get('/companies/all'),
  create: (data) => api.post('/companies/', data),
  update: (id, data) => api.put(`/companies/${id}`, data),
  delete: (id) => api.delete(`/companies/${id}`),
  updateSubscription: (id, plan, status) =>
    api.patch(`/companies/${id}/subscription`, null, { params: { plan, status } }),
  setBusinessType: (id, business_type, features = null) =>
    api.patch(`/companies/${id}/business-type`, { business_type, features }),
  setAiRulesLimit: (id, limit) =>
    api.patch(`/companies/${id}/ai-rules-limit`, null, { params: { limit } }),
  setChatDailyLimit: (id, limit) =>
    api.patch(`/companies/${id}/chat-daily-limit`, null, { params: { limit } }),
  setKnowledgeDocsLimit: (id, limit) =>
    api.patch(`/companies/${id}/knowledge-docs-limit`, null, { params: { limit } }),
  listUsers: (id) => api.get(`/companies/${id}/users`),
  searchUser: (id, email) => api.get(`/companies/${id}/search-user`, { params: { email } }),
  assignUser: (id, data) => api.post(`/companies/${id}/assign-admin`, data),
  createUser: (id, data) => api.post(`/companies/${id}/create-user`, data),
  removeUser: (companyId, userId) => api.delete(`/companies/${companyId}/users/${userId}`),
  getMe: () => api.get('/companies/me'),
  updateMe: (data) => api.put('/companies/me/settings', data),
  requestDeletion: () => api.post('/companies/me/request-deletion'),
  uploadLogo: (file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/companies/me/upload-logo', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

// ============================================================
// KNOWLEDGE BASE (documentos institucionales para el chat IA)
// ============================================================
export const knowledgeAPI = {
  listDocuments: () => api.get('/knowledge/documents'),
  getDocumentsLimit: () => api.get('/knowledge/documents/limit'),
  uploadDocument: (title, file) => {
    const form = new FormData()
    form.append('title', title)
    form.append('file', file)
    return api.post('/knowledge/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  },
  deleteDocument: (documentId) => api.delete(`/knowledge/documents/${documentId}`),
}

// ============================================================
// CATEGORIES
// ============================================================
export const categoriesAPI = {
  listPublic: (slug) => api.get(`/categories/public/${slug}`),
  list: () => api.get('/categories/'),
  create: (data) => api.post('/categories/', data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  delete: (id) => api.delete(`/categories/${id}`),
}

// ============================================================
// WAREHOUSES
// ============================================================
export const warehousesAPI = {
  listPublic: (slug) => api.get(`/warehouses/public/${slug}`),
  list: () => api.get('/warehouses/'),
  create: (data) => api.post('/warehouses/', data),
  update: (id, data) => api.put(`/warehouses/${id}`, data),
  delete: (id) => api.delete(`/warehouses/${id}`),
}

// ============================================================
// PRODUCTS
// ============================================================
export const productsAPI = {
  listPublic: (slug, params) => api.get(`/products/public/${slug}`, { params }),
  list: (params) => api.get('/products/', { params }),
  get: (id) => api.get(`/products/${id}`),
  create: (data) => api.post('/products/', data),
  update: (id, data) => api.put(`/products/${id}`, data),
  delete: (id) => api.delete(`/products/${id}`),
  regenerateEmbedding: (id) => api.post(`/products/${id}/regenerate-embedding`),
  reembedAll: () => api.post('/products/reembed-all'),
  getVariants: (id) => api.get(`/products/${id}/variants`),
  getVariantStock: (id) => api.get(`/products/${id}/variant-stock`),
  upsertVariantStock: (id, items, notes) => api.put(`/products/${id}/variant-stock`, { items, notes }),
  getVariantStockPublic: (slug, productId) => api.get(`/products/public/${slug}/${productId}/variant-stock`),
  uploadImage: (file) => {
    const form = new FormData()
    form.append('file', file)
    return api.post('/products/upload-image', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

// ============================================================
// STOCK
// ============================================================
export const stockAPI = {
  listMovements: (params) => api.get('/stock/movements', { params }),
  createMovement: (data) => api.post('/stock/movement', data),
  setStock: (productId, data) => api.put('/stock/set', data, { params: { product_id: productId } }),
  updateLocation: (data) => api.patch('/stock/location', data),
  getExpiring: (days = 30) => api.get('/stock/expiring', { params: { days } }),
}

// ============================================================
// RECIPES (sector restaurantes)
// ============================================================
export const recipesAPI = {
  get: (dishId) => api.get(`/recipes/${dishId}`),
  set: (dishId, items) => api.put(`/recipes/${dishId}`, { items }),
  registerSale: (items, warehouseId = null) =>
    api.post('/recipes/register-sale', { items, warehouse_id: warehouseId }),
}

// ============================================================
// TABLES + BOOKINGS (sector restaurantes)
// ============================================================
export const tablesAPI = {
  list: () => api.get('/tables/'),
  listPublic: (slug) => api.get(`/tables/public/${slug}`),
  create: (data) => api.post('/tables/', data),
  update: (id, data) => api.patch(`/tables/${id}`, data),
  delete: (id) => api.delete(`/tables/${id}`),
}

export const bookingsAPI = {
  list: (params) => api.get('/bookings/', { params }),
  createPublic: (slug, data) => api.post(`/bookings/public/${slug}`, data),
  getPublic: (code, slug) => api.get(`/bookings/public/${code}`, { params: { company_slug: slug } }),
  update: (id, data) => api.patch(`/bookings/${id}`, data),
  cleanup: () => api.delete('/bookings/cleanup'),
}

// ============================================================
// BATCHES
// ============================================================
export const batchesAPI = {
  list: (params) => api.get('/batches/', { params }),
  getByProduct: (productId) => api.get('/batches/', { params: { product_id: productId } }),
  create: (data) => api.post('/batches/', data),
  update: (id, data) => api.patch(`/batches/${id}`, data),
  delete: (id) => api.delete(`/batches/${id}`),
}

// ============================================================
// SERIALS
// ============================================================
export const serialsAPI = {
  list: (params) => api.get('/serials/', { params }),
  create: (data) => api.post('/serials/', data),
  find: (serialNumber) => api.get(`/serials/search/${serialNumber}`),
  update: (id, data) => api.patch(`/serials/${id}`, data),
  delete: (id) => api.delete(`/serials/${id}`),
}

// ============================================================
// RESERVATIONS
// ============================================================
export const reservationsAPI = {
  createPublic: (slug, data) => api.post(`/reservations/public/${slug}`, data),
  getPublic: (slug, code) => api.get(`/reservations/public/${code}`, { params: { company_slug: slug } }),
  getByEmail: (slug, email, code) => api.get('/reservations/public/by-email', { params: { company_slug: slug, email, code } }),
  list: (params) => api.get('/reservations/', { params }),
  listFresh: (params) => api.get('/reservations/', { params, noCache: true }),
  update: (id, data) => api.patch(`/reservations/${id}`, data),
  expireAll: () => api.post('/reservations/expire-all'),
  deleteCancelled: () => api.delete('/reservations/cancelled'),
}

// ============================================================
// REPORTS
// ============================================================
export const reportsAPI = {
  aging: () => api.get('/reports/aging', { noCache: true }),
  valuation: () => api.get('/reports/valuation', { noCache: true }),
  importProducts: (products) => api.post('/reports/import/products', { products }),
}

// ============================================================
// PUTAWAY RULES
// ============================================================
export const putawayAPI = {
  list: () => api.get('/putaway/'),
  suggest: (productId, warehouseId) =>
    api.get('/putaway/suggest', { params: { product_id: productId, warehouse_id: warehouseId } }),
  create: (data) => api.post('/putaway/', data),
  update: (id, data) => api.patch(`/putaway/${id}`, data),
  delete: (id) => api.delete(`/putaway/${id}`),
}

// ============================================================
// REORDER
// ============================================================
export const reorderAPI = {
  list: (params) => api.get('/reorder/', { params }),
  create: (data) => api.post('/reorder/', data),
  update: (id, data) => api.patch(`/reorder/${id}`, data),
  delete: (id) => api.delete(`/reorder/${id}`),
}

// ============================================================
// PICKING
// ============================================================
export const pickingAPI = {
  list: (params) => api.get('/picking/', { params }),
  confirmPick: (id) => api.patch(`/picking/${id}/confirm`),
  completePick: (id) => api.patch(`/picking/${id}/complete`),
}

// ============================================================
// CHAT
// ============================================================
export const chatAPI = {
  sendMessage: (sessionId, message, companySlug) =>
    api.post('/chat/message', {
      session_id: sessionId,
      message,
      company_slug: companySlug,
    }, { timeout: 60000 }), // 60s — DeepInfra puede tener cold starts lentos

  sendImage: (sessionId, companySlug, imageFile, userText) => {
    const formData = new FormData()
    formData.append('session_id', sessionId)
    formData.append('company_slug', companySlug)
    formData.append('user_text', userText || '¿Qué producto es este y cuánto cuesta?')
    formData.append('image', imageFile)
    return api.post('/chat/image', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000, // más tiempo para visión
    })
  },

  sendAudio: (sessionId, companySlug, audioBlob, filename = 'audio.webm') => {
    const formData = new FormData()
    formData.append('session_id', sessionId)
    formData.append('company_slug', companySlug)
    formData.append('audio', audioBlob, filename)
    return api.post('/chat/audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 90000, // transcripción + respuesta del agente
    })
  },

  // Solo transcribe — NO envía al agente. Usado para que el usuario
  // revise/edite el texto antes de mandarlo (Whisper puede "alucinar"
  // texto en otro idioma con audios cortos/silenciosos/ruidosos).
  transcribeAudio: (companySlug, audioBlob, filename = 'audio.webm') => {
    const formData = new FormData()
    formData.append('company_slug', companySlug)
    formData.append('audio', audioBlob, filename)
    return api.post('/chat/transcribe', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    })
  },
}

// ============================================================
// DASHBOARD
// ============================================================
export const dashboardAPI = {
  getMetrics: () => api.get('/dashboard/metrics'),
  getActivity: (limit) => api.get('/dashboard/activity', { params: limit ? { limit } : {} }),
  getSuperAdminMetrics: (month) => api.get('/dashboard/superadmin', { params: month ? { month } : {} }),
}

// ============================================================
// NOTIFICATIONS
// ============================================================
export const notificationsAPI = {
  list: () => api.get('/notifications/'),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
  deleteOne: (id) => api.delete(`/notifications/${id}`),
  deleteRead: () => api.delete('/notifications/'),
}

export default api
