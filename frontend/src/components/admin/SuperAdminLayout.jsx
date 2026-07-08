/**
 * components/admin/SuperAdminLayout.jsx
 */
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useState } from 'react'
import { LayoutDashboard, Building2, LogOut, Shield, Menu, X } from 'lucide-react'
import clsx from 'clsx'
import LiveClock from '../shared/LiveClock'

const navItems = [
  { to: '/superadmin/companies', icon: Building2,      label: 'Empresas' },
  { to: '/superadmin/metrics',   icon: LayoutDashboard, label: 'Métricas Globales' },
]

export default function SuperAdminLayout() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = () => { logout(); navigate('/admin/login') }

  const Sidebar = () => (
    <div className="flex flex-col h-full bg-ink-900">
      <div className="px-5 py-5 border-b border-ink-700">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center">
            <Shield size={16} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-sm">Super Admin</p>
            <p className="text-xs text-ink-400">InventoryAI</p>
          </div>
        </div>
        <LiveClock dark className="mt-2" />
      </div>

      <nav className="flex-1 px-3 py-3 space-y-0.5">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => setSidebarOpen(false)}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'bg-brand-500 text-white'
                  : 'text-ink-300 hover:bg-ink-800 hover:text-white'
              )
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-ink-700">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-400 hover:bg-ink-800 hover:text-red-400 w-full transition-all"
        >
          <LogOut size={17} />
          Cerrar sesión
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-ink-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-64 h-full shadow-xl">
            <button
              onClick={() => setSidebarOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-ink-400 hover:bg-ink-800"
            >
              <X size={18} />
            </button>
            <Sidebar />
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 bg-ink-900 border-b border-ink-700">
          <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-lg text-ink-300 hover:bg-ink-800">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 bg-brand-500 rounded-md flex items-center justify-center shrink-0">
              <Shield size={13} className="text-white" />
            </div>
            <span className="font-bold text-white text-sm">Super Admin</span>
          </div>
          <LiveClock compact dark />
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
