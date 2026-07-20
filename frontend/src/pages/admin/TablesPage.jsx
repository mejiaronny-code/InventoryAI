/**
 * pages/admin/TablesPage.jsx
 * Mesas y zonas del restaurante (sector restaurantes).
 */
import { useState, useEffect } from 'react'
import { tablesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Armchair, MapPin, Loader2, Users } from 'lucide-react'
import { Modal } from '../../components/ui'

export default function TablesPage() {
  const [tables, setTables] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({ name: '', capacity: 2, zone: '' })
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  const load = () => {
    setLoading(true)
    tablesAPI.list().then(r => setTables(r.data)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const openCreate = () => { setForm({ name: '', capacity: 2, zone: '' }); setModal('create') }
  const openEdit = (t) => { setForm({ name: t.name, capacity: t.capacity, zone: t.zone || '' }); setModal(t) }

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      const payload = { name: form.name, capacity: parseInt(form.capacity) || 1, zone: form.zone || null }
      if (modal === 'create') await tablesAPI.create(payload)
      else await tablesAPI.update(modal.id, payload)
      toast.success('Guardado'); setModal(null); load()
    } catch { toast.error('Error al guardar') } finally { setSaving(false) }
  }

  const doDelete = async () => {
    try {
      await tablesAPI.delete(confirmDelete.id)
      toast.success('Mesa eliminada')
    } catch { toast.error('Error') }
    setConfirmDelete(null)
    load()
  }

  // Agrupar por zona
  const byZone = tables.reduce((acc, t) => {
    const z = t.zone || 'Sin zona'
    ;(acc[z] = acc[z] || []).push(t)
    return acc
  }, {})

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Mesas y zonas</h1>
        <button onClick={openCreate} className="btn-primary"><Plus size={16} /> Nueva mesa</button>
      </div>

      <p className="text-sm text-ink-500">
        Define tus mesas y zonas (terraza, interior, barra…). Es opcional — si tu negocio es solo para llevar, puedes dejarlo vacío.
      </p>

      {loading ? (
        <p className="text-ink-400 py-8 text-center">Cargando…</p>
      ) : tables.length === 0 ? (
        <div className="text-center py-16">
          <Armchair size={40} className="text-ink-300 mx-auto mb-3" />
          <p className="text-ink-500">Aún no hay mesas. Agrega la primera.</p>
        </div>
      ) : (
        Object.entries(byZone).map(([zone, list]) => (
          <div key={zone}>
            <p className="text-xs font-bold text-ink-500 uppercase tracking-wide mb-2 flex items-center gap-1">
              <MapPin size={12} /> {zone}
            </p>
            <div className="grid grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
              {list.map(t => (
                <div key={t.id} className="card p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center">
                      <Armchair size={16} className="text-white" />
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(t)} className="btn-ghost w-10 h-10 p-0 justify-center" aria-label={`Editar ${t.name}`}><Pencil size={13} /></button>
                      <button onClick={() => setConfirmDelete({ id: t.id, name: t.name })} className="btn-ghost w-10 h-10 p-0 justify-center text-red-400 hover:bg-red-50" aria-label={`Eliminar ${t.name}`}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <h3 className="font-bold text-ink-900 text-sm">{t.name}</h3>
                  <p className="text-xs text-ink-500 flex items-center gap-1 mt-1">
                    <Users size={11} /> {t.capacity} personas
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar mesa">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">¿Eliminar la mesa <strong>"{confirmDelete?.name}"</strong>?</p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button onClick={doDelete} className="btn-danger flex-1 justify-center">Eliminar</button>
          </div>
        </div>
      </Modal>

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'Nueva mesa' : 'Editar mesa'}>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="Mesa 1, Terraza A…" required />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Capacidad</label>
              <input type="number" min="1" value={form.capacity} onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Zona</label>
              <input value={form.zone} onChange={e => setForm(f => ({ ...f, zone: e.target.value }))} className="input" placeholder="Terraza, Interior…" />
            </div>
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
