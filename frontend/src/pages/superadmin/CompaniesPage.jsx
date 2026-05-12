/**
 * pages/superadmin/CompaniesPage.jsx
 */
import { useState, useEffect } from 'react'
import { companiesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Building2, X, Loader2, ChevronDown } from 'lucide-react'
import clsx from 'clsx'

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

export default function SuperAdminCompaniesPage() {
  const [companies, setCompanies] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ name: '', slug: '' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = () => companiesAPI.listAll().then(r => setCompanies(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await companiesAPI.create(form)
      toast.success('Empresa creada'); setModal(false); load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    } finally { setSaving(false) }
  }

  const handleSubUpdate = async (id, plan, status) => {
    try {
      await companiesAPI.updateSubscription(id, plan, status)
      toast.success('Suscripción actualizada'); load()
    } catch { toast.error('Error') }
  }

  const subStatusColor = {
    active: 'badge-green', trial: 'badge-yellow',
    suspended: 'badge-red', cancelled: 'badge-gray'
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Empresas</h1>
        <button onClick={() => setModal(true)} className="btn-primary"><Plus size={16} /> Nueva empresa</button>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>Slug</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={5}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>)
            ) : companies.map(c => {
              const sub = c.subscriptions || {}
              return (
                <tr key={c.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center">
                        <span className="text-brand-600 font-bold text-sm">{c.name[0]}</span>
                      </div>
                      <span className="font-semibold text-ink-900">{c.name}</span>
                    </div>
                  </td>
                  <td><span className="font-mono text-xs text-ink-500">/{c.slug}</span></td>
                  <td><span className="badge badge-gray">{sub.plan || '—'}</span></td>
                  <td>
                    <span className={`badge ${subStatusColor[sub.status] || 'badge-gray'}`}>
                      {sub.status || '—'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <select
                        defaultValue={sub.status}
                        onChange={e => handleSubUpdate(c.id, sub.plan || 'trial', e.target.value)}
                        className="text-xs border border-ink-200 rounded-lg px-2 py-1.5 text-ink-700 bg-white focus:outline-none focus:border-brand-400"
                      >
                        <option value="active">Activo</option>
                        <option value="trial">Trial</option>
                        <option value="suspended">Suspendido</option>
                        <option value="cancelled">Cancelado</option>
                      </select>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Nueva empresa">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Slug</label>
            <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className="input font-mono" placeholder="mi-empresa" />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setModal(false)} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? <Loader2 size={14} className="animate-spin" /> : 'Crear'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
