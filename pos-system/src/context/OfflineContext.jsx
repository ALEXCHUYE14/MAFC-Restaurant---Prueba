import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import * as IDB             from '@/services/offlineDB'
import { supabase }         from '@/services/supabase'

/**
 * OfflineContext — Gestor central de sincronización offline/online.
 *
 * Responsabilidades:
 *   1. Expone isOnline a toda la app.
 *   2. Mantiene el conteo de operaciones pendientes de sincronizar.
 *   3. Procesa la cola de sincronización cuando se recupera la conexión.
 *   4. Escucha el evento 'pos:queueChanged' emitido por OrdersContext
 *      y TablesContext para actualizar el conteo.
 *   5. Emite 'pos:syncComplete' cuando termina de sincronizar, para
 *      que OrdersContext recargue datos frescos del servidor.
 *
 * Estrategia anti-duplicados:
 *   - Los pedidos usan UUID generado en el cliente → mismo ID local y Supabase.
 *   - Se usa upsert con onConflict:'id' → idempotente (se puede reejecutar sin duplicar).
 *   - Si Supabase ya tiene el registro (otro dispositivo lo subió antes) se ignora.
 */

const OfflineCtx = createContext(null)

export function OfflineProvider({ children }) {
  const { isOnline, wasOffline }   = useNetworkStatus()
  const [isSyncing,    setIsSyncing]    = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncStatus,   setSyncStatus]   = useState('idle')
  // 'idle' | 'syncing' | 'done' | 'error'

  const syncingRef = useRef(false) // guard para evitar ejecuciones paralelas

  /* ── Actualizar conteo de pendientes ──────────────────────────────── */
  const refreshCount = useCallback(async () => {
    try {
      const n = await IDB.getPendingCount()
      setPendingCount(n)
    } catch { /* IDB puede no estar disponible en todos los navegadores */ }
  }, [])

  /* ── Proceso de sincronización ────────────────────────────────────── */
  const processQueue = useCallback(async () => {
    if (syncingRef.current) return
    if (!supabase)           return  // Supabase no configurado

    const queue = await IDB.getQueue().catch(() => [])
    if (!queue.length) return

    syncingRef.current = true
    setIsSyncing(true)
    setSyncStatus('syncing')

    let ok = 0, fail = 0

    for (const item of queue) {
      try {
        await syncItem(item)
        await IDB.removeFromQueue(item.id)

        // Quitar flag _pendingSync del pedido en IDB
        if (item.entity === 'orders') {
          const local = await IDB.getOrder(item.entityId).catch(() => null)
          if (local) await IDB.saveOrder({ ...local, _pendingSync: false })
        }
        ok++
      } catch (err) {
        const isDuplicate = err?.code === '23505' ||
          err?.message?.includes('duplicate') ||
          err?.message?.includes('already exists')

        if (isDuplicate) {
          // Ya existe en el servidor — se considera sincronizado
          await IDB.removeFromQueue(item.id)
          ok++
        } else {
          console.warn('[OfflineSync] Fallo al sincronizar item:', item.id, err?.message)
          await IDB.updateQueueItem(item.id, {
            retries: (item.retries || 0) + 1,
            lastError: err?.message,
          }).catch(() => {})
          fail++
        }
      }
    }

    syncingRef.current = false
    setIsSyncing(false)
    await refreshCount()
    setSyncStatus(fail === 0 ? 'done' : 'error')

    // Notificar a OrdersContext para que recargue datos frescos
    window.dispatchEvent(new CustomEvent('pos:syncComplete', { detail: { ok, fail } }))

    // Resetear status visual después de 4 segundos
    setTimeout(() => setSyncStatus('idle'), 4000)
  }, [refreshCount])

  /* ── Ejecuta una operación individual de la cola ──────────────────── */
  async function syncItem(item) {
    if (!supabase) throw new Error('Supabase no disponible')

    // Strip campos client-only antes de enviar a Supabase
    const { _pendingSync, ...cleanData } = item.data || {}

    switch (`${item.entity}:${item.op}`) {

      case 'orders:INSERT': {
        // upsert con ignoreDuplicates: si ya existe, no hacer nada
        const { error } = await supabase
          .from('orders')
          .upsert(cleanData, { onConflict: 'id', ignoreDuplicates: true })
        if (error) throw error
        break
      }

      case 'orders:UPDATE': {
        const { error } = await supabase
          .from('orders')
          .update(cleanData)
          .eq('id', item.entityId)
        if (error) throw error
        break
      }

      case 'orders:DELETE': {
        const { error } = await supabase
          .from('orders')
          .delete()
          .eq('id', item.entityId)
        if (error) throw error
        break
      }

      case 'mesas:UPDATE': {
        const { numero_mesa, estado, extra = {} } = item.data || {}
        const { error } = await supabase
          .from('mesas')
          .update({ estado, ultima_actualizacion: new Date().toISOString(), ...extra })
          .eq('numero_mesa', numero_mesa)
        if (error) throw error
        break
      }

      default:
        console.warn('[OfflineSync] Operación desconocida:', item.entity, item.op)
    }
  }

  /* ── Dispara la sincronización al reconectarse ────────────────────── */
  useEffect(() => {
    if (!isOnline || !wasOffline) return
    // Pequeño delay para que la conexión se estabilice
    const timer = setTimeout(processQueue, 1500)
    return () => clearTimeout(timer)
  }, [isOnline, wasOffline, processQueue])

  /* ── Escucha cuando OrdersContext/TablesContext agregan a la cola ──── */
  useEffect(() => {
    window.addEventListener('pos:queueChanged', refreshCount)
    return () => window.removeEventListener('pos:queueChanged', refreshCount)
  }, [refreshCount])

  /* ── Conteo inicial ───────────────────────────────────────────────── */
  useEffect(() => { refreshCount() }, [refreshCount])

  return (
    <OfflineCtx.Provider value={{
      isOnline,
      isSyncing,
      pendingCount,
      syncStatus,
      processQueue,
      refreshCount,
    }}>
      {children}
    </OfflineCtx.Provider>
  )
}

export function useOffline() {
  const ctx = useContext(OfflineCtx)
  if (!ctx) throw new Error('useOffline debe usarse dentro de <OfflineProvider>')
  return ctx
}
