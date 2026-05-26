/**
 * pages/admin/EmployeesPage.jsx
 */
import { useState, useEffect } from 'react'
import { authAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, Trash2, Users, X, Loader2, Shield, User, ToggleLeft, ToggleRight } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-sm">
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
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [toggling, setToggling] = useState(null)

  const load = () => authAPI.listEmployees().then(r => setEmployees(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await authAPI.createEmployee(form)
      toast.success('Empleado creado'); setModal(false)
      setForm({ email: '', password: '', full_name: '', role: 'employee' })
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error')
    } finally { setSaving(false) }
  }

  const handleToggleActive = async (emp) => {
    setToggling(emp.id)
    try {
      const res = await authAPI.toggleEmployeeActive(emp.id)
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, is_active: res.data.is_active } : e))
      toast.success(res.data.is_active ? 'Empleado activado' : 'Empleado desactivado')
    } catch {
      toast.error('Error al cambiar estado')
    } finally { setToggling(null) }
  }

  const doDelete = async () => {
    setDeleting(true)
    try {
      await authAPI.deleteEmployee(confirmDelete.id)
      toast.success('Empleado eliminado')
      setConfirmDelete(null)
      load()
    } catch {
      toast.error('Error al eliminar')
    } finally { setDeleting(false) }
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
              {/* Acciones */}
              <div className="flex items-center gap-1">
                {/* Toggle activo/inactivo */}
                <button
                  onClick={() => handleToggleActive(e)}
                  disabled={toggling === e.id}
                  title={e.is_active ? 'Desactivar' : 'Activar'}
                  className={`btn-ghost p-1.5 ${e.is_active ? 'text-green-500 hover:bg-green-50' : 'text-ink-400 hover:bg-ink-100'}`}
                >
                  {toggling === e.id
                    ? <Loader2 size={15} className="animate-spin" />
                    : e.is_active ? <ToggleRight size={17} /> : <ToggleLeft size={17} />
                  }
                </button>
                {/* Eliminar permanentemente */}
                <button
                  onClick={() => setConfirmDelete({ id: e.id, name: e.full_name || e.email })}
                  title="Eliminar permanentemente"
                  className="btn-ghost p-1.5 text-red-400 hover:bg-red-50"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div>
              <p className="font-bold text-ink-900">{e.full_name || '—'}</p>
              {e.email && <p className="text-xs text-ink-500 mt-0.5">{e.email}</p>}
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

      {/* Modal confirmar eliminación permanente */}
      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Eliminar empleado">
        <div className="space-y-4">
          <p className="text-sm text-ink-600">
            ¿Eliminar permanentemente a <strong className="text-ink-900">"{confirmDelete?.name}"</strong>?
            Esta acción <strong className="text-red-600">no se puede deshacer</strong> — se borrará su cuenta y acceso al sistema.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setConfirmDelete(null)} className="btn-secondary flex-1 justify-center">
              Cancelar
            </button>
            <button onClick={doDelete} disabled={deleting} className="btn-danger flex-1 justify-center">
              {deleting ? <Loader2 size={14} className="animate-spin" /> : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal crear empleado */}
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
