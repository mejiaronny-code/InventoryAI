/**
 * components/admin/AdminLayout.jsx
 * Layout del panel de administración con sidebar naranja.
 */
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useState, useEffect, useRef } from 'react'
import { notificationsAPI, companiesAPI } from '../../services/api'
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications'
import ChatWidget from '../chat/ChatWidget'
import ThemeProvider from '../shared/ThemeProvider'
import LiveClock from '../shared/LiveClock'
import { CompanyFeaturesProvider } from '../../context/CompanyFeaturesContext'
import {
  LayoutDashboard, Package, Tag, Warehouse, BarChart3,
  CalendarCheck, Bell, Settings, Users, LogOut, Menu, X,
  Zap, AlertTriangle, Activity, Hash, ClipboardList,
  ShoppingCart, ClipboardCheck, FileBarChart, BookOpen,
  Armchair, CalendarClock
} from 'lucide-react'
import clsx from 'clsx'
import toast from 'react-hot-toast'

// Sonido corto de alerta (Web Audio — sin archivo).
// Los navegadores bloquean el audio hasta que el usuario interactúa con la
// página, así que usamos UN solo AudioContext compartido y lo "desbloqueamos"
// (resume) en el primer clic/tecla. Después suena confiable.
let _audioCtx = null
function _getAudioCtx() {
  if (!_audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (Ctx) _audioCtx = new Ctx()
  }
  return _audioCtx
}
if (typeof window !== 'undefined') {
  const _unlock = () => {
    const ctx = _getAudioCtx()
    if (ctx && ctx.state === 'suspended') ctx.resume()
    window.removeEventListener('click', _unlock)
    window.removeEventListener('keydown', _unlock)
  }
  window.addEventListener('click', _unlock)
  window.addEventListener('keydown', _unlock)
}
function playNotificationSound() {
  try {
    const ctx = _getAudioCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.setValueAtTime(0.0001, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    o.start()
    o.stop(ctx.currentTime + 0.37)
  } catch { /* navegador sin soporte de audio — se ignora */ }
}

// Notificación del sistema operativo (Nivel A): aparece aunque la pestaña del
// panel esté en segundo plano/minimizada (mientras siga abierta). Solo se
// muestra cuando la pestaña NO está al frente — si está visible, basta el toast.
function showSystemNotification(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (!document.hidden) return
    const n = new Notification(title, { body: body || '', tag: 'inventoryai-alert' })
    n.onclick = () => { try { window.focus() } catch { /* */ } n.close() }
  } catch { /* navegador sin soporte — se ignora */ }
}

