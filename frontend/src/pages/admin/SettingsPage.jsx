/**
 * pages/admin/SettingsPage.jsx
 */
import { useState, useEffect, useCallback } from 'react'
import { companiesAPI, authAPI } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useDropzone } from 'react-dropzone'
import toast from 'react-hot-toast'
import { Save, Loader2, Settings, User, Upload, ImageIcon, AlertTriangle, X } from 'lucide-react'

export default function SettingsPage() {
  const { user, updateUser } = useAuth()
  const [form, setForm] = useState({ name: '', slug: '', logo_url: '', settings: { chat_welcome: '', primary_color: '#f97316' } })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [deletionModal, setDeletionModal] = useState(false)
  const [deletionConfirmName, setDeletionConfirmName] = useState('')
  const [requestingDeletion, setRequestingDeletion] = useState(false)

  useEffect(() => {
    setProfileName(user?.full_name || '')
    if (user?.role !== 'admin') { setLoading(false); return }
    companiesAPI.getMe().then(r => {
      const c = r.data
      setForm({
        name: c.name || '',
        slug: c.slug || '',
        logo_url: c.logo_url || '',
        settings: {
          chat_welcome: c.settings?.chat_welcome || '',
          primary_color: c.settings?.primary_color || '#f97316',
        }
      })
    }).finally(() => setLoading(false))
  }, [])

  const handleSaveProfile = async (e) => {
    e.preventDefault(); setSavingProfile(true)
    try {
      await authAPI.updateMe({ full_name: profileName })
      updateUser({ full_name: profileName })
      toast.success('Perfil actualizado')
    } catch { toast.error('Error al actualizar') } finally { setSavingProfile(false) }
  }

  const onDropLogo = useCallback(async (acceptedFiles) => {
    const file = acceptedFiles[0]
    if (!file) return
    setUploadingLogo(true)
    try {
      const res = await companiesAPI.uploadLogo(file)
      setForm(f => ({ ...f, logo_url: res.data.logo_url }))
      toast.success('Logo actualizado')
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al subir el logo')
    } finally { setUploadingLogo(false) }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropLogo,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.svg'] },
    maxFiles: 1,
    maxSize: 2 * 1024 * 1024, // 2MB
  })

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await companiesAPI.updateMe(form)
      toast.success('Configuración guardada')
    } catch { toast.error('Error al guardar') } finally { setSaving(false) }
  }

  const handleRequestDeletion = async () => {
    setRequestingDeletion(true)
    try {
      await companiesAPI.requestDeletion()
      toast.success('Solicitud enviada. El equipo de soporte se pondrá en contacto contigo.')
      setDeletionModal(false)
      setDeletionConfirmName('')
    } catch { toast.error('Error al enviar la solicitud') } finally { setRequestingDeletion(false) }
  }

  if (loading) return <div className="p-8 text-center text-ink-400">Cargando...</div>

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
          <Settings size={20} className="text-white" />
        </div>
        <h1 className="page-title">Configuración</h1>
      </div>

      {/* Mi perfil */}
      <form onSubmit={handleSaveProfile} className="card p-6 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <User size={17} className="text-brand-500" />
          <h2 className="section-title">Mi perfil</h2>
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre completo</label>
          <input
            value={profileName}
            onChange={e => setProfileName(e.target.value)}
            className="input"
            required
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Email</label>
          <input value={user?.email || ''} className="input opacity-60 cursor-not-allowed" readOnly />
        </div>
        <div className="flex items-center gap-3">
          <span className={`badge ${user?.role === 'admin' ? 'badge-orange' : 'badge-gray'}`}>
            {user?.role === 'admin' ? 'Admin' : 'Empleado'}
          </span>
        </div>
        <button type="submit" disabled={savingProfile} className="btn-primary">
          {savingProfile ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Guardar perfil
        </button>
      </form>

      {/* Empresa — solo admins */}
      {user?.role === 'admin' && (
      <form onSubmit={handleSave} className="card p-6 space-y-5">
        <h2 className="section-title">Información de la empresa</h2>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Nombre</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" required />
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Slug (URL)</label>
          <div className="flex items-center">
            <span className="px-3 py-2.5 bg-ink-100 border border-r-0 border-ink-200 rounded-l-xl text-xs text-ink-500">tuapp.com/</span>
            <input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} className="input rounded-l-none flex-1" />
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Logo de la empresa</label>
          <div className="flex items-start gap-4">
            {/* Preview */}
            <div className="w-16 h-16 rounded-xl border border-ink-200 bg-ink-50 flex items-center justify-center shrink-0 overflow-hidden">
              {form.logo_url
                ? <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
                : <ImageIcon size={22} className="text-ink-300" />
              }
            </div>
            {/* Dropzone */}
            <div
              {...getRootProps()}
              className={`flex-1 border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-all ${
                isDragActive ? 'border-brand-400 bg-brand-50' : 'border-ink-200 hover:border-brand-300 hover:bg-ink-50'
              }`}
            >
              <input {...getInputProps()} />
              {uploadingLogo ? (
                <div className="flex items-center justify-center gap-2 text-brand-500">
                  <Loader2 size={16} className="animate-spin" /> Subiendo...
                </div>
              ) : (
                <>
                  <Upload size={18} className="text-ink-400 mx-auto mb-1.5" />
                  <p className="text-xs text-ink-600 font-medium">
                    {isDragActive ? 'Suelta la imagen aquí' : 'Arrastra tu logo o haz clic'}
                  </p>
                  <p className="text-xs text-ink-400 mt-0.5">PNG, JPG, SVG · máx 2MB</p>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="divider" />
        <h2 className="section-title">Chat IA</h2>
        <div>
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Mensaje de bienvenida</label>
          <textarea
            value={form.settings.chat_welcome}
            onChange={e => setForm(f => ({ ...f, settings: { ...f.settings, chat_welcome: e.target.value } }))}
            rows={3}
            className="input resize-none"
            placeholder="¡Hola! ¿En qué puedo ayudarte?"
          />
        </div>

        <button type="submit" disabled={saving} className="btn-primary">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Guardar cambios
        </button>
      </form>
      )}

      {/* Zona de peligro — solo admins */}
      {user?.role === 'admin' && (
        <div className="border border-red-200 bg-red-50/50 rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500" />
            <h2 className="text-base font-bold text-red-700">Zona de peligro</h2>
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-semibold text-ink-900">Solicitar eliminación de cuenta</p>
              <p className="text-xs text-ink-500 mt-0.5">
                Envía una solicitud al equipo de soporte para eliminar tu empresa y todos sus datos.
                Esta acción es irreversible una vez procesada.
              </p>
            </div>
            <button
              onClick={() => { setDeletionConfirmName(''); setDeletionModal(true) }}
              className="btn-danger shrink-0"
            >
              Solicitar eliminación
            </button>
          </div>
        </div>
      )}

      {/* Modal confirmar solicitud de eliminación */}
      {deletionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeletionModal(false)} />
          <div className="modal-box max-w-sm relative">
            <div className="flex items-center justify-between p-6 border-b border-ink-100">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-red-500" />
                <h3 className="text-base font-bold text-ink-900">Confirmar solicitud</h3>
              </div>
              <button onClick={() => setDeletionModal(false)} className="p-2 rounded-xl hover:bg-ink-100">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-ink-600">
                Esta solicitud notificará al equipo de soporte para eliminar la empresa
                <strong className="text-ink-900"> "{form.name}"</strong> y todos sus datos de forma permanente.
              </p>
              <div>
                <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">
                  Escribe el nombre de tu empresa para confirmar
                </label>
                <input
                  value={deletionConfirmName}
                  onChange={e => setDeletionConfirmName(e.target.value)}
                  className="input"
                  placeholder={form.name}
                  autoFocus
                />
                {deletionConfirmName.length > 0 && deletionConfirmName !== form.name && (
                  <p className="text-xs text-red-500 mt-1">El nombre no coincide</p>
                )}
              </div>
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setDeletionModal(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleRequestDeletion}
                  disabled={deletionConfirmName !== form.name || requestingDeletion}
                  className="btn-danger flex-1 justify-center"
                >
                  {requestingDeletion
                    ? <Loader2 size={14} className="animate-spin" />
                    : 'Enviar solicitud'
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
