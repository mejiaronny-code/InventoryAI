/**
 * hooks/useRealtimeNotifications.js
 * Hook para recibir notificaciones en tiempo real via Supabase Realtime.
 * Úsalo en el AdminLayout para mostrar nuevas notificaciones sin refrescar.
 */
import { useEffect, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'
import toast from 'react-hot-toast'
import { Bell, AlertTriangle, CalendarCheck } from 'lucide-react'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

const typeEmoji = {
  new_reservation:      '📋',
  reservation_expired:  '⌛',
  low_stock:            '⚠️',
  stock_out:            '🚫',
  system:               '⚡',
}

/**
 * @param {string} companyId - UUID de la empresa del usuario autenticado
 * @param {function} onNew - Callback cuando llega una notificación nueva
 */
export function useRealtimeNotifications(companyId, onNew) {
  useEffect(() => {
    if (!companyId) return

    const channel = supabase
      .channel(`notifications:${companyId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const notif = payload.new
          const emoji = typeEmoji[notif.type] || '🔔'

          // Mostrar toast de notificación
          toast(notif.message, {
            icon: emoji,
            duration: 5000,
            style: {
              borderLeft: '4px solid #f97316',
            },
          })

          // Callback para actualizar contadores
          if (onNew) onNew(notif)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [companyId, onNew])
}
