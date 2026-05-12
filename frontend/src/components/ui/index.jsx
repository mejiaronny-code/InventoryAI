/**
 * components/ui/index.jsx
 * Componentes reutilizables de UI.
 */
import { X, AlertTriangle, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'

/* ── Modal genérico ───────────────────────────────────────── */
export function Modal({ open, onClose, title, size = 'md', children }) {
  if (!open) return null
  const sizeClass = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }[size]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx(
        'relative bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-y-auto animate-slide-up',
        sizeClass
      )}>
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100">
            <h3 className="text-base font-bold text-ink-900">{title}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-500">
              <X size={17} />
            </button>
          </div>
        )}
        <div className="p-6">{children}</div>
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
        <div className="flex gap-3 w-full">
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
    <div className="flex items-center justify-center h-48 gap-3 text-ink-400">
      <Spinner size={22} />
      <span className="text-sm">Cargando...</span>
    </div>
  )
}

/* ── Empty state ──────────────────────────────────────────── */
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
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
        className="btn-ghost p-2 disabled:opacity-40"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="text-sm text-ink-600 font-medium px-2">
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
        className="btn-ghost p-2 disabled:opacity-40"
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
