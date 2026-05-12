/**
 * pages/admin/StockPage.jsx
 */
import { useState, useEffect } from 'react'
import { stockAPI, productsAPI, warehousesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, ArrowUp, ArrowDown, RefreshCw, BarChart3, X, Loader2 } from 'lucide-react'
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

export default function StockPage() {
  const [movements, setMovements] = useState([])
  const [products, setProducts] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ product_id: '', warehouse_id: '', type: 'entrada', quantity: 1, notes: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

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
        <h1 className="page-title">Movimientos de Stock</h1>
        <button onClick={() => setModal(true)} className="btn-primary"><Plus size={16} /> Registrar movimiento</button>
      </div>

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
    </div>
  )
}
