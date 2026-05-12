/**
 * pages/superadmin/MetricsPage.jsx
 */
import { useState, useEffect } from 'react'
import { dashboardAPI } from '../../services/api'
import { Building2, DollarSign, CalendarCheck, Zap } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className={`card p-5 flex flex-col gap-1 ${accent ? 'border-brand-200' : ''}`}>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${accent ? 'bg-brand-500 shadow-glow' : 'bg-ink-800'}`}>
        <Icon size={17} className={accent ? 'text-white' : 'text-brand-400'} />
      </div>
      <p className="text-xs text-ink-500 font-medium">{label}</p>
      <p className={`text-2xl font-extrabold mt-0.5 ${accent ? 'text-brand-600' : 'text-ink-900'}`}>{value}</p>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label, prefix = '', suffix = '' }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-ink-100 rounded-xl shadow-card px-3 py-2 text-xs">
      <p className="text-ink-500 mb-1">{label}</p>
      <p className="font-bold text-ink-900">{prefix}{payload[0].value}{suffix}</p>
    </div>
  )
}

function currentMonthValue() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function SuperAdminMetricsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(currentMonthValue())

  const load = (m) => {
    setLoading(true)
    dashboardAPI.getSuperAdminMetrics(m)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load(month) }, [month])

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="page-title">Métricas Globales</h1>
        <input
          type="month"
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="text-sm border border-ink-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:border-brand-400"
        />
      </div>

      {/* Stat cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="w-9 h-9 bg-ink-100 rounded-xl mb-3" />
              <div className="h-3 bg-ink-100 rounded w-2/3 mb-2" />
              <div className="h-7 bg-ink-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={Building2}    label="Empresas activas"   value={data.active_companies} />
            <StatCard icon={CalendarCheck} label="Reservas del mes"  value={data.total_reservations} accent />
            <StatCard icon={DollarSign}   label="Costo IA (USD)"    value={`$${Number(data.total_monthly_ai_cost).toFixed(4)}`} />
            <StatCard icon={Zap}          label="Empresa más activa" value={data.most_active_company} />
          </div>

          {/* Gráfico: Reservas por empresa */}
          <div className="card">
            <div className="p-5 border-b border-ink-100">
              <h2 className="section-title">Reservas por empresa</h2>
            </div>
            <div className="p-5">
              {data.res_by_company_chart.length === 0 ? (
                <p className="text-center text-ink-400 text-sm py-10">Sin reservas este mes</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.res_by_company_chart} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis dataKey="empresa" tick={{ fontSize: 11, fill: '#71717a' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#71717a' }} />
                    <Tooltip content={<CustomTooltip suffix=" reservas" />} />
                    <Bar dataKey="reservas" fill="#f97316" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Gráfico: Costo IA por día */}
          <div className="card">
            <div className="p-5 border-b border-ink-100">
              <h2 className="section-title">Costo IA por día (USD)</h2>
            </div>
            <div className="p-5">
              {data.ai_by_day_chart.length === 0 ? (
                <p className="text-center text-ink-400 text-sm py-10">Sin uso de IA este mes</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.ai_by_day_chart} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: '#71717a' }}
                      tickFormatter={d => d.slice(5)}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#71717a' }} />
                    <Tooltip content={<CustomTooltip prefix="$" />} />
                    <Line
                      type="monotone"
                      dataKey="cost"
                      stroke="#f97316"
                      strokeWidth={2}
                      dot={{ fill: '#f97316', r: 3 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Tabla: Costo IA por empresa */}
          <div className="card">
            <div className="p-5 border-b border-ink-100">
              <h2 className="section-title">Costo IA por empresa</h2>
            </div>
            <div className="divide-y divide-ink-50">
              {data.companies.map(c => {
                const cost = data.monthly_ai_cost_by_company[c.id] || 0
                return (
                  <div key={c.id} className="px-5 py-3.5 flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-ink-900 text-sm">{c.name}</p>
                      <p className="text-xs font-mono text-ink-400">/{c.slug}</p>
                    </div>
                    <span className="font-mono text-sm font-bold text-brand-600">${cost.toFixed(4)}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
