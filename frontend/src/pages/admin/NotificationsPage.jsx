/**
 * pages/admin/NotificationsPage.jsx
 */
import { useState, useEffect } from 'react'
import { notificationsAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useRealtimeInserts } from '../../hooks/useRealtimeInserts'
import toast from 'react-hot-toast'
import { Bell, CheckCheck, Package, AlertTriangle, CalendarCheck, Zap, Trash2, X } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const typeIcon = {
  new_reservation: CalendarCheck,
  reservation_expired: Bell,
  low_stock: AlertTriangle,
  stock_out: Package,
  system: Zap,
}

const typeColor = {
  new_reservation: 'text-brand-500 bg-brand-50',
  reservation_expired: 'text-yellow-500 bg-yellow-50',
  low_stock: 'text-orange-500 bg-orange-50',
  stock_out: 'text-red-500 bg-red-50',
  system: 'text-ink-500 bg-ink-100',
}

export default function NotificationsPage() {
  const { user } = useAuth()
  const [notifs, setNotifs] = useState([])
  const [loading, setLoading] = useState(true)
  const [deletingRead, setDeletingRead] = useState(false)

  const load = () => notificationsAPI.list().then(r => setNotifs(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  // Realtime: prepend nuevas notificaciones sin recargar
  useRealtimeInserts({
    companyId: user?.company_id,
    table: 'notifications',
    onEvent: (newNotif) => {
      setNotifs(prev => {
        // Evitar duplicados (puede llegar dos veces en dev con StrictMode)
        if (prev.some(n => n.id === newNotif.id)) return prev
        return [newNotif, ...prev]
      })
    },
  })

  const markRead = async (id) => {
    await notificationsAPI.markRead(id)
    setNotifs(n => n.map(x => x.id === id ? { ...x, read: true } : x))
  }

  const markAll = async () => {
    await notificationsAPI.markAllRead()
    setNotifs(n => n.map(x => ({ ...x, read: true })))
    toast.success('Todas marcadas como leídas')
  }

  const deleteOne = async (e, id) => {
    e.stopPropagation()
    await notificationsAPI.deleteOne(id)
    setNotifs(n => n.filter(x => x.id !== id))
  }

  const deleteRead = async () => {
    const readCount = notifs.filter(n => n.read).length
    if (readCount === 0) { toast('No hay notificaciones leídas', { icon: '💬' }); return }
    setDeletingRead(true)
    try {
      await notificationsAPI.deleteRead()
      setNotifs(n => n.filter(x => !x.read))
      toast.success(`${readCount} notificación${readCount > 1 ? 'es eliminadas' : ' eliminada'}`)
    } catch { toast.error('Error al eliminar') } finally { setDeletingRead(false) }
  }

  const unread = notifs.filter(n => !n.read).length
  const readCount = notifs.filter(n => n.read).length

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Notificaciones</h1>
          {unread > 0 && <p className="text-sm text-ink-500 mt-0.5">{unread} sin leer</p>}
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {unread > 0 && (
            <button onClick={markAll} className="btn-secondary text-sm flex-1 sm:flex-none justify-center">
              <CheckCheck size={15} /> Marcar todas leídas
            </button>
          )}
          {readCount > 0 && (
            <button
              onClick={deleteRead}
              disabled={deletingRead}
              className="btn-danger text-sm flex-1 sm:flex-none justify-center"
            >
              <Trash2 size={15} />
              {deletingRead ? 'Eliminando...' : `Eliminar leídas (${readCount})`}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => <div key={i} className="card p-4 animate-pulse h-16" />)}
        </div>
      ) : notifs.length === 0 ? (
        <div className="text-center py-20">
          <Bell size={40} className="text-ink-200 mx-auto mb-3" />
          <p className="text-ink-500">Sin notificaciones</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifs.map(n => {
            const Icon = typeIcon[n.type] || Bell
            const colors = typeColor[n.type] || typeColor.system
            return (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                onKeyDown={(event) => {
                  if (event.target === event.currentTarget && !n.read && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    markRead(n.id)
                  }
                }}
                role={!n.read ? 'button' : undefined}
                tabIndex={!n.read ? 0 : undefined}
                aria-label={!n.read ? `Marcar como leída: ${n.message}` : undefined}
                className={clsx(
                  'card p-4 flex items-start gap-4 transition-all group',
                  !n.read && 'border-brand-200 bg-brand-50/30 hover:bg-brand-50 cursor-pointer',
                  n.read && 'opacity-60'
                )}
              >
                <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', colors)}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={clsx('text-sm', !n.read ? 'font-semibold text-ink-900' : 'text-ink-600')}>
                    {n.message}
                  </p>
                  <p className="text-xs text-ink-400 mt-1">
                    {format(new Date(n.created_at), "d 'de' MMM, HH:mm", { locale: es })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!n.read && <div className="w-2 h-2 rounded-full bg-brand-500 mt-1" />}
                  <button
                    onClick={(e) => deleteOne(e, n.id)}
                    className="w-10 h-10 rounded-lg text-ink-300 hover:text-red-500 hover:bg-red-50 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-all inline-flex items-center justify-center"
                    title="Eliminar"
                    aria-label="Eliminar notificación"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
