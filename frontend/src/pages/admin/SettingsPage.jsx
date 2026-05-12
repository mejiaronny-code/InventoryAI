/**
 * pages/admin/SettingsPage.jsx
 */
import { useState, useEffect } from 'react'
import { companiesAPI } from '../../services/api'
import toast from 'react-hot-toast'
import { Save, Loader2, Settings } from 'lucide-react'

export default function SettingsPage() {
  const [form, setForm] = useState({ name: '', slug: '', logo_url: '', settings: { chat_welcome: '', primary_color: '#f97316' } })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
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

  const handleSave = async (e) => {
    e.preventDefault(); setSaving(true)
    try {
      await companiesAPI.updateMe(form)
      toast.success('Configuración guardada')
    } catch { toast.error('Error al guardar') } finally { setSaving(false) }
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
          <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">URL del logo</label>
          <input value={form.logo_url} onChange={e => setForm(f => ({ ...f, logo_url: e.target.value }))} className="input" placeholder="https://..." />
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
    </div>
  )
}
