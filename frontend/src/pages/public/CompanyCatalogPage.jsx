/**
 * pages/public/CompanyCatalogPage.jsx
 * Catálogo público de productos con chat IA flotante.
 */
import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { productsAPI, categoriesAPI, companiesAPI, reservationsAPI, tablesAPI, bookingsAPI } from '../../services/api'
import ChatWidget from '../../components/chat/ChatWidget'
import ProductImage from '../../components/shared/ProductImage'
import ThemeProvider from '../../components/shared/ThemeProvider'
import {
  Search, Package, Tag, ChevronLeft, ChevronRight,
  ShoppingBag, Zap, X, ShoppingCart, CheckCircle2,
  Loader2, Phone, Mail, User, Hash, FileText, Minus, Plus, MapPin,
  CalendarClock, Utensils, Users
} from 'lucide-react'
import clsx from 'clsx'
import { CURRENCIES } from '../../context/CompanyFeaturesContext'

function buildFormatPrice(currencyCode) {
  const info = CURRENCIES.find(c => c.code === currencyCode) || CURRENCIES[0]
  const noDecimals = ['CLP', 'PYG', 'JPY']
  const decimals = noDecimals.includes(currencyCode) ? 0 : 2
  return (amount) => {
    if (amount == null || isNaN(amount)) return `${info.symbol}0`
    return `${info.symbol}${Number(amount).toLocaleString('es-419', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`
  }
}

