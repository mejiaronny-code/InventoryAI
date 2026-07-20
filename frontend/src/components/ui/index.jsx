/**
 * components/ui/index.jsx
 * Componentes reutilizables de UI.
 */
import { X, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useId, useRef } from 'react'

/* ── Modal genérico ───────────────────────────────────────── */
export function Modal({ open, onClose, title, size = 'md', children }) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined

    const previousActiveElement = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusTimer = window.setTimeout(() => {
      const firstFocusable = panelRef.current?.querySelector(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'
      )
      ;(firstFocusable || panelRef.current)?.focus()
    }, 0)

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }

      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
      )]
      if (focusable.length === 0) {
        event.preventDefault()
        panelRef.current.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousActiveElement?.focus?.()
    }
  }, [open])

  if (!open) return null
  const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }[size]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className={clsx(
        'relative bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto animate-slide-up',
        sizeClass
      )}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : 'Diálogo'}
        tabIndex={-1}
      >
        {title && (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-ink-100 bg-white">
            <h3 id={titleId} className="text-base font-bold text-ink-900">{title}</h3>
            <button
              onClick={onClose}
              className="w-10 h-10 -my-2 -mr-2 rounded-lg hover:bg-ink-100 text-ink-500 inline-flex items-center justify-center"
              aria-label="Cerrar diálogo"
            >
              <X size={17} />
            </button>
          </div>
        )}
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  )
}

/* ── Confirm dialog ───────────────────────────────────────── */
export function ConfirmDialog({ open, onClose, onConfirm, title, message, danger = false }) {
  if (!open) return null
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="flex flex-col items-center text-center gap-4">
        <div className={clsx(
          'w-12 h-12 rounded-full flex items-center justify-center',
          danger ? 'bg-red-100' : 'bg-yellow-100'
        )}>
          <AlertTriangle size={22} className={danger ? 'text-red-500' : 'text-yellow-500'} />
        </div>
        <div>
          <p className="font-bold text-ink-900">{title}</p>
          {message && <p className="text-sm text-ink-500 mt-1">{message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3 w-full">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancelar</button>
          <button
            onClick={() => { onConfirm(); onClose() }}
            className={clsx('flex-1 justify-center', danger ? 'btn-danger' : 'btn-primary')}
          >
            Confirmar
          </button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Spinner ──────────────────────────────────────────────── */
export function Spinner({ size = 20, className = '' }) {
  return (
    <Loader2
      size={size}
      className={clsx('animate-spin text-brand-500', className)}
    />
  )
}

/* ── Page loader ──────────────────────────────────────────── */
export function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-48 gap-3 text-ink-400" role="status" aria-live="polite">
      <Spinner size={22} />
      <span className="text-sm">Cargando...</span>
    </div>
  )
}

/* ── Empty state ──────────────────────────────────────────── */
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 sm:py-20 px-4 text-center gap-3">
      {Icon && <Icon size={44} className="text-ink-200" />}
      <p className="font-semibold text-ink-600">{title}</p>
      {description && <p className="text-sm text-ink-400 max-w-xs">{description}</p>}
      {action}
    </div>
  )
}

/* ── Pagination ───────────────────────────────────────────── */
export function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-2 py-4">
      <button
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="btn-ghost w-11 h-11 p-0 justify-center disabled:opacity-40"
        aria-label="Página anterior"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm text-ink-600 font-medium px-2">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="btn-ghost w-11 h-11 p-0 justify-center disabled:opacity-40"
        aria-label="Página siguiente"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  )
}

/* ── Status badge helper ──────────────────────────────────── */
export function StatusBadge({ status }) {
  const config = {
    pending:   { cls: 'badge-yellow', label: 'Pendiente'  },
    confirmed: { cls: 'badge-green',  label: 'Confirmada' },
    completed: { cls: 'badge-orange', label: 'Completada' },
    cancelled: { cls: 'badge-red',    label: 'Cancelada'  },
    expired:   { cls: 'badge-gray',   label: 'Expirada'   },
    active:    { cls: 'badge-green',  label: 'Activo'     },
    inactive:  { cls: 'badge-gray',   label: 'Inactivo'   },
    trial:     { cls: 'badge-yellow', label: 'Trial'      },
    suspended: { cls: 'badge-red',    label: 'Suspendido' },
  }
  const c = config[status] || { cls: 'badge-gray', label: status }
  return <span className={`badge ${c.cls}`}>{c.label}</span>
}
