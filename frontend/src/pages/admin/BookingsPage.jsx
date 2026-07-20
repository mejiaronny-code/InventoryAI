/**
 * pages/admin/BookingsPage.jsx
 * Agenda de reservas de mesa / pedidos para recoger (sector restaurantes).
 */
import { useState, useEffect } from 'react'
import { bookingsAPI } from '../../services/api'
import { useCompanyFeatures } from '../../context/CompanyFeaturesContext'
import { useAuth } from '../../context/AuthContext'
import { useRealtimeTable } from '../../hooks/useRealtimeNotifications'
import toast from 'react-hot-toast'
import { CalendarClock, Users, MapPin, Utensils, ShoppingBag, Check, X, Loader2, Phone, Mail, Trash2 } from 'lucide-react'
import { format, parseISO, isToday, isTomorrow } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const STATUS_LABEL = {
  pending:   { label: 'Recibido',       cls: 'badge-yellow' },
  confirmed: { label: 'Aceptado',       cls: 'badge-green' },
  preparing: { label: 'En preparación', cls: 'badge-orange' },
  ready:     { label: 'Listo',          cls: 'badge-orange' },
  completed: { label: 'Entregado',      cls: 'badge-gray' },
  cancelled: { label: 'Cancelado',      cls: 'badge-red' },
  no_show:   { label: 'No llegó',       cls: 'badge-red' },
  seated:    { label: 'En mesa',        cls: 'badge-orange' },  // compatibilidad
}

// Flujo de estados del pedido: Recibido → Aceptado → En preparación → Listo → Entregado
function nextActions(b) {
  if (b.status === 'pending')   return [{ to: 'confirmed', label: 'Aceptar' }]
  if (b.status === 'confirmed') return [{ to: 'preparing', label: 'Preparar' }]
  if (b.status === 'preparing') return [{ to: 'ready', label: 'Marcar listo' }]
  if (b.status === 'ready')     return [{ to: 'completed', label: 'Entregar' }]
  if (b.status === 'seated')    return [{ to: 'completed', label: 'Entregar' }]  // reservas viejas
  return []
}

function dateGroupLabel(d) {
  if (isToday(d)) return 'Hoy'
  if (isTomorrow(d)) return 'Mañana'
  return format(d, "EEEE d 'de' MMMM", { locale: es })
}

