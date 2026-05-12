/**
 * pages/superadmin/CompaniesPage.jsx
 */
import { useState, useEffect } from 'react'
import { companiesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Plus, X, Loader2, Users, UserPlus, Search } from 'lucide-react'
import clsx from 'clsx'

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

const roleColors = { admin: 'badge-orange', employee: 'badge-gray' }

function UsersModal({ company, onClose }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list' | 'assign' | 'create'

  // Assign existing user state
  const [searchEmail, setSearchEmail] = useState('')
  const [searchResult, setSearchResult] = useState(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [assignRole, setAssignRole] = useState('admin')
  const [assigning, setAssigning] = useState(false)

  // Create new user state
  const [newUser, setNewUser] = useState({ email: '', password: '', full_name: '', role: 'admin' })
  const [creating, setCreating] = useState(false)

  const loadUsers = () => {
    setLoading(true)
    companiesAPI.listUsers(company.id)
      .then(r => setUsers(r.data))
      .catch(() => toast.error('Error al cargar usuarios'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadUsers() }, [])

  const handleSearch = async () => {
    if (!searchEmail) return
    setSearchLoading(true); setSearchResult(null)
    try {
      const r = await companiesAPI.searchUser(company.id, searchEmail)
      setSearchResult(r.data)
    } catch { toast.error('Usuario no encontrado') }
    finally { setSearchLoading(false) }
  }

  const handleAssign = async () => {
    if (!searchResult) return
    setAssigning(true)
    try {
      await companiesAPI.assignUser(company.id, { user_id: searchResult.id, role: assignRole })
      toast.success('Usuario asignado'); setView('list'); setSearchEmail(''); setSearchResult(null); loadUsers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setAssigning(false) }
  }

  const handleCreate = async (e) => {
    e.preventDefault(); setCreating(true)
    try {
      await companiesAPI.createUser(company.id, newUser)
      toast.success('Usuario creado'); setView('list')
      setNewUser({ email: '', password: '', full_name: '', role: 'admin' }); loadUsers()
    } catch (err) { toast.error(err.response?.data?.detail || 'Error') }
    finally { setCreating(false) }
  }

  const handleRemove = async (userId) => {
    try {
      await companiesAPI.removeUser(company.id, userId)
      toast.success('Usuario removido'); loadUsers()
    } catch { toast.error('Error al remover') }
  }

  const handleRoleChange = async (userId, role) => {
    try {
      await companiesAPI.assignUser(company.id, { user_id: userId, role })
      toast.success('Rol actualizado'); loadUsers()
    } catch { toast.error('Error') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <div>
            <h3 className="text-lg font-bold text-ink-900">Usuarios · {company.name}</h3>
            {view !== 'list' && (
              <button onClick={() => setView('list')} className="text-xs text-brand-500 font-semibold mt-0.5">
                ← Volver a la lista
              </button>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>

        <div className="p-6">
          {/* LIST VIEW */}
          {view === 'list' && (
            <div className="space-y-4">
              {loading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-ink-100 rounded-xl animate-pulse" />)}
                </div>
              ) : users.length === 0 ? (
                <p className="text-center text-ink-400 text-sm py-6">Sin usuarios asignados</p>
              ) : (
                <div className="space-y-2">
                  {users.map(u => (
                    <div key={u.id} className="flex items-center gap-3 p-3 rounded-xl bg-ink-50 border border-ink-100">
                      <div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center shrink-0">
                        <span className="text-brand-600 font-bold text-sm">{(u.full_name || u.email || '?')[0].toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-ink-900 truncate">{u.full_name || '—'}</p>
                        <p className="text-xs text-ink-400 truncate">{u.email}</p>
                      </div>
                      <select
                        value={u.role}
                        onChange={e => handleRoleChange(u.id, e.target.value)}
                        className="text-xs border border-ink-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-brand-400"
                      >
                        <option value="admin">Admin</option>
                        <option value="employee">Empleado</option>
                      </select>
                      <button
                        onClick={() => handleRemove(u.id)}
                        className="text-xs text-red-500 hover:text-red-700 font-semibold px-2 py-1 rounded-lg hover:bg-red-50 shrink-0"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button onClick={() => setView('assign')} className="btn-secondary flex-1 justify-center text-xs">
                  <Search size={14} /> Agregar existente
                </button>
                <button onClick={() => setView('create')} className="btn-primary flex-1 justify-center text-xs">
                  <UserPlus size={14} /> Crear nuevo admin
                </button>
              </div>
            </div>
          )}

          {/* ASSIGN EXISTING USER */}
          {view === 'assign' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Buscar por email</label>
                <div className="flex gap-2">
                  <input
                    value={searchEmail}
                    onChange={e => setSearchEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                    className="input"
                    placeholder="usuario@email.com"
                  />
                  <button onClick={handleSearch} disabled={searchLoading} className="btn-secondary shrink-0">
                    {searchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  </button>
                </div>
              </div>
              {searchResult && (
                <div className="p-3 rounded-xl bg-ink-50 border border-ink-100 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{searchResult.full_name || '—'}</p>
                    <p className="text-xs text-ink-400">{searchResult.email}</p>
                    {searchResult.company_id && searchResult.company_id !== searchResult.id && (
                      <p className="text-xs text-yellow-600 mt-1">⚠ Ya tiene empresa asignada — se reasignará</p>
                    )}
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Rol</label>
                    <select value={assignRole} onChange={e => setAssignRole(e.target.value)}
                      className="text-sm border border-ink-200 rounded-lg px-3 py-2 bg-white w-full focus:outline-none focus:border-brand-400">
                      <option value="admin">Admin</option>
                      <option value="employee">Empleado</option>
                    </select>
                  </div>
                  <button onClick={handleAssign} disabled={assigning} className="btn-primary w-full justify-center">
                    {assigning ? <Loader2 size={14} className="animate-spin" /> : 'Asignar'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* CREATE NEW USER */}
          {view === 'create' && (
            <form onSubmit={handleCreate} className="space-y-4">
              {[
                { label: 'Nombre completo', key: 'full_name', placeholder: 'Juan García' },
                { label: 'Email', key: 'email', placeholder: 'admin@empresa.com', type: 'email' },
                { label: 'Contraseña', key: 'password', placeholder: '••••••••', type: 'password' },
              ].map(({ label, key, placeholder, type = 'text' }) => (
                <div key={key}>
                  <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">{label}</label>
                  <input
                    type={type}
                    value={newUser[key]}
                    onChange={e => setNewUser(f => ({ ...f, [key]: e.target.value }))}
                    className="input"
                    placeholder={placeholder}
                    required
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Rol</label>
                <select value={newUser.role} onChange={e => setNewUser(f => ({ ...f, role: e.target.value }))}
                  className="text-sm border border-ink-200 rounded-lg px-3 py-2 bg-white w-full focus:outline-none focus:border-brand-400">
                  <option value="admin">Admin</option>
                  <option value="employee">Empleado</option>
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setView('list')} className="btn-secondary flex-1 justify-center">Cancelar</button>
                <button type="submit" disabled={creating} className="btn-primary flex-1 justify-center">
                  {creating ? <Loader2 size={14} className="animate-spin" /> : 'Crear usuario'}
                </button>
              </div>
            </form>
          )}
        </div>
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
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [usersTarget, setUsersTarget] = useState(null)

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

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await companiesAPI.delete(deleteTarget.id)
      toast.success('Empresa eliminada')
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al eliminar')
    } finally { setDeleting(false) }
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
                    <div className="flex gap-2 items-center">
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
                      <button
                        onClick={() => setUsersTarget(c)}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        <Users size={13} /> Usuarios
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
                        className="btn-danger text-xs px-3 py-1.5"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal gestionar usuarios */}
      {usersTarget && <UsersModal company={usersTarget} onClose={() => setUsersTarget(null)} />}

      {/* Modal confirmación eliminar */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Eliminar empresa">
        <div className="space-y-4">
          <p className="text-ink-700">
            ¿Eliminar empresa <span className="font-bold text-ink-900">{deleteTarget?.name}</span>?{' '}
            Se borrará toda su información permanentemente.
          </p>
          <div className="flex gap-3 pt-1">
            <button onClick={() => setDeleteTarget(null)} className="btn-secondary flex-1 justify-center">
              Cancelar
            </button>
            <button onClick={handleDelete} disabled={deleting} className="btn-danger flex-1 justify-center">
              {deleting ? <Loader2 size={14} className="animate-spin" /> : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>

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
