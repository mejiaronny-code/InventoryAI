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
  // Nombre de canal único por instancia: varios componentes pueden suscribirse
  // a las mismas notificaciones, y Supabase no permite reusar un canal ya suscrito.
  const channelIdRef = useRef(Math.random().toString(36).slice(2))

  useEffect(() => {
    if (!companyId) return

    // Autenticar el canal Realtime con el JWT del usuario para que el RLS
    // de notifications permita recibir los eventos (si no, llega vacío).
    const token = localStorage.getItem('access_token')
    if (token) supabase.realtime.setAuth(token)

    const channel = supabase
      .channel(`notifications_${companyId}_${channelIdRef.current}`)
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

/**
 * Hook genérico: se suscribe a cambios (INSERT/UPDATE/DELETE) de cualquier
 * tabla filtrada por company_id y llama onChange en cada cambio.
 * @param {string} table - nombre de la tabla (ej. 'bookings')
 * @param {string|null} companyId
 * @param {function} onChange - callback en cada cambio
 */
export function useRealtimeTable(table, companyId, onChange) {
  const cbRef = useRef(onChange)
  cbRef.current = onChange
  const channelIdRef = useRef(Math.random().toString(36).slice(2))

  useEffect(() => {
    if (!companyId || !table) return

    const token = localStorage.getItem('access_token')
    if (token) supabase.realtime.setAuth(token)

    const channel = supabase
      .channel(`${table}_${companyId}_${channelIdRef.current}`)
      .on(
        'postgres_changes',
        {
          event:  '*',
          schema: 'public',
          table,
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          cbRef.current?.(payload)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, companyId])
}
