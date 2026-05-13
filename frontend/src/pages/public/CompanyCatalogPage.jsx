/**
 * pages/public/CompanyCatalogPage.jsx
 * Catálogo público de productos con chat IA flotante.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { productsAPI, categoriesAPI, companiesAPI } from '../../services/api'
import ChatWidget from '../../components/chat/ChatWidget'
import ProductImage from '../../components/shared/ProductImage'
import {
  Search, Package, Tag, ChevronLeft,
  ShoppingBag, Zap, Filter
} from 'lucide-react'
import clsx from 'clsx'

function ProductCard({ product }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="card-hover p-5 flex flex-col gap-3" onClick={() => setExpanded(e => !e)}>
      <ProductImage
        src={product.images?.[0]}
        alt={product.name}
        className="w-full h-36 rounded-xl"
        iconSize={36}
      />

      <div>
        <h3 className="font-bold text-ink-900 text-sm leading-snug">{product.name}</h3>
        {product.sku && <p className="text-ink-400 text-xs font-mono mt-0.5">SKU: {product.sku}</p>}
      </div>

      <div className="flex items-center justify-between mt-auto">
        <div>
          <p className="text-xl font-extrabold text-brand-600">
            ${Number(product.price).toLocaleString()}
          </p>
          <p className="text-xs text-ink-400">por {product.unit}</p>
        </div>
        <div className={clsx(
          'badge',
          (product.total_stock || 0) > 0 ? 'badge-green' : 'badge-red'
        )}>
          {(product.total_stock || 0) > 0
            ? `${product.total_stock} en stock`
            : 'Sin stock'
          }
        </div>
      </div>

      {expanded && product.description && (
        <div className="border-t border-ink-100 pt-3 animate-fade-in">
          <p className="text-xs text-ink-600 leading-relaxed">{product.description}</p>
          {product.use_cases && (
            <p className="text-xs text-ink-400 mt-2">
              <span className="font-semibold text-brand-600">Usos:</span> {product.use_cases}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default function CompanyCatalogPage() {
  const { companySlug } = useParams()
  const navigate = useNavigate()
  const [company, setCompany] = useState(null)
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCat, setSelectedCat] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    Promise.all([
      productsAPI.listPublic(companySlug, {}),
      categoriesAPI.listPublic(companySlug),
    ]).then(([prodRes, catRes]) => {
      setProducts(prodRes.data)
      setCategories(catRes.data)
    }).catch(() => setNotFound(true))
    .finally(() => setLoading(false))

    // Get company info for chat welcome message
    companiesAPI.listPublic()
      .then(r => {
        const found = r.data.find(c => c.slug === companySlug)
        setCompany(found || null)
        if (!found) setNotFound(true)
      })
  }, [companySlug])

  const filtered = products.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = !selectedCat || p.category_id === selectedCat
    return matchSearch && matchCat
  })

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-ink-50">
      <Package size={56} className="text-ink-300" />
      <h2 className="text-xl font-bold text-ink-700">Empresa no encontrada</h2>
      <button onClick={() => navigate('/')} className="btn-primary">Volver al inicio</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Header */}
      <header className="bg-white border-b border-ink-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <button onClick={() => navigate('/')} className="btn-ghost p-2">
            <ChevronLeft size={18} />
          </button>
          {company?.logo_url ? (
            <img src={company.logo_url} alt={company?.name} className="w-8 h-8 rounded-lg object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">{company?.name?.[0] || '?'}</span>
            </div>
          )}
          <div className="flex-1">
            <h1 className="font-bold text-ink-900 text-base">{company?.name || companySlug}</h1>
            <p className="text-xs text-ink-400 flex items-center gap-1">
              <Zap size={10} className="text-brand-500" /> Chat IA disponible
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-ink-400 bg-ink-50 px-3 py-1.5 rounded-full border border-ink-100">
            <ShoppingBag size={13} />
            {products.length} productos
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar productos..."
              className="input pl-10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setSelectedCat(null)}
              className={clsx('badge cursor-pointer px-3 py-1.5 text-xs transition-all',
                !selectedCat ? 'badge-orange' : 'badge-gray hover:badge-orange'
              )}
            >
              Todos
            </button>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCat(cat.id === selectedCat ? null : cat.id)}
                className={clsx('badge cursor-pointer px-3 py-1.5 text-xs transition-all',
                  selectedCat === cat.id ? 'badge-orange' : 'badge-gray hover:badge-orange'
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Products grid */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="card p-5 animate-pulse">
                <div className="h-36 bg-ink-100 rounded-xl mb-3" />
                <div className="h-3 bg-ink-100 rounded w-3/4 mb-2" />
                <div className="h-5 bg-ink-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24">
            <Package size={48} className="text-ink-200 mx-auto mb-4" />
            <p className="text-ink-500 font-medium">Sin productos</p>
            <p className="text-ink-400 text-sm mt-1">
              Prueba con el chat IA para encontrar lo que buscas 💬
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </div>

      {/* Chat widget flotante */}
      <ChatWidget
        companySlug={companySlug}
        welcomeMessage={company?.settings?.chat_welcome}
      />
    </div>
  )
}
