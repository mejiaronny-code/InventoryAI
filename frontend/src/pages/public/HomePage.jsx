/**
 * pages/public/HomePage.jsx
 * Página de inicio — lista pública de empresas.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { companiesAPI } from '../../services/api'
import { Search, Zap, ArrowRight, Building2 } from 'lucide-react'

export default function HomePage() {
  const [companies, setCompanies] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    companiesAPI.listPublic()
      .then(r => setCompanies(r.data.filter(c => c.features?.public_catalog !== false)))
      .finally(() => setLoading(false))
  }, [])

  const filtered = companies.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="relative bg-ink-950 overflow-hidden">
        <div className="absolute inset-0 bg-pattern opacity-30" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 mb-6">
            <Zap size={14} className="text-brand-400" />
            <span className="text-brand-400 text-xs font-semibold tracking-wide uppercase">InventoryAI</span>
          </div>
          <h1 className="text-3xl min-[380px]:text-4xl md:text-6xl font-extrabold text-white mb-4 tracking-tight">
            Tu inventario,<br />
            <span className="text-gradient">inteligente.</span>
          </h1>
          <p className="text-ink-400 text-base sm:text-lg max-w-xl mx-auto mb-8 sm:mb-10">
            Busca productos con lenguaje natural. Haz reservas en segundos.<br />
            Potenciado por IA.
          </p>

          {/* Search */}
          <div className="relative max-w-md mx-auto">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar empresa..."
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white/10 border border-white/10 text-white placeholder:text-ink-500 text-sm focus:outline-none focus:border-brand-500 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Companies grid */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <p className="text-ink-500 text-sm mb-8 font-medium">
          {filtered.length} empresa{filtered.length !== 1 ? 's' : ''} disponible{filtered.length !== 1 ? 's' : ''}
        </p>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="card p-6 animate-pulse">
                <div className="w-12 h-12 rounded-xl bg-ink-100 mb-4" />
                <div className="h-4 bg-ink-100 rounded w-2/3 mb-2" />
                <div className="h-3 bg-ink-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20">
            <Building2 size={40} className="text-ink-300 mx-auto mb-3" />
            <p className="text-ink-500">No se encontraron empresas</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(company => (
              <button
                key={company.id}
                onClick={() => navigate(`/${company.slug || company.id}`)}
                className="card-hover p-6 text-left group"
              >
                {company.logo_url ? (
                  <img src={company.logo_url} alt={company.name}
                    className="w-20 h-20 rounded-xl object-contain mb-4 border border-ink-100 p-1" />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center mb-4">
                    <span className="text-brand-600 font-bold text-2xl">{company.name[0]}</span>
                  </div>
                )}
                <h3 className="font-bold text-ink-900 text-base mb-1 group-hover:text-brand-600 transition-colors">
                  {company.name}
                </h3>
                <p className="text-ink-400 text-xs font-mono">/{company.slug}</p>
                <div className="flex items-center gap-1 mt-4 text-brand-500 text-xs font-semibold">
                  Ver catálogo <ArrowRight size={13} className="group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-ink-100 py-8 text-center">
        <div className="flex items-center justify-center gap-2 text-ink-400 text-sm">
          <Zap size={14} className="text-brand-500" />
          <span>Powered by <strong className="text-ink-700">InventoryAI</strong></span>
        </div>
      </footer>
    </div>
  )
}
