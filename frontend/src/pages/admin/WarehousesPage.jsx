/**
 * pages/admin/WarehousesPage.jsx
 */
import { useState, useEffect } from 'react'
import { warehousesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Warehouse, MapPin, Loader2 } from 'lucide-react'
import { Modal } from '../../components/ui'

export default function WarehousesPage() {
  const [warehouses, setWarehouses] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', location: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

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

  const doDelete = async () => {
    await warehousesAPI.delete(confirmDelete.id)
    toast.success('Desactivado')
    setConfirmDelete(null)
    load()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
                <button onClick={() => openEdit(w)} className="btn-ghost w-10 h-10 p-0 justify-center" aria-label={`Editar ${w.name}`}><Pencil size={14} /></button>
                <button onClick={() => setConfirmDelete({ id: w.id, name: w.name })} className="btn-ghost w-10 h-10 p-0 justify-center text-red-400 hover:bg-red-50" aria-label={`Desactivar ${w.name}`}><Trash2 size={14} /></button>
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

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Confirmar desactivación">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            ¿Desactivar el almacén <strong className="text-ink-900">"{confirmDelete?.name}"</strong>?
            Dejará de estar disponible para movimientos de stock.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button onClick={doDelete} className="btn-danger flex-1 justify-center">Desactivar</button>
          </div>
        </div>
      </Modal>

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
