/**
 * pages/admin/ReservationsPage.jsx
 */
import { useState, useEffect, useMemo } from 'react'
import { reservationsAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { RefreshCw, CheckCircle, XCircle, Package, Clock, Search } from 'lucide-react'
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
  const [updating, setUpdating] = useState(null)

  const load = () => {
    setLoading(true)
    reservationsAPI.list(statusFilter ? { status: statusFilter } : {})
      .then(r => setReservations(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [statusFilter])

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
    setUpdating(id)
    try {
      await reservationsAPI.update(id, { status: newStatus })
      toast.success(`Reserva ${newStatus}`)
      load()
    } catch { toast.error('Error') } finally { setUpdating(null) }
  }

  const handleExpireAll = async () => {
    await reservationsAPI.expireAll()
    toast.success('Reservas expiradas procesadas')
    load()
  }

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
              return (
                <tr key={r.id}>
                  <td><span className="font-mono text-xs font-bold text-brand-600">{r.reservation_code}</span></td>
                  <td>
                    <p className="font-medium text-ink-900 text-sm">{r.client_name}</p>
                    <p className="text-xs text-ink-400">{r.client_email}</p>
                  </td>
                  <td className="text-sm text-ink-700">{r.products?.name || '—'}</td>
                  <td className="font-semibold">{r.quantity}</td>
                  <td><span className={`badge ${s.color}`}>{s.label}</span></td>
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
                            disabled={updating === r.id}
                            className="btn-ghost p-1.5 text-green-600 hover:bg-green-50"
                            title="Confirmar"
                          >
                            <CheckCircle size={15} />
                          </button>
                          <button
                            onClick={() => handleStatus(r.id, 'cancelled')}
                            disabled={updating === r.id}
                            className="btn-ghost p-1.5 text-red-500 hover:bg-red-50"
                            title="Cancelar"
                          >
                            <XCircle size={15} />
                          </button>
                        </>
                      )}
                      {r.status === 'confirmed' && (
                        <button
                          onClick={() => handleStatus(r.id, 'completed')}
                          disabled={updating === r.id}
                          className="btn-ghost p-1.5 text-brand-500 hover:bg-brand-50"
                          title="Marcar entregado"
                        >
                          <Package size={15} />
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
