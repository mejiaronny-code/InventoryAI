/**
 * pages/superadmin/MetricsPage.jsx
 */
import { useState, useEffect } from 'react'
import { dashboardAPI } from '../../services/api'
import { Building2, DollarSign, Activity, TrendingUp } from 'lucide-react'

export default function SuperAdminMetricsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    dashboardAPI.getSuperAdminMetrics()
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="p-8 text-center text-ink-400">Cargando métricas...</div>
  if (!data) return null

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="page-title">Métricas Globales</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Building2, label: 'Total empresas', value: data.total_companies },
          { icon: Activity,  label: 'Empresas activas', value: data.active_companies },
          { icon: DollarSign, label: 'Costo IA mes (USD)', value: `$${Number(data.total_monthly_ai_cost).toFixed(4)}` },
          { icon: TrendingUp, label: 'Empresas con IA', value: Object.keys(data.monthly_ai_cost_by_company).length },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="card p-5">
            <div className="w-9 h-9 bg-ink-800 rounded-xl flex items-center justify-center mb-3">
              <Icon size={17} className="text-brand-400" />
            </div>
            <p className="text-xs text-ink-500 font-medium">{label}</p>
            <p className="text-2xl font-extrabold text-ink-900 mt-0.5">{value}</p>
          </div>
        ))}
      </div>

      {/* AI cost by company */}
      <div className="card">
        <div className="p-5 border-b border-ink-100">
          <h2 className="section-title">Costo IA por empresa (mes actual)</h2>
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
    </div>
  )
}
