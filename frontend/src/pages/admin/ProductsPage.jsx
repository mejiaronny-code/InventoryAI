/**
 * pages/admin/ProductsPage.jsx
 * CRUD completo de productos con generación automática de embeddings.
 */
import { useState, useEffect } from 'react'
import { productsAPI, categoriesAPI, warehousesAPI, stockAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import toast from 'react-hot-toast'
import {
  Plus, Search, Pencil, Trash2, Package, X,
  RefreshCw, ChevronDown, Loader2, BarChart3
} from 'lucide-react'
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

function ProductForm({ product, categories, warehouses, onSave, onClose }) {
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
  })
  const [stockData, setStockData] = useState({ warehouse_id: '', quantity: 0, min_stock_alert: 5 })
  const [loading, setLoading] = useState(false)

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

export default function ProductsPage() {
  const { user } = useAuth()
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'create' | product obj

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

  const handleDelete = async (id) => {
    if (!confirm('¿Desactivar este producto?')) return
    await productsAPI.delete(id)
    toast.success('Producto desactivado')
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
                      {p.images?.[0]
                        ? <img src={p.images[0]} className="w-9 h-9 rounded-lg object-cover border border-ink-100" alt="" />
                        : <div className="w-9 h-9 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center"><Package size={14} className="text-brand-400" /></div>
                      }
                      <div>
                        <p className="font-semibold text-ink-900 text-sm">{p.name}</p>
                        <p className="text-xs text-ink-400">{p.unit}</p>
                      </div>
                    </div>
                  </td>
                  <td><span className="font-mono text-xs text-ink-500">{p.sku || '—'}</span></td>
                  <td><span className="text-xs text-ink-600">{cat?.name || '—'}</span></td>
                  <td><span className="font-semibold text-brand-600">${Number(p.price).toLocaleString()}</span></td>
                  <td>
                    <span className={clsx('badge', (p.total_stock || 0) > 0 ? 'badge-green' : 'badge-red')}>
                      {p.total_stock || 0}
                    </span>
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
                        <button onClick={() => handleDelete(p.id)} className="btn-ghost p-2 text-red-500 hover:bg-red-50" title="Desactivar">
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

      {/* Modal */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal === 'create' ? 'Nuevo producto' : `Editar: ${modal?.name}`}
      >
        <ProductForm
          product={modal === 'create' ? null : modal}
          categories={categories}
          warehouses={warehouses}
          onSave={() => { setModal(null); load() }}
          onClose={() => setModal(null)}
        />
      </Modal>
    </div>
  )
}
