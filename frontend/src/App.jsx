/**
 * App.jsx
 * Router principal de la aplicación.
 */
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

// Public pages
import HomePage from './pages/public/HomePage'
import CompanyCatalogPage from './pages/public/CompanyCatalogPage'
import ReservationStatusPage from './pages/public/ReservationStatusPage'
import NotFoundPage from './pages/public/NotFoundPage'

// Admin pages
import LoginPage from './pages/admin/LoginPage'
import AdminLayout from './components/admin/AdminLayout'
import DashboardPage from './pages/admin/DashboardPage'
import ProductsPage from './pages/admin/ProductsPage'
import CategoriesPage from './pages/admin/CategoriesPage'
import WarehousesPage from './pages/admin/WarehousesPage'
import StockPage from './pages/admin/StockPage'
import ReservationsPage from './pages/admin/ReservationsPage'
import NotificationsPage from './pages/admin/NotificationsPage'
import SettingsPage from './pages/admin/SettingsPage'
import EmployeesPage from './pages/admin/EmployeesPage'

// Super Admin pages
import SuperAdminLayout from './components/admin/SuperAdminLayout'
import SuperAdminCompaniesPage from './pages/superadmin/CompaniesPage'
import SuperAdminMetricsPage from './pages/superadmin/MetricsPage'

function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!user) return <Navigate to="/admin/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/admin/dashboard" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/" element={<HomePage />} />
      <Route path="/:companySlug" element={<CompanyCatalogPage />} />
      <Route path="/reserva/:code" element={<ReservationStatusPage />} />

      {/* ── Auth ── */}
      <Route path="/admin/login" element={<LoginPage />} />

      {/* ── Admin / Employee ── */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['admin', 'employee']}>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="warehouses" element={<WarehousesPage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="reservations" element={<ReservationsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route
          path="employees"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <EmployeesPage />
            </ProtectedRoute>
          }
        />
      </Route>

      {/* ── Super Admin ── */}
      <Route
        path="/superadmin"
        element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <SuperAdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/superadmin/companies" replace />} />
        <Route path="companies" element={<SuperAdminCompaniesPage />} />
        <Route path="metrics" element={<SuperAdminMetricsPage />} />
      </Route>

      {/* ── 404 ── */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
