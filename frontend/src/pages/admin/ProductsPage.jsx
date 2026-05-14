/**
 * pages/admin/ProductsPage.jsx
 * CRUD completo de productos con generación automática de embeddings.
 */
import { useState, useEffect, useCallback } from 'react'
import { productsAPI, categoriesAPI, warehousesAPI, stockAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useCompanyFeatures } from '../../context/CompanyFeaturesContext'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import {
  Plus, Search, Pencil, Trash2, Package, X,
  RefreshCw, Loader2, Upload, ImageIcon, Warehouse, Tag, Layers
} from 'lucide-react'
import ProductImage from '../../components/shared/ProductImage'
import clsx from 'clsx'

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function TagInput({ tags, onChange }) {
  const [input, setInput] = useState('')

  const addTag = () => {
    const trimmed = input.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInput('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border border-ink-200 rounded-xl min-h-[40px] focus-within:border-brand-400 transition-colors">
      {tags.map(tag => (
        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand-100 text-brand-700 rounded-lg text-xs font-medium">
          {tag}
          <button type="button" onClick={() => onChange(tags.filter(t => t !== tag))} className="text-brand-400 hover:text-brand-700">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={addTag}
        placeholder={tags.length === 0 ? 'Agregar etiqueta...' : ''}
        className="flex-1 min-w-[100px] bg-transparent outline-none text-xs text-ink-700 placeholder-ink-400"
      />
    </div>
  )
}

function UnitsEditor({ baseUnit, units, onChange }) {
  const [newName, setNewName] = useState('')
  const [newFactor, setNewFactor] = useState('')

  const add = () => {
    const name = newName.trim()
    const factor = parseFloat(newFactor)
    if (!name || !factor || factor <= 0) return
    if (units.some(u => u.name === name)) return
    onChange([...units, { name, factor }])
    setNewName('')
    setNewFactor('')
  }

  return (
    <div className="space-y-2">
      {/* Base unit (read-only) */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-ink-50 border border-ink-200">
        <span className="text-xs font-semibold text-brand-600 w-16 shrink-0">Base</span>
        <span className="flex-1 text-xs text-ink-700 font-medium">{baseUnit}</span>
        <span className="text-xs text-ink-400">factor: 1</span>
      </div>

      {/* Existing extra units */}
      {units.map((u, i) => (
        <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-ink-200">
          <span className="text-xs text-ink-400 w-16 shrink-0">Extra</span>
          <span className="flex-1 text-xs text-ink-700 font-medium">{u.name}</span>
          <span className="text-xs text-ink-500">× {u.factor} {baseUnit}s</span>
          <button
            type="button"
            onClick={() => onChange(units.filter((_, j) => j !== i))}
            className="text-red-400 hover:text-red-600 ml-1"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {/* Add new unit */}
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Ej: caja, pack, docena..."
          className="input text-xs flex-1"
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <input
          type="number"
          value={newFactor}
          onChange={e => setNewFactor(e.target.value)}
          placeholder="Factor"
          className="input text-xs w-24"
          onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button type="button" onClick={add} className="btn-primary px-3 py-2 text-xs">
          <Plus size={13} />
        </button>
      </div>
      <p className="text-[10px] text-ink-400">Factor = cuántas unidades base contiene. Ej: caja = 12 unidades</p>
    </div>
  )
}

function ProductForm({ product, categories, warehouses, onSave, onClose }) {
  const { hasFeature } = useCompanyFeatures()
  const [form, setForm] = useState({
    name: product?.name || '',
    description: product?.description || '',
    use_cases: product?.use_cases || '',
    sku: product?.sku || '',
    barcode: product?.barcode || '',
    price: product?.price || 0,
    unit: product?.unit || 'unidad',
    category_id: product?.category_id || '',
    reservation_time_hours: product?.reservation_time_hours || '',
    attributes: JSON.stringify(product?.attributes || {}, null, 2),
    images: product?.images || [],
    tags: product?.tags || [],
    units: product?.units || [],
    variant_attributes: product?.variant_attributes || {},
    parent_product_id: product?.parent_product_id || null,
  })
  const [variants, setVariants] = useState([])
  const [loadingVariants, setLoadingVariants] = useState(false)

  // Cargar variantes si es un producto padre
  useEffect(() => {
    if (product?.id && hasFeature('variants') && !product?.parent_product_id) {
      setLoadingVariants(true)
      productsAPI.getVariants(product.id)
        .then(r => setVariants(r.data || []))
        .catch(() => {})
        .finally(() => setLoadingVariants(false))
    }
  }, [product?.id])
  const [stockData, setStockData] = useState({ warehouse_id: '', quantity: 0, min_stock_alert: 5 })
  const [loading, setLoading] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)

  const onDropImage = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0]
    if (!file) return
    setUploadingImg(true)
    try {
      const res = await productsAPI.uploadImage(file)
      setForm(f => ({ ...f, images: [...f.images, res.data.url] }))
    } catch {
      toast.error('Error al subir imagen')
    } finally { setUploadingImg(false) }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropImage,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    maxFiles: 1,
    maxSize: 5 * 1024 * 1024,
  })

  const removeImage = (idx) => setForm(f => ({ ...f, images: f.images.filter((_, i) => i !== idx) }))

  const handleChange = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      const payload = {
        ...form,
        price: parseFloat(form.price) || 0,
        category_id: form.category_id || null,
        reservation_time_hours: form.reservation_time_hours ? parseInt(form.reservation_time_hours) : null,
        attributes: (() => { try { return JSON.parse(form.attributes) } catch { return {} } })(),
        tags: form.tags,
        units: form.units,
        variant_attributes: form.variant_attributes,
        parent_product_id: form.parent_product_id || null,
      }

      let saved
      if (product?.id) {
        saved = await productsAPI.update(product.id, payload)
      } else {
        saved = await productsAPI.create(payload)
      }

      // Agregar stock inicial si se especificó
      if (!product?.id && stockData.warehouse_id && stockData.quantity > 0) {
        await stockAPI.createMovement({
          product_id: saved.data.id,
          warehouse_id: stockData.warehouse_id,
          type: 'entrada',
          quantity: parseInt(stockData.quantity),
          notes: 'Stock inicial',
        })
      }

      toast.success(product?.id ? 'Producto actualizado' : 'Producto creado con embedding ✅')
      onSave()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al guardar')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
          <input value={form.name} onChange={e => handleChange('name', e.target.value)} className="input" required />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Precio</label>
          <input type="number" step="0.01" value={form.price} onChange={e => handleChange('price', e.target.value)} className="input" />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Unidad</label>
          <input value={form.unit} onChange={e => handleChange('unit', e.target.value)} className="input" placeholder="unidad, kg, m²..." />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">SKU</label>
          <input value={form.sku} onChange={e => handleChange('sku', e.target.value)} className="input font-mono" />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Código de barras</label>
          <input value={form.barcode} onChange={e => handleChange('barcode', e.target.value)} className="input font-mono" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Categoría</label>
          <select value={form.category_id} onChange={e => handleChange('category_id', e.target.value)} className="input">
            <option value="">Sin categoría</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Descripción <span className="text-brand-500">(afecta búsqueda semántica)</span>
          </label>
          <textarea value={form.description} onChange={e => handleChange('description', e.target.value)} rows={2} className="input resize-none" />
        </div>
        <div className="col-span-2">
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Casos de uso <span className="text-brand-500">(afecta búsqueda semántica)</span>
          </label>
          <textarea value={form.use_cases} onChange={e => handleChange('use_cases', e.target.value)} rows={2} className="input resize-none" placeholder="¿Para qué se usa este producto?" />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Tiempo reserva (hs)</label>
          <input type="number" value={form.reservation_time_hours} onChange={e => handleChange('reservation_time_hours', e.target.value)} className="input" placeholder="usa el de la categoría" />
        </div>
      </div>

      {/* Tags */}
      {hasFeature('tags') && (
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Etiquetas <span className="text-ink-400 font-normal normal-case">· Enter o coma para agregar</span>
          </label>
          <TagInput tags={form.tags} onChange={v => handleChange('tags', v)} />
        </div>
      )}

      {/* Variante: atributos de variante (si tiene padre) */}
      {hasFeature('variants') && product?.parent_product_id && (
        <div className="border border-brand-100 bg-brand-50 rounded-xl p-3">
          <p className="text-xs font-bold text-brand-700 uppercase tracking-wide mb-2">Atributos de variante</p>
          <p className="text-xs text-ink-500 mb-2">Ej: color=Rojo, talla=M</p>
          <div className="space-y-2">
            {Object.entries(form.variant_attributes).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="text-xs font-medium text-ink-600 w-20 shrink-0">{k}</span>
                <input
                  value={v}
                  onChange={e => handleChange('variant_attributes', { ...form.variant_attributes, [k]: e.target.value })}
                  className="input text-xs flex-1"
                />
                <button type="button" onClick={() => {
                  const rest = { ...form.variant_attributes }
                  delete rest[k]
                  handleChange('variant_attributes', rest)
                }} className="text-red-400 hover:text-red-600"><X size={12} /></button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const key = window.prompt('Nombre del atributo (ej: color, talla, tamaño)')
                if (key?.trim()) handleChange('variant_attributes', { ...form.variant_attributes, [key.trim()]: '' })
              }}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
            >
              <Plus size={11} /> Agregar atributo
            </button>
          </div>
        </div>
      )}

      {/* Variantes existentes (solo en producto padre) */}
      {hasFeature('variants') && product?.id && !product?.parent_product_id && (
        <div className="border border-ink-100 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-ink-50 border-b border-ink-100">
            <p className="text-xs font-bold text-ink-600 uppercase tracking-wide flex items-center gap-1.5">
              <Layers size={12} /> Variantes ({variants.length})
            </p>
            <button
              type="button"
              onClick={() => {
                // Abrir formulario para crear variante (producto hijo)
                onSave({ openVariant: product.id })
              }}
              className="text-xs text-brand-600 hover:text-brand-700 font-medium flex items-center gap-1"
            >
              <Plus size={11} /> Agregar
            </button>
          </div>
          {loadingVariants ? (
            <div className="p-3 text-center text-xs text-ink-400">Cargando...</div>
          ) : variants.length === 0 ? (
            <div className="p-3 text-center text-xs text-ink-400">Sin variantes. Agrega la primera.</div>
          ) : (
            <div className="divide-y divide-ink-50">
              {variants.map(v => (
                <div key={v.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-ink-800">{v.name}</p>
                    <div className="flex gap-1 flex-wrap mt-0.5">
                      {Object.entries(v.variant_attributes || {}).map(([k, val]) => (
                        <span key={k} className="text-[10px] bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded">{k}: {val}</span>
                      ))}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-brand-600">${Number(v.price).toLocaleString()}</span>
                  <span className={clsx('badge text-[10px]', v.total_stock > 0 ? 'badge-green' : 'badge-red')}>
                    {v.total_stock}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Multi-unidad */}
      {hasFeature('multi_unit') && (
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
            Unidades de medida <span className="text-ink-400 font-normal normal-case">· unidades adicionales de venta</span>
          </label>
          <UnitsEditor
            baseUnit={form.unit || 'unidad'}
            units={form.units}
            onChange={v => handleChange('units', v)}
          />
        </div>
      )}

      {/* Imágenes */}
      <div>
        <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-2">
          Imágenes <span className="text-brand-500">(la IA las usa para reconocer fotos)</span>
        </label>
        <div className="flex gap-2 flex-wrap mb-2">
          {form.images.map((url, i) => (
            <div key={i} className="relative group w-16 h-16">
              <img src={url} className="w-16 h-16 rounded-xl object-cover border border-ink-100" alt="" />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={11} className="text-white" />
              </button>
            </div>
          ))}
          <div
            {...getRootProps()}
            className={`w-16 h-16 rounded-xl border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-all ${
              isDragActive ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50'
            }`}
          >
            <input {...getInputProps()} />
            {uploadingImg
              ? <Loader2 size={16} className="text-brand-500 animate-spin" />
              : <Upload size={16} className="text-ink-400" />
            }
          </div>
        </div>
        <p className="text-xs text-ink-400">PNG, JPG, WEBP · máx 5MB por imagen</p>
      </div>

      {/* Stock inicial (solo creación) */}
      {!product?.id && warehouses.length > 0 && (
        <div className="border border-brand-100 bg-brand-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-brand-700 uppercase tracking-wide">Stock inicial (opcional)</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-ink-500 block mb-1">Almacén</label>
              <select value={stockData.warehouse_id} onChange={e => setStockData(s => ({ ...s, warehouse_id: e.target.value }))} className="input text-sm">
                <option value="">Seleccionar...</option>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-500 block mb-1">Cantidad</label>
              <input type="number" value={stockData.quantity} onChange={e => setStockData(s => ({ ...s, quantity: e.target.value }))} className="input text-sm" />
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancelar</button>
        <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
          {loading ? <><Loader2 size={15} className="animate-spin" /> Guardando...</> : 'Guardar'}
        </button>
      </div>
    </form>
  )
}

function StockDetailModal({ open, onClose, product, warehouses }) {
  if (!open || !product) return null
  const rows = product.stock_by_warehouse || []
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-sm">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <div>
            <h3 className="text-base font-bold text-ink-900">Stock por almacén</h3>
            <p className="text-xs text-ink-400 mt-0.5">{product.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">
          {rows.length === 0 ? (
            <div className="text-center py-8 text-ink-400">
              <Warehouse size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Sin stock registrado</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rows.map((r) => {
                const wh = warehouses.find(w => w.id === r.warehouse_id)
                return (
                  <div key={r.warehouse_id} className="flex items-center justify-between p-3 rounded-xl bg-ink-50 border border-ink-100">
                    <div className="flex items-center gap-2">
                      <Warehouse size={14} className="text-brand-500" />
                      <span className="text-sm font-medium text-ink-700">{wh?.name || r.warehouse_id}</span>
                    </div>
                    <span className={clsx('badge', r.quantity > 0 ? 'badge-green' : 'badge-red')}>
                      {r.quantity}
                    </span>
                  </div>
                )
              })}
              <div className="flex items-center justify-between p-3 rounded-xl bg-brand-50 border border-brand-100 mt-3">
                <span className="text-sm font-bold text-brand-700">Total</span>
                <span className="badge badge-orange">{product.total_stock || 0}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ProductsPage() {
  const { user } = useAuth()
  const { hasFeature } = useCompanyFeatures()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'create' | product obj
  const [stockModal, setStockModal] = useState(null) // product obj para ver desglose
  const [confirmDelete, setConfirmDelete] = useState(null) // null | { id, name }

  const load = () => {
    setLoading(true)
    Promise.all([
      productsAPI.list({ search }),
      categoriesAPI.list(),
      warehousesAPI.list(),
    ]).then(([p, c, w]) => {
      setProducts(p.data)
      setCategories(c.data)
      setWarehouses(w.data)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [search])

  const doDelete = async () => {
    await productsAPI.delete(confirmDelete.id)
    toast.success('Producto desactivado')
    setConfirmDelete(null)
    load()
  }

  const handleRegenerateEmbedding = async (id) => {
    toast.promise(productsAPI.regenerateEmbedding(id), {
      loading: 'Regenerando embedding...',
      success: 'Embedding actualizado ✅',
      error: 'Error al regenerar',
    })
  }

  const isAdmin = user?.role === 'admin'

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Productos</h1>
        {isAdmin && (
          <button onClick={() => setModal('create')} className="btn-primary">
            <Plus size={16} /> Nuevo producto
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar productos..." className="input pl-10" />
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Stock</th>
              <th>Estado</th>
              {isAdmin && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan={7}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
              ))
            ) : products.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-ink-400">Sin productos</td></tr>
            ) : products.map(p => {
              const cat = categories.find(c => c.id === p.category_id)
              return (
                <tr key={p.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ProductImage src={p.images?.[0]} className="w-9 h-9 rounded-lg" iconSize={14} />
                      <div>
                        <p className="font-semibold text-ink-900 text-sm">{p.name}</p>
                        <p className="text-xs text-ink-400">{p.unit}</p>
                        {hasFeature('tags') && p.tags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {p.tags.slice(0, 3).map(tag => (
                              <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-brand-50 text-brand-600 rounded text-[10px] font-medium border border-brand-100">
                                <Tag size={8} /> {tag}
                              </span>
                            ))}
                            {p.tags.length > 3 && <span className="text-[10px] text-ink-400">+{p.tags.length - 3}</span>}
                          </div>
                        )}
                        {hasFeature('variants') && p.parent_product_id && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-[10px] font-medium border border-purple-100 mt-1">
                            <Layers size={8} /> Variante
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td><span className="font-mono text-xs text-ink-500">{p.sku || '—'}</span></td>
                  <td><span className="text-xs text-ink-600">{cat?.name || '—'}</span></td>
                  <td><span className="font-semibold text-brand-600">${Number(p.price).toLocaleString()}</span></td>
                  <td>
                    <button
                      onClick={() => setStockModal(p)}
                      title="Ver stock por almacén"
                      className={clsx('badge cursor-pointer hover:opacity-80 transition-opacity', (p.total_stock || 0) > 0 ? 'badge-green' : 'badge-red')}
                    >
                      {p.total_stock || 0}
                    </button>
                  </td>
                  <td>
                    <span className={clsx('badge', p.is_active ? 'badge-green' : 'badge-gray')}>
                      {p.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setModal(p)} className="btn-ghost p-2 text-ink-500" title="Editar">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => handleRegenerateEmbedding(p.id)} className="btn-ghost p-2 text-brand-500" title="Regenerar embedding">
                          <RefreshCw size={14} />
                        </button>
                        <button onClick={() => setConfirmDelete({ id: p.id, name: p.name })} className="btn-ghost p-2 text-red-500 hover:bg-red-50" title="Desactivar">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal editar/crear */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'Nuevo producto' : `Editar: ${modal?.name}`}
      >
        <ProductForm
          product={modal === 'create' ? null : modal}
          categories={categories}
          warehouses={warehouses}
          onSave={(extra) => {
            setModal(null)
            load()
            // Si se solicitó crear una variante del producto padre
            if (extra?.openVariant) {
              const parent = products.find(p => p.id === extra.openVariant)
              if (parent) {
                setModal({
                  ...parent,
                  id: undefined, // nuevo producto
                  name: `${parent.name} — Variante`,
                  parent_product_id: parent.id,
                  variant_attributes: {},
                })
              }
            }
          }}
          onClose={() => setModal(null)}
        />
      </Modal>

      {/* Modal confirmación eliminar */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Confirmar desactivación">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            ¿Desactivar <strong className="text-ink-900">"{confirmDelete?.name}"</strong>?
            El producto dejará de aparecer en el catálogo.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button onClick={doDelete} className="btn-danger flex-1 justify-center">Desactivar</button>
          </div>
        </div>
      </Modal>

      {/* Modal stock por almacén */}
      <StockDetailModal
        open={!!stockModal}
        onClose={() => setStockModal(null)}
        product={stockModal}
        warehouses={warehouses}
      />
    </div>
  )
}
