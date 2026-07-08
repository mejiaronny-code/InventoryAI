/**
 * components/chat/ChatWidget.jsx
 * Chat flotante con IA para el catálogo público.
 * - Texto: llama-3.3-70b-versatile
 * - Imagen: meta-llama/llama-4-scout-17b-16e-instruct (solo al subir imagen)
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { chatAPI, BASE_URL } from '../../services/api'
import { v4 as uuidv4 } from 'uuid'
import { MessageCircle, X, Send, Image, Loader2, Bot, User, ImagePlus, Zap, Mic, Square } from 'lucide-react'
import clsx from 'clsx'

function parseMarkdown(text) {
  return text
    // 1. Imágenes markdown BIEN formadas -> <img> (debe ir antes de las redes
    //    de seguridad para no borrarlas). [^\)\n] (no \s) porque algunos
    //    nombres de archivo subidos tienen espacios literales en la URL
    //    (ej. ".../Mochila prueba.jpg") — excluir \s hacía que esas imágenes
    //    nunca se reconocieran como <img> y la red de seguridad #2 las borraba.
    .replace(
      /!\\?\[([^\]]*)\\?\]\\?\((https?:\/\/[^\)\n]+)\)\\?/g,
      '<img src="$2" alt="$1" class="rounded-xl w-full max-w-[200px] my-1 border border-ink-100 object-cover" onerror="this.style.display=\'none\'" />'
    )
    // 2. Red de seguridad: markdown de imagen sobrante o CORTADO a medias
    //    (la respuesta del modelo se truncó sin cerrar el paréntesis) -> fuera,
    //    para que no se filtre la URL ni rompa el layout del chat.
    .replace(/!\\?\[[^\]]*\]?\(?[^)\n]*\)?/g, '')
    // 3. Red de seguridad: URL de storage suelta dejada como texto plano
    //    (precedida por inicio o espacio; así no toca el src="" de un <img>).
    .replace(/(^|\s)https?:\/\/\S*\/storage\/\S*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
}

function BotAvatar({ logo, size = 'sm' }) {
  const dim = size === 'sm' ? 'w-7 h-7' : 'w-9 h-9'
  return (
    <div className={`${dim} rounded-full bg-brand-500 flex items-center justify-center shrink-0 overflow-hidden`}>
      {logo
        ? <img src={logo} alt="bot" className="w-full h-full object-contain p-0.5" />
        : <Zap size={size === 'sm' ? 12 : 18} className="text-white" />
      }
    </div>
  )
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

export default function ChatWidget({ companySlug, welcomeMessage, companyLogo, onOpenChange, embedded = false, embedMobile = false }) {
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
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const fileRef = useRef(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const recordingTimerRef = useRef(null)
  const streamRef = useRef(null)

  // Avisa al contenedor (p.ej. el loader del widget embebible) cada vez que el
  // chat se abre o cierra, para que pueda redimensionar el iframe.
  useEffect(() => { onOpenChange?.(open) }, [open, onOpenChange])

  useEffect(() => {
    if (open && messages.length === 0 && welcomeMessage) {
      setMessages([{
        role: 'assistant',
        content: welcomeMessage,
        timestamp: new Date(),
      }])
    }
  }, [open, welcomeMessage])

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

    // Chat de texto normal — streaming con fallback al endpoint clásico
    const text = input.trim()
    addMessage('user', text)
    setInput('')
    setLoading(true)

    let assistantIndex = null
    setMessages(prev => {
      assistantIndex = prev.length
      return [...prev, { role: 'assistant', content: '', timestamp: new Date(), streaming: true }]
    })

    const appendDelta = (delta) => {
      setMessages(prev => {
        const next = [...prev]
        if (next[assistantIndex]) {
          next[assistantIndex] = { ...next[assistantIndex], content: next[assistantIndex].content + delta }
        }
        return next
      })
    }

    const finalizeStreaming = () => {
      setMessages(prev => {
        const next = [...prev]
        if (next[assistantIndex]) next[assistantIndex] = { ...next[assistantIndex], streaming: false }
        return next
      })
    }

    const setAssistantContent = (content) => {
      setMessages(prev => {
        const next = [...prev]
        next[assistantIndex] = { role: 'assistant', content, timestamp: new Date() }
        return next
      })
    }

    let gotAnyDelta = false
    try {
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${BASE_URL}/chat/message/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ session_id: sessionId, message: text, company_slug: companySlug }),
      })

      if (!res.ok || !res.body) throw new Error('stream_not_ok')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Los eventos SSE llegan separados por doble salto de línea; lo que
        // quede incompleto al final del chunk se conserva para el siguiente.
        const parts = buffer.split('\n\n')
        buffer = parts.pop()

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          let evt
          try { evt = JSON.parse(line.slice(6)) } catch { continue }

          if (evt.delta) {
            gotAnyDelta = true
            appendDelta(evt.delta)
          } else if (evt.error) {
            gotAnyDelta = true
            appendDelta(evt.error)
          } else if (evt.done) {
            finalizeStreaming()
          }
        }
      }

      if (!gotAnyDelta) throw new Error('stream_empty')
    } catch (e) {
      // El streaming falló antes de traer nada útil — reintenta una vez
      // contra el endpoint clásico para no dejar al usuario sin respuesta.
      try {
        const res = await chatAPI.sendMessage(sessionId, text, companySlug)
        setAssistantContent(res.data.response)
      } catch {
        setAssistantContent('Ocurrió un error. Intenta de nuevo en un momento.')
      }
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

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  // Transcribe el audio y coloca el texto en el campo de escritura para que
  // el usuario lo revise/edite antes de enviarlo. NUNCA se envía directo al
  // agente: Whisper puede "alucinar" texto fluido en otro idioma cuando el
  // audio es corto, silencioso o con ruido de fondo.
  const [transcribing, setTranscribing] = useState(false)
  const transcribeAudioBlob = useCallback(async (blob) => {
    if (!blob || blob.size === 0) return
    setTranscribing(true)
    try {
      const res = await chatAPI.transcribeAudio(companySlug, blob, 'nota-de-voz.webm')
      const text = res.data.transcribed_text || ''
      setInput(prev => (prev.trim() ? `${prev.trim()} ${text}` : text))
      setTimeout(() => inputRef.current?.focus(), 50)
    } catch (e) {
      const detail = e?.response?.data?.detail
      addMessage('assistant', detail || 'No pude transcribir el audio. Intenta de nuevo o escribe tu mensaje directamente.')
    } finally {
      setTranscribing(false)
    }
  }, [companySlug])

  const startRecording = useCallback(async () => {
    if (loading || isRecording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '')
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        stopRecordingTimer()
        cleanupStream()
        const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
        audioChunksRef.current = []
        setIsRecording(false)
        setRecordingSeconds(0)
        transcribeAudioBlob(blob)
      }

      recorder.start()
      setIsRecording(true)
      setRecordingSeconds(0)
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds(s => {
          if (s >= 59) { // tope de 60s para evitar audios enormes
            recorder.stop()
            return s
          }
          return s + 1
        })
      }, 1000)
    } catch (err) {
      addMessage('assistant', 'No pude acceder al micrófono. Revisa los permisos del navegador.')
    }
  }, [loading, isRecording, transcribeAudioBlob])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null
      if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop()
    }
    stopRecordingTimer()
    cleanupStream()
    audioChunksRef.current = []
    setIsRecording(false)
    setRecordingSeconds(0)
  }, [])

  useEffect(() => {
    return () => {
      stopRecordingTimer()
      cleanupStream()
    }
  }, [])

  const handleMicClick = () => {
    if (isRecording) stopRecording()
    else startRecording()
  }

  const formatRecTime = (s) => `0:${s.toString().padStart(2, '0')}`

  // Layout del panel. En modo normal usa el breakpoint `sm:` (responsive). En
  // modo embebido el ancho del iframe NO sirve para detectar móvil (siempre es
  // angosto), así que el loader nos dice si es móvil; aplicamos clases fijas.
  // Móvil = tarjeta flotante compacta (deja ver la burbuja abajo, no tapa toda
  // la pantalla). Escritorio = panel flotante abajo-derecha. En modo embebido el
  // ancho del iframe no sirve para detectar móvil, así que el loader nos lo dice.
  const cardMobile = 'inset-x-3 bottom-24 top-auto h-[60dvh] max-h-[60dvh] rounded-2xl'
  const cardDesktop = 'inset-auto bottom-24 right-6 w-[360px] max-w-[calc(100vw-24px)] h-auto max-h-[min(600px,calc(100dvh-7rem))] rounded-2xl'
  const panelBox = !embedded
    ? 'inset-x-3 bottom-24 top-auto h-[60dvh] max-h-[60dvh] rounded-2xl sm:inset-x-auto sm:left-auto sm:right-6 sm:top-auto sm:h-auto sm:max-h-[min(600px,calc(100dvh-7rem))] sm:w-[360px] sm:max-w-[calc(100vw-24px)]'
    : embedMobile ? cardMobile : cardDesktop

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
        'fixed z-50',
        panelBox,
        'bg-white shadow-2xl',
        // El borde delinea la tarjeta sobre fondo claro (app normal). En el
        // widget embebido se ve como una línea blanca sobre la web del cliente,
        // así que ahí lo quitamos: basta la sombra.
        embedded ? '' : 'border border-ink-100',
        'flex flex-col overflow-hidden transition-all duration-300',
        embedded && embedMobile ? 'origin-bottom' : 'origin-bottom-right',
        open
          ? 'opacity-100 scale-100 pointer-events-auto'
          : 'opacity-0 scale-90 pointer-events-none'
      )}>
        {/* Header — redondea sus esquinas superiores igual que la tarjeta, para
            que el rojo llene la curva y no se asome el blanco del fondo. */}
        <div className="bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-3.5 flex items-center gap-3 shrink-0 rounded-t-2xl">
          <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
            {companyLogo
              ? <img src={companyLogo} alt="logo" className="w-full h-full object-cover" />
              : <Zap size={18} className="text-brand-500" />
            }
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
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 bg-ink-50/30">
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
                ) : msg.streaming && !msg.content ? (
                  <div className="chat-bubble-ai flex items-center gap-1.5 py-3.5 px-4">
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                    <div className="typing-dot" />
                  </div>
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

          {loading && !messages[messages.length - 1]?.streaming && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>

        {/* Transcribing indicator */}
        {transcribing && (
          <div className="shrink-0 px-4 py-2.5 border-t border-ink-100 bg-brand-50 flex items-center gap-2.5 animate-fade-in">
            <Loader2 size={14} className="animate-spin text-brand-500 shrink-0" />
            <p className="text-xs text-brand-600 font-medium">Transcribiendo tu nota de voz…</p>
          </div>
        )}

        {/* Image preview bar */}
        {previewImage && (
          <div className="shrink-0 px-4 py-2 border-t border-ink-100 bg-white flex items-center gap-3">
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
        <div className="shrink-0 p-3 border-t border-ink-100 bg-white">
          {isRecording ? (
            <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5 animate-fade-in">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <p className="flex-1 text-sm text-red-600 font-medium">
                Grabando… {formatRecTime(recordingSeconds)}
              </p>
              <button
                onClick={cancelRecording}
                className="p-2 rounded-lg text-ink-400 hover:text-ink-600 hover:bg-white transition-colors"
                title="Cancelar"
              >
                <X size={16} />
              </button>
              <button
                onClick={stopRecording}
                className="p-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors shadow-sm"
                title="Enviar nota de voz"
              >
                <Square size={16} fill="currentColor" />
              </button>
            </div>
          ) : (
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
                placeholder={
                  transcribing
                    ? 'Transcribiendo audio...'
                    : imageFile ? 'Pregunta sobre esta imagen...' : 'Escribe tu mensaje...'
                }
                rows={1}
                className="flex-1 input resize-none py-2.5 text-sm leading-relaxed max-h-24"
                style={{ minHeight: '42px' }}
                disabled={loading || transcribing}
              />

              {/* Mostrar botón de enviar solo si hay texto/imagen; si no, mostrar micrófono.
                  Así, una nota de voz transcrita SIEMPRE pasa primero por revisión del usuario
                  antes de enviarse — Whisper puede transcribir mal audios cortos/ruidosos. */}
              {(input.trim() || imageFile) ? (
                <button
                  onClick={handleSendText}
                  disabled={loading || transcribing}
                  title="Revisa el texto transcrito antes de enviar"
                  className={clsx(
                    'p-2.5 rounded-xl shrink-0 transition-all',
                    (loading || transcribing)
                      ? 'bg-ink-100 text-ink-400 cursor-not-allowed'
                      : 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                  )}
                >
                  {loading
                    ? <Loader2 size={18} className="animate-spin" />
                    : <Send size={18} />
                  }
                </button>
              ) : (
                <button
                  onClick={handleMicClick}
                  disabled={loading || transcribing}
                  title="Grabar nota de voz"
                  className={clsx(
                    'p-2.5 rounded-xl shrink-0 transition-all',
                    (loading || transcribing)
                      ? 'bg-ink-100 text-ink-400 cursor-not-allowed'
                      : 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                  )}
                >
                  {transcribing
                    ? <Loader2 size={18} className="animate-spin" />
                    : <Mic size={18} />
                  }
                </button>
              )}
            </div>
          )}
          <p className="text-[10px] text-ink-400 text-center mt-2">
            IA · Busca productos · Reserva fácil · 📸 Sube imagen · 🎤 Nota de voz (revisa antes de enviar)
          </p>
        </div>
      </div>
    </>
  )
}
