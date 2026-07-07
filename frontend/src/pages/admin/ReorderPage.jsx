/**
 * pages/admin/ReorderPage.jsx
 * Solicitudes de reabastecimiento — generadas automáticamente cuando el stock
 * baja del mínimo, o creadas manualmente por el admin.
 */
import { useState, useEffect } from 'react'
import { reorderAPI, productsAPI, warehousesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import {
  ShoppingCart, Plus, RefreshCw, CheckCircle2, Truck,
  X, Loader2, Trash2, Package, Warehouse, AlertTriangle, Pencil
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const STATUS_CFG = {
  pending:   { label: 'Pendiente',  color: 'badge-orange', icon: AlertTriangle },
  ordered:   { label: 'Pedido',     color: 'badge-gray',   icon: Truck         },
  received:  { label: 'Recibido',   color: 'badge-green',  icon: CheckCircle2  },
  cancelled: { label: 'Cancelado',  color: 'badge-gray',   icon: X             },
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export default function ReorderPage() {
  const [requests, setRequests] = useState([])
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [modal, setModal] = useState(false)
  const [editModal, setEditModal] = useState(null)
  const [editQty, setEditQty] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [form, setForm] = useState({ product_id: '', warehouse_id: '', requested_quantity: '', notes: '' })
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [rRes, pRes, wRes] = await Promise.all([
        reorderAPI.list(statusFilter !== 'all' ? { status: statusFilter } : {}),
        productsAPI.list(),
        warehousesAPI.list(),
      ])
      setRequests(rRes.data || [])
      setProducts(pRes.data || [])
      setWarehouses(wRes.data || [])
    } catch { toast.error('Error al cargar') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [statusFilter])

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await reorderAPI.create({ ...form, requested_quantity: parseInt(form.requested_quantity) || 0 })
      toast.success('Solicitud creada')
      setModal(false)
      setForm({ product_id: '', warehouse_id: '', requested_quantity: '', notes: '' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    } finally { setSaving(false) }
  }

  const handleStatus = async (id, status) => {
    try {
      await reorderAPI.update(id, { status })
      toast.success('Estado actualizado')
      load()
    } catch { toast.error('Error al actualizar') }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar esta solicitud?')) return
    try {
      await reorderAPI.delete(id)
      toast.success('Eliminada')
      load()
    } catch { toast.error('Error al eliminar') }
  }

  const openEdit = (r) => {
    setEditModal(r)
    setEditQty(String(r.requested_quantity ?? ''))
    setEditNotes(r.notes || '')
  }

  const handleSaveEdit = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await reorderAPI.update(editModal.id, {
        requested_quantity: parseInt(editQty) || 0,
        notes: editNotes || null,
      })
      toast.success('Solicitud actualizada')
      setEditModal(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al actualizar')
    } finally { setSaving(false) }
  }

  const counts = {
    pending:   requests.filter(r => r.status === 'pending').length,
    ordered:   requests.filter(r => r.status === 'ordered').length,
    received:  requests.filter(r => r.status === 'received').length,
    cancelled: requests.filter(r => r.status === 'cancelled').length,
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ShoppingCart size={22} className="text-brand-500" />
            Reabastecimiento
          </h1>
          <p className="text-sm text-ink-400 mt-0.5">
            Solicitudes generadas automáticamente cuando el stock baja del mínimo
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
          <button onClick={() => setModal(true)} className="btn-primary">
            <Plus size={14} /> Nueva solicitud
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS_CFG).map(([key, cfg]) => {
          const Icon = cfg.icon
          return (
            <button
              key={key}
              onClick={() => setStatusFilter(key)}
              className={clsx(
                'card p-4 text-center transition-all hover:shadow-md',
                statusFilter === key && 'ring-2 ring-brand-400'
              )}
            >
              <Icon size={18} className="mx-auto mb-1 text-ink-400" />
              <p className="text-2xl font-extrabold text-ink-800">{counts[key]}</p>
              <p className="text-xs text-ink-400">{cfg.label}</p>
            </button>
          )
        })}
      </div>

      {/* Filtros */}
      <div className="flex gap-1 bg-ink-100 p-1 rounded-xl w-fit">
        {[{ key: 'all', label: 'Todas' }, ...Object.entries(STATUS_CFG).map(([k, v]) => ({ key: k, label: v.label }))].map(s => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            className={clsx(
              'px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
              statusFilter === s.key ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Almacén</th>
              <th>Stock actual</th>
              <th>Mínimo</th>
              <th>Cantidad a pedir</th>
              <th>Estado</th>
              <th>Creado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => (
                <tr key={i}><td colSpan={8}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
              ))
            ) : requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12 text-ink-400">
                  <ShoppingCart size={32} className="mx-auto mb-2 opacity-30" />
                  <p>Sin solicitudes {statusFilter !== 'all' ? `"${STATUS_CFG[statusFilter]?.label}"` : ''}</p>
                </td>
              </tr>
            ) : requests.map(r => {
              const st = STATUS_CFG[r.status] || STATUS_CFG.pending
              const StIcon = st.icon
              const isLow = r.current_stock <= r.min_stock_alert
              return (
                <tr key={r.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <Package size={14} className="text-ink-400 shrink-0" />
                      <div>
                        <p className="font-semibold text-ink-900 text-sm">{r.products?.name || '—'}</p>
                        {r.products?.sku && <p className="text-[10px] text-ink-400 font-mono">{r.products.sku}</p>}
                        {r.notes && <p className="text-[10px] text-ink-400 italic">{r.notes}</p>}
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5 text-sm text-ink-600">
                      <Warehouse size={13} className="text-ink-400" />
                      {r.warehouses?.name || '—'}
                    </div>
                  </td>
                  <td>
                    <span className={clsx('badge', isLow ? 'badge-red' : 'badge-green')}>
                      {r.current_stock} {r.products?.unit || ''}
                    </span>
                  </td>
                  <td className="text-sm text-ink-500">{r.min_stock_alert}</td>
                  <td>
                    <span className="font-bold text-brand-600 text-sm">
                      {r.requested_quantity} {r.products?.unit || ''}
                    </span>
                  </td>
                  <td>
                    <span className={clsx('badge flex items-center gap-1 w-fit', st.color)}>
                      <StIcon size={10} /> {st.label}
                    </span>
                  </td>
                  <td className="text-xs text-ink-400">
                    {format(parseISO(r.created_at), 'd MMM yyyy', { locale: es })}
                  </td>
                  <td>
                    <div className="flex items-center gap-1">
                      {r.status === 'pending' && (
                        <button
                          onClick={() => handleStatus(r.id, 'ordered')}
                          className="btn-ghost text-xs px-2 py-1 text-blue-600 hover:bg-blue-50"
                          title="Marcar como pedido"
                        >
                          <Truck size={12} /> Pedido
                        </button>
                      )}
                      {r.status === 'ordered' && (
                        <button
                          onClick={() => handleStatus(r.id, 'received')}
                          className="btn-ghost text-xs px-2 py-1 text-green-600 hover:bg-green-50"
                          title="Marcar como recibido"
                        >
                          <CheckCircle2 size={12} /> Recibido
                        </button>
                      )}
                      {['pending', 'ordered'].includes(r.status) && (
                        <button
                          onClick={() => handleStatus(r.id, 'cancelled')}
                          className="btn-ghost p-1.5 text-ink-400 hover:text-red-500"
                          title="Cancelar"
                        >
                          <X size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(r)}
                        className="btn-ghost p-1.5 text-ink-400 hover:text-brand-600"
                        title="Editar cantidad a pedir"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="btn-ghost p-1.5 text-red-400 hover:text-red-600"
                        title="Eliminar"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal nueva solicitud */}
      <Modal open={modal} onClose={() => setModal(false)} title="Nueva solicitud de reabastecimiento">
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
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Cantidad a solicitar</label>
            <input type="number" min="1" value={form.requested_quantity} onChange={e => setForm(f => ({ ...f, requested_quantity: e.target.value }))} className="input" placeholder="0" />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Notas</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input" placeholder="Proveedor, urgencia, etc." />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Crear solicitud'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal editar cantidad a pedir */}
      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Editar solicitud">
        {editModal && (
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <p className="text-sm text-ink-600">
              <span className="font-semibold text-ink-900">{editModal.products?.name}</span>
              {' · '}{editModal.warehouses?.name}
            </p>
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                Cantidad a pedir
              </label>
              <input
                type="number" min="1" value={editQty}
                onChange={e => setEditQty(e.target.value)}
                className="input" required
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Notas</label>
              <input
                value={editNotes} onChange={e => setEditNotes(e.target.value)}
                className="input" placeholder="Proveedor, urgencia, etc."
              />
            </div>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={() => setEditModal(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
              <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
                {saving ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
