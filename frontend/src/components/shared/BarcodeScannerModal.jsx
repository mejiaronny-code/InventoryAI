/**
 * components/shared/BarcodeScannerModal.jsx
 * Modal reutilizable para escanear códigos de barras / QR con la cámara.
 * Usa html5-qrcode (carga dinámica para no bloquear el bundle inicial).
 *
 * Props:
 *   open       — boolean
 *   onClose    — () => void
 *   onDetected — (code: string) => void   llamado con el primer código detectado
 */
import { useState, useEffect, useRef } from 'react'
import { X, ScanLine, Camera, AlertCircle, Loader2 } from 'lucide-react'

export default function BarcodeScannerModal({ open, onClose, onDetected }) {
  const [error, setError]   = useState(null)
  const [ready, setReady]   = useState(false)
  const scannerRef          = useRef(null)
  const detectedRef         = useRef(false)   // evita disparar onDetected varias veces

  useEffect(() => {
    if (!open) return
    setError(null)
    setReady(false)
    detectedRef.current = false

    import('html5-qrcode').then(({ Html5Qrcode }) => {
      const scanner = new Html5Qrcode('barcode-scanner-region')
      scannerRef.current = scanner

      scanner.start(
        { facingMode: 'environment' },
        { fps: 15, qrbox: { width: 260, height: 140 } },
        (code) => {
          if (detectedRef.current) return
          detectedRef.current = true
          scanner.pause()
          onDetected(code.trim())
          onClose()
        },
        () => {} // errores por frame — ignorar
      )
        .then(() => setReady(true))
        .catch(() =>
          setError('No se pudo acceder a la cámara. Verifica los permisos del navegador.')
        )
    }).catch(() => setError('No se pudo cargar el módulo de escaneo.'))

    return () => {
      const s = scannerRef.current
      if (s) {
        Promise.resolve(s.isRunning() ? s.stop() : null).catch(() => {})
        scannerRef.current = null
      }
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="modal-box max-w-sm w-full">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-ink-100">
          <h3 className="font-bold text-ink-900 flex items-center gap-2">
            <ScanLine size={18} className="text-brand-500" />
            Escanear código
          </h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-ink-100">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {error ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <AlertCircle size={36} className="text-red-400" />
              <p className="text-sm text-red-600">{error}</p>
              <p className="text-xs text-ink-400">
                Asegúrate de que el navegador tenga permiso para usar la cámara
                y de que estés en HTTPS o localhost.
              </p>
            </div>
          ) : (
            <>
              {!ready && (
                <div className="flex items-center justify-center gap-2 py-4 text-ink-400 text-sm">
                  <Loader2 size={18} className="animate-spin text-brand-500" />
                  Iniciando cámara...
                </div>
              )}
              {/* html5-qrcode inyecta el elemento <video> aquí */}
              <div
                id="barcode-scanner-region"
                className="w-full rounded-xl overflow-hidden bg-black"
              />
              <div className="flex items-center justify-center gap-2 text-xs text-ink-400">
                <Camera size={13} />
                Apunta al código de barras o QR del producto
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
