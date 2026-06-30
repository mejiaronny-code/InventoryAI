/**
 * pages/public/EmbedChatPage.jsx
 * Versión "desnuda" del chat para incrustar en sitios de terceros vía iframe.
 * Solo monta el ChatWidget con el branding de la empresa y un fondo
 * transparente, y le avisa al loader (embed.js) cuándo abrir/cerrar para que
 * redimensione el iframe. NO renderiza menú, catálogo ni layout.
 */
import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { companiesAPI } from '../../services/api'
import ThemeProvider from '../../components/shared/ThemeProvider'
import ChatWidget from '../../components/chat/ChatWidget'

// Protocolo de mensajes con el loader (embed.js).
const MSG_SOURCE = 'inventoryai-chat-widget'

function postToParent(payload) {
  try {
    window.parent?.postMessage({ source: MSG_SOURCE, ...payload }, '*')
  } catch { /* ignorar */ }
}

export default function EmbedChatPage() {
  const { companySlug } = useParams()
  const [company, setCompany] = useState(null)
  const [resolved, setResolved] = useState(false)   // ya intentamos cargar
  const [disabled, setDisabled] = useState(false)   // empresa sin catálogo público
  const [mobile, setMobile] = useState(false)       // lo determina el loader (ventana real)

  // El loader (que corre en la página padre) sabe el tamaño real del dispositivo.
  // El ancho del iframe es siempre angosto, así que NO podemos detectar móvil
  // aquí solos: lo recibimos del loader y se lo pasamos al ChatWidget.
  useEffect(() => {
    function onMsg(ev) {
      const d = ev.data
      if (!d || d.source !== MSG_SOURCE || d.dir !== 'to-iframe') return
      if (typeof d.mobile === 'boolean') setMobile(d.mobile)
    }
    window.addEventListener('message', onMsg)
    postToParent({ ready: true })   // pedirle al loader el modo actual
    return () => window.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    companiesAPI.listPublic()
      .then(r => {
        const found = (r.data || []).find(c => c.slug === companySlug)
        if (!found || found.features?.public_catalog === false) {
          setDisabled(true)
        } else {
          setCompany(found)
        }
      })
      .catch(() => setDisabled(true))
      .finally(() => setResolved(true))
  }, [companySlug])

  // Si la empresa no existe o tiene el catálogo apagado, avisamos al loader
  // para que esconda el iframe por completo.
  useEffect(() => {
    if (resolved && disabled) postToParent({ hidden: true })
  }, [resolved, disabled])

  const handleOpenChange = useCallback((open) => {
    postToParent({ open })
  }, [])

  // Fondo transparente: así, con el iframe pequeño solo se ve la burbuja.
  const transparentBg = `html,body,#root{background:transparent !important;margin:0;padding:0;}`

  if (!resolved || disabled || !company) {
    return <style dangerouslySetInnerHTML={{ __html: transparentBg }} />
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: transparentBg }} />
      <ThemeProvider settings={company.settings} />
      <ChatWidget
        companySlug={companySlug}
        welcomeMessage={company.settings?.chat_welcome}
        companyLogo={company.logo_url}
        onOpenChange={handleOpenChange}
        embedded
        embedMobile={mobile}
      />
    </>
  )
}
