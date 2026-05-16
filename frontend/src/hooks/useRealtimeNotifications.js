/**
 * hooks/useRealtimeNotifications.js
 * Suscripción en tiempo real a nuevas notificaciones via Supabase Realtime.
 * Se usa en AdminLayout para actualizar el badge sin recargar.
 */
import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

/**
 * @param {string|null} companyId - ID de la empresa del usuario logueado
 * @param {function} onNew - Callback que se llama cuando llega una notificación nueva
 */
export function useRealtimeNotifications(companyId, onNew) {
  const onNewRef = useRef(onNew)
  onNewRef.current = onNew

  useEffect(() => {
    if (!companyId) return

    const channel = supabase
      .channel(`notifications_${companyId}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'notifications',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          onNewRef.current?.(payload.new)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [companyId])
}
