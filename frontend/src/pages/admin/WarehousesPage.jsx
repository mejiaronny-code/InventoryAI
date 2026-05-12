/**
 * pages/admin/WarehousesPage.jsx
 */
import { useState, useEffect } from 'react'
import { warehousesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Warehouse, MapPin, X, Loader2 } from 'lucide-react'

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

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', location: '', description: '' })
  const [saving, setSaving] = useState(false)

  const load = () => warehousesAPI.list().then(r => setWarehouses(r.data))
  useEffect(() => { load() }, [])

  const openCreate = () => { setForm({ name: '', location: '', description: '' }); setModal('create') }
  const openEdit = (w) => { setForm({ name: w.name, location: w.location || '', description: w.description || '' }); setModal(w) }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      if (modal === 'create') await warehousesAPI.create(form)
      else await warehousesAPI.update(modal.id, form)
      toast.success('Guardado'); setModal(null); load()
    } catch { toast.error('Error') } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Desactivar almacén?')) return
    await warehousesAPI.delete(id); toast.success('Desactivado'); load()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Almacenes</h1>
        <button onClick={openCreate} className="btn-primary"><Plus size={16} /> Nuevo almacén</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {warehouses.map(w => (
          <div key={w.id} className="card p-5">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-xl bg-ink-900 flex items-center justify-center">
                <Warehouse size={18} className="text-white" />
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(w)} className="btn-ghost p-1.5"><Pencil size={13} /></button>
                <button onClick={() => handleDelete(w.id)} className="btn-ghost p-1.5 text-red-400 hover:bg-red-50"><Trash2 size={13} /></button>
              </div>
            </div>
            <h3 className="font-bold text-ink-900 mb-1">{w.name}</h3>
            {w.location && (
              <p className="text-xs text-ink-500 flex items-center gap-1"><MapPin size={11} /> {w.location}</p>
            )}
            {w.description && <p className="text-xs text-ink-400 mt-1 line-clamp-2">{w.description}</p>}
            <div className={`badge mt-3 ${w.is_active ? 'badge-green' : 'badge-gray'} text-xs`}>
              {w.is_active ? 'Activo' : 'Inactivo'}
            </div>
          </div>
        ))}
        {warehouses.length === 0 && <p className="col-span-3 text-center text-ink-400 py-12">Sin almacenes</p>}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'Nuevo almacén' : 'Editar almacén'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Ubicación</label>
            <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Descripción</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="input resize-none" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setModal(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
