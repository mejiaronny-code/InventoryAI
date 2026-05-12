/**
 * pages/admin/CategoriesPage.jsx
 */
import { useState, useEffect } from 'react'
import { categoriesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Tag, X, Loader2 } from 'lucide-react'

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md animate-slide-up">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export default function CategoriesPage() {
  const [cats, setCats] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', reservation_time_hours: 24 })
  const [saving, setSaving] = useState(false)

  const load = () => categoriesAPI.list().then(r => setCats(r.data))
  useEffect(() => { load() }, [])

  const openCreate = () => { setForm({ name: '', description: '', reservation_time_hours: 24 }); setModal('create') }
  const openEdit = (c) => { setForm({ name: c.name, description: c.description || '', reservation_time_hours: c.reservation_time_hours }); setModal(c) }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      if (modal === 'create') await categoriesAPI.create(form)
      else await categoriesAPI.update(modal.id, form)
      toast.success('Guardado'); setModal(null); load()
    } catch { toast.error('Error') } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Eliminar?')) return
    await categoriesAPI.delete(id); toast.success('Eliminada'); load()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Categorías</h1>
        <button onClick={openCreate} className="btn-primary"><Plus size={16} /> Nueva</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cats.map(c => (
          <div key={c.id} className="card p-5 flex flex-col gap-2">
            <div className="flex items-start justify-between">
              <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center">
                <Tag size={16} className="text-brand-500" />
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(c)} className="btn-ghost p-1.5"><Pencil size={13} /></button>
                <button onClick={() => handleDelete(c.id)} className="btn-ghost p-1.5 text-red-400 hover:bg-red-50"><Trash2 size={13} /></button>
              </div>
            </div>
            <h3 className="font-bold text-ink-900">{c.name}</h3>
            {c.description && <p className="text-xs text-ink-500 line-clamp-2">{c.description}</p>}
            <span className="badge badge-orange text-xs self-start">⏱ {c.reservation_time_hours}h reserva</span>
          </div>
        ))}
        {cats.length === 0 && <p className="col-span-3 text-center text-ink-400 py-12">Sin categorías</p>}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'Nueva categoría' : 'Editar categoría'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Descripción</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="input resize-none" />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Tiempo reserva (horas)</label>
            <input type="number" value={form.reservation_time_hours} onChange={e => setForm(f => ({ ...f, reservation_time_hours: parseInt(e.target.value) }))} className="input" min={1} />
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
