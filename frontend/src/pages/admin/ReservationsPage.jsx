/**
 * pages/admin/ReservationsPage.jsx
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { reservationsAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useRealtimeInserts } from '../../hooks/useRealtimeInserts'
import toast from 'react-hot-toast'
import { RefreshCw, CheckCircle, XCircle, Package, Clock, Search, Loader2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'
import { ErrorState } from '../../components/ui'

const statusConfig = {
  pending:   { color: 'badge-yellow', label: 'Pendiente'  },
  confirmed: { color: 'badge-green',  label: 'Confirmada' },
  completed: { color: 'badge-orange', label: 'Completada' },
  cancelled: { color: 'badge-red',    label: 'Cancelada'  },
  expired:   { color: 'badge-gray',   label: 'Expirada'   },
}

export default function ReservationsPage() {
  const { user } = useAuth()
  const [reservations, setReservations] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [liveIndicator, setLiveIndicator] = useState(false)
  // { id, action } — qué botón muestra spinner
  const [updating, setUpdating] = useState(null)
  const [deletingCancelled, setDeletingCancelled] = useState(false)
  const [loadError, setLoadError] = useState(false)
  // Set de IDs que acaban de cambiar de estado (para la animación de fila)
  const [flashedRows, setFlashedRows] = useState(new Set())
  // Ref para evitar refetch mientras hay una acción en curso
  const updatingRef = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(false)
    reservationsAPI.list(statusFilter ? { status: statusFilter } : {})
      .then(r => setReservations(r.data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  // Realtime: nueva reserva → prepend silencioso
  useRealtimeInserts({
    companyId: user?.company_id,
    table: 'reservations',
    event: 'INSERT',
    onEvent: () => {
      // Solo refrescar si no hay una acción de botón en vuelo
      if (updatingRef.current) return
      // Mostrar indicador live brevemente
      setLiveIndicator(true)
      setTimeout(() => setLiveIndicator(false), 2000)
      reservationsAPI.listFresh(statusFilter ? { status: statusFilter } : {})
        .then(r => setReservations(r.data))
        .catch(() => {})
    },
  })

  // Realtime: cambio de estado → actualizar fila sin spinner de carga
  useRealtimeInserts({
    companyId: user?.company_id,
    table: 'reservations',
    event: 'UPDATE',
    onEvent: (updated) => {
      // Si este UPDATE lo causamos nosotros (optimistic update ya aplicado), ignorar
      if (updatingRef.current?.id === updated.id) return
      setReservations(prev =>
        prev.map(r => r.id === updated.id ? { ...r, status: updated.status } : r)
      )
    },
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return reservations
    const q = search.toLowerCase()
    return reservations.filter(r =>
      r.reservation_code?.toLowerCase().includes(q) ||
      r.client_name?.toLowerCase().includes(q) ||
      r.client_email?.toLowerCase().includes(q) ||
      r.products?.name?.toLowerCase().includes(q)
    )
  }, [reservations, search])

  const handleStatus = async (id, newStatus) => {
    const update = { id, action: newStatus }
    setUpdating(update)
    updatingRef.current = update

    // Optimistic update — badge cambia de inmediato
    setReservations(prev =>
      prev.map(r => r.id === id ? { ...r, status: newStatus } : r)
    )

    // Marcar fila para animación de flash
    setFlashedRows(prev => new Set(prev).add(id))
    setTimeout(() => {
      setFlashedRows(prev => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }, 700)

    try {
      await reservationsAPI.update(id, { status: newStatus })
      toast.success(
        newStatus === 'confirmed' ? 'Reserva confirmada ✓' :
        newStatus === 'cancelled' ? 'Reserva cancelada' :
        'Reserva completada ✓'
      )
    } catch {
      // Revertir optimistic update si falla
      toast.error('Error al actualizar')
      load()
    } finally {
      setUpdating(null)
      updatingRef.current = null
    }
  }

  const handleExpireAll = async () => {
    await reservationsAPI.expireAll()
    toast.success('Reservas expiradas procesadas')
    load()
  }

  const handleDeleteCancelled = async () => {
    const count = reservations.filter(r => ['cancelled', 'expired', 'completed'].includes(r.status)).length
    if (count === 0) { toast('No hay reservas para limpiar', { icon: '💬' }); return }
    setDeletingCancelled(true)
    try {
      await reservationsAPI.deleteCancelled()
      toast.success(`${count} reserva${count > 1 ? 's eliminadas' : ' eliminada'}`)
      load()
    } catch { toast.error('Error al eliminar') } finally { setDeletingCancelled(false) }
  }

  const isUpdating = (id, action) =>
    updating?.id === id && updating?.action === action

  const isAnyUpdating = (id) => updating?.id === id

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="page-title">Reservas</h1>
          <span className={clsx(
            'inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full transition-all duration-500',
            liveIndicator
              ? 'bg-green-100 text-green-700 scale-105'
              : 'bg-ink-100 text-ink-400'
          )}>
            <span className={clsx('w-1.5 h-1.5 rounded-full', liveIndicator ? 'bg-green-500 animate-pulse' : 'bg-ink-300')} />
            {liveIndicator ? 'Nueva reserva' : 'En vivo'}
          </span>
        </div>
        <div className="flex gap-2 flex-wrap w-full sm:w-auto">
          <button onClick={handleExpireAll} className="btn-ghost min-h-11 text-xs flex-1 sm:flex-none">
            <Clock size={14} /> Expirar vencidas
          </button>
          {reservations.some(r => ['cancelled', 'expired', 'completed'].includes(r.status)) && (
            <button
              onClick={handleDeleteCancelled}
              disabled={deletingCancelled}
              className="btn-danger min-h-11 text-xs flex-1 sm:flex-none"
            >
              {deletingCancelled
                ? <Loader2 size={14} className="animate-spin" />
                : <Trash2 size={14} />
              }
              Limpiar historial
            </button>
          )}
          <button onClick={load} className="btn-ghost min-h-11 min-w-11" aria-label="Actualizar reservas">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Código, cliente, email, producto..."
          className="input min-h-11 pl-9 text-sm"
        />
      </div>

      {/* Status filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {[['', 'Todas'], ...Object.entries(statusConfig).map(([k, v]) => [k, v.label])].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={clsx('badge min-h-11 shrink-0 cursor-pointer px-4 py-1.5 text-xs transition-all',
              statusFilter === val ? 'badge-orange' : 'badge-gray'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {loadError && reservations.length === 0 ? (
        <div className="card"><ErrorState onRetry={load} /></div>
      ) : <div className="table-container">
        <table className="table min-w-[820px]">
          <thead>
            <tr>
              <th>Código</th>
              <th>Cliente</th>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Estado</th>
              <th>Expira</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => <tr key={i}><td colSpan={7}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>)
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-ink-400">Sin reservas</td></tr>
            ) : filtered.map(r => {
              const s = statusConfig[r.status] || { color: 'badge-gray', label: r.status }
              const expired = new Date(r.expires_at) < new Date()
              const flashing = flashedRows.has(r.id)
              return (
                <tr
                  key={r.id}
                  className={clsx(
                    'transition-all duration-500',
                    flashing && 'bg-brand-50'
                  )}
                >
                  <td><span className="font-mono text-xs font-bold text-brand-600">{r.reservation_code}</span></td>
                  <td>
                    <p className="font-medium text-ink-900 text-sm">{r.client_name}</p>
                    <p className="text-xs text-ink-400 break-all">{r.client_email}</p>
                  </td>
                  <td className="text-sm text-ink-700">
                    <p>{r.products?.name || '—'}</p>
                    {r.notes && (
                      <p className="text-xs text-brand-600 font-medium mt-0.5">{r.notes}</p>
                    )}
                  </td>
                  <td className="font-semibold">{r.quantity}</td>
                  <td>
                    <span className={clsx('badge transition-all duration-300', s.color)}>
                      {s.label}
                    </span>
                  </td>
                  <td>
                    <span className={clsx('text-xs', expired && r.status === 'pending' ? 'text-red-500 font-semibold' : 'text-ink-400')}>
                      {format(new Date(r.expires_at), 'd MMM HH:mm', { locale: es })}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => handleStatus(r.id, 'confirmed')}
                            disabled={isAnyUpdating(r.id)}
                            className="btn-ghost min-h-10 min-w-10 p-1.5 text-green-600 hover:bg-green-50"
                            title="Confirmar"
                            aria-label={`Confirmar reserva ${r.reservation_code}`}
                          >
                            {isUpdating(r.id, 'confirmed')
                              ? <Loader2 size={15} className="animate-spin" />
                              : <CheckCircle size={15} />
                            }
                          </button>
                          <button
                            onClick={() => handleStatus(r.id, 'cancelled')}
                            disabled={isAnyUpdating(r.id)}
                            className="btn-ghost min-h-10 min-w-10 p-1.5 text-red-500 hover:bg-red-50"
                            title="Cancelar"
                            aria-label={`Cancelar reserva ${r.reservation_code}`}
                          >
                            {isUpdating(r.id, 'cancelled')
                              ? <Loader2 size={15} className="animate-spin" />
                              : <XCircle size={15} />
                            }
                          </button>
                        </>
                      )}
                      {r.status === 'confirmed' && (
                        <button
                          onClick={() => handleStatus(r.id, 'completed')}
                          disabled={isAnyUpdating(r.id)}
                          className="btn-ghost min-h-10 min-w-10 p-1.5 text-brand-500 hover:bg-brand-50"
                          title="Marcar entregado"
                          aria-label={`Marcar reserva ${r.reservation_code} como entregada`}
                        >
                          {isUpdating(r.id, 'completed')
                            ? <Loader2 size={15} className="animate-spin" />
                            : <Package size={15} />
                          }
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>}
    </div>
  )
}
