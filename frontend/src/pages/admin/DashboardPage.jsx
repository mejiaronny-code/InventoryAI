/**
 * pages/admin/DashboardPage.jsx
 */
import { useState, useEffect } from 'react'
import { dashboardAPI, stockAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useCompanyFeatures } from '../../context/CompanyFeaturesContext'
import { useRealtimeNotifications, useRealtimeTable } from '../../hooks/useRealtimeNotifications'
import {
  Package, CalendarCheck, AlertTriangle,
  Bell, ArrowRight, RefreshCw, CalendarX2
} from 'lucide-react'
import { format, parseISO, differenceInDays } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const statusColor = {
  pending:   'badge-yellow',
  confirmed: 'badge-green',
  completed: 'badge-orange',
  cancelled: 'badge-red',
  expired:   'badge-gray',
}

function StatCard({ icon: Icon, label, value, sub, accent = false }) {
  return (
    <div className={clsx('stat-card', accent && 'border-brand-200 bg-gradient-to-br from-brand-50 to-white')}>
      <div className={clsx(
        'w-10 h-10 rounded-xl flex items-center justify-center mb-3',
        accent ? 'bg-brand-500 text-[var(--brand-contrast)] shadow-glow' : 'bg-ink-100 text-ink-500'
      )}>
        <Icon size={20} />
      </div>
      <p className="text-xs text-ink-500 font-medium">{label}</p>
      <p className={clsx('text-2xl font-extrabold', accent ? 'text-brand-600' : 'text-ink-900')}>{value}</p>
      {sub && <p className="text-xs text-ink-400">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const { user } = useAuth()
  const { hasFeature } = useCompanyFeatures()
  const [data, setData] = useState(null)
  const [expiring, setExpiring] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    const calls = [dashboardAPI.getMetrics()]
    if (hasFeature('expiration_dates')) calls.push(stockAPI.getExpiring(30))
    Promise.all(calls)
      .then(([metrics, exp]) => {
        setData(metrics.data)
        if (exp) setExpiring(exp.data || [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)  // respaldo por polling
    return () => clearInterval(interval)
  }, [])

  // Refrescar el dashboard en vivo cuando entra una notificación o reserva nueva
  useRealtimeNotifications(user?.company_id, () => load())
  useRealtimeTable('bookings', user?.company_id, () => load())

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">Dashboard</h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Bienvenido, <span className="font-semibold text-ink-700 break-all">{user?.full_name || user?.email}</span>
          </p>
        </div>
        <button onClick={load} className="btn-ghost min-h-11 w-full sm:w-auto" disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="stat-card animate-pulse">
              <div className="w-10 h-10 bg-ink-100 rounded-xl mb-3" />
              <div className="h-3 bg-ink-100 rounded w-2/3 mb-2" />
              <div className="h-7 bg-ink-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Package}       label="Productos activos"   value={data.total_products}      sub={`${data.total_stock} en stock`} />
            <StatCard icon={CalendarCheck} label="Reservas activas"    value={data.active_reservations} sub={`${data.monthly_reservations} este mes`} accent />
            <StatCard icon={AlertTriangle} label="Stock bajo mínimo"   value={data.low_stock_products}  sub="requieren atención" />
            {hasFeature('expiration_dates') && (
              <StatCard icon={CalendarX2} label="Por vencer (30d)" value={data.expiring_soon ?? 0} sub="próximos 30 días" />
            )}
          </div>

          {/* Widget: Productos por vencer */}
          {hasFeature('expiration_dates') && expiring.length > 0 && (
            <div className="card border-yellow-200 bg-yellow-50/40">
              <div className="p-4 sm:p-5 border-b border-yellow-100 flex items-start sm:items-center gap-2">
                <CalendarX2 size={17} className="text-yellow-500" />
                <h2 className="section-title text-yellow-700">Productos por vencer (próximos 30 días)</h2>
              </div>
              <div className="divide-y divide-yellow-100">
                {expiring.map((item, i) => {
                  const daysLeft = item.days_left
                  const urgent = daysLeft <= 3
                  const warn = daysLeft <= 7
                  return (
                    <div key={i} className="px-4 sm:px-5 py-3 grid grid-cols-[auto_minmax(0,1fr)] sm:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                      <div className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0',
                        urgent ? 'bg-red-100 text-red-600' : warn ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'
                      )}>
                        {daysLeft}d
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-ink-900 text-sm truncate">{item.product_name}</p>
                        <p className="text-xs text-ink-400">{item.warehouse_name} · {item.quantity} {item.unit}</p>
                      </div>
                      <span className="col-start-2 sm:col-start-auto text-xs text-ink-500 sm:text-right">
                        {format(parseISO(item.nearest_expiry), 'd MMM yyyy', { locale: es })}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tables row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent reservations */}
            <div className="card">
              <div className="p-4 sm:p-5 border-b border-ink-100 flex items-center justify-between gap-3">
                <h2 className="section-title flex items-center gap-2">
                  <CalendarCheck size={17} className="text-brand-500" />
                  Reservas recientes
                </h2>
                <a
                  href={(hasFeature('table_reservations') || hasFeature('pickup_orders')) ? '/admin/bookings' : '/admin/reservations'}
                  className="min-h-11 -my-2 px-2 text-xs text-brand-500 font-semibold hover:text-brand-600 flex items-center gap-1 shrink-0"
                >
                  Ver todas <ArrowRight size={12} />
                </a>
              </div>
              <div className="divide-y divide-ink-50">
                {data.recent_reservations.length === 0 ? (
                  <p className="text-center text-ink-400 text-sm py-8">Sin reservas</p>
                ) : data.recent_reservations.map(r => (
                  <div key={r.reservation_code || r.id} className="px-4 sm:px-5 py-3.5 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink-900 text-sm truncate">
                        {r.client_name}
                      </p>
                      <p className="text-xs text-ink-400 truncate">
                        {r.products?.name} · {r.reservation_code}
                      </p>
                    </div>
                    <span className={clsx('badge shrink-0', statusColor[r.status] || 'badge-gray')}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Notifications */}
            <div className="card">
              <div className="p-4 sm:p-5 border-b border-ink-100 flex items-center justify-between gap-3">
                <h2 className="section-title flex items-center gap-2">
                  <Bell size={17} className="text-brand-500" />
                  Notificaciones
                </h2>
                <a href="/admin/notifications" className="min-h-11 -my-2 px-2 text-xs text-brand-500 font-semibold hover:text-brand-600 flex items-center gap-1 shrink-0">
                  Ver todas <ArrowRight size={12} />
                </a>
              </div>
              <div className="divide-y divide-ink-50">
                {data.recent_notifications.length === 0 ? (
                  <p className="text-center text-ink-400 text-sm py-8">Sin notificaciones</p>
                ) : data.recent_notifications.map(n => (
                  <div key={n.id} className="px-4 sm:px-5 py-3.5">
                    <p className="text-sm text-ink-800">{n.message}</p>
                    <p className="text-xs text-ink-400 mt-0.5">
                      {format(new Date(n.created_at), "d MMM · HH:mm", { locale: es })}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