export default function BookingsPage() {
  const { formatPrice } = useCompanyFeatures()
  const { user } = useAuth()
  const [bookings, setBookings] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('upcoming') // upcoming | all
  const [busy, setBusy] = useState(null)

  const load = () => {
    setLoading(true)
    bookingsAPI.list({ limit: 200 })
      .then(r => setBookings(r.data || []))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)  // respaldo por polling
    return () => clearInterval(interval)
  }, [])

  // Agenda en vivo: se actualiza sola cuando entra/cambia una reserva
  useRealtimeTable('bookings', user?.company_id, () => load())

  const cleanup = async () => {
    if (!window.confirm('¿Eliminar todas las reservas completadas, canceladas y no-show? Esta acción es permanente.')) return
    try {
      const r = await bookingsAPI.cleanup()
      toast.success(r.data?.message || 'Reservas limpiadas')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error al limpiar')
    }
  }

  const changeStatus = async (b, status) => {
    setBusy(b.id)
    try {
      await bookingsAPI.update(b.id, { status })
      toast.success(status === 'completed' ? 'Reserva completada — insumos descontados' : 'Estado actualizado')
      load()
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Error al actualizar')
    } finally { setBusy(null) }
  }

  // Filtrar y agrupar por fecha
  const visible = bookings.filter(b => {
    if (filter === 'all') return true
    return !['completed', 'cancelled', 'no_show'].includes(b.status)
  })

  const groups = visible.reduce((acc, b) => {
    const key = b.reserved_at.slice(0, 10)
    ;(acc[key] = acc[key] || []).push(b)
    return acc
  }, {})
  const sortedKeys = Object.keys(groups).sort()

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Reservas</h1>
        <div className="flex flex-wrap gap-2 items-center w-full sm:w-auto">
          {[{ v: 'upcoming', l: 'Próximas' }, { v: 'all', l: 'Todas' }].map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setFilter(v)}
              className={clsx('min-h-11 px-3 py-2 rounded-lg text-sm font-medium border transition-all flex-1 sm:flex-none',
                filter === v ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-600 border-ink-200 hover:border-brand-300')}
            >
              {l}
            </button>
          ))}
          {user?.role === 'admin' && (
            <button
              onClick={cleanup}
              title="Eliminar reservas completadas, canceladas y no-show"
              className="min-h-11 px-3 py-2 rounded-lg text-sm font-medium border border-ink-200 text-ink-500 hover:border-red-300 hover:text-red-600 transition-all flex items-center justify-center gap-1.5 w-full sm:w-auto"
            >
              <Trash2 size={14} /> Limpiar terminadas
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-ink-400 py-8 text-center">Cargando…</p>
      ) : sortedKeys.length === 0 ? (
        <div className="text-center py-16">
          <CalendarClock size={40} className="text-ink-300 mx-auto mb-3" />
          <p className="text-ink-500">No hay reservas {filter === 'upcoming' ? 'próximas' : ''}.</p>
        </div>
      ) : (
        sortedKeys.map(key => {
          const dayBookings = groups[key].sort((a, b) => a.reserved_at.localeCompare(b.reserved_at))
          const totalPeople = dayBookings
            .filter(b => b.service_type === 'dine_in' && !['cancelled', 'no_show'].includes(b.status))
            .reduce((s, b) => s + (b.party_size || 0), 0)
          return (
            <div key={key}>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm font-bold text-ink-700 capitalize">{dateGroupLabel(parseISO(key))}</p>
                {totalPeople > 0 && (
                  <span className="text-xs text-ink-400">· {totalPeople} personas en total</span>
                )}
              </div>
              <div className="space-y-2.5">
                {dayBookings.map(b => {
                  const st = STATUS_LABEL[b.status] || STATUS_LABEL.pending
                  const items = b.booking_items || []
                  const tableName = b.restaurant_tables?.name
                  return (
                    <div key={b.id} className="card p-4">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className="text-center shrink-0">
                            <p className="text-lg font-extrabold text-brand-600 leading-none">
                              {format(parseISO(b.reserved_at), 'HH:mm')}
                            </p>
                            <p className="text-[10px] text-ink-400 mt-0.5 flex items-center gap-0.5 justify-center">
                              {b.service_type === 'pickup'
                                ? <><ShoppingBag size={9} /> Recoger</>
                                : <><Utensils size={9} /> Mesa</>}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-ink-900 text-sm">{b.client_name}</p>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-500 mt-0.5">
                              {b.service_type === 'dine_in' && b.party_size && (
                                <span className="flex items-center gap-1"><Users size={11} /> {b.party_size}</span>
                              )}
                              {(tableName || b.zone) && (
                                <span className="flex items-center gap-1"><MapPin size={11} /> {tableName || b.zone}</span>
                              )}
                              {b.client_phone && (
                                <span className="flex items-center gap-1"><Phone size={11} /> {b.client_phone}</span>
                              )}
                              {b.client_email && (
                                <span className="flex items-center gap-1 break-all"><Mail size={11} className="shrink-0" /> {b.client_email}</span>
                              )}
                            </div>
                            <p className="text-[10px] text-ink-400 font-mono mt-1">Código: {b.code}</p>
                            {items.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {items.map((it, i) => (
                                  <span key={i} className="px-1.5 py-0.5 bg-brand-50 text-brand-600 rounded text-[10px] font-medium border border-brand-100">
                                    {it.quantity}× {it.products?.name || 'platillo'}
                                  </span>
                                ))}
                              </div>
                            )}
                            {b.notes && <p className="text-xs text-ink-400 mt-1 italic">"{b.notes}"</p>}
                          </div>
                        </div>
                        <div className="flex flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto">
                          <span className={clsx('badge text-xs', st.cls)}>{st.label}</span>
                          <div className="flex flex-wrap gap-1.5">
                            {nextActions(b).map(a => (
                              <button
                                key={a.to}
                                onClick={() => changeStatus(b, a.to)}
                                disabled={busy === b.id}
                                className="min-h-10 px-3 py-1 rounded-lg text-xs font-semibold bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50 flex-1 sm:flex-none"
                              >
                                {busy === b.id ? <Loader2 size={12} className="animate-spin" /> : a.label}
                              </button>
                            ))}
                            {!['completed', 'cancelled', 'no_show'].includes(b.status) && (
                              <button
                                onClick={() => changeStatus(b, 'cancelled')}
                                disabled={busy === b.id}
                                title="Cancelar"
                                className="w-10 h-10 rounded-lg text-xs font-semibold bg-ink-100 text-ink-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 inline-flex items-center justify-center"
                                aria-label="Cancelar reserva"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
