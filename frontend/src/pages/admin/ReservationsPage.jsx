/**
 * pages/admin/ReservationsPage.jsx
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { reservationsAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { RefreshCw, CheckCircle, XCircle, Package, Clock, Search, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const statusConfig = {
  pending:   { color: 'badge-yellow', label: 'Pendiente'  },
  confirmed: { color: 'badge-green',  label: 'Confirmada' },
  completed: { color: 'badge-orange', label: 'Completada' },
  cancelled: { color: 'badge-red',    label: 'Cancelada'  },
  expired:   { color: 'badge-gray',   label: 'Expirada'   },
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  // { id, action } — qué botón muestra spinner
  const [updating, setUpdating] = useState(null)
  // Set de IDs que acaban de cambiar de estado (para la animación de fila)
  const [flashedRows, setFlashedRows] = useState(new Set())

  const load = useCallback(() => {
    setLoading(true)
    reservationsAPI.list(statusFilter ? { status: statusFilter } : {})
      .then(r => setReservations(r.data))
      .finally(() => setLoading(false))
  }, [statusFilter])

  useEffect(() => { load() }, [load])

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
    setUpdating({ id, action: newStatus })

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
    }
  }

  const handleExpireAll = async () => {
    await reservationsAPI.expireAll()
    toast.success('Reservas expiradas procesadas')
    load()
  }

  const isUpdating = (id, action) =>
    updating?.id === id && updating?.action === action

  const isAnyUpdating = (id) => updating?.id === id

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Reservas</h1>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleExpireAll} className="btn-ghost text-xs">
            <Clock size={14} /> Expirar vencidas
          </button>
          <button onClick={load} className="btn-ghost">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Código, cliente, email, producto..."
          className="input pl-9 text-sm"
        />
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {[['', 'Todas'], ...Object.entries(statusConfig).map(([k, v]) => [k, v.label])].map(([val, label]) => (
          <button
            key={val}
            onClick={() => setStatusFilter(val)}
            className={clsx('badge cursor-pointer px-3 py-1.5 text-xs transition-all',
              statusFilter === val ? 'badge-orange' : 'badge-gray'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="table-container">
        <table className="table">
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
                    <p className="text-xs text-ink-400">{r.client_email}</p>
                  </td>
                  <td className="text-sm text-ink-700">{r.products?.name || '—'}</td>
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
                            className="btn-ghost p-1.5 text-green-600 hover:bg-green-50"
                            title="Confirmar"
                          >
                            {isUpdating(r.id, 'confirmed')
                              ? <Loader2 size={15} className="animate-spin" />
                              : <CheckCircle size={15} />
                            }
                          </button>
                          <button
                            onClick={() => handleStatus(r.id, 'cancelled')}
                            disabled={isAnyUpdating(r.id)}
                            className="btn-ghost p-1.5 text-red-500 hover:bg-red-50"
                            title="Cancelar"
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
                          className="btn-ghost p-1.5 text-brand-500 hover:bg-brand-50"
                          title="Marcar entregado"
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
      </div>
    </div>
  )
}