const navItems = [
  { to: '/admin/dashboard',     icon: LayoutDashboard, label: 'Dashboard',        roles: ['admin','employee'] },
  { to: '/admin/products',      icon: Package,         label: 'Productos',         roles: ['admin','employee'] },
  { to: '/admin/categories',    icon: Tag,             label: 'Categorías',        roles: ['admin'] },
  { to: '/admin/warehouses',    icon: Warehouse,       label: 'Almacenes',         roles: ['admin'] },
  { to: '/admin/stock',         icon: BarChart3,       label: 'Stock',             roles: ['admin','employee'] },
  { to: '/admin/serials',       icon: Hash,            label: 'Nros. de serie',    roles: ['admin','employee'], feature: 'serial_numbers' },
  { to: '/admin/reservations',  icon: CalendarCheck,   label: 'Reservas',          roles: ['admin','employee'], hideAnyFeature: ['table_reservations','pickup_orders'] },
  { to: '/admin/bookings',      icon: CalendarClock,   label: 'Reservas',          roles: ['admin','employee'], anyFeature: ['table_reservations','pickup_orders'] },
  { to: '/admin/tables',        icon: Armchair,        label: 'Mesas',             roles: ['admin'], feature: 'table_reservations' },
  { to: '/admin/picking',       icon: ClipboardList,   label: 'Picking',           roles: ['admin','employee'] },
  { to: '/admin/reorder',       icon: ShoppingCart,    label: 'Reabastecimiento',  roles: ['admin'] },
  { to: '/admin/conteo',        icon: ClipboardCheck,  label: 'Conteo cíclico',    roles: ['admin','employee'] },
  { to: '/admin/reports',       icon: FileBarChart,    label: 'Reportes',          roles: ['admin'] },
  { to: '/admin/knowledge',     icon: BookOpen,        label: 'Base de conocimiento', roles: ['admin'] },
  { to: '/admin/notifications', icon: Bell,            label: 'Notificaciones',    roles: ['admin','employee'] },
  { to: '/admin/activity',      icon: Activity,        label: 'Actividad',         roles: ['admin','employee'] },
  { to: '/admin/employees',     icon: Users,           label: 'Empleados',         roles: ['admin'] },
  { to: '/admin/settings',      icon: Settings,        label: 'Configuración',     roles: ['admin'] },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [suspended, setSuspended] = useState(false)
  const [companyLogo, setCompanyLogo] = useState(null)
  const [companyName, setCompanyName] = useState('InventoryAI')
  const [companySlug, setCompanySlug] = useState(null)
  const [companySettings, setCompanySettings] = useState(null)
  const [companyFeatures, setCompanyFeatures] = useState(null)
  const [companyBusinessType, setCompanyBusinessType] = useState('general')
  const [companyCurrency, setCompanyCurrency] = useState('USD')

  const lastNotifIdRef = useRef(null)
  const notifInitRef = useRef(false)

  // Revisa notificaciones: actualiza el badge y, si hay una nueva, dispara
  // toast + sonido. Se llama por polling (cada 20s, red de seguridad si el
  // Realtime falla) y también desde el Realtime (instantáneo cuando funciona).
  // El dedup por id de la más reciente evita alertas dobles.
  const checkNotifications = async () => {
    try {
      const res = await notificationsAPI.list()
      const list = res.data || []
      setUnreadCount(list.filter(n => !n.read).length)
      if (list.length === 0) return
      const sorted = [...list].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      const newest = sorted[0]
      if (!notifInitRef.current) {
        // primera carga: no alertar de lo que ya existía
        lastNotifIdRef.current = newest.id
        notifInitRef.current = true
        return
      }
      if (newest.id !== lastNotifIdRef.current) {
        lastNotifIdRef.current = newest.id
        const icon = newest.type === 'low_stock' ? '⚠️'
          : newest.type === 'new_reservation' ? '🍽️'
          : newest.type === 'reservation_expired' ? '⌛'
          : '🔔'
        const title = newest.type === 'low_stock' ? '⚠️ Stock bajo'
          : newest.type === 'new_reservation' ? '🍽️ Nueva reserva'
          : newest.type === 'reservation_expired' ? '⌛ Reserva expirada'
          : '🔔 Notificación'
        toast(newest.message || 'Nueva notificación', { icon, duration: 6000 })
        playNotificationSound()
        showSystemNotification(title, newest.message || '')
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    // Pedir permiso para notificaciones del sistema (Nivel A)
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission()
      }
    } catch { /* navegador sin soporte — se ignora */ }
    checkNotifications()
    companiesAPI.getMe()
      .then(res => {
        if (res.data?.subscriptions?.status === 'suspended') setSuspended(true)
        if (res.data?.logo_url) setCompanyLogo(res.data.logo_url)
        if (res.data?.name) setCompanyName(res.data.name)
        if (res.data?.slug) setCompanySlug(res.data.slug)
        if (res.data?.settings) setCompanySettings(res.data.settings)
        if (res.data?.features) setCompanyFeatures(res.data.features)
        if (res.data?.business_type) setCompanyBusinessType(res.data.business_type)
        if (res.data?.settings?.currency) setCompanyCurrency(res.data.settings.currency)
      })
      .catch(() => {})
    // Polling de respaldo cada 20s (funciona aunque el Realtime no entregue)
    const interval = setInterval(checkNotifications, 20000)
    return () => clearInterval(interval)
  }, [])

  // Realtime: dispara una revisión inmediata (instantáneo cuando funciona)
  useRealtimeNotifications(user?.company_id, () => checkNotifications())

  const handleLogout = () => { logout(); navigate('/admin/login') }

  const filteredNav = navItems.filter(item => {
    if (!item.roles.includes(user?.role)) return false
    if (item.feature && companyFeatures && !companyFeatures[item.feature]) return false
    if (item.hideFeature && companyFeatures && companyFeatures[item.hideFeature]) return false
    if (item.anyFeature && companyFeatures && !item.anyFeature.some(f => companyFeatures[f])) return false
    if (item.hideAnyFeature && companyFeatures && item.hideAnyFeature.some(f => companyFeatures[f])) return false
    return true
  })

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-ink-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 flex items-center justify-center bg-brand-500 shadow-glow">
            {companyLogo
              ? <img src={companyLogo} alt="logo" className="w-full h-full object-contain" />
              : <Zap size={16} className="text-white" />
            }
          </div>
          <span className="font-bold text-ink-900 text-base tracking-tight truncate">{companyName}</span>
        </div>
      </div>

      {/* User info */}
      <div className="px-4 py-3 mx-3 mt-3 rounded-xl bg-ink-50 border border-ink-100">
        <p className="text-xs text-ink-500 font-medium">Conectado como</p>
        <p className="text-sm font-semibold text-ink-900 truncate">{user?.full_name || user?.email}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className={clsx('badge text-xs', user?.role === 'admin' ? 'badge-orange' : 'badge-gray')}>
            {user?.role === 'admin' ? 'Admin' : 'Empleado'}
          </span>
          <LiveClock compact />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
        {filteredNav.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              clsx('sidebar-link', isActive && 'sidebar-link-active')
            }
          >
            <Icon size={17} />
            <span className="flex-1">{label}</span>
            {label === 'Notificaciones' && unreadCount > 0 && (
              <span className="w-5 h-5 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Logout */}
      <div className="p-3 border-t border-ink-100">
        <button onClick={handleLogout} className="sidebar-link w-full text-red-500 hover:bg-red-50 hover:text-red-600">
          <LogOut size={17} />
          <span>Cerrar sesión</span>
        </button>
      </div>
    </div>
  )

  if (suspended) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink-950 text-white text-center px-6">
        <AlertTriangle size={48} className="text-brand-500 mb-6" />
        <h1 className="text-2xl font-extrabold mb-3">Cuenta pausada</h1>
        <p className="text-ink-300 text-base max-w-sm mb-8">
          Tu cuenta ha sido pausada. Contacta al administrador de la plataforma.
        </p>
        <button
          onClick={() => { logout(); navigate('/admin/login') }}
          className="btn-primary"
        >
          <LogOut size={16} />
          Cerrar sesión
        </button>
      </div>
    )
  }

  return (
    <CompanyFeaturesProvider features={companyFeatures} businessType={companyBusinessType} currency={companyCurrency}>
    <div className="flex h-screen bg-ink-50">
      <ThemeProvider settings={companySettings} />
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 bg-white border-r border-ink-100 shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-64 h-full bg-white shadow-xl">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-ink-100"
            >
              <X size={18} />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-ink-100">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg hover:bg-ink-100">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded-md overflow-hidden flex items-center justify-center bg-brand-500 shrink-0">
              {companyLogo
                ? <img src={companyLogo} alt="logo" className="w-full h-full object-contain" />
                : <Zap size={13} className="text-white" />
              }
            </div>
            <span className="font-bold text-ink-900 truncate max-w-[140px]">{companyName}</span>
          </div>
          <LiveClock compact />
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      {/* Chat IA — vista previa del catálogo */}
      {companySlug && (
        <>
          {/* Badge "Vista previa" posicionado encima del FAB del ChatWidget */}
          <div className="fixed bottom-[5.25rem] right-3 z-50 pointer-events-none">
            <span className="text-[10px] font-bold text-brand-600 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full shadow-sm">
              Vista previa
            </span>
          </div>
          <ChatWidget
            companySlug={companySlug}
            welcomeMessage={`[Admin] Estás viendo el chat tal como lo ven tus clientes en el catálogo de ${companyName}.`}
            companyLogo={companyLogo}
          />
        </>
      )}
    </div>
    </CompanyFeaturesProvider>
  )
}
