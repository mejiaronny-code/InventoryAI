/**
 * App.jsx
 * Router principal de la aplicación.
 *
 * Code-splitting: las páginas de admin/superadmin se cargan con React.lazy
 * — un cliente que solo visita el catálogo público NUNCA descarga el bundle
 * del panel de administración (ProductsPage, ReportsPage, etc.) ni el de
 * super admin. Las páginas públicas se mantienen en el bundle principal
 * porque son la puerta de entrada más común (menos saltos de red).
 */
import { Suspense, lazy } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'

// Public pages — bundle principal (entrada más común, sin lazy)
import HomePage from './pages/public/HomePage'
import CompanyCatalogPage from './pages/public/CompanyCatalogPage'
import ReservationStatusPage from './pages/public/ReservationStatusPage'
import MyReservationsPage from './pages/public/MyReservationsPage'
import NotFoundPage from './pages/public/NotFoundPage'
import EmbedChatPage from './pages/public/EmbedChatPage'
import ResetPasswordPage from './pages/public/ResetPasswordPage'
import ForgotPasswordPage from './pages/public/ForgotPasswordPage'
import LoginPage from './pages/admin/LoginPage'

// Admin pages — lazy (solo se descargan al entrar a /admin)
const AdminLayout        = lazy(() => import('./components/admin/AdminLayout'))
const DashboardPage      = lazy(() => import('./pages/admin/DashboardPage'))
const ProductsPage       = lazy(() => import('./pages/admin/ProductsPage'))
const CategoriesPage     = lazy(() => import('./pages/admin/CategoriesPage'))
const WarehousesPage     = lazy(() => import('./pages/admin/WarehousesPage'))
const StockPage          = lazy(() => import('./pages/admin/StockPage'))
const ReservationsPage   = lazy(() => import('./pages/admin/ReservationsPage'))
const NotificationsPage  = lazy(() => import('./pages/admin/NotificationsPage'))
const SettingsPage       = lazy(() => import('./pages/admin/SettingsPage'))
const EmployeesPage      = lazy(() => import('./pages/admin/EmployeesPage'))
const ActivityPage       = lazy(() => import('./pages/admin/ActivityPage'))
const SerialsPage        = lazy(() => import('./pages/admin/SerialsPage'))
const PickingPage        = lazy(() => import('./pages/admin/PickingPage'))
const ReorderPage        = lazy(() => import('./pages/admin/ReorderPage'))
const ReconciliationPage = lazy(() => import('./pages/admin/ReconciliationPage'))
const ReportsPage        = lazy(() => import('./pages/admin/ReportsPage'))
const KnowledgeBasePage  = lazy(() => import('./pages/admin/KnowledgeBasePage'))
const TablesPage         = lazy(() => import('./pages/admin/TablesPage'))
const BookingsPage       = lazy(() => import('./pages/admin/BookingsPage'))

// Super Admin pages — lazy (solo se descargan al entrar a /superadmin)
const SuperAdminLayout        = lazy(() => import('./components/admin/SuperAdminLayout'))
const SuperAdminCompaniesPage = lazy(() => import('./pages/superadmin/CompaniesPage'))
const SuperAdminMetricsPage   = lazy(() => import('./pages/superadmin/MetricsPage'))

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/admin/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/admin/dashboard" replace />
  return children
}

function AppRoutes() {
  return (
    <Routes>
      {/* ── Public ── */}
      <Route path="/" element={<HomePage />} />
      {/* Chat embebible para sitios de terceros (iframe) — sin layout */}
      <Route path="/embed/:companySlug" element={<EmbedChatPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/:companySlug" element={<CompanyCatalogPage />} />
      <Route path="/:companySlug/mis-reservas" element={<MyReservationsPage />} />
      <Route path="/reserva/:code" element={<ReservationStatusPage />} />

      {/* ── Auth ── */}
      <Route path="/admin/login" element={<LoginPage />} />

      {/* ── Admin / Employee ── */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={['admin', 'employee']}>
            <Suspense fallback={<PageLoader />}>
              <AdminLayout />
            </Suspense>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><DashboardPage /></Suspense>} />
        <Route path="products" element={<Suspense fallback={<PageLoader />}><ProductsPage /></Suspense>} />
        <Route path="categories" element={<Suspense fallback={<PageLoader />}><CategoriesPage /></Suspense>} />
        <Route path="warehouses" element={<Suspense fallback={<PageLoader />}><WarehousesPage /></Suspense>} />
        <Route path="stock" element={<Suspense fallback={<PageLoader />}><StockPage /></Suspense>} />
        <Route path="reservations" element={<Suspense fallback={<PageLoader />}><ReservationsPage /></Suspense>} />
        <Route path="bookings" element={<Suspense fallback={<PageLoader />}><BookingsPage /></Suspense>} />
        <Route path="tables" element={<Suspense fallback={<PageLoader />}><TablesPage /></Suspense>} />
        <Route path="notifications" element={<Suspense fallback={<PageLoader />}><NotificationsPage /></Suspense>} />
        <Route path="activity" element={<Suspense fallback={<PageLoader />}><ActivityPage /></Suspense>} />
        <Route path="serials" element={<Suspense fallback={<PageLoader />}><SerialsPage /></Suspense>} />
        <Route path="picking" element={<Suspense fallback={<PageLoader />}><PickingPage /></Suspense>} />
        <Route path="reorder" element={<Suspense fallback={<PageLoader />}><ReorderPage /></Suspense>} />
        <Route path="conteo" element={<Suspense fallback={<PageLoader />}><ReconciliationPage /></Suspense>} />
        <Route path="reports" element={<Suspense fallback={<PageLoader />}><ReportsPage /></Suspense>} />
        <Route path="knowledge" element={<Suspense fallback={<PageLoader />}><KnowledgeBasePage /></Suspense>} />
        <Route path="settings" element={<Suspense fallback={<PageLoader />}><SettingsPage /></Suspense>} />
        <Route
          path="employees"
          element={
            <ProtectedRoute allowedRoles={['admin']}>
              <Suspense fallback={<PageLoader />}><EmployeesPage /></Suspense>
            </ProtectedRoute>
          }
        />
      </Route>

      {/* ── Super Admin ── */}
      <Route
        path="/superadmin"
        element={
          <ProtectedRoute allowedRoles={['super_admin']}>
            <Suspense fallback={<PageLoader />}>
              <SuperAdminLayout />
            </Suspense>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/superadmin/companies" replace />} />
        <Route path="companies" element={<Suspense fallback={<PageLoader />}><SuperAdminCompaniesPage /></Suspense>} />
        <Route path="metrics" element={<Suspense fallback={<PageLoader />}><SuperAdminMetricsPage /></Suspense>} />
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
