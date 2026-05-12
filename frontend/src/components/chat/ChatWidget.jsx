/**
 * components/chat/ChatWidget.jsx
 * Chat flotante con IA para el catálogo público.
 * - Texto: llama-3.3-70b-versatile
 * - Imagen: meta-llama/llama-4-scout-17b-16e-instruct (solo al subir imagen)
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { chatAPI } from '../../services/api'
import { v4 as uuidv4 } from 'uuid'
import { MessageCircle, X, Send, Image, Loader2, Bot, User, ImagePlus, Zap } from 'lucide-react'
import clsx from 'clsx'

function parseMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 animate-fade-in">
      <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
        <Zap size={12} className="text-white" />
      </div>
      <div className="chat-bubble-ai flex items-center gap-1.5 py-3.5 px-4">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  )
}

export default function ChatWidget({ companySlug, welcomeMessage }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => {
    const key = `chat_session_${companySlug}`
    const existing = localStorage.getItem(key)
    if (existing) return existing
    const newId = uuidv4()
    localStorage.setItem(key, newId)
    return newId
  })
  const [previewImage, setPreviewImage] = useState(null)
  const [imageFile, setImageFile] = useState(null)
  const fileRef = useRef(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{
        role: 'assistant',
        content: welcomeMessage || '¡Hola! 👋 Soy tu asistente de inventario. Puedo ayudarte a buscar productos, consultar precios y hacer reservas. ¿En qué te ayudo?',
        timestamp: new Date(),
      }])
    }
  }, [open])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  const addMessage = (role, content, meta = {}) => {
    setMessages(prev => [...prev, { role, content, timestamp: new Date(), ...meta }])
  }

  const handleSendText = useCallback(async () => {
    if ((!input.trim() && !imageFile) || loading) return

    // Si hay imagen, usar endpoint de visión
    if (imageFile) {
      const userMsg = input.trim() || '¿Qué producto es este y cuánto cuesta?'
      addMessage('user', userMsg, { imagePreview: previewImage })
      setInput('')
      setPreviewImage(null)
      setImageFile(null)
      setLoading(true)
      try {
        const res = await chatAPI.sendImage(sessionId, companySlug, imageFile, userMsg)
        addMessage('assistant', res.data.response, {
          usedVision: res.data.used_tools?.includes('vision_search'),
        })
      } catch (e) {
        addMessage('assistant', 'No pude analizar la imagen. ¿Puedes describirme el producto?')
      } finally {
        setLoading(false)
      }
      return
    }

    // Chat de texto normal
    const text = input.trim()
    addMessage('user', text)
    setInput('')
    setLoading(true)
    try {
      const res = await chatAPI.sendMessage(sessionId, text, companySlug)
      addMessage('assistant', res.data.response)
    } catch (e) {
      addMessage('assistant', 'Ocurrió un error. Intenta de nuevo en un momento.')
    } finally {
      setLoading(false)
    }
  }, [input, imageFile, previewImage, loading, sessionId, companySlug])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendText()
    }
  }

  const handleImageSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPreviewImage(ev.target.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <>
      {/* FAB button */}
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-glow-lg',
          'flex items-center justify-center transition-all duration-300',
          open ? 'bg-ink-800 rotate-0' : 'bg-brand-500 hover:bg-brand-600 hover:scale-110'
        )}
        aria-label="Abrir chat"
      >
        {open
          ? <X size={22} className="text-white" />
          : <MessageCircle size={24} className="text-white" />
        }
        {!open && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse-soft" />
        )}
      </button>

      {/* Chat panel */}
      <div className={clsx(
        'fixed bottom-24 right-6 z-50 w-[360px] max-w-[calc(100vw-24px)]',
        'bg-white rounded-2xl shadow-2xl border border-ink-100',
        'flex flex-col overflow-hidden transition-all duration-300 origin-bottom-right',
        open
          ? 'opacity-100 scale-100 pointer-events-auto'
          : 'opacity-0 scale-90 pointer-events-none'
      )}>
        {/* Header */}
        <div className="bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-3.5 flex items-center gap-3">
          <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center">
            <Zap size={18} className="text-white" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-white text-sm">Asistente IA</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-green-300 rounded-full animate-pulse" />
              <p className="text-xs text-white/80">En línea</p>
            </div>
          </div>
          <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-white/20 transition-colors">
            <X size={16} className="text-white" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[380px] bg-ink-50/30">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={clsx(
                'flex items-end gap-2 animate-slide-up',
                msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
              )}
            >
              {/* Avatar */}
              <div className={clsx(
                'w-7 h-7 rounded-full flex items-center justify-center shrink-0',
                msg.role === 'user' ? 'bg-ink-800' : 'bg-brand-500'
              )}>
                {msg.role === 'user'
                  ? <User size={12} className="text-white" />
                  : <Zap size={12} className="text-white" />
                }
              </div>

              {/* Bubble */}
              <div className={clsx('max-w-[78%]', msg.role === 'user' ? 'items-end' : 'items-start', 'flex flex-col gap-1')}>
                {msg.imagePreview && (
                  <img
                    src={msg.imagePreview}
                    alt="imagen enviada"
                    className="w-32 h-32 object-cover rounded-xl border border-ink-200 mb-1"
                  />
                )}
                {msg.role === 'user' ? (
                  <div className="chat-bubble-user">{msg.content}</div>
                ) : (
                  <div
                    className="chat-bubble-ai chat-markdown"
                    dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }}
                  />
                )}
                {msg.usedVision && (
                  <span className="text-[10px] text-brand-500 font-medium flex items-center gap-1">
                    <Image size={10} /> Búsqueda por imagen
                  </span>
                )}
              </div>
            </div>
          ))}

          {loading && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Image preview bar */}
        {previewImage && (
          <div className="px-4 py-2 border-t border-ink-100 bg-white flex items-center gap-3">
            <img src={previewImage} alt="preview" className="w-12 h-12 object-cover rounded-lg border border-ink-200" />
            <div className="flex-1">
              <p className="text-xs font-medium text-ink-700">Imagen adjunta</p>
              <p className="text-xs text-brand-500">Búsqueda visual activada</p>
            </div>
            <button
              onClick={() => { setPreviewImage(null); setImageFile(null) }}
              className="p-1 rounded-lg hover:bg-ink-100"
            >
              <X size={14} className="text-ink-500" />
            </button>
          </div>
        )}

        {/* Input */}
        <div className="p-3 border-t border-ink-100 bg-white">
          <div className="flex items-end gap-2">
            {/* Image upload button */}
            <button
              onClick={() => fileRef.current?.click()}
              className="p-2.5 rounded-xl text-ink-400 hover:text-brand-500 hover:bg-brand-50 transition-colors shrink-0"
              title="Buscar por imagen"
              disabled={loading}
            >
              <ImagePlus size={18} />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImageSelect} />

            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={imageFile ? 'Pregunta sobre esta imagen...' : 'Escribe tu mensaje...'}
              rows={1}
              className="flex-1 input resize-none py-2.5 text-sm leading-relaxed max-h-24"
              style={{ minHeight: '42px' }}
              disabled={loading}
            />

            <button
              onClick={handleSendText}
              disabled={(!input.trim() && !imageFile) || loading}
              className={clsx(
                'p-2.5 rounded-xl shrink-0 transition-all',
                (!input.trim() && !imageFile) || loading
                  ? 'bg-ink-100 text-ink-400 cursor-not-allowed'
                  : 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
              )}
            >
              {loading
                ? <Loader2 size={18} className="animate-spin" />
                : <Send size={18} />
              }
            </button>
          </div>
          <p className="text-[10px] text-ink-400 text-center mt-2">
            IA · Busca productos · Reserva fácil · 📸 Sube imagen
          </p>
        </div>
      </div>
    </>
  )
}
