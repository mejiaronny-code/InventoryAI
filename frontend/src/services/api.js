/**
 * services/api.js
 * Capa de servicio centralizada para todas las llamadas al backend FastAPI.
 */
import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
})

// ── Interceptor: inyectar token JWT ──────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── Interceptor: manejo de errores globales ───────────────────────
api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('user')
      window.location.href = '/admin/login'
    }
    return Promise.reject(error)
  }
)

// ============================================================
// AUTH
// ============================================================
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
  refresh: (refreshToken) => api.post('/auth/refresh', null, { params: { refresh_token: refreshToken } }),
  createEmployee: (data) => api.post('/auth/employees', data),
  listEmployees: () => api.get('/auth/employees'),
  deleteEmployee: (id) => api.delete(`/auth/employees/${id}`),
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
  listUsers: (id) => api.get(`/companies/${id}/users`),
  searchUser: (id, email) => api.get(`/companies/${id}/search-user`, { params: { email } }),
  assignUser: (id, data) => api.post(`/companies/${id}/assign-admin`, data),
  createUser: (id, data) => api.post(`/companies/${id}/create-user`, data),
  removeUser: (companyId, userId) => api.delete(`/companies/${companyId}/users/${userId}`),
  getMe: () => api.get('/companies/me'),
  updateMe: (data) => api.put('/companies/me/settings', data),
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
}

// ============================================================
// STOCK
// ============================================================
export const stockAPI = {
  listMovements: (params) => api.get('/stock/movements', { params }),
  createMovement: (data) => api.post('/stock/movement', data),
  setStock: (productId, data) => api.put('/stock/set', data, { params: { product_id: productId } }),
}

// ============================================================
// RESERVATIONS
// ============================================================
export const reservationsAPI = {
  getPublic: (slug, code) => api.get(`/reservations/public/${code}`, { params: { company_slug: slug } }),
  list: (params) => api.get('/reservations/', { params }),
  update: (id, data) => api.patch(`/reservations/${id}`, data),
  expireAll: () => api.post('/reservations/expire-all'),
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
    }),

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
}

// ============================================================
// DASHBOARD
// ============================================================
export const dashboardAPI = {
  getMetrics: () => api.get('/dashboard/metrics'),
  getSuperAdminMetrics: (month) => api.get('/dashboard/superadmin', { params: month ? { month } : {} }),
}

// ============================================================
// NOTIFICATIONS
// ============================================================
export const notificationsAPI = {
  list: () => api.get('/notifications/'),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/read-all'),
}

export default api
