/**
 * embed.js — Loader del chat embebible de InventoryAI.
 *
 * Uso (el cliente lo pega en su propia página web):
 *   <script src="https://inventory-ai-ruddy.vercel.app/embed.js"
 *           data-company="su-slug"></script>
 *
 * Opcionales:
 *   data-position="left"   -> ancla la burbuja abajo-izquierda (default: right)
 *
 * Inyecta un <iframe> aislado que apunta a /embed/<slug>. El iframe arranca
 * pequeño (solo la burbuja) y crece cuando el usuario abre el chat, escuchando
 * mensajes postMessage que emite la página del chat. Así no bloquea clics del
 * sitio anfitrión cuando está cerrado.
 */
(function () {
  'use strict'

  var MSG_SOURCE = 'inventoryai-chat-widget'

  // Localiza el <script> actual (para leer sus data-* y derivar el origen).
  var script = document.currentScript
  if (!script) {
    var all = document.getElementsByTagName('script')
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && all[i].src.indexOf('embed.js') !== -1) { script = all[i]; break }
    }
  }
  if (!script) return

  var slug = script.getAttribute('data-company')
  if (!slug) {
    console.error('[InventoryAI] Falta data-company en el <script> del chat embebible.')
    return
  }
  var side = script.getAttribute('data-position') === 'left' ? 'left' : 'right'

  // Origen del propio script (donde vive la app del chat).
  var origin
  try { origin = new URL(script.src).origin } catch (e) { origin = '' }

  // Evita doble inyección si el script se incluye dos veces.
  if (document.getElementById('inventoryai-chat-frame')) return

  var CLOSED = 96            // px: cabe la burbuja + su indicador
  function isMobile() { return window.matchMedia('(max-width: 639px)').matches }
  var lastOpen = false
  var shrinkTimer = null

  var iframe = document.createElement('iframe')
  iframe.id = 'inventoryai-chat-frame'
  iframe.src = origin + '/embed/' + encodeURIComponent(slug)
  iframe.title = 'Asistente IA'
  iframe.setAttribute('allow', 'microphone; clipboard-write')
  iframe.setAttribute('aria-label', 'Asistente IA')

  var base = {
    position: 'fixed',
    bottom: '0',
    border: '0',
    width: CLOSED + 'px',
    height: CLOSED + 'px',
    maxWidth: '100vw',
    maxHeight: '100dvh',
    background: 'transparent',
    colorScheme: 'normal',
    zIndex: '2147483000'
    // Sin transición de tamaño a propósito: el iframe cambia de tamaño al
    // instante y la animación bonita la hace el panel del chat por dentro.
  }
  base[side] = '0'
  for (var k in base) { iframe.style[k] = base[k] }

  function resize() {
    if (!lastOpen) {
      iframe.style.width = CLOSED + 'px'
      iframe.style.height = CLOSED + 'px'
    } else if (isMobile()) {
      // Móvil: pantalla completa.
      iframe.style.width = '100vw'
      iframe.style.height = '100dvh'
    } else {
      // Escritorio: panel flotante (mismo look del catálogo).
      iframe.style.width = '400px'
      iframe.style.height = Math.min(window.innerHeight, 720) + 'px'
    }
  }

  // Le informa al iframe si el dispositivo real es móvil, para que el chat use
  // el layout correcto (el ancho del iframe no sirve para detectarlo).
  function sendMode() {
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage(
        { source: MSG_SOURCE, dir: 'to-iframe', mobile: isMobile() }, '*'
      )
    }
  }

  window.addEventListener('message', function (ev) {
    var data = ev.data
    if (!data || data.source !== MSG_SOURCE || data.dir === 'to-iframe') return
    if (data.ready) { sendMode(); return }         // el iframe ya cargó: dile el modo
    if (data.hidden) { iframe.style.display = 'none'; return }
    if (typeof data.open === 'boolean') {
      clearTimeout(shrinkTimer)
      if (data.open) {
        lastOpen = true
        resize()                       // crece al instante (panel no se recorta)
      } else {
        lastOpen = false
        // Mantiene el iframe grande ~320ms para no cortar la animación de cierre.
        shrinkTimer = setTimeout(resize, 320)
      }
    }
  })

  // Si cambia el viewport (rotación, resize de ventana), reevalúa modo y tamaño.
  window.addEventListener('resize', function () {
    sendMode()
    resize()
  })

  function inject() { document.body.appendChild(iframe) }
  if (document.body) inject()
  else document.addEventListener('DOMContentLoaded', inject)
})()
