/**
 * pages/admin/StockPage.jsx
 */
import { useState, useEffect } from 'react'
import { stockAPI, productsAPI, warehousesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import {
  Plus, ArrowUp, ArrowDown, RefreshCw, BarChart3,
  X, Loader2, Pencil, Warehouse, Package
} from 'lucide-react'
import ProductImage from '../../components/shared/ProductImage'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const typeConfig = {
  entrada:       { color: 'badge-green',  icon: ArrowUp,    label: 'Entrada'       },
  salida:        { color: 'badge-red',    icon: ArrowDown,  label: 'Salida'        },
  transferencia: { color: 'badge-orange', icon: RefreshCw,  label: 'Transferencia' },
  ajuste:        { color: 'badge-gray',   icon: BarChart3,  label: 'Ajuste'        },
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

function EditStockModal({ open, onClose, item, onSaved }) {
  const [newQty, setNewQty] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && item) setNewQty(String(item.current_qty))
  }, [open, item])

  if (!open || !item) return null

  const handleSave = async (e) => {
    e.preventDefault()
    const qty = parseInt(newQty)
    if (isNaN(qty) || qty < 0) { toast.error('Cantidad inválida'); return }
    setSaving(true)
    try {
      await stockAPI.createMovement({
        product_id: item.product_id,
        warehouse_id: item.warehouse_id,
        type: 'ajuste',
        quantity: qty,
        notes: `Ajuste manual: ${item.current_qty} → ${qty}`,
      })
      toast.success('Stock actualizado')
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al actualizar')
    } finally {
      setSaving(false)
    }
  }

  const diff = parseInt(newQty) - item.current_qty
  const diffLabel = isNaN(diff) ? null : diff > 0 ? `+${diff}` : diff < 0 ? `${diff}` : '±0'
  const diffColor = diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-ink-400'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-sm">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <div>
            <h3 className="text-base font-bold text-ink-900">Editar stock</h3>
            <p className="text-xs text-ink-400 mt-0.5">{item.product_name} · {item.warehouse_name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <form onSubmit={handleSave} className="p-6 space-y-4">
          <div className="flex items-center gap-4 p-3 rounded-xl bg-ink-50 border border-ink-100">
            <div className="text-center flex-1">
              <p className="text-xs text-ink-400 mb-1">Actual</p>
              <p className="text-2xl font-bold text-ink-700">{item.current_qty}</p>
            </div>
            <div className="text-ink-300 text-xl">→</div>
            <div className="text-center flex-1">
              <p className="text-xs text-ink-400 mb-1">Nuevo</p>
              <p className={clsx('text-2xl font-bold', parseInt(newQty) >= 0 ? 'text-ink-900' : 'text-ink-300')}>
                {newQty !== '' ? newQty : '—'}
              </p>
            </div>
            {diffLabel && (
              <div className="text-center flex-1">
                <p className="text-xs text-ink-400 mb-1">Diferencia</p>
                <p className={clsx('text-2xl font-bold', diffColor)}>{diffLabel}</p>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Nueva cantidad *
            </label>
            <input
              type="number"
              min="0"
              value={newQty}
              onChange={e => setNewQty(e.target.value)}
              className="input text-center text-xl font-bold"
              autoFocus
              required
            />
          </div>

          <p className="text-xs text-ink-400 text-center">
            Se registrará como <span className="font-semibold text-ink-600">ajuste manual</span> en el historial.
          </p>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function StockPage() {
  const [movements, setMovements] = useState([])
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [modal, setModal] = useState(false)
  const [editModal, setEditModal] = useState(null)
  const [form, setForm] = useState({ product_id: '', warehouse_id: '', type: 'entrada', quantity: 1, notes: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('current')

  const load = () => {
    setLoading(true)
    Promise.all([
      stockAPI.listMovements(),
      productsAPI.list(),
      warehousesAPI.list(),
    ]).then(([m, p, w]) => {
      setMovements(m.data); setProducts(p.data); setWarehouses(w.data)
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  // Aplanar productos → filas por producto+almacén
  const currentStockRows = products.flatMap(p =>
    (p.stock_by_warehouse || []).map(s => {
      const wh = warehouses.find(w => w.id === s.warehouse_id)
      return {
        product_id: p.id,
        product_name: p.name,
        product_image: p.images?.[0] || null,
        warehouse_id: s.warehouse_id,
        warehouse_name: wh?.name || s.warehouse_id,
        current_qty: s.quantity,
      }
    })
  )

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await stockAPI.createMovement({ ...form, quantity: parseInt(form.quantity) })
      toast.success('Movimiento registrado'); setModal(false); load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Stock</h1>
        <button onClick={() => setModal(true)} className="btn-primary"><Plus size={16} /> Registrar movimiento</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-ink-100 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('current')}
          className={clsx(
            'px-4 py-1.5 rounded-lg text-sm font-semibold transition-all',
            activeTab === 'current'
              ? 'bg-white text-ink-900 shadow-sm'
              : 'text-ink-500 hover:text-ink-700'
          )}
        >
          Inventario actual
        </button>
        <button
          onClick={() => setActiveTab('movements')}
          className={clsx(
            'px-4 py-1.5 rounded-lg text-sm font-semibold transition-all',
            activeTab === 'movements'
              ? 'bg-white text-ink-900 shadow-sm'
              : 'text-ink-500 hover:text-ink-700'
          )}
        >
          Historial de movimientos
        </button>
      </div>

      {/* Tab: Inventario actual */}
      {activeTab === 'current' && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Almacén</th>
                <th>Cantidad</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={4}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
                ))
              ) : currentStockRows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-ink-400">
                    <Warehouse size={32} className="mx-auto mb-2 opacity-40" />
                    <p>Sin stock registrado</p>
                    <p className="text-xs mt-1">Registra un movimiento de entrada para comenzar</p>
                  </td>
                </tr>
              ) : currentStockRows.map((row, i) => (
                <tr key={`${row.product_id}-${row.warehouse_id}-${i}`}>
                  <td>
                    <div className="flex items-center gap-3">
                      <ProductImage src={row.product_image} className="w-8 h-8 rounded-lg" iconSize={13} />
                      <span className="font-medium text-ink-900 text-sm">{row.product_name}</span>
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <Warehouse size={13} className="text-ink-400" />
                      <span className="text-sm text-ink-600">{row.warehouse_name}</span>
                    </div>
                  </td>
                  <td>
                    <span className={clsx('badge', row.current_qty > 0 ? 'badge-green' : 'badge-red')}>
                      {row.current_qty}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => setEditModal(row)}
                      className="btn-ghost p-2 text-ink-500"
                      title="Editar cantidad"
                    >
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Historial de movimientos */}
      {activeTab === 'movements' && (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Producto</th>
                <th>Almacén</th>
                <th>Cantidad</th>
                <th>Notas</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}><td colSpan={6}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
                ))
              ) : movements.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-12 text-ink-400">Sin movimientos</td></tr>
              ) : movements.map(m => {
                const t = typeConfig[m.type] || typeConfig.ajuste
                const TIcon = t.icon
                return (
                  <tr key={m.id}>
                    <td>
                      <span className={`badge ${t.color} flex items-center gap-1 w-fit`}>
                        <TIcon size={11} /> {t.label}
                      </span>
                    </td>
                    <td className="font-medium text-ink-900">{m.products?.name || m.product_id}</td>
                    <td className="text-ink-600">{m.warehouses?.name || '—'}</td>
                    <td>
                      <span className={clsx(
                        'font-bold text-sm',
                        m.type === 'entrada' ? 'text-green-600' :
                        m.type === 'salida' ? 'text-red-600' : 'text-ink-700'
                      )}>
                        {m.type === 'entrada' ? '+' : m.type === 'salida' ? '-' : ''}{m.quantity}
                      </span>
                    </td>
                    <td className="text-xs text-ink-400">{m.notes || '—'}</td>
                    <td className="text-xs text-ink-400">
                      {format(new Date(m.created_at), 'd MMM HH:mm', { locale: es })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal registrar movimiento */}
      <Modal open={modal} onClose={() => setModal(false)} title="Registrar movimiento">
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Tipo *</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="input">
              {Object.entries(typeConfig).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
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
              Cantidad {form.type === 'ajuste' ? '(valor final)' : ''} *
            </label>
            <input type="number" min="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} className="input" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Notas</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input" placeholder="Motivo del movimiento..." />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Registrar'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal editar stock */}
      <EditStockModal
        open={!!editModal}
        onClose={() => setEditModal(null)}
        item={editModal}
        onSaved={load}
      />
    </div>
  )
}
