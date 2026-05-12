/**
 * pages/admin/DashboardPage.jsx
 */
import { useState, useEffect } from 'react'
import { dashboardAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import {
  Package, CalendarCheck, AlertTriangle, DollarSign,
  TrendingUp, Bell, ArrowRight, RefreshCw
} from 'lucide-react'
import { format } from 'date-fns'
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
        accent ? 'bg-brand-500 text-white shadow-glow' : 'bg-ink-100 text-ink-500'
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
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    dashboardAPI.getMetrics()
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="text-ink-500 text-sm mt-0.5">
            Bienvenido, <span className="font-semibold text-ink-700">{user?.full_name || user?.email}</span>
          </p>
        </div>
        <button onClick={load} className="btn-ghost" disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Package}      label="Productos activos"   value={data.total_products}     sub={`${data.total_stock} en stock`} />
            <StatCard icon={CalendarCheck} label="Reservas activas"   value={data.active_reservations} sub={`${data.monthly_reservations} este mes`} accent />
            <StatCard icon={AlertTriangle} label="Stock bajo mínimo"  value={data.low_stock_products}  sub="requieren atención" />
            <StatCard icon={DollarSign}    label="Costo IA (mes)"     value={`$${data.monthly_ai_cost.toFixed(4)}`} sub="USD · LangSmith" />
          </div>

          {/* Tables row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent reservations */}
            <div className="card">
              <div className="p-5 border-b border-ink-100 flex items-center justify-between">
                <h2 className="section-title flex items-center gap-2">
                  <CalendarCheck size={17} className="text-brand-500" />
                  Reservas recientes
                </h2>
                <a href="/admin/reservations" className="text-xs text-brand-500 font-semibold hover:text-brand-600 flex items-center gap-1">
                  Ver todas <ArrowRight size={12} />
                </a>
              </div>
              <div className="divide-y divide-ink-50">
                {data.recent_reservations.length === 0 ? (
                  <p className="text-center text-ink-400 text-sm py-8">Sin reservas</p>
                ) : data.recent_reservations.map(r => (
                  <div key={r.id} className="px-5 py-3.5 flex items-center gap-3">
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
              <div className="p-5 border-b border-ink-100 flex items-center justify-between">
                <h2 className="section-title flex items-center gap-2">
                  <Bell size={17} className="text-brand-500" />
                  Notificaciones
                </h2>
                <a href="/admin/notifications" className="text-xs text-brand-500 font-semibold hover:text-brand-600 flex items-center gap-1">
                  Ver todas <ArrowRight size={12} />
                </a>
              </div>
              <div className="divide-y divide-ink-50">
                {data.recent_notifications.length === 0 ? (
                  <p className="text-center text-ink-400 text-sm py-8">Sin notificaciones</p>
                ) : data.recent_notifications.map(n => (
                  <div key={n.id} className="px-5 py-3.5">
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
