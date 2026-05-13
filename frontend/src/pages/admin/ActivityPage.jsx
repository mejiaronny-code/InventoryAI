/**
 * pages/admin/ActivityPage.jsx
 * Log de actividad de la empresa: movimientos de stock y eventos del sistema.
 */
import { useState, useEffect } from 'react'
import { dashboardAPI } from '../../services/api'
import { format, isToday, isYesterday } from 'date-fns'
import { es } from 'date-fns/locale'
import {
  ArrowUp, ArrowDown, RefreshCw, BarChart3,
  CalendarCheck, AlertTriangle, Bell, Zap,
  Clock, Filter
} from 'lucide-react'
import clsx from 'clsx'

// Config por tipo de actividad
const typeConfig = {
  // Stock movements
  entrada:       { icon: ArrowUp,       color: 'text-green-600 bg-green-50',   label: 'Entrada'        },
  salida:        { icon: ArrowDown,     color: 'text-red-500 bg-red-50',       label: 'Salida'         },
  ajuste:        { icon: BarChart3,     color: 'text-ink-500 bg-ink-100',      label: 'Ajuste'         },
  transferencia: { icon: RefreshCw,     color: 'text-brand-500 bg-brand-50',   label: 'Transferencia'  },
  // Event types
  new_reservation:     { icon: CalendarCheck,  color: 'text-brand-500 bg-brand-50',   label: 'Reserva'        },
  reservation_expired: { icon: Clock,          color: 'text-yellow-600 bg-yellow-50', label: 'Expiración'     },
  low_stock:           { icon: AlertTriangle,  color: 'text-orange-500 bg-orange-50', label: 'Stock bajo'     },
  stock_out:           { icon: AlertTriangle,  color: 'text-red-500 bg-red-50',       label: 'Sin stock'      },
  system:              { icon: Zap,            color: 'text-ink-500 bg-ink-100',      label: 'Sistema'        },
}

const categoryLabel = {
  stock: 'Stock',
  event: 'Evento',
}

const categoryColor = {
  stock: 'badge-orange',
  event: 'badge-gray',
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  if (isToday(d)) return `Hoy, ${format(d, 'HH:mm')}`
  if (isYesterday(d)) return `Ayer, ${format(d, 'HH:mm')}`
  return format(d, "d 'de' MMM, HH:mm", { locale: es })
}

function groupByDay(items) {
  const groups = {}
  for (const item of items) {
    const d = new Date(item.created_at)
    const key = isToday(d) ? 'Hoy' : isYesterday(d) ? 'Ayer' : format(d, "d 'de' MMMM yyyy", { locale: es })
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
  }
  return groups
}

export default function ActivityPage() {
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | 'stock' | 'event'

  const load = () => {
    setLoading(true)
    dashboardAPI.getActivity(150)
      .then(r => setActivities(r.data))
      .catch(() => setActivities([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = filter === 'all'
    ? activities
    : activities.filter(a => a.category === filter)

  const groups = groupByDay(filtered)

  return (
    <div className="space-y-5 animate-fade-in max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Actividad</h1>
        <button onClick={load} className="btn-ghost">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2">
        <Filter size={14} className="text-ink-400" />
        {[
          { key: 'all',   label: 'Todo' },
          { key: 'stock', label: 'Stock' },
          { key: 'event', label: 'Eventos' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={clsx(
              'badge cursor-pointer px-3 py-1.5 text-xs transition-all',
              filter === key ? 'badge-orange' : 'badge-gray'
            )}
          >
            {label}
          </button>
        ))}
        {activities.length > 0 && (
          <span className="text-xs text-ink-400 ml-auto">{filtered.length} registros</span>
        )}
      </div>

      {/* Log */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-start gap-3 animate-pulse">
              <div className="w-8 h-8 rounded-xl bg-ink-100 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-ink-100 rounded w-2/3" />
                <div className="h-3 bg-ink-100 rounded w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <BarChart3 size={40} className="text-ink-200 mx-auto mb-3" />
          <p className="text-ink-500">Sin actividad registrada</p>
          <p className="text-xs text-ink-400 mt-1">Los movimientos de stock y eventos aparecerán aquí</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([day, items]) => (
            <div key={day}>
              {/* Separador de día */}
              <div className="flex items-center gap-3 mb-3">
                <span className="text-xs font-bold text-ink-500 uppercase tracking-wide">{day}</span>
                <div className="flex-1 h-px bg-ink-100" />
              </div>

              {/* Items del día */}
              <div className="space-y-1">
                {items.map((item) => {
                  const cfg = typeConfig[item.type] || typeConfig.system
                  const Icon = cfg.icon
                  return (
                    <div
                      key={item.id}
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-ink-50 transition-colors group"
                    >
                      {/* Icono */}
                      <div className={clsx('w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5', cfg.color)}>
                        <Icon size={14} />
                      </div>

                      {/* Contenido */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink-800 leading-snug">{item.message}</p>
                        {item.notes && (
                          <p className="text-xs text-ink-400 mt-0.5 truncate">{item.notes}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className={clsx('badge text-xs', categoryColor[item.category])}>
                            {categoryLabel[item.category]}
                          </span>
                          <span className="text-xs text-ink-400">
                            {format(new Date(item.created_at), 'HH:mm')}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
