/**
 * utils/format.js
 * Funciones de formato y helpers generales.
 */

/**
 * Formatea un número como moneda local.
 */
export function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('es-HN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

/**
 * Formatea una fecha relativa (hace X minutos, etc.)
 */
export function timeAgo(dateStr) {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = (now - date) / 1000

  if (diff < 60) return 'hace un momento'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)} días`
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

/**
 * Trunca un texto a N caracteres.
 */
export function truncate(text, n = 80) {
  if (!text) return ''
  return text.length > n ? text.slice(0, n) + '...' : text
}

/**
 * Genera un ID de sesión de chat único.
 */
export function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * Valida que una URL de imagen sea accesible.
 */
export async function validateImageUrl(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok && res.headers.get('content-type')?.startsWith('image/')
  } catch {
    return false
  }
}

/**
 * Convierte un File a base64.
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/**
 * Retorna el color de badge según estado de reserva.
 */
export function getReservationBadgeClass(status) {
  const map = {
    pending:   'badge-yellow',
    confirmed: 'badge-green',
    completed: 'badge-orange',
    cancelled: 'badge-red',
    expired:   'badge-gray',
  }
  return map[status] || 'badge-gray'
}
