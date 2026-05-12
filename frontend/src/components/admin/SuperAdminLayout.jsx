/**
 * components/admin/SuperAdminLayout.jsx
 */
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { LayoutDashboard, Building2, LogOut, Shield } from 'lucide-react'
import clsx from 'clsx'

export default function SuperAdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="flex h-screen bg-ink-50">
      <aside className="w-60 bg-ink-900 flex flex-col">
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
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {[
            { to: '/superadmin/companies', icon: Building2, label: 'Empresas' },
            { to: '/superadmin/metrics',   icon: LayoutDashboard, label: 'Métricas Globales' },
          ].map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
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
            onClick={() => { logout(); navigate('/admin/login') }}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-ink-400 hover:bg-ink-800 hover:text-red-400 w-full transition-all"
          >
            <LogOut size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  )
}
