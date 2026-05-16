/**
 * pages/public/ResetPasswordPage.jsx
 * Página para restablecer contraseña desde el link de Supabase.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import toast from 'react-hot-toast'
import { Eye, EyeOff, Loader2, KeyRound, CheckCircle2 } from 'lucide-react'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  // Detectar error en el hash (link expirado, etc.)
  useEffect(() => {
    const hash = window.location.hash
    if (hash.includes('error=')) {
      const params = new URLSearchParams(hash.replace('#', ''))
      const desc = params.get('error_description') || 'El enlace es inválido o expiró'
      setError(decodeURIComponent(desc.replace(/\+/g, ' ')))
    }
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) { toast.error('Las contraseñas no coinciden'); return }
    if (password.length < 6) { toast.error('Mínimo 6 caracteres'); return }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
      toast.success('Contraseña actualizada')
      setTimeout(() => navigate('/admin/login'), 2500)
    } catch (err) {
      toast.error(err.message || 'Error al actualizar contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <KeyRound size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-ink-900">Nueva contraseña</h1>
          <p className="text-ink-500 text-sm mt-1">Elige una contraseña segura para tu cuenta</p>
        </div>

        <div className="card p-6">

          {/* Error de link expirado */}
          {error && !done && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
              <p className="text-sm text-red-700 font-medium">⚠️ Enlace inválido</p>
              <p className="text-xs text-red-500 mt-1">{error}</p>
              <button
                onClick={() => navigate('/admin/login')}
                className="mt-3 text-xs text-brand-600 font-semibold hover:underline"
              >
                Solicitar un nuevo enlace →
              </button>
            </div>
          )}

          {/* Éxito */}
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 size={48} className="text-green-500 mx-auto mb-3" />
              <p className="font-semibold text-ink-900">¡Contraseña actualizada!</p>
              <p className="text-sm text-ink-500 mt-1">Redirigiendo al inicio de sesión...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                  Nueva contraseña
                </label>
                <div className="relative">
                  <input
                    type={show ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="input pr-10"
                    placeholder="Mínimo 6 caracteres"
                    required
                    disabled={!!error}
                  />
                  <button
                    type="button"
                    onClick={() => setShow(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                  Confirmar contraseña
                </label>
                <input
                  type={show ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="input"
                  placeholder="Repite la contraseña"
                  required
                  disabled={!!error}
                />
                {confirm && password !== confirm && (
                  <p className="text-xs text-red-500 mt-1">Las contraseñas no coinciden</p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading || !!error}
                className="btn-primary w-full justify-center mt-2"
              >
                {loading ? <Loader2 size={15} className="animate-spin" /> : <KeyRound size={15} />}
                Actualizar contraseña
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
