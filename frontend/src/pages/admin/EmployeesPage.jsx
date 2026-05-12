/**
 * pages/admin/EmployeesPage.jsx
 */
import { useState, useEffect } from 'react'
import { authAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Trash2, Users, X, Loader2, Shield, User } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm animate-slide-up">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'employee' })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = () => authAPI.listEmployees().then(r => setEmployees(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await authAPI.createEmployee(form)
      toast.success('Empleado creado'); setModal(false); load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('¿Desactivar empleado?')) return
    await authAPI.deleteEmployee(id); toast.success('Desactivado'); load()
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Empleados</h1>
        <button onClick={() => setModal(true)} className="btn-primary"><Plus size={16} /> Nuevo empleado</button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          [...Array(3)].map((_, i) => <div key={i} className="card p-5 animate-pulse h-28" />)
        ) : employees.map(e => (
          <div key={e.id} className="card p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 rounded-xl bg-ink-100 flex items-center justify-center">
                {e.role === 'admin'
                  ? <Shield size={18} className="text-brand-500" />
                  : <User size={18} className="text-ink-500" />
                }
              </div>
              <button onClick={() => handleDelete(e.id)} className="btn-ghost p-1.5 text-red-400 hover:bg-red-50">
                <Trash2 size={14} />
              </button>
            </div>
            <div>
              <p className="font-bold text-ink-900">{e.full_name || '—'}</p>
              <p className="text-xs text-ink-400 mt-0.5">
                {format(new Date(e.created_at), "d MMM yyyy", { locale: es })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`badge text-xs ${e.role === 'admin' ? 'badge-orange' : 'badge-gray'}`}>
                {e.role}
              </span>
              <span className={`badge text-xs ${e.is_active ? 'badge-green' : 'badge-red'}`}>
                {e.is_active ? 'activo' : 'inactivo'}
              </span>
            </div>
          </div>
        ))}
        {!loading && employees.length === 0 && (
          <p className="col-span-3 text-center text-ink-400 py-12">Sin empleados creados</p>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Nuevo empleado">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre completo *</label>
            <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="input" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input" required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Contraseña *</label>
            <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="input" minLength={6} required />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Rol</label>
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input">
              <option value="employee">Empleado</option>
              <option value="admin">Admin</option>
            </select>
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
