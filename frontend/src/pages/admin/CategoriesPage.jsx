/**
 * pages/admin/CategoriesPage.jsx
 */
import { useState, useEffect } from 'react'
import { categoriesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Tag, Loader2, Clock3, Package } from 'lucide-react'
import { EmptyState, ErrorState, Modal, PageLoader } from '../../components/ui'

export default function CategoriesPage() {
  const [cats, setCats] = useState([])
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', reservation_time_hours: 24 })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  const load = () => {
    setLoading(true)
    setLoadError(false)
    categoriesAPI.list()
      .then(r => setCats(r.data))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const openCreate = () => { setForm({ name: '', description: '', reservation_time_hours: 24, max_reservation_qty: '' }); setModal('create') }
  const openEdit = (c) => { setForm({ name: c.name, description: c.description || '', reservation_time_hours: c.reservation_time_hours, max_reservation_qty: c.max_reservation_qty ?? '' }); setModal(c) }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      const payload = {
        ...form,
        max_reservation_qty: form.max_reservation_qty !== '' ? parseInt(form.max_reservation_qty) : null,
      }
      if (modal === 'create') await categoriesAPI.create(payload)
      else await categoriesAPI.update(modal.id, payload)
      toast.success('Guardado'); setModal(null); load()
    } catch { toast.error('Error') } finally { setSaving(false) }
  }

  const doDelete = async () => {
    try {
      await categoriesAPI.delete(confirmDelete.id)
      toast.success('Eliminada')
      setConfirmDelete(null)
      load()
    } catch {
      toast.error('No se pudo eliminar la categoría')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Categorías</h1>
        <button onClick={openCreate} className="btn-primary"><Plus size={16} /> Nueva</button>
      </div>

      {loading ? <PageLoader /> : loadError ? (
        <div className="card"><ErrorState onRetry={load} /></div>
      ) : cats.length === 0 ? (
        <div className="card">
          <EmptyState icon={Tag} title="Sin categorías" description="Crea una categoría para organizar y filtrar tus productos." />
        </div>
      ) : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cats.map(c => (
          <div key={c.id} className="card p-5 flex flex-col gap-2">
            <div className="flex items-start justify-between">
              <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center">
                <Tag size={16} className="text-brand-500" />
              </div>
              <div className="flex gap-1">
                <button onClick={() => openEdit(c)} className="btn-ghost w-10 h-10 p-0 justify-center" aria-label={`Editar ${c.name}`}><Pencil size={14} /></button>
                <button onClick={() => setConfirmDelete({ id: c.id, name: c.name })} className="btn-ghost w-10 h-10 p-0 justify-center text-red-400 hover:bg-red-50" aria-label={`Eliminar ${c.name}`}><Trash2 size={14} /></button>
              </div>
            </div>
            <h3 className="font-bold text-ink-900">{c.name}</h3>
            {c.description && <p className="text-xs text-ink-500 line-clamp-2">{c.description}</p>}
            <div className="flex gap-2 flex-wrap">
              <span className="badge badge-orange text-xs gap-1"><Clock3 size={11} /> {c.reservation_time_hours}h reserva</span>
              {c.max_reservation_qty
                ? <span className="badge badge-gray text-xs gap-1"><Package size={11} /> Máx. {c.max_reservation_qty} por reserva</span>
                : <span className="badge badge-gray text-xs opacity-50">Sin límite de cantidad</span>
              }
            </div>
          </div>
        ))}
      </div>}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Confirmar eliminación">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            ¿Eliminar la categoría <strong className="text-ink-900">"{confirmDelete?.name}"</strong>?
            Esta acción no se puede deshacer.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button onClick={doDelete} className="btn-danger flex-1 justify-center">Eliminar</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'Nueva categoría' : 'Editar categoría'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="category-name" className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
            <input id="category-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" required />
          </div>
          <div>
            <label htmlFor="category-description" className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Descripción</label>
            <textarea id="category-description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="input resize-none" />
          </div>
          <div>
            <label htmlFor="category-reservation-hours" className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Tiempo reserva (horas)</label>
            <input id="category-reservation-hours" type="number" value={form.reservation_time_hours} onChange={e => setForm(f => ({ ...f, reservation_time_hours: parseInt(e.target.value) }))} className="input" min={1} />
          </div>
          <div>
            <label htmlFor="category-reservation-max" className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
              Máximo por reserva <span className="text-ink-400 font-normal normal-case">(dejar vacío = sin límite)</span>
            </label>
            <input
              id="category-reservation-max"
              type="number"
              value={form.max_reservation_qty}
              onChange={e => setForm(f => ({ ...f, max_reservation_qty: e.target.value }))}
              className="input"
              min={1}
              placeholder="Ej: 5"
            />
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
