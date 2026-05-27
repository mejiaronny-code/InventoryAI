/**
 * hooks/useRealtimeInserts.js
 * Hook genérico para escuchar INSERTs en cualquier tabla via Supabase Realtime.
 * Reutilizable en Notificaciones, Reservas, etc.
 */
import { useEffect, useRef } from 'react'
import { createClient } from '@supabase/supabase-js'

// Singleton del cliente Supabase (anon key — solo lectura pública de cambios)
let _client = null
function getClient() {
  if (!_client) {
    _client = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY
    )
  }
  return _client
}

/**
 * @param {object} options
 * @param {string|null} options.companyId   - Filtra por company_id
 * @param {string}      options.table       - Nombre de la tabla ("notifications", "reservations", …)
 * @param {string}      [options.event]     - Evento Postgres: "INSERT" | "UPDATE" | "DELETE" | "*"
 * @param {function}    options.onEvent     - Callback que recibe payload.new (o payload completo si event="*")
 */
export function useRealtimeInserts({ companyId, table, event = 'INSERT', onEvent }) {
  const cbRef = useRef(onEvent)
  cbRef.current = onEvent

  useEffect(() => {
    if (!companyId || !table) return

    const supabase = getClient()
    const channelName = `rt_${table}_${event}_${companyId}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          cbRef.current?.(payload.new ?? payload)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [companyId, table, event])
}
