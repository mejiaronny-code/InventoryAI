/**
 * components/admin/AdminLayout.jsx
 * Layout del panel de administración con sidebar naranja.
 */
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useState, useEffect } from 'react'
import { notificationsAPI } from '../../services/api'
import { useRealtimeNotifications } from '../../hooks/useRealtimeNotifications'
import {
  LayoutDashboard, Package, Tag, Warehouse, BarChart3,
  CalendarCheck, Bell, Settings, Users, LogOut, Menu, X,
  Zap, ChevronRight
} from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { to: '/admin/dashboard',     icon: LayoutDashboard, label: 'Dashboard',      roles: ['admin','employee'] },
  { to: '/admin/products',      icon: Package,         label: 'Productos',       roles: ['admin','employee'] },
  { to: '/admin/categories',    icon: Tag,             label: 'Categorías',      roles: ['admin'] },
  { to: '/admin/warehouses',    icon: Warehouse,       label: 'Almacenes',       roles: ['admin'] },
  { to: '/admin/stock',         icon: BarChart3,       label: 'Stock',           roles: ['admin','employee'] },
  { to: '/admin/reservations',  icon: CalendarCheck,   label: 'Reservas',        roles: ['admin','employee'] },
  { to: '/admin/notifications', icon: Bell,            label: 'Notificaciones',  roles: ['admin','employee'] },
  { to: '/admin/employees',     icon: Users,           label: 'Empleados',       roles: ['admin'] },
  { to: '/admin/settings',      icon: Settings,        label: 'Configuración',   roles: ['admin'] },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    notificationsAPI.list()
      .then(res => setUnreadCount(res.data.filter(n => !n.read).length))
      .catch(() => {})
  }, [])

  // Notificaciones en tiempo real via Supabase Realtime
  useRealtimeNotifications(user?.company_id, () => {
    setUnreadCount(c => c + 1)
  })

  const handleLogout = () => { logout(); navigate('/admin/login') }

  const filteredNav = navItems.filter(item => item.roles.includes(user?.role))

  const Sidebar = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-ink-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shadow-glow">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-bold text-ink-900 text-lg tracking-tight">InventoryAI</span>
        </div>
      </div>

      {/* User info */}
      <div className="px-4 py-3 mx-3 mt-3 rounded-xl bg-ink-50 border border-ink-100">
        <p className="text-xs text-ink-500 font-medium">Conectado como</p>
        <p className="text-sm font-semibold text-ink-900 truncate">{user?.full_name || user?.email}</p>
        <span className={clsx('badge text-xs mt-0.5', user?.role === 'admin' ? 'badge-orange' : 'badge-gray')}>
          {user?.role === 'admin' ? 'Admin' : 'Empleado'}
        </span>
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

  return (
    <div className="flex h-screen bg-ink-50">
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
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-brand-500 rounded-md flex items-center justify-center">
              <Zap size={13} className="text-white" />
            </div>
            <span className="font-bold text-ink-900">InventoryAI</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
