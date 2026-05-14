/**
 * pages/admin/SerialsPage.jsx
 * Gestión de números de serie — solo visible con feature serial_numbers.
 */
import { useState, useEffect } from 'react'
import { serialsAPI, productsAPI, warehousesAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useCompanyFeatures } from '../../context/CompanyFeaturesContext'
import toast from 'react-hot-toast'
import {
  Hash, Search, Plus, X, Loader2, CheckCircle2,
  Clock, PackageCheck, Archive, AlertTriangle, Pencil
} from 'lucide-react'
import clsx from 'clsx'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

const STATUS_CONFIG = {
  in_stock:  { label: 'En stock',   badge: 'badge-green',  icon: CheckCircle2 },
  reserved:  { label: 'Reservado',  badge: 'badge-yellow', icon: Clock        },
  sold:      { label: 'Vendido',    badge: 'badge-orange', icon: PackageCheck },
  retired:   { label: 'Retirado',   badge: 'badge-gray',   icon: Archive      },
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export default function SerialsPage() {
  const { user } = useAuth()
  const { hasFeature } = useCompanyFeatures()
  const [serials, setSerials] = useState([])
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterProduct, setFilterProduct] = useState('')
  const [modal, setModal] = useState(false)
  const [editSerial, setEditSerial] = useState(null)
  const [searchSerial, setSearchSerial] = useState('')
  const [foundSerial, setFoundSerial] = useState(null)
  const [searching, setSearching] = useState(false)

  // Form para crear seriales
  const [form, setForm] = useState({
    product_id: '',
    warehouse_id: '',
    serial_numbers: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  const isAdmin = user?.role === 'admin'

  const load = () => {
    setLoading(true)
    Promise.all([
      serialsAPI.list({ search: search || undefined, status: filterStatus || undefined, product_id: filterProduct || undefined }),
      productsAPI.list(),
      warehousesAPI.list(),
    ]).then(([s, p, w]) => {
      setSerials(s.data || [])
      setProducts(p.data || [])
      setWarehouses(w.data || [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    const t = setTimeout(load, 400)
    return () => clearTimeout(t)
  }, [search, filterStatus, filterProduct])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const lines = form.serial_numbers.split('\n').map(s => s.trim()).filter(Boolean)
      if (!lines.length) { toast.error('Ingresa al menos un número de serie'); return }
      const res = await serialsAPI.create({
        product_id: form.product_id,
        warehouse_id: form.warehouse_id,
        serial_numbers: lines,
        notes: form.notes || null,
      })
      toast.success(`${res.data.created} serie(s) registrada(s)`)
      setModal(false)
      setForm({ product_id: '', warehouse_id: '', serial_numbers: '', notes: '' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al crear')
    } finally { setSaving(false) }
  }

  const handleStatusUpdate = async (id, status) => {
    try {
      await serialsAPI.update(id, { status })
      toast.success('Estado actualizado')
      load()
      setEditSerial(null)
    } catch {
      toast.error('Error al actualizar')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar este número de serie?')) return
    try {
      await serialsAPI.delete(id)
      toast.success('Eliminado')
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    }
  }

  const handleSearch = async () => {
    if (!searchSerial.trim()) return
    setSearching(true)
    try {
      const res = await serialsAPI.find(searchSerial.trim())
      setFoundSerial(res.data)
    } catch {
      setFoundSerial(null)
      toast.error('Número de serie no encontrado')
    } finally { setSearching(false) }
  }

  if (!hasFeature('serial_numbers')) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-ink-400">
        <Hash size={48} className="mb-4 opacity-30" />
        <p className="font-semibold">Números de serie no habilitados</p>
        <p className="text-sm mt-1">Actívalos desde el panel de Super Admin → Sector de empresa</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Números de serie</h1>
        {isAdmin && (
          <button onClick={() => setModal(true)} className="btn-primary">
            <Plus size={16} /> Registrar series
          </button>
        )}
      </div>

      {/* Buscador rápido por número de serie */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-ink-500 uppercase tracking-wide mb-2">Buscar número de serie específico</p>
        <div className="flex gap-2">
          <input
            value={searchSerial}
            onChange={e => setSearchSerial(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="SN-ABC-12345..."
            className="input flex-1 font-mono"
          />
          <button onClick={handleSearch} disabled={searching} className="btn-primary px-4">
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          </button>
        </div>
        {foundSerial && (
          <div className="mt-3 p-3 rounded-xl bg-ink-50 border border-ink-100 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-mono font-bold text-ink-900">{foundSerial.serial_number}</span>
              <span className={clsx('badge', STATUS_CONFIG[foundSerial.status]?.badge)}>
                {STATUS_CONFIG[foundSerial.status]?.label}
              </span>
            </div>
            <p className="text-sm text-ink-600">{foundSerial.products?.name}</p>
            <p className="text-xs text-ink-400">{foundSerial.warehouses?.name} · Registrado: {format(parseISO(foundSerial.created_at), 'd MMM yyyy', { locale: es })}</p>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar serie..."
            className="input pl-9 w-48 font-mono text-sm"
          />
        </div>
        <select value={filterProduct} onChange={e => setFilterProduct(e.target.value)} className="input w-48 text-sm">
          <option value="">Todos los productos</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="input w-40 text-sm">
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>

      {/* Tabla */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Número de serie</th>
              <th>Producto</th>
              <th>Almacén</th>
              <th>Estado</th>
              <th>Registrado</th>
              {isAdmin && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}><td colSpan={6}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
              ))
            ) : serials.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-ink-400">
                  <Hash size={32} className="mx-auto mb-2 opacity-40" />
                  <p>Sin números de serie</p>
                </td>
              </tr>
            ) : serials.map(s => {
              const st = STATUS_CONFIG[s.status] || STATUS_CONFIG.in_stock
              const StIcon = st.icon
              return (
                <tr key={s.id}>
                  <td>
                    <span className="font-mono font-semibold text-ink-800 text-sm">{s.serial_number}</span>
                    {s.notes && <p className="text-xs text-ink-400 mt-0.5">{s.notes}</p>}
                  </td>
                  <td className="text-sm text-ink-700">{s.products?.name || '—'}</td>
                  <td className="text-sm text-ink-600">{s.warehouses?.name || '—'}</td>
                  <td>
                    <span className={clsx('badge flex items-center gap-1 w-fit', st.badge)}>
                      <StIcon size={10} /> {st.label}
                    </span>
                  </td>
                  <td className="text-xs text-ink-400">
                    {format(parseISO(s.created_at), 'd MMM yyyy', { locale: es })}
                  </td>
                  {isAdmin && (
                    <td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditSerial(s)} className="btn-ghost p-2 text-ink-500" title="Cambiar estado">
                          <Pencil size={13} />
                        </button>
                        {s.status === 'in_stock' && (
                          <button onClick={() => handleDelete(s.id)} className="btn-ghost p-2 text-red-500 hover:bg-red-50" title="Eliminar">
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal crear series */}
      <Modal open={modal} onClose={() => setModal(false)} title="Registrar números de serie">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Producto *</label>
            <select value={form.product_id} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))} className="input" required>
              <option value="">Seleccionar...</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Almacén *</label>
            <select value={form.warehouse_id} onChange={e => setForm(f => ({ ...f, warehouse_id: e.target.value }))} className="input" required>
              <option value="">Seleccionar...</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Números de serie * <span className="text-ink-400 font-normal normal-case">· uno por línea</span>
            </label>
            <textarea
              value={form.serial_numbers}
              onChange={e => setForm(f => ({ ...f, serial_numbers: e.target.value }))}
              rows={6}
              className="input resize-none font-mono text-sm"
              placeholder={"SN-ABC-001\nSN-ABC-002\nSN-ABC-003"}
              required
            />
            <p className="text-xs text-ink-400 mt-1">
              {form.serial_numbers.split('\n').filter(s => s.trim()).length} serie(s) a registrar
            </p>
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Notas</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input" placeholder="Ej: Compra proveedor X..." />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal cambiar estado */}
      <Modal open={!!editSerial} onClose={() => setEditSerial(null)} title="Cambiar estado">
        {editSerial && (
          <div className="space-y-3">
            <p className="text-sm text-ink-600">
              Serie: <span className="font-mono font-bold text-ink-900">{editSerial.serial_number}</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
                const Icon = cfg.icon
                return (
                  <button
                    key={key}
                    onClick={() => handleStatusUpdate(editSerial.id, key)}
                    className={clsx(
                      'flex items-center gap-2 p-3 rounded-xl border text-sm font-medium transition-all',
                      editSerial.status === key
                        ? 'border-brand-400 bg-brand-50 text-brand-700'
                        : 'border-ink-200 hover:border-brand-300 text-ink-600'
                    )}
                  >
                    <Icon size={14} /> {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
