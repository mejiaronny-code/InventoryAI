/**
 * components/shared/LiveClock.jsx
 * Reloj en vivo (hora local del navegador) para orientación rápida en el admin.
 */
import { useState, useEffect } from 'react'
import { Clock } from 'lucide-react'

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

export default function LiveClock({ compact = false, dark = false, className = '' }) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(interval)
  }, [])

  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const fecha = `${DIAS[now.getDay()]} ${now.getDate()}`

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${dark ? 'text-ink-300' : 'text-ink-500'} ${className}`}>
        <Clock size={13} />
        <span>{hh}:{mm}</span>
      </div>
    )
  }

  return (
    <div className={`flex items-center gap-2 text-ink-500 ${className}`}>
      <Clock size={14} />
      <span className="text-sm font-semibold text-ink-700">{hh}:{mm}</span>
      <span className="text-xs text-ink-400">· {fecha}</span>
    </div>
  )
}
