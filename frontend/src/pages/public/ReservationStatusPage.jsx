/**
 * pages/public/ReservationStatusPage.jsx
 * Consulta pública de estado de reserva por código.
 */
import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { reservationsAPI } from '../../services/api'
import { CheckCircle, Clock, XCircle, Package, Calendar, User, MapPin, ArrowLeft, Zap } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const statusConfig = {
  pending:   { icon: Clock,        color: 'text-yellow-500', bg: 'bg-yellow-50',  border: 'border-yellow-200', label: 'Pendiente de confirmación' },
  confirmed: { icon: CheckCircle,  color: 'text-green-500',  bg: 'bg-green-50',   border: 'border-green-200',  label: 'Confirmada' },
  completed: { icon: CheckCircle,  color: 'text-brand-500',  bg: 'bg-brand-50',   border: 'border-brand-200',  label: 'Completada / Entregada' },
  cancelled: { icon: XCircle,      color: 'text-red-500',    bg: 'bg-red-50',     border: 'border-red-200',    label: 'Cancelada' },
  expired:   { icon: Clock,        color: 'text-ink-400',    bg: 'bg-ink-50',     border: 'border-ink-200',    label: 'Expirada' },
}

export default function ReservationStatusPage() {
  const { code: codeParam } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const [code, setCode] = useState(codeParam || '')
  const [slug, setSlug] = useState(searchParams.get('empresa') || '')
  const [reservation, setReservation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (codeParam && slug) handleSearch()
  }, [])

  const handleSearch = async () => {
    if (!code.trim() || !slug.trim()) {
      setError('Ingresa el código de reserva y el slug de la empresa')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await reservationsAPI.getPublic(slug.trim(), code.trim().toUpperCase())
      setReservation(res.data)
    } catch {
      setError('No se encontró la reserva. Verifica el código e intenta nuevamente.')
      setReservation(null)
    } finally {
      setLoading(false)
    }
  }

  const status = reservation ? statusConfig[reservation.status] : null
  const StatusIcon = status?.icon

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col">
      {/* Topbar */}
      <header className="bg-white border-b border-ink-100 px-6 py-4 flex items-center gap-3">
        <button onClick={() => navigate('/')} className="btn-ghost p-2">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-brand-500 rounded-lg flex items-center justify-center">
            <Zap size={13} className="text-white" />
          </div>
          <span className="font-bold text-ink-900">InventoryAI</span>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-extrabold text-ink-900 mb-2">Consulta tu reserva</h1>
            <p className="text-ink-500 text-sm">Ingresa el código que recibiste al reservar</p>
          </div>

          <div className="card p-6 mb-6">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                  Código de reserva
                </label>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="RES-XXXXXXXX"
                  className="input font-mono text-center text-lg tracking-widest"
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                  Empresa (slug)
                </label>
                <input
                  value={slug}
                  onChange={e => setSlug(e.target.value)}
                  placeholder="ej: mi-empresa"
                  className="input"
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
              </div>
              {error && <p className="text-red-500 text-xs text-center">{error}</p>}
              <button onClick={handleSearch} disabled={loading} className="btn-primary w-full justify-center mt-1">
                {loading ? 'Buscando...' : 'Consultar reserva'}
              </button>
            </div>
          </div>

          {/* Result */}
          {reservation && (
            <div className={clsx('card border-2 p-6 animate-slide-up', status?.border)}>
              {/* Status badge */}
              <div className={clsx('flex items-center gap-3 p-4 rounded-xl mb-5', status?.bg)}>
                {StatusIcon && <StatusIcon size={24} className={status?.color} />}
                <div>
                  <p className="font-bold text-ink-900">{status?.label}</p>
                  <p className="text-xs font-mono text-ink-500">{reservation.reservation_code}</p>
                </div>
              </div>

              {/* Details */}
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Package size={16} className="text-ink-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-ink-500">Producto</p>
                    <p className="font-semibold text-ink-900 text-sm">
                      {reservation.products?.name || '—'} × {reservation.quantity} {reservation.products?.unit || ''}
                    </p>
                    {reservation.products?.price && (
                      <p className="text-xs text-brand-600 font-medium">
                        ${Number(reservation.products.price).toLocaleString()} c/u
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin size={16} className="text-ink-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-ink-500">Almacén</p>
                    <p className="font-semibold text-ink-900 text-sm">
                      {reservation.warehouses?.name || '—'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <User size={16} className="text-ink-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-ink-500">Cliente</p>
                    <p className="font-semibold text-ink-900 text-sm">{reservation.client_name}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Calendar size={16} className="text-ink-400 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-ink-500">Expira</p>
                    <p className="font-semibold text-ink-900 text-sm">
                      {format(new Date(reservation.expires_at), "d 'de' MMMM yyyy 'a las' HH:mm", { locale: es })}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
