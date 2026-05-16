/**
 * pages/public/MyReservationsPage.jsx
 * Historial público de reservas de un cliente por email.
 * Sin login — solo necesita su email y el slug de la empresa.
 */
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { reservationsAPI } from '../../services/api'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, Mail, Search, Package, Clock, Loader2 } from 'lucide-react'
import clsx from 'clsx'

const statusConfig = {
  pending:   { color: 'badge-yellow', label: 'Pendiente'  },
  confirmed: { color: 'badge-green',  label: 'Confirmada' },
  completed: { color: 'badge-orange', label: 'Completada' },
  cancelled: { color: 'badge-red',    label: 'Cancelada'  },
  expired:   { color: 'badge-gray',   label: 'Expirada'   },
}

export default function MyReservationsPage() {
  const { companySlug } = useParams()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [reservations, setReservations] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async (e) => {
    e.preventDefault()
    if (!email.trim() || !email.includes('@')) {
      setError('Ingresa un email válido')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await reservationsAPI.getByEmail(companySlug, email.trim())
      setReservations(res.data)
    } catch {
      setError('No pudimos consultar tus reservas. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header */}
      <header className="bg-white border-b border-ink-100 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button onClick={() => navigate(`/${companySlug}`)} className="btn-ghost p-2">
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className="font-bold text-ink-900">Mis Reservas</h1>
            <p className="text-xs text-ink-400">Consulta el estado de tus reservas</p>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Formulario de búsqueda */}
        <div className="card p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
              <Mail size={20} className="text-brand-500" />
            </div>
            <div>
              <h2 className="font-semibold text-ink-900">Buscar por email</h2>
              <p className="text-xs text-ink-400">Usa el mismo email con el que hiciste la reserva</p>
            </div>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tucorreo@ejemplo.com"
              className="input flex-1"
              autoComplete="email"
            />
            <button
              type="submit"
              disabled={loading}
              className="btn-primary shrink-0"
            >
              {loading
                ? <Loader2 size={16} className="animate-spin" />
                : <Search size={16} />
              }
              Buscar
            </button>
          </form>
          {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
        </div>

        {/* Resultados */}
        {reservations !== null && (
          reservations.length === 0 ? (
            <div className="text-center py-16">
              <Package size={48} className="text-ink-200 mx-auto mb-3" />
              <p className="text-ink-500 font-medium">No encontramos reservas</p>
              <p className="text-ink-400 text-sm mt-1">
                Verifica que el email sea el mismo que usaste al reservar
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-500 font-medium">
                {reservations.length} reserva{reservations.length > 1 ? 's' : ''} encontrada{reservations.length > 1 ? 's' : ''}
              </p>
              {reservations.map(r => {
                const s = statusConfig[r.status] || { color: 'badge-gray', label: r.status }
                const expired = r.status === 'pending' && new Date(r.expires_at) < new Date()
                return (
                  <div key={r.id} className="card p-5 space-y-3">
                    {/* Header de la reserva */}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="font-mono font-bold text-brand-600 text-sm">
                          {r.reservation_code}
                        </span>
                        <p className="text-ink-900 font-semibold mt-0.5">
                          {r.products?.name || '—'}
                        </p>
                        <p className="text-ink-400 text-xs">
                          {r.warehouses?.name || '—'}
                        </p>
                      </div>
                      <span className={clsx('badge shrink-0', s.color)}>{s.label}</span>
                    </div>

                    {/* Detalles */}
                    <div className="grid grid-cols-2 gap-2 text-xs text-ink-600 bg-ink-50 rounded-xl p-3">
                      <div>
                        <span className="text-ink-400">Cantidad</span>
                        <p className="font-semibold text-ink-900">{r.quantity} {r.products?.unit || ''}</p>
                      </div>
                      <div>
                        <span className="text-ink-400">Creada</span>
                        <p className="font-semibold text-ink-900">
                          {format(new Date(r.created_at), 'd MMM yyyy', { locale: es })}
                        </p>
                      </div>
                      <div className="col-span-2">
                        <span className="text-ink-400 flex items-center gap-1">
                          <Clock size={11} /> Expira
                        </span>
                        <p className={clsx('font-semibold', expired ? 'text-red-500' : 'text-ink-900')}>
                          {format(new Date(r.expires_at), "d MMM yyyy 'a las' HH:mm", { locale: es })}
                          {expired && ' · Vencida'}
                        </p>
                      </div>
                    </div>

                    {/* Notas */}
                    {r.notes && (
                      <p className="text-xs text-ink-500 italic">{r.notes}</p>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>
    </div>
  )
}