/* ── Carrusel de imágenes ─────────────────────────────────────────── */
function ImageCarousel({ images, alt, height = 'h-44' }) {
  const [idx, setIdx] = useState(0)
  const imgs = images?.length > 0 ? images : []

  if (imgs.length === 0) return (
    <ProductImage src={null} alt={alt} className={`w-full ${height} rounded-xl`} iconSize={36} />
  )

  const prev = (e) => { e.stopPropagation(); setIdx(i => (i - 1 + imgs.length) % imgs.length) }
  const next = (e) => { e.stopPropagation(); setIdx(i => (i + 1) % imgs.length) }

  return (
    <div className={`relative w-full ${height} rounded-xl overflow-hidden group bg-ink-50`}>
      <img src={imgs[idx]} alt={alt} className="w-full h-full object-contain p-2 transition-opacity duration-200" />
      {imgs.length > 1 && (
        <>
          <button onClick={prev} className="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronLeft size={15} />
          </button>
          <button onClick={next} className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight size={15} />
          </button>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {imgs.map((_, i) => (
              <button key={i} onClick={(e) => { e.stopPropagation(); setIdx(i) }}
                className={clsx('w-1.5 h-1.5 rounded-full transition-all', i === idx ? 'bg-white scale-125' : 'bg-white/50')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/* ── Modal de detalle + reserva ───────────────────────────────────── */
function ProductDetailModal({ product, variants, formatPrice, showStock, companySlug, categoryMaxQty, onClose }) {
  const [step, setStep] = useState('detail') // 'detail' | 'form' | 'success'
  const [selectedVariant, setSelectedVariant] = useState(null)
  const [imgIdx, setImgIdx] = useState(0)
  const [selectedOptions, setSelectedOptions] = useState({}) // { "Color": "Rojo", "Talla": "M" }
  const [variantStock, setVariantStock] = useState([])

  const options = product.product_options || []

  // Cargar stock de variantes si el producto tiene opciones
  useEffect(() => {
    if (options.length > 0 && product.id) {
      productsAPI.getVariantStockPublic(companySlug, product.id)
        .then(r => setVariantStock(r.data || []))
        .catch(() => {})
    }
  }, [product.id])

  // Obtener stock de la combinación seleccionada
  const getVariantQty = () => {
    if (!options.length || Object.keys(selectedOptions).length === 0) return null
    const key = JSON.stringify(selectedOptions)
    const total = variantStock
      .filter(vs => JSON.stringify(vs.combination) === key)
      .reduce((sum, vs) => sum + vs.quantity, 0)
    return total
  }

  // Cuando cambia el color, cambiar la foto principal
  const handleOptionSelect = (optName, valLabel) => {
    const opt = options.find(o => o.name === optName)
    setSelectedOptions(prev => ({ ...prev, [optName]: valLabel }))
    // Si el tipo tiene imágenes, cambiar la foto
    if (opt?.with_images) {
      const val = opt.values.find(v => v.label === valLabel)
      if (val?.image) {
        // Insertar la imagen del color al inicio temporalmente
        setImgIdx(-1) // señal para usar imagen de opción
        setSelectedColorImg(val.image)
      }
    }
  }

  const [selectedColorImg, setSelectedColorImg] = useState(null)

  const activeProduct = selectedVariant || product
  const imgs = product.images || []
  const displayImg = imgIdx === -1 && selectedColorImg ? selectedColorImg : (imgs[Math.max(0, imgIdx)] || null)

  const extraUnits = activeProduct.units || []
  const allUnits = extraUnits.length > 0
    ? [{ name: activeProduct.unit, factor: 1 }, ...extraUnits]
    : []
  const [selectedUnit, setSelectedUnit] = useState(allUnits[0] || null)

  const displayPrice = selectedUnit
    ? Number(activeProduct.price) * selectedUnit.factor
    : Number(activeProduct.price)
  const displayUnit = selectedUnit ? selectedUnit.name : activeProduct.unit
  const variantQty = getVariantQty()
  const totalStock = variantQty !== null ? variantQty : (activeProduct.total_stock || 0)
  const maxQty = categoryMaxQty ? Math.min(totalStock, categoryMaxQty) : totalStock

  // Reserva
  const [form, setForm] = useState({ client_name: '', client_email: '', client_phone: '', quantity: 1, notes: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [reservationCode, setReservationCode] = useState(null)

  const handleReserve = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      // Elegir el almacén con más stock
      const stocks = activeProduct.stock_by_warehouse || []
      const bestWarehouse = [...stocks].sort((a, b) => b.quantity - a.quantity)[0]
      if (!bestWarehouse) { setError('No hay almacén con stock disponible.'); setSaving(false); return }

      // Incluir opciones seleccionadas en notas (separador · igual que el AI)
      const optionsSummary = Object.entries(selectedOptions)
        .map(([k, v]) => `${k}: ${v}`).join(' · ')
      const notesWithOptions = [optionsSummary, form.notes.trim()].filter(Boolean).join(' — ')

      const res = await reservationsAPI.createPublic(companySlug, {
        product_id: activeProduct.id,
        warehouse_id: bestWarehouse.warehouse_id,
        quantity: form.quantity,
        client_name: form.client_name.trim(),
        client_email: form.client_email.trim().toLowerCase(),
        client_phone: form.client_phone.trim() || undefined,
        notes: notesWithOptions || undefined,
      })
      setReservationCode(res.data.reservation_code)
      setStep('success')
    } catch (err) {
      setError(err.response?.data?.detail || 'Ocurrió un error. Intenta nuevamente.')
    } finally {
      setSaving(false)
    }
  }

  // Cerrar con Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full sm:max-w-lg bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[95vh] sm:max-h-[90vh] overflow-hidden">

        {/* Handle móvil */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-ink-200" />
        </div>

        {/* Botón cerrar */}
        <button onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center transition-colors">
          <X size={16} />
        </button>

        {/* ── PASO 1: Detalle ── */}
        {step === 'detail' && (
          <>
            {/* Galería grande */}
            {(imgs.length > 0 || selectedColorImg) && (
              <div className="relative shrink-0 h-64 sm:h-72 bg-ink-50 overflow-hidden">
                <img
                  src={displayImg || imgs[0]}
                  alt={product.name}
                  className="w-full h-full object-contain p-3 transition-all duration-200"
                />
                {imgs.length > 1 && imgIdx !== -1 && (
                  <>
                    <button onClick={() => setImgIdx(i => (i - 1 + imgs.length) % imgs.length)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center">
                      <ChevronLeft size={16} />
                    </button>
                    <button onClick={() => setImgIdx(i => (i + 1) % imgs.length)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center">
                      <ChevronRight size={16} />
                    </button>
                    <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
                      {imgs.map((_, i) => (
                        <button key={i} onClick={() => setImgIdx(i)}
                          className={clsx('w-2 h-2 rounded-full transition-all', i === imgIdx ? 'bg-white scale-125' : 'bg-white/50')} />
                      ))}
                    </div>
                    {/* Miniaturas */}
                    <div className="absolute bottom-0 left-0 right-0 flex gap-2 px-3 pb-2 overflow-x-auto">
                      {imgs.map((url, i) => (
                        <button key={i} onClick={() => { setImgIdx(i); setSelectedColorImg(null) }}
                          className={clsx('w-10 h-10 rounded-lg overflow-hidden border-2 shrink-0 transition-all bg-white',
                            i === imgIdx ? 'border-white' : 'border-transparent opacity-60')}>
                          <img src={url} alt="" className="w-full h-full object-contain p-0.5" />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Contenido scrolleable */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-4">

                {/* Nombre y SKU */}
                <div>
                  <h2 className="text-xl font-bold text-ink-900 leading-tight">{product.name}</h2>
                  {activeProduct.sku && (
                    <p className="text-xs text-ink-400 font-mono mt-1 flex items-center gap-1">
                      <Hash size={10} /> SKU: {activeProduct.sku}
                    </p>
                  )}
                </div>

                {/* Precio y stock */}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-extrabold text-brand-600">
                      {formatPrice ? formatPrice(displayPrice) : `$${displayPrice.toLocaleString()}`}
                    </p>
                    {activeProduct.product_type !== 'dish' && <p className="text-xs text-ink-400 mt-0.5">por {displayUnit}</p>}
                  </div>
                  {activeProduct.product_type === 'dish' ? (
                    <div className={clsx('badge text-sm px-3 py-1',
                      activeProduct.is_available === false ? 'badge-red' : 'badge-green')}>
                      {activeProduct.is_available === false ? 'Agotado hoy' : 'Disponible'}
                    </div>
                  ) : (
                    <div className={clsx('badge text-sm px-3 py-1',
                      totalStock > 0 ? 'badge-green' : 'badge-red')}>
                      {totalStock > 0
                        ? showStock ? `${totalStock} en stock` : 'En stock'
                        : 'Sin stock'}
                    </div>
                  )}
                </div>

                {/* Opciones: Color, Talla, etc. */}
                {options.map(opt => (
                  <div key={opt.name}>
                    <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">
                      {opt.name}
                      {selectedOptions[opt.name] && (
                        <span className="ml-2 font-normal normal-case text-ink-400">— {selectedOptions[opt.name]}</span>
                      )}
                    </p>
                    <div className="flex gap-2 flex-wrap">
                      {opt.values.map(val => {
                        const isSelected = selectedOptions[opt.name] === val.label
                        // Obtener stock de esta opción si tiene combinaciones
                        const partialCombo = { ...selectedOptions, [opt.name]: val.label }
                        const partialStock = variantStock
                          .filter(vs => Object.entries(partialCombo).every(([k, v]) => vs.combination[k] === v))
                          .reduce((sum, vs) => sum + vs.quantity, 0)
                        const hasVariantStock = variantStock.length > 0
                        const outOfStock = hasVariantStock && partialStock === 0

                        if (opt.with_images && val.image) {
                          return (
                            <button
                              key={val.label}
                              onClick={() => handleOptionSelect(opt.name, val.label)}
                              disabled={outOfStock}
                              title={val.label}
                              className={clsx(
                                'w-12 h-12 rounded-xl border-2 overflow-hidden transition-all relative',
                                isSelected ? 'border-brand-500 scale-105 shadow-md' : 'border-ink-200 hover:border-brand-300',
                                outOfStock && 'opacity-40'
                              )}
                            >
                              <img src={val.image} alt={val.label} className="w-full h-full object-cover" />
                              {outOfStock && (
                                <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                                  <X size={12} className="text-red-500" />
                                </div>
                              )}
                            </button>
                          )
                        }
                        return (
                          <button
                            key={val.label}
                            onClick={() => handleOptionSelect(opt.name, val.label)}
                            disabled={outOfStock}
                            className={clsx(
                              'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all',
                              isSelected ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-600 border-ink-200 hover:border-brand-300',
                              outOfStock && 'opacity-40 line-through'
                            )}
                          >
                            {val.label}
                            {outOfStock && <span className="ml-1 text-[9px]">✗</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {/* Unidades */}
                {allUnits.length > 1 && (
                  <div>
                    <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">Unidad</p>
                    <div className="flex gap-2 flex-wrap">
                      {allUnits.map(u => (
                        <button key={u.name} onClick={() => setSelectedUnit(u)}
                          className={clsx('px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all',
                            selectedUnit?.name === u.name ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-600 border-ink-200 hover:border-brand-300')}>
                          {u.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Descripción */}
                {product.description && (
                  <div>
                    <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-1.5">Descripción</p>
                    <p className="text-sm text-ink-600 leading-relaxed">{product.description}</p>
                  </div>
                )}

                {/* Usos / Ideal para (platillos) */}
                {product.use_cases && (
                  <div className="bg-brand-50 rounded-xl p-3 border border-brand-100">
                    <p className="text-xs font-semibold text-brand-700 mb-1">
                      {product.product_type === 'dish' ? 'Ideal para' : 'Usos recomendados'}
                    </p>
                    <p className="text-xs text-brand-600 leading-relaxed">{product.use_cases}</p>
                  </div>
                )}

                {/* Ubicación en tienda */}
                {(() => {
                  const loc = activeProduct.stock_by_warehouse?.find(s => s.store_location)?.store_location
                  return loc ? (
                    <div className="flex items-center gap-2 bg-brand-50 border border-brand-100 rounded-xl px-3 py-2">
                      <MapPin size={14} className="text-brand-500 shrink-0" />
                      <div>
                        <p className="text-[10px] font-semibold text-brand-600 uppercase tracking-wide">Dónde encontrarlo</p>
                        <p className="text-sm font-medium text-brand-800">{loc}</p>
                      </div>
                    </div>
                  ) : null
                })()}

                {/* Tags */}
                {product.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {product.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 bg-ink-100 text-ink-500 rounded text-xs font-medium">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer fijo */}
            <div className="p-4 border-t border-ink-100 shrink-0 bg-white space-y-2">
              {/* Aviso si hay opciones sin seleccionar */}
              {options.length > 0 && options.some(o => !selectedOptions[o.name]) && (
                <p className="text-xs text-center text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-xl py-2 px-3">
                  ⚠️ Elige {options.filter(o => !selectedOptions[o.name]).map(o => o.name.toLowerCase()).join(' y ')} antes de reservar
                </p>
              )}
              {activeProduct.product_type === 'dish' ? (
                // Los platillos se ordenan/reservan por el chat (pre-orden y mesa llegan en R3)
                <div className="w-full text-center py-3 px-4 rounded-2xl bg-brand-50 border border-brand-100">
                  <p className="text-sm font-semibold text-brand-600">
                    {activeProduct.is_available === false
                      ? 'No disponible hoy'
                      : '🍽️ Pregunta o reserva por el chat'}
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => setStep('form')}
                  disabled={totalStock === 0 || (options.length > 0 && options.some(o => !selectedOptions[o.name]))}
                  className={clsx(
                    'w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-base transition-all',
                    totalStock > 0 && !(options.length > 0 && options.some(o => !selectedOptions[o.name]))
                      ? 'bg-brand-500 hover:bg-brand-600 text-white shadow-md hover:shadow-lg active:scale-[0.98]'
                      : 'bg-ink-100 text-ink-400 cursor-not-allowed'
                  )}
                >
                  <ShoppingCart size={18} />
                  {totalStock === 0 ? 'Sin stock disponible' : 'Reservar producto'}
                </button>
              )}
            </div>
          </>
        )}

        {/* ── PASO 2: Formulario de reserva ── */}
        {step === 'form' && (
          <>
            <div className="px-5 py-4 border-b border-ink-100 shrink-0 flex items-center gap-3">
              <button onClick={() => setStep('detail')} className="p-1.5 rounded-lg hover:bg-ink-100">
                <ChevronLeft size={18} />
              </button>
              <div>
                <h3 className="font-bold text-ink-900 text-base">Reservar producto</h3>
                <p className="text-xs text-ink-400 truncate max-w-[260px]">{product.name}</p>
              </div>
            </div>

            <form onSubmit={handleReserve} className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-4">

                {/* Resumen del producto */}
                <div className="bg-ink-50 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-3">
                    {(selectedColorImg || imgs[0])
                      ? <img src={selectedColorImg || imgs[0]} alt={product.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                      : <div className="w-12 h-12 rounded-lg bg-ink-200 flex items-center justify-center shrink-0"><Package size={18} className="text-ink-400" /></div>
                    }
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-ink-900 text-sm truncate">{activeProduct.name}</p>
                      <p className="text-brand-600 font-bold text-sm">{formatPrice ? formatPrice(displayPrice) : `$${displayPrice}`} <span className="text-ink-400 font-normal text-xs">por {displayUnit}</span></p>
                    </div>
                  </div>
                  {/* Opciones seleccionadas */}
                  {Object.keys(selectedOptions).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-ink-200">
                      {Object.entries(selectedOptions).map(([k, v]) => (
                        <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-100 text-brand-700 rounded-lg text-xs font-semibold">
                          {k}: {v}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Cantidad */}
                <div>
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-2">Cantidad</label>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => setForm(f => ({ ...f, quantity: Math.max(1, f.quantity - 1) }))}
                      className="w-9 h-9 rounded-xl border border-ink-200 flex items-center justify-center hover:bg-ink-50 transition-colors">
                      <Minus size={14} />
                    </button>
                    <input type="number" min={1} max={maxQty} value={form.quantity}
                      onChange={e => setForm(f => ({ ...f, quantity: Math.max(1, Math.min(maxQty, parseInt(e.target.value) || 1)) }))}
                      className="input w-20 text-center font-bold text-lg" />
                    <button type="button" onClick={() => setForm(f => ({ ...f, quantity: Math.min(maxQty, f.quantity + 1) }))}
                      className="w-9 h-9 rounded-xl border border-ink-200 flex items-center justify-center hover:bg-ink-50 transition-colors">
                      <Plus size={14} />
                    </button>
                    <div className="text-xs text-ink-400 leading-tight">
                      {categoryMaxQty && <p className="text-brand-500 font-medium">máx. {categoryMaxQty} por reserva</p>}
                      {showStock && <p>stock: {totalStock}</p>}
                    </div>
                  </div>
                </div>

                {/* Nombre */}
                <div>
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                    Nombre completo *
                  </label>
                  <div className="relative">
                    <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                    <input required value={form.client_name}
                      onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                      placeholder="Tu nombre"
                      className="input pl-9" />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                    Correo electrónico *
                  </label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                    <input required type="email" value={form.client_email}
                      onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))}
                      placeholder="tu@correo.com"
                      className="input pl-9" />
                  </div>
                </div>

                {/* Teléfono */}
                <div>
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                    Teléfono <span className="text-ink-400 font-normal normal-case">(opcional)</span>
                  </label>
                  <div className="relative">
                    <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                    <input value={form.client_phone}
                      onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))}
                      placeholder="+504 9999-9999"
                      className="input pl-9" />
                  </div>
                </div>

                {/* Notas */}
                <div>
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                    Notas <span className="text-ink-400 font-normal normal-case">(opcional)</span>
                  </label>
                  <div className="relative">
                    <FileText size={15} className="absolute left-3 top-3 text-ink-400" />
                    <textarea value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                      placeholder="Especificaciones, horario de recogida..."
                      rows={2}
                      className="input pl-9 resize-none" />
                  </div>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                    <p className="text-xs text-red-600">{error}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-ink-100 bg-white sticky bottom-0">
                <button type="submit" disabled={saving}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-base transition-all shadow-md hover:shadow-lg active:scale-[0.98] disabled:opacity-60">
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <ShoppingCart size={18} />}
                  {saving ? 'Reservando...' : 'Confirmar reserva'}
                </button>
              </div>
            </form>
          </>
        )}

        {/* ── PASO 3: Éxito ── */}
        {step === 'success' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-5">
            <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 size={42} className="text-green-500" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-ink-900 mb-1">¡Reserva confirmada!</h3>
              <p className="text-sm text-ink-500">Te enviamos los detalles a tu correo.</p>
            </div>
            <div className="bg-brand-50 border border-brand-200 rounded-2xl px-6 py-4 w-full">
              <p className="text-xs text-brand-600 font-semibold uppercase tracking-wide mb-1">Código de reserva</p>
              <p className="text-2xl font-extrabold text-brand-700 tracking-widest font-mono">{reservationCode}</p>
            </div>
            <p className="text-xs text-ink-400 leading-relaxed">
              Guarda este código para consultar el estado de tu reserva en cualquier momento.
            </p>
            <div className="flex flex-col gap-2 w-full">
              <button onClick={onClose}
                className="w-full py-3 rounded-2xl bg-brand-500 hover:bg-brand-600 text-white font-bold transition-all">
                Seguir viendo productos
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

/* ── Card del producto (simplificada) ────────────────────────────── */
// ── DishSearchAdd: buscador para agregar platillos a la pre-orden ──────
function DishSearchAdd({ dishes, onPick }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = query
    ? dishes.filter(d => d.name.toLowerCase().includes(query.toLowerCase()))
    : dishes

  return (
    <div className="relative mb-2" ref={ref}>
      <input
        className="input"
        value={query}
        placeholder="+ Buscar y agregar platillo…"
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
      />
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-ink-200 rounded-xl shadow-lg">
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-ink-400">Sin resultados</p>
          ) : filtered.map(d => (
            <button
              key={d.id}
              type="button"
              onClick={() => { onPick(d.id); setQuery(''); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm text-ink-700 hover:bg-brand-50 transition-colors"
            >
              {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── BookingModal: reserva de mesa / pedido para recoger ───────────────
function BookingModal({ companySlug, dishes, formatPrice, allowDineIn = true, allowPickup = true, onClose }) {
  const serviceOptions = [
    allowDineIn && { v: 'dine_in', label: 'Comer aquí', icon: Utensils },
    allowPickup && { v: 'pickup', label: 'Para recoger', icon: ShoppingBag },
  ].filter(Boolean)
  const [serviceType, setServiceType] = useState(serviceOptions[0]?.v || 'dine_in')
  const [zones, setZones] = useState([])
  const [form, setForm] = useState({
    reserved_date: '', reserved_time: '',
    party_size: 2, zone: '',
    client_name: '', client_email: '', client_phone: '', notes: '',
    website: '', // honeypot anti-bot (oculto)
  })
  const [preorder, setPreorder] = useState([]) // [{ dish_id, quantity }]
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [code, setCode] = useState(null)

  useEffect(() => {
    tablesAPI.listPublic(companySlug).then(r => {
      const z = [...new Set((r.data || []).map(t => t.zone).filter(Boolean))]
      setZones(z)
    }).catch(() => {})
  }, [companySlug])

  const addDish = (dishId) => {
    if (!dishId) return
    setPreorder(prev => {
      const ex = prev.find(p => p.dish_id === dishId)
      if (ex) return prev.map(p => p.dish_id === dishId ? { ...p, quantity: p.quantity + 1 } : p)
      return [...prev, { dish_id: dishId, quantity: 1 }]
    })
  }
  const setQty = (dishId, q) => setPreorder(prev =>
    q <= 0 ? prev.filter(p => p.dish_id !== dishId) : prev.map(p => p.dish_id === dishId ? { ...p, quantity: q } : p))

  const submit = async () => {
    setError('')
    if (!form.client_name.trim()) { setError('Ingresa tu nombre'); return }
    if (!form.client_phone.trim() && !form.client_email.trim()) {
      setError('Pon un teléfono o email de contacto'); return
    }
    if (!form.reserved_date || !form.reserved_time) { setError('Elige fecha y hora'); return }
    const reserved_at = new Date(`${form.reserved_date}T${form.reserved_time}`)
    if (isNaN(reserved_at.getTime())) { setError('Fecha/hora inválida'); return }

    setSaving(true)
    try {
      const res = await bookingsAPI.createPublic(companySlug, {
        service_type: serviceType,
        party_size: serviceType === 'dine_in' ? Number(form.party_size) : null,
        reserved_at: reserved_at.toISOString(),
        zone: form.zone || null,
        client_name: form.client_name,
        client_email: form.client_email || null,
        client_phone: form.client_phone || null,
        notes: form.notes || null,
        website: form.website || null,
        items: preorder.map(p => ({ dish_id: p.dish_id, quantity: p.quantity })),
      })
      setCode(res.data.code)
    } catch (e) {
      setError(e.response?.data?.detail || 'No se pudo crear la reserva')
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white flex items-center justify-between p-5 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">Reservar</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>

        {code ? (
          <div className="p-8 text-center space-y-3">
            <CheckCircle2 size={48} className="text-green-500 mx-auto" />
            <h4 className="text-lg font-bold text-ink-900">¡Reserva confirmada!</h4>
            <p className="text-sm text-ink-500">Tu código de reserva es:</p>
            <p className="text-2xl font-extrabold text-brand-600 font-mono tracking-wider">{code}</p>
            <button onClick={onClose} className="btn-primary mt-2">Listo</button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Tipo de servicio (solo si hay más de una opción) */}
            {serviceOptions.length > 1 && (
              <div className="grid grid-cols-2 gap-2">
                {serviceOptions.map(({ v, label, icon: Icon }) => (
                  <button
                    key={v}
                    onClick={() => setServiceType(v)}
                    className={clsx('flex items-center justify-center gap-2 py-2.5 rounded-xl border text-sm font-semibold transition-all',
                      serviceType === v ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-ink-600 border-ink-200')}
                  >
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            )}

            {/* Fecha y hora */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Fecha</label>
                <input type="date" value={form.reserved_date} onChange={e => setForm(f => ({ ...f, reserved_date: e.target.value }))} className="input" />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Hora</label>
                <input type="time" value={form.reserved_time} onChange={e => setForm(f => ({ ...f, reserved_time: e.target.value }))} className="input" />
              </div>
            </div>

            {/* Personas + zona (solo comer aquí) */}
            {serviceType === 'dine_in' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Personas</label>
                  <input type="number" min="1" value={form.party_size} onChange={e => setForm(f => ({ ...f, party_size: e.target.value }))} className="input" />
                </div>
                {zones.length > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Zona</label>
                    <select value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} className="input">
                      <option value="">Cualquiera</option>
                      {zones.map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* Honeypot anti-bot: invisible para humanos; si un bot lo llena, se rechaza */}
            <input
              type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
              value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
              style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
            />

            {/* Datos del cliente */}
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
              <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} className="input" placeholder="Tu nombre" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input value={form.client_phone} onChange={e => setForm(f => ({ ...f, client_phone: e.target.value }))} className="input" placeholder="Teléfono *" />
              <input value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))} className="input" placeholder="Email" />
            </div>
            <p className="text-[11px] text-ink-400 -mt-2">Pon al menos un teléfono o email de contacto.</p>

            {/* Pre-orden de platillos */}
            {dishes.length > 0 && (
              <div className="border-t border-ink-100 pt-3">
                <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">Pre-ordenar platillos (opcional)</p>
                <DishSearchAdd dishes={dishes} onPick={addDish} />
                {preorder.map(p => {
                  const dish = dishes.find(d => d.id === p.dish_id)
                  return (
                    <div key={p.dish_id} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-sm text-ink-700 flex-1">{dish?.name}</span>
                      <span className="text-xs text-ink-400">{formatPrice ? formatPrice(dish?.price) : dish?.price}</span>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setQty(p.dish_id, p.quantity - 1)} className="w-6 h-6 rounded-lg bg-ink-100 flex items-center justify-center"><Minus size={12} /></button>
                        <span className="text-sm font-semibold w-5 text-center">{p.quantity}</span>
                        <button onClick={() => setQty(p.dish_id, p.quantity + 1)} className="w-6 h-6 rounded-lg bg-ink-100 flex items-center justify-center"><Plus size={12} /></button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="input resize-none" placeholder="Notas (alergias, ocasión especial…)" />

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button onClick={submit} disabled={saving} className="btn-primary w-full justify-center py-3">
              {saving ? <Loader2 size={18} className="animate-spin" /> : 'Confirmar reserva'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ProductCard({ product, variants = [], formatPrice, showStock, onOpen }) {
  const imgs = product.images || []
  const totalStock = product.total_stock || 0

  return (
    <div
      className="card-hover p-4 flex flex-col gap-3 cursor-pointer"
      onClick={() => onOpen(product)}
    >
      <ImageCarousel images={imgs} alt={product.name} height="h-36" />

      <div className="flex-1 flex flex-col gap-2">
        <h3 className="font-bold text-ink-900 text-sm leading-snug line-clamp-2">{product.name}</h3>

        {/* Variantes (chips pequeños) */}
        {variants.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {variants.slice(0, 3).map(v => {
              const attrs = Object.values(v.variant_attributes || {}).join('/')
              return (
                <span key={v.id} className="px-1.5 py-0.5 bg-ink-100 text-ink-500 rounded text-[10px] font-medium">
                  {attrs || v.name}
                </span>
              )
            })}
            {variants.length > 3 && <span className="text-[10px] text-ink-400">+{variants.length - 3}</span>}
          </div>
        )}

        <div className="flex items-center justify-between mt-auto">
          <div>
            <p className="text-lg font-extrabold text-brand-600">
              {formatPrice ? formatPrice(Number(product.price)) : `$${Number(product.price).toLocaleString()}`}
            </p>
            {product.product_type !== 'dish' && <p className="text-[10px] text-ink-400">por {product.unit}</p>}
          </div>
          {product.product_type === 'dish' ? (
            // Los platillos no llevan stock; su disponibilidad es "agotado hoy"
            product.is_available === false
              ? <div className="badge text-[10px] badge-red">Agotado hoy</div>
              : <div className="badge text-[10px] badge-green">✓</div>
          ) : (
            <div className={clsx('badge text-[10px]', totalStock > 0 ? 'badge-green' : 'badge-red')}>
              {totalStock > 0 ? (showStock ? `${totalStock}` : '✓') : '✗'}
            </div>
          )}
        </div>

        {/* Tags */}
        {product.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {product.tags.slice(0, 2).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-ink-100 text-ink-500 rounded text-[10px] font-medium">{tag}</span>
            ))}
            {product.tags.length > 2 && <span className="text-[10px] text-ink-400">+{product.tags.length - 2}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Página principal ─────────────────────────────────────────────── */
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
  const [catalogDisabled, setCatalogDisabled] = useState(false)
  const [detailProduct, setDetailProduct] = useState(null)
  const [bookingOpen, setBookingOpen] = useState(false)

  const formatPrice = buildFormatPrice(company?.settings?.currency || 'USD')
  const showStock = company?.settings?.show_stock ?? true

  useEffect(() => {
    Promise.all([
      productsAPI.listPublic(companySlug, {}),
      categoriesAPI.listPublic(companySlug),
    ]).then(([prodRes, catRes]) => {
      setProducts(prodRes.data)
      setCategories(catRes.data)
    }).catch(() => setNotFound(true))
    .finally(() => setLoading(false))

    companiesAPI.listPublic()
      .then(r => {
        const found = r.data.find(c => c.slug === companySlug)
        setCompany(found || null)
        if (!found) setNotFound(true)
        else if (found.features?.public_catalog === false) setCatalogDisabled(true)
      })
  }, [companySlug])

  const allTags = [...new Set(products.flatMap(p => p.tags || []))].sort()

  const filtered = products.filter(p => {
    if (p.parent_product_id) return false
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
    const matchCat = !selectedCat || p.category_id === selectedCat
    const matchTag = !selectedTag || (p.tags || []).includes(selectedTag)
    return matchSearch && matchCat && matchTag
  })

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

  if (catalogDisabled) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-ink-50 text-center px-4">
      <ShoppingBag size={56} className="text-ink-300" />
      <h2 className="text-xl font-bold text-ink-700">{company?.name}</h2>
      <p className="text-ink-500 max-w-sm">Esta empresa no tiene un catálogo público disponible.</p>
      <button onClick={() => navigate('/')} className="btn-primary">Volver al inicio</button>
    </div>
  )

  return (
    <div className="min-h-screen bg-ink-50">
      <ThemeProvider settings={company?.settings} />

      {/* Header */}
      <header className="bg-white border-b border-ink-100 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 sm:py-4 flex items-center gap-2 sm:gap-4">
          <button onClick={() => navigate('/')} className="btn-ghost p-2 shrink-0">
            <ChevronLeft size={18} />
          </button>
          {company?.logo_url ? (
            <img src={company.logo_url} alt={company?.name} className="w-8 h-8 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">{company?.name?.[0] || '?'}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-ink-900 text-sm sm:text-base truncate">{company?.name || companySlug}</h1>
            <p className="text-xs text-ink-400 flex items-center gap-1">
              <Zap size={10} className="text-brand-500 shrink-0" /> Chat IA disponible
            </p>
          </div>
          {(company?.features?.table_reservations || company?.features?.pickup_orders) && (
            <button
              onClick={() => setBookingOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-500 px-3 py-1.5 rounded-full hover:bg-brand-600 transition-colors shrink-0"
            >
              <CalendarClock size={13} />
              {company?.features?.table_reservations ? 'Reservar' : 'Ordenar'}
            </button>
          )}
          <button
            onClick={() => navigate(`/${companySlug}/mis-reservas`)}
            title="Mis reservas"
            className="flex items-center gap-1.5 text-xs text-brand-600 bg-brand-50 px-3 py-1.5 rounded-full border border-brand-100 hover:bg-brand-100 transition-colors shrink-0"
          >
            <ShoppingBag size={13} />
            <span className="hidden sm:inline">Mis reservas</span>
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Filtros */}
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
                  !selectedCat ? 'bg-brand-500 text-white border-brand-500' : 'badge-gray hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200')}
              >
                Todos
              </button>
              {categories.map(cat => (
                <button key={cat.id}
                  onClick={() => setSelectedCat(cat.id === selectedCat ? null : cat.id)}
                  className={clsx('badge cursor-pointer px-3 py-1.5 text-xs transition-all',
                    selectedCat === cat.id ? 'bg-brand-500 text-white border-brand-500' : 'badge-gray hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200')}
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
                <button key={tag}
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

        {/* Grid de productos */}
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
            <p className="text-ink-400 text-sm mt-1">Prueba con el chat IA para encontrar lo que buscas 💬</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map(p => (
              <ProductCard
                key={p.id}
                product={p}
                variants={variantsByParent[p.id] || []}
                formatPrice={formatPrice}
                showStock={showStock}
                onOpen={setDetailProduct}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modal de detalle */}
      {detailProduct && (
        <ProductDetailModal
          product={detailProduct}
          variants={variantsByParent[detailProduct.id] || []}
          formatPrice={formatPrice}
          showStock={showStock}
          companySlug={companySlug}
          categoryMaxQty={categories.find(c => c.id === detailProduct.category_id)?.max_reservation_qty ?? null}
          onClose={() => setDetailProduct(null)}
        />
      )}

      {/* Reserva de mesa / pedido (sector restaurantes) */}
      {bookingOpen && (
        <BookingModal
          companySlug={companySlug}
          dishes={products.filter(p => p.product_type === 'dish' && p.is_available !== false)}
          formatPrice={formatPrice}
          allowDineIn={!!company?.features?.table_reservations}
          allowPickup={!!company?.features?.pickup_orders}
          onClose={() => setBookingOpen(false)}
        />
      )}

      {/* Chat IA */}
      <ChatWidget
        companySlug={companySlug}
        welcomeMessage={company?.settings?.chat_welcome}
        companyLogo={company?.logo_url}
      />
    </div>
  )
}
