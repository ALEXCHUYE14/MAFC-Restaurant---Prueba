import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { DEMO_MODE, DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'

// ── Estado global de Caja (abierta/cerrada) ───────────────────────────────────
// Independiente de la sesión local de CashierPanel (localStorage, con todo el
// detalle del turno) — este contexto solo expone el booleano compartido que
// POS, Externos y NewOrderModal usan para bloquear "Enviar a Cocina" cuando
// no hay una caja abierta. CashierPanel es el único que escribe aquí (al
// abrir/cerrar turno); todo lo demás solo lee.
//
// Por defecto cajaAbierta = true: si la tabla `caja_estado` aún no existe
// (migración no aplicada) o Supabase no responde, el sistema se comporta
// exactamente igual que antes de esta funcionalidad — nada se bloquea.
const CajaCtx = createContext(null)

export function CajaProvider({ children }) {
  const { user } = useAuth()
  const [cajaAbierta, setCajaAbierta] = useState(true)
  const [cajaInfo, setCajaInfo]       = useState(null)
  const [loading, setLoading]         = useState(true)

  useEffect(() => {
    if (DEMO_MODE) { setLoading(false); return }

    let mounted = true
    DB.getCajaEstado()
      .then(data => {
        if (!mounted) return
        // Si no hay fila (tabla no migrada aún) data es null → mantener el
        // default permisivo (cajaAbierta = true) en vez de forzar false.
        if (data) {
          setCajaAbierta(!!data.isOpen)
          setCajaInfo(data)
        }
        setLoading(false)
      })
      .catch(() => { if (mounted) setLoading(false) })

    const unsub = DB.subscribeCajaEstado(row => {
      if (!row) return
      setCajaAbierta(!!row.isOpen)
      setCajaInfo(row)
    })

    return () => { mounted = false; unsub() }
  }, [])

  // Llamado por CashierPanel al abrir/cerrar turno — propaga el cambio a
  // todos los demás módulos y dispositivos casi al instante vía Realtime.
  // Best-effort: si la tabla no existe aún, no rompe el flujo de caja local
  // (el error se registra pero no se relanza).
  const setCajaEstado = useCallback(async (isOpen, meta = {}) => {
    setCajaAbierta(isOpen) // optimista — refleja el cambio de inmediato en este mismo dispositivo
    if (DEMO_MODE) return
    try {
      await DB.updateCajaEstado(isOpen, meta)
      // Auditoría — no se espera (fire-and-forget): nunca debe demorar ni
      // poder hacer fallar la apertura/cierre de caja en sí.
      DB.logAudit({
        actorId:   user?.uid,
        actorName: user?.name,
        action:    isOpen ? 'caja_open' : 'caja_close',
        entity:    'caja_estado',
        detail:    meta,
      })
    } catch (e) {
      console.warn('[Caja] setCajaEstado:', e?.message)
    }
  }, [user])

  return (
    <CajaCtx.Provider value={{ cajaAbierta, cajaInfo, loading, setCajaEstado }}>
      {children}
    </CajaCtx.Provider>
  )
}

export function useCaja() {
  const ctx = useContext(CajaCtx)
  if (!ctx) throw new Error('useCaja must be used inside CajaProvider')
  return ctx
}
