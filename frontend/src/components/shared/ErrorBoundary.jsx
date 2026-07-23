/**
 * components/shared/ErrorBoundary.jsx
 * Boundary global de errores de render. Sin esto, un error en cualquier
 * componente (incluyendo un chunk lazy que falla al cargar tras un deploy,
 * porque el hash del archivo cambió y el navegador tiene la versión vieja
 * en caché) tumbaba toda la app a una pantalla blanca sin ningún mensaje.
 *
 * Debe ser un componente de clase — React solo soporta error boundaries
 * como clases (no hay equivalente con hooks).
 */
import { Component } from 'react'
import * as Sentry from '@sentry/react'
import { RefreshCw, AlertOctagon } from 'lucide-react'

const CHUNK_RELOAD_KEY = 'inventoryai_chunk_reload_at'
const CHUNK_RELOAD_COOLDOWN_MS = 60_000

function isChunkLoadError(error) {
  const msg = error?.message || ''
  return /Failed to fetch dynamically imported module|Loading chunk .* failed|Importing a module script failed/i.test(msg)
}

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    try {
      Sentry.captureException(error, { extra: info })
    } catch {
      // Sentry es opcional (solo se activa con DSN) — nunca debe romper el boundary
    }

    // Chunk desactualizado tras un deploy: un solo reload automático (con
    // cooldown para no entrar en loop) suele resolverlo sin que el usuario
    // tenga que hacer nada.
    if (isChunkLoadError(error)) {
      const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
      if (Date.now() - lastReload > CHUNK_RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
        window.location.reload()
      }
    }
  }

  handleReload = () => window.location.reload()

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-ink-50 text-center px-4">
          <AlertOctagon size={48} className="text-ink-300" />
          <h2 className="text-xl font-bold text-ink-700">Algo salió mal</h2>
          <p className="text-ink-500 max-w-sm">
            Ocurrió un error inesperado. Intenta recargar la página.
          </p>
          <button onClick={this.handleReload} className="btn-primary inline-flex items-center gap-2">
            <RefreshCw size={16} /> Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
