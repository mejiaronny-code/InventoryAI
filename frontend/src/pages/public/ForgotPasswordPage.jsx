/**
 * pages/public/ForgotPasswordPage.jsx
 * Solicita el enlace de recuperación de contraseña.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { KeyRound, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'

export default function ForgotPasswordPage() {
  const [email, setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]     = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await authAPI.forgotPassword(email)
      setSent(true)
    } catch {
      // Siempre mostramos éxito por seguridad (no revelar si el email existe)
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <KeyRound size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-ink-900">Recuperar contraseña</h1>
          <p className="text-ink-500 text-sm mt-1">Te enviamos un enlace a tu correo</p>
        </div>

        <div className="card p-6">
          {sent ? (
            <div className="text-center py-4 space-y-3">
              <CheckCircle2 size={48} className="text-green-500 mx-auto" />
              <p className="font-semibold text-ink-900">¡Correo enviado!</p>
              <p className="text-sm text-ink-500">
                Si existe una cuenta con ese correo, recibirás un enlace para restablecer tu contraseña en los próximos minutos.
              </p>
              <Link to="/admin/login" className="btn-primary w-full justify-center mt-2 inline-flex">
                Volver al inicio de sesión
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                  Correo electrónico
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="input"
                  placeholder="admin@empresa.com"
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full justify-center"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Enviar enlace de recuperación
              </button>

              <Link
                to="/admin/login"
                className="flex items-center justify-center gap-1.5 text-sm text-ink-500 hover:text-ink-700 mt-2"
              >
                <ArrowLeft size={14} /> Volver al inicio de sesión
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
