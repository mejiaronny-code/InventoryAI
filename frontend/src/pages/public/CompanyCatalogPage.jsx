/**
 * pages/public/CompanyCatalogPage.jsx
 * Catálogo público de productos con chat IA flotante.
 */
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { productsAPI, categoriesAPI, companiesAPI } from '../../services/api'
import ChatWidget from '../../components/chat/ChatWidget'
import ProductImage from '../../components/shared/ProductImage'
import ThemeProvider from '../../components/shared/ThemeProvider'
import {
  Search, Package, Tag, ChevronLeft,
  ShoppingBag, Zap, Filter
} from 'lucide-react'
import clsx from 'clsx'

function ProductCard({ product, variants = [] }) {
  const [expanded, setExpanded] = useState(false)
  const [selectedVariant, setSelectedVariant] = useState(null)
  const activeProduct = selectedVariant || product
  const extraUnits = activeProduct.units || []
  const allUnits = extraUnits.length > 0
    ? [{ name: activeProduct.unit, factor: 1 }, ...extraUnits]
    : []
  const [selectedUnit, setSelectedUnit] = useState(allUnits[0] || null)

  const displayPrice = selectedUnit
    ? Number(activeProduct.price) * selectedUnit.factor
    : Number(activeProduct.price)
  const displayUnit = selectedUnit ? selectedUnit.name : activeProduct.unit

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
        {activeProduct.sku && <p className="text-ink-400 text-xs font-mono mt-0.5">SKU: {activeProduct.sku}</p>}
      </div>

      {/* Selector de variantes */}
      {variants.length > 0 && (
        <div className="flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setSelectedVariant(null)}
            className={clsx(
              'px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-all',
              !selectedVariant ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-500 border-ink-200 hover:border-brand-300'
            )}
          >
            Base
          </button>
          {variants.map(v => {
            const attrs = Object.entries(v.variant_attributes || {}).map(([k, val]) => val).join(' / ')
            return (
              <button
                key={v.id}
                onClick={() => setSelectedVariant(selectedVariant?.id === v.id ? null : v)}
                className={clsx(
                  'px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-all',
                  selectedVariant?.id === v.id ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-500 border-ink-200 hover:border-brand-300'
                )}
              >
                {attrs || v.name}
              </button>
            )
          })}
        </div>
      )}

      {/* Selector de unidades */}
      {allUnits.length > 1 && (
        <div className="flex gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
          {allUnits.map(u => (
            <button
              key={u.name}
              onClick={() => setSelectedUnit(u)}
              className={clsx(
                'px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-all',
                selectedUnit?.name === u.name
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-white text-ink-500 border-ink-200 hover:border-brand-300'
              )}
            >
              {u.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto">
        <div>
          <p className="text-xl font-extrabold text-brand-600">
            ${displayPrice.toLocaleString()}
          </p>
          <p className="text-xs text-ink-400">por {displayUnit}</p>
        </div>
        <div className={clsx(
          'badge',
          (activeProduct.total_stock || 0) > 0 ? 'badge-green' : 'badge-red'
        )}>
          {(activeProduct.total_stock || 0) > 0
            ? `${activeProduct.total_stock} en stock`
            : 'Sin stock'
          }
        </div>
      </div>

      {product.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {product.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 bg-ink-100 text-ink-500 rounded text-[10px] font-medium">
              {tag}
            </span>
          ))}
        </div>
      )}

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
  const [selectedTag, setSelectedTag] = useState(null)
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

  const allTags = [...new Set(products.flatMap(p => p.tags || []))].sort()

  // Ocultar variantes (hijos) del grid principal — se muestran dentro del card del padre
  const filtered = products.filter(p => {
    if (p.parent_product_id) return false  // variantes no van en la lista principal
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = !selectedCat || p.category_id === selectedCat
    const matchTag = !selectedTag || (p.tags || []).includes(selectedTag)
    return matchSearch && matchCat && matchTag
  })

  // Agrupar variantes por parent_product_id
  const variantsByParent = products.reduce((acc, p) => {
    if (p.parent_product_id) {
      if (!acc[p.parent_product_id]) acc[p.parent_product_id] = []
      acc[p.parent_product_id].push(p)
    }
    return acc
  }, {})

  if (notFound) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-ink-50">
      <Package size={56} className="text-ink-300" />
      <h2 className="text-xl font-bold text-ink-700">Empresa no encontrada</h2>
      <button onClick={() => navigate('/')} className="btn-primary">Volver al inicio</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-ink-50">
      <ThemeProvider settings={company?.settings} />
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
        <div className="flex flex-col gap-3 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
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
          {allTags.length > 0 && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-ink-400 flex items-center gap-1"><Tag size={11} /> Etiquetas:</span>
              {allTags.map(tag => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={clsx('inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer',
                    selectedTag === tag
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-ink-600 border-ink-200 hover:border-brand-300 hover:text-brand-600'
                  )}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
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
            {filtered.map(p => (
              <ProductCard key={p.id} product={p} variants={variantsByParent[p.id] || []} />
            ))}
          </div>
        )}
      </div>

      {/* Chat widget flotante */}
      <ChatWidget
        companySlug={companySlug}
        welcomeMessage={company?.settings?.chat_welcome}
        companyLogo={company?.logo_url}
      />
    </div>
  )
}
