/**
 * pages/admin/LoginPage.jsx
 */
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { Zap, Eye, EyeOff, LogIn } from 'lucide-react'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const user = await login(form.email, form.password)
      if (user.role === 'super_admin') navigate('/superadmin/companies')
      else navigate('/admin/dashboard')
    } catch (err) {
      setError(err.response?.data?.detail || 'Credenciales inválidas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-950 flex items-center justify-center px-6">
      <div className="absolute inset-0 bg-pattern opacity-20" />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex w-14 h-14 bg-brand-500 rounded-2xl items-center justify-center mb-4 shadow-glow-lg">
            <Zap size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">InventoryAI</h1>
          <p className="text-ink-400 text-sm mt-1">Panel de administración</p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-bold text-ink-900 mb-6">Iniciar sesión</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="admin@empresa.com"
                className="input"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide">
                  Contraseña
                </label>
                <Link to="/forgot-password" className="text-xs text-brand-500 hover:text-brand-600 font-medium">
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="input pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center py-3 mt-2"
            >
              <LogIn size={16} />
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p className="text-center text-ink-600 text-xs mt-6">
          ¿Eres cliente?{' '}
          <a href="/" className="text-brand-400 hover:text-brand-300 font-medium">
            Ver catálogo público
          </a>
        </p>
      </div>
    </div>
  )
}
