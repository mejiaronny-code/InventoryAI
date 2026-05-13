/**
 * pages/public/NotFoundPage.jsx
 */
import { useNavigate } from 'react-router-dom'
import { Zap, ArrowLeft } from 'lucide-react'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-ink-950 flex flex-col items-center justify-center text-center px-6">
      <div className="w-16 h-16 bg-brand-500/10 border border-brand-500/20 rounded-2xl flex items-center justify-center mb-6">
        <Zap size={28} className="text-brand-500" />
      </div>
      <p className="text-brand-500 text-sm font-semibold tracking-widest uppercase mb-3">404</p>
      <h1 className="text-4xl font-extrabold text-white mb-3">Página no encontrada</h1>
      <p className="text-ink-400 text-base max-w-sm mb-8">
        La dirección que buscas no existe o fue movida.
      </p>
      <button
        onClick={() => navigate('/')}
        className="btn-primary"
      >
        <ArrowLeft size={16} />
        Volver al inicio
      </button>
    </div>
  )
}
