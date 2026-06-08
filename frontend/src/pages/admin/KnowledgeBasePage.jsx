/**
 * pages/admin/KnowledgeBasePage.jsx
 * Base de conocimiento de la empresa: el admin sube documentos
 * (PDF/Word/Markdown/texto) con información institucional (horarios,
 * políticas, sucursales, FAQs) que el chat IA usa para responder
 * preguntas que no son del catálogo de productos.
 */
import { useState, useEffect, useRef } from 'react'
import { knowledgeAPI } from '../../services/api'
import toast from 'react-hot-toast'
import {
  BookOpen, Upload, Trash2, FileText, RefreshCw,
  Loader2, X, CheckCircle2, AlertTriangle, Clock, File
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import clsx from 'clsx'

const STATUS_CFG = {
  processing: { label: 'Procesando', color: 'badge-orange', icon: Clock },
  ready:      { label: 'Listo',      color: 'badge-green',  icon: CheckCircle2 },
  error:      { label: 'Error',      color: 'badge-red',    icon: AlertTriangle },
}

const FILE_TYPE_LABEL = {
  pdf: 'PDF',
  docx: 'Word',
  md: 'Markdown',
  txt: 'Texto',
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100"><X size={18} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState([])
  const [limitInfo, setLimitInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  const load = async () => {
    setLoading(true)
    try {
      const [docsRes, limitRes] = await Promise.all([
        knowledgeAPI.listDocuments(),
        knowledgeAPI.getDocumentsLimit(),
      ])
      setDocuments(docsRes.data || [])
      setLimitInfo(limitRes.data || null)
    } catch {
      toast.error('Error al cargar la base de conocimiento')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const resetForm = () => {
    setTitle('')
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!title.trim()) { toast.error('Ponle un título al documento'); return }
    if (!file) { toast.error('Selecciona un archivo'); return }

    setUploading(true)
    try {
      await knowledgeAPI.uploadDocument(title.trim(), file)
      toast.success('Documento subido y procesado')
      setModal(false)
      resetForm()
      load()
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al subir el documento')
    } finally {
      setUploading(false)
    }
  }

  const handleDelete = async (doc) => {
    if (!confirm(`¿Eliminar "${doc.title}"? Esta acción no se puede deshacer.`)) return
    try {
      await knowledgeAPI.deleteDocument(doc.id)
      toast.success('Documento eliminado')
      load()
    } catch {
      toast.error('Error al eliminar')
    }
  }

  const atLimit = limitInfo && limitInfo.remaining <= 0

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <BookOpen size={22} className="text-brand-500" />
            Base de conocimiento
          </h1>
          <p className="text-sm text-ink-400 mt-0.5">
            Sube documentos con información institucional (horarios, políticas, sucursales, FAQs)
            para que el chat IA responda preguntas que no son sobre el catálogo
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary"><RefreshCw size={14} /></button>
          <button
            onClick={() => { if (atLimit) { toast.error(`Alcanzaste el límite de ${limitInfo.limit} documentos`); return } setModal(true) }}
            className="btn-primary"
            disabled={atLimit}
          >
            <Upload size={14} /> Subir documento
          </button>
        </div>
      </div>

      {/* Límite */}
      {limitInfo && (
        <div className="card p-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
              <FileText size={16} className="text-brand-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-800">
                {limitInfo.current} de {limitInfo.limit} documentos usados
              </p>
              <p className="text-xs text-ink-400">
                {atLimit
                  ? 'Alcanzaste tu límite — elimina alguno o solicita un aumento al equipo de soporte'
                  : `Puedes subir ${limitInfo.remaining} documento${limitInfo.remaining === 1 ? '' : 's'} más`}
              </p>
            </div>
          </div>
          <div className="w-full sm:w-48 h-2 rounded-full bg-ink-100 overflow-hidden">
            <div
              className={clsx('h-full rounded-full transition-all', atLimit ? 'bg-red-400' : 'bg-brand-400')}
              style={{ width: `${Math.min(100, (limitInfo.current / Math.max(1, limitInfo.limit)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Lista de documentos */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Documento</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Fragmentos</th>
              <th>Subido</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [...Array(3)].map((_, i) => (
                <tr key={i}><td colSpan={6}><div className="h-8 bg-ink-100 rounded animate-pulse" /></td></tr>
              ))
            ) : documents.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12 text-ink-400">
                  <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
                  <p>Aún no has subido ningún documento</p>
                  <p className="text-xs mt-1">Sube horarios, políticas de devolución, ubicación de sucursales, preguntas frecuentes, etc.</p>
                </td>
              </tr>
            ) : documents.map(doc => {
              const st = STATUS_CFG[doc.status] || STATUS_CFG.processing
              const StIcon = st.icon
              return (
                <tr key={doc.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <File size={14} className="text-ink-400 shrink-0" />
                      <div>
                        <p className="font-semibold text-ink-900 text-sm">{doc.title}</p>
                        <p className="text-[10px] text-ink-400 font-mono">{doc.filename}</p>
                        {doc.status === 'error' && doc.error_message && (
                          <p className="text-[10px] text-red-500 italic mt-0.5">{doc.error_message}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-gray">{FILE_TYPE_LABEL[doc.file_type] || doc.file_type}</span>
                  </td>
                  <td>
                    <span className={clsx('badge flex items-center gap-1 w-fit', st.color)}>
                      <StIcon size={10} /> {st.label}
                    </span>
                  </td>
                  <td className="text-sm text-ink-500">{doc.chunk_count || 0}</td>
                  <td className="text-xs text-ink-400">
                    {format(parseISO(doc.created_at), 'd MMM yyyy', { locale: es })}
                  </td>
                  <td>
                    <button
                      onClick={() => handleDelete(doc)}
                      className="btn-ghost p-1.5 text-red-400 hover:text-red-600"
                      title="Eliminar"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Modal subir documento */}
      <Modal open={modal} onClose={() => { setModal(false); resetForm() }} title="Subir documento">
        <form onSubmit={handleUpload} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Título *</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="input"
              placeholder="Ej: Horarios de atención, Política de devoluciones..."
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-ink-500 uppercase tracking-wide block mb-1.5">Archivo *</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.md,.txt"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="input"
              required
            />
            <p className="text-[11px] text-ink-400 mt-1.5">PDF, Word (.docx), Markdown (.md) o texto (.txt) — máx. 15 MB</p>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => { setModal(false); resetForm() }} className="btn-secondary flex-1 justify-center">Cancelar</button>
            <button type="submit" disabled={uploading} className="btn-primary flex-1 justify-center">
              {uploading ? <><Loader2 size={14} className="animate-spin" /> Procesando…</> : 'Subir y procesar'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
