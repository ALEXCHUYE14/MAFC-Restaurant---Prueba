import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useOrders } from '@/features/orders/OrdersContext'
import { useAuth } from '@/features/auth/AuthContext'
import { useExpenses } from '@/features/expenses/ExpensesContext'
import { useCaja } from '@/features/cashier/CajaContext'
import OrderCard from '@/features/orders/OrderCard'
import { formatPEN } from '@/utils/currency'
import { formatFullDate } from '@/utils/dates'
import { generateDailySalesReport } from '@/utils/pdf'
import { DB, DEMO_MODE, isMissingRpcError } from '@/services/supabase'
import { printReceipt } from '@/utils/print'
import * as IDB from '@/services/offlineDB'
import {
  Banknote, CreditCard, Smartphone, Wallet, Check, AlertTriangle, LogOut,
  FileText, Flag, Printer, RotateCw, Bell, CheckCircle2, Circle, Loader2, Ban,
} from 'lucide-react'

const PAYMENT_ICONS = { efectivo: Banknote, tarjeta: CreditCard, yape: Smartphone, plin: Smartphone }

// Zonas sin mesero en la cadena — van directamente de Cocina "Listo" a Caja "Por Cobrar"
const DIRECT_TO_CASHIER_ZONES = ['Para Llevar', 'Delivery', 'Recojo en Local']

const PM_DISPLAY = { efectivo: 'Efectivo', yape: 'Yape', tarjeta: 'Tarjeta', plin: 'Plin' }

// Pedido sin cobrar = no cobrado, no anulado, no archivado (misma regla que
// la base de datos en migracion-cierres-turno.sql).
function isOpenOrderStatus(status) {
  const s = String(status || '')
  return !s.startsWith('Pagado') && !['paid', 'anulado', 'archivado'].includes(s)
}
const ORDER_STATUS_LABEL = {
  pending: 'pendiente', preparing: 'en cocina', in_progress: 'en cocina',
  ready: 'listo', served: 'servido sin cobrar',
}
function openOrderLabel(o) {
  let customer = null
  try { customer = JSON.parse(o?.notes || '{}').customerName || null } catch (_) { /* notas no JSON */ }
  const where = Number(o?.table_number) > 0 ? `Mesa ${o.table_number}` : (o?.zone || 'Externo')
  const who   = o?.waiter_name || customer || '—'
  return `${where} · ${who}`
}
const num2 = v => Math.round((Number(v) || 0) * 100) / 100

// ── Persistencia del turno de caja ────────────────────────────────────────────
// La sesión se guarda en localStorage para sobrevivir recargas de página.
// Shape: { openedAt: ISO string, openedBy: string, fondoInicial: number }
const CAJA_KEY = 'antojitos_caja_session'

// Fallback en memoria para entornos donde localStorage no está disponible
// (modo incógnito con restricciones, cuota llena, etc.)
let _cajaMemFallback = null

function loadCajaSession() {
  try {
    const stored = localStorage.getItem(CAJA_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  // Si localStorage falla, devolver el fallback en memoria
  return _cajaMemFallback
}

function saveCajaSession(session) {
  _cajaMemFallback = session
  try {
    if (session) localStorage.setItem(CAJA_KEY, JSON.stringify(session))
    else         localStorage.removeItem(CAJA_KEY)
  } catch { /* localStorage no disponible — el fallback en memoria mantiene la sesión */ }
}

// ─────────────────────────────────────────────────────────────────────────────

export default function CashierPanel() {
  const { orders, loading, todaySales, updateOrder, resetLocalOrders, cancelOrder } = useOrders()
  const { user } = useAuth()
  // totalToday = suma de egresos registrados hoy — ya viene protegida contra
  // valores null/NaN dentro de ExpensesContext (reduce con `e.monto || 0`).
  // todayExpenses = el detalle (concepto, categoría, monto) para el reporte PDF.
  const { totalToday: totalEgresosHoy, todayExpenses, archiveActive } = useExpenses()
  // Estado global de caja — lo que ven POS/Externos/App Mesero para
  // habilitar o bloquear "Enviar a Cocina". CashierPanel es quien lo escribe.
  const { setCajaEstado } = useCaja()

  // ── Estado de sesión de caja (persiste entre recargas) ───────────────────
  const [cajaSession, setCajaSession] = useState(loadCajaSession)
  const [fondoInput,  setFondoInput]  = useState('')
  // Conteo físico de efectivo al cerrar caja — para el arqueo
  const [efectivoReal, setEfectivoReal] = useState('')

  // ── Estado del panel ──────────────────────────────────────────────────────
  const [tab,           setTab]           = useState('pending')
  const [showCierre,    setShowCierre]    = useState(false)
  const [cierreLoading, setCierreLoading] = useState(false)
  const [cierreMsg,     setCierreMsg]     = useState('')
  // Snapshot de totales tomado ANTES de resetLocalOrders() para mostrar datos
  // correctos en el modal de éxito aunque las órdenes ya estén limpias en memoria.
  const [cierreResumen, setCierreResumen] = useState(null)
  const lastPrintRef                      = useRef(null)
  const [printBanner,   setPrintBanner]   = useState(null)
  // Verificación previa al cierre (migracion-cierres-turno.sql): resumen
  // calculado en el servidor + pedidos sin cobrar. source: 'server' | 'local' | 'error'
  const [cierreInfo,        setCierreInfo]        = useState(null)
  const [cierreInfoLoading, setCierreInfoLoading] = useState(false)
  const [cierreErr,         setCierreErr]         = useState('')
  const [anulandoId,        setAnulandoId]        = useState(null)
  const closingRef = useRef(false)   // evita dos cierres por doble clic

  // ── Apertura de caja ──────────────────────────────────────────────────────
  function handleAbrirCaja() {
    const fondo   = parseFloat(fondoInput) || 0
    const session = {
      openedAt:     new Date().toISOString(),
      openedBy:     user?.name || 'Cajero',
      fondoInicial: fondo,
    }
    // Guardar PRIMERO en localStorage (best-effort con try/catch interno)
    saveCajaSession(session)
    // Actualizar el estado de React SIEMPRE, independientemente de si localStorage falló
    setCajaSession(session)
    setFondoInput('')
    setEfectivoReal('') // turno nuevo — limpiar cualquier arqueo del turno anterior
    // Propaga "caja abierta" a POS/Externos/App Mesero — habilita "Enviar a
    // Cocina" ahí de inmediato. Best-effort (no bloquea la apertura local si falla).
    setCajaEstado(true, session)
  }

  // ── Wrapper de cobro — snapshot ANTES del await para evitar closure stale ─
  const handleUpdate = useCallback(async (orderId, changes) => {
    // Capturar el pedido en su estado actual, ANTES de que updateOrder
    // modifique el array de orders de forma optimista.
    const orderSnapshot = orders.find(o => o.id === orderId)

    await updateOrder(orderId, changes)

    if (!changes.payment_method) return
    if (!orderSnapshot) return

    let customerName = null
    try { customerName = JSON.parse(orderSnapshot.notes || '{}').customerName || null } catch (_) {}

    const printData = {
      mesa:          orderSnapshot.table_number > 0 ? orderSnapshot.table_number : null,
      zone:          orderSnapshot.zone || 'Salón',
      waiterName:    orderSnapshot.waiter_name || null,
      items:         (orderSnapshot.items || []).map(i => ({
        name:  i.name,
        price: i.price || 0,
        qty:   i.qty ?? i.quantity ?? 1,
      })),
      total:         orderSnapshot.total || 0,
      paymentMethod: changes.payment_method,
      // Envases descartables (migracion-envases.sql) — desglose en el ticket
      packagingCount: orderSnapshot.packaging_count || 0,
      packagingUnit:  orderSnapshot.packaging_unit ?? null,
      // Descuento (migracion-descuentos-cupones.sql) — desglose en el ticket
      descuentoMonto: Number(orderSnapshot.descuento_monto) || 0,
      descuentoLabel: orderSnapshot.cupon_codigo || orderSnapshot.descuento_motivo || null,
      customerName,
    }

    lastPrintRef.current = printData
    printReceipt(printData)

    const pmName = PM_DISPLAY[changes.payment_method] || changes.payment_method
    setPrintBanner({ msg: `✓ Cobrado · ${pmName}`, pm: changes.payment_method })
    setTimeout(() => setPrintBanner(null), 12000)
  }, [updateOrder, orders])

  // "Por Cobrar" = pedidos entregados por mesero ('served')
  //              + pedidos 'ready' de zonas sin mesero (Para Llevar, Delivery, Recojo)
  const served = useMemo(() => orders.filter(o =>
    o.status === 'served' ||
    (o.status === 'ready' && DIRECT_TO_CASHIER_ZONES.includes(o.zone))
  ), [orders])

  // Ventas cobradas — usa todaySales del contexto (idéntico al PANEL)
  const paid = todaySales

  const totalRevenue = useMemo(() =>
    paid.reduce((s, o) => s + (o.total || 0), 0), [paid])

  // Un pedido 'mixto' (pago dividido — ver migracion-pago-mixto.sql) reparte su
  // monto entre los métodos reales de payment_breakdown. Esto alimenta
  // directamente efectivoVentas de abajo — CRÍTICO para el arqueo físico de
  // caja: la parte en efectivo de un cobro dividido tiene que contarse igual
  // que cualquier otra venta en efectivo, ni de más ni de menos.
  const byPayment = useMemo(() => paid.reduce((acc, o) => {
    const breakdown = Array.isArray(o.payment_breakdown) ? o.payment_breakdown : null
    if (breakdown && breakdown.length) {
      for (const leg of breakdown) acc[leg.metodo] = (acc[leg.metodo] || 0) + (Number(leg.monto) || 0)
    } else {
      const pm = o.payment_method || o.paymentMethod || 'efectivo'
      acc[pm] = (acc[pm] || 0) + (o.total || 0)
    }
    return acc
  }, {}), [paid])

  // ── Cálculo de caja: efectivo, digital, egresos y saldo esperado ───────────
  // Todo protegido contra null/undefined/NaN (fondo corrupto en localStorage,
  // egresos sin cargar aún, etc.) — nunca debe propagar NaN a la UI.
  const fondoInicial     = Number(cajaSession?.fondoInicial) || 0
  const efectivoVentas   = Number(byPayment.efectivo) || 0
  const digitalVentas    = Math.max(0, (Number(totalRevenue) || 0) - efectivoVentas)
  const totalEgresos     = Number(totalEgresosHoy) || 0
  // Efectivo que debería haber físicamente en caja ahora mismo — se resta el
  // total de egresos registrados, así un egreso siempre se refleja al instante.
  const efectivoEsperado = fondoInicial + efectivoVentas - totalEgresos

  // Vista previa del servidor (fuente de verdad del cierre). Si la migración
  // no está ejecutada, se usan los montos del panel como siempre.
  const serverPreview = cierreInfo?.source === 'server' && cierreInfo.resumen ? {
    total:            num2(cierreInfo.resumen.total_ventas),
    count:            Number(cierreInfo.resumen.pedidos_count) || 0,
    efectivoVentas:   num2(cierreInfo.resumen.efectivo_ventas),
    digitalVentas:    num2(cierreInfo.resumen.digital_ventas),
    totalEgresos:     num2(cierreInfo.resumen.total_egresos),
    efectivoEsperado: num2(cierreInfo.resumen.efectivo_esperado),
  } : null
  // Pedidos sin cobrar: del servidor (incluye días anteriores) o, si falta la
  // migración, de los pedidos cargados en el panel.
  const localOpenOrders = useMemo(() => orders.filter(o => isOpenOrderStatus(o.status)), [orders])
  const openOrders = cierreInfo?.source === 'server' ? (cierreInfo.abiertos || [])
    : cierreInfo?.source === 'local' ? localOpenOrders : null
  const mesasHuerfanas = cierreInfo?.source === 'server' ? (cierreInfo.huerfanas || []) : []
  const cierreBloqueado = !cierreInfo || cierreInfo.source === 'error' || (openOrders && openOrders.length > 0)

  const efectivoRealNum   = efectivoReal.trim() === '' ? null : Number(efectivoReal)
  const efectivoRealValido = efectivoRealNum !== null && isFinite(efectivoRealNum) && efectivoRealNum >= 0 && efectivoRealNum <= 1000000
  const esperadoArqueo     = serverPreview ? serverPreview.efectivoEsperado : efectivoEsperado
  const diferenciaCaja     = efectivoRealValido ? num2(efectivoRealNum - esperadoArqueo) : null

  // Carga la verificación previa al cierre
  const loadCierreInfo = useCallback(async () => {
    if (DEMO_MODE) { setCierreInfo({ source: 'local' }); return }
    setCierreInfoLoading(true)
    try {
      const data = await DB.estadoCierreCaja(Number(cajaSession?.fondoInicial) || 0)
      setCierreInfo({
        source:    'server',
        resumen:   data?.resumen || null,
        abiertos:  Array.isArray(data?.pedidos_abiertos) ? data.pedidos_abiertos : [],
        huerfanas: Array.isArray(data?.mesas_huerfanas) ? data.mesas_huerfanas : [],
      })
    } catch (e) {
      if (isMissingRpcError(e)) setCierreInfo({ source: 'local' })
      else setCierreInfo({ source: 'error', error: e?.message || 'sin conexión' })
    } finally {
      setCierreInfoLoading(false)
    }
  }, [cajaSession])

  // Al abrir el modal, y cada vez que cambian los pedidos (Realtime ya
  // existente en OrdersContext) mientras está abierto, se vuelve a verificar.
  useEffect(() => {
    if (!showCierre || cierreMsg === 'success') return
    const t = setTimeout(() => { loadCierreInfo() }, cierreInfo ? 800 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCierre, orders, cierreMsg, loadCierreInfo])

  // Anular un pedido sin cobrar desde el cierre (función existente, solo admin)
  const handleAnularAbierto = useCallback(async (o) => {
    if (!o?.id || anulandoId) return
    const motivo = window.prompt(`¿Anular el pedido ${openOrderLabel(o)} (${formatPEN(o.total || 0)})?\nEscribe el motivo:`)
    if (motivo === null) return
    if (!motivo.trim()) { alert('Escribe el motivo de la anulación.'); return }
    setAnulandoId(o.id)
    try {
      await cancelOrder(o, motivo.trim())
    } catch (e) {
      alert(e?.message || 'No se pudo anular el pedido')
    } finally {
      setAnulandoId(null)
      loadCierreInfo()
    }
  }, [anulandoId, cancelOrder, loadCierreInfo])

  async function handleGenerateReport() {
    try {
      await generateDailySalesReport(paid, new Date(), todayExpenses)
    } catch (_) {}
  }

  // ── Cierre de Caja ─────────────────────────────────────────────────────────
  // Flujo:
  //   1. Snapshot de datos ANTES de cualquier operación asíncrona
  //   2. Generar PDF (best-effort, no bloquea el cierre si falla)
  //   3. RPC atómica en Supabase (fallback a archiveOrders + liberarTodasMesas)
  //   4. Limpiar estado React local
  //   5. Limpiar cola offline
  //   6. Mostrar mensaje de éxito o error
  //   7. finally: siempre liberar el estado de carga
  //
  // La sesión de caja (cajaSession) se borra SÓLO cuando el usuario confirma
  // "Finalizar turno" en el modal de éxito. Nunca hay redirección automática.
  const handleCierreCaja = useCallback(async () => {
    if (cierreLoading || closingRef.current) return
    // Exige un arqueo válido antes de cerrar — el botón ya queda deshabilitado
    // sin esto, pero se valida de nuevo aquí por si se invoca de otra forma.
    if (!efectivoRealValido) return
    // No se cierra con pedidos sin cobrar (el servidor lo vuelve a verificar)
    if (cierreBloqueado) return
    closingRef.current = true
    setCierreLoading(true)
    setCierreMsg('')
    setCierreErr('')

    // Snapshot inmutable tomado ANTES de resetLocalOrders() para que el modal
    // de éxito y el PDF tengan los datos aunque orders ya esté en [].
    const paidSnap      = [...paid]
    const cajaSnap      = cajaSession ? { ...cajaSession } : null
    const expensesSnap  = [...todayExpenses]
    const localSnap = {
      total: totalRevenue, count: paid.length, byPayment: { ...byPayment },
      efectivoVentas, digitalVentas, totalEgresos, efectivoEsperado,
    }

    try {
      // ── Paso 1: cierre en el servidor ─────────────────────────────────────
      let server = null
      let historialGuardado = false
      if (!DEMO_MODE) {
        try {
          server = await DB.cerrarTurnoCaja({
            fondo:           Number(cajaSnap?.fondoInicial) || 0,
            efectivoContado: efectivoRealNum,
            openedAt:        cajaSnap?.openedAt || null,
            openedBy:        cajaSnap?.openedBy || null,
          })
          historialGuardado = true
        } catch (e) {
          const msg = String(e?.message || '')
          if (isMissingRpcError(e)) {
            // Migración no ejecutada: el cierre de siempre (sin historial)
            try {
              await DB.ejecutarCierreCajaTotal()
            } catch (e2) {
              if (!isMissingRpcError(e2)) throw e2
              await Promise.allSettled([
                DB.archiveOrders().catch(() => {}),
                DB.liberarTodasMesas().catch(() => {}),
              ])
            }
          } else if (/TURNO_CON_PEDIDOS_ABIERTOS/.test(msg)) {
            // Alguien envió un pedido justo ahora: NO se cerró nada
            setCierreErr('Hay pedidos sin cobrar. Cóbralos o anúlalos antes de cerrar el turno.')
            loadCierreInfo()
            return
          } else {
            setCierreErr(/NOT_ALLOWED/.test(msg) ? 'Solo el administrador puede cerrar la caja.'
              : /INVALIDO/.test(msg) ? 'Monto no válido.'
              : 'No se pudo cerrar la caja (revisa la conexión). No se cerró nada.')
            setCierreMsg('error')
            return
          }
        }
      }

      // Montos definitivos: los del servidor (fuente de verdad) o, sin
      // migración, los del panel como siempre.
      const r = server ? {
        total:            num2(server.total_ventas),
        count:            Number(server.pedidos_count) || 0,
        byPayment:        server.por_metodo && typeof server.por_metodo === 'object' ? server.por_metodo : {},
        efectivoVentas:   num2(server.efectivo_ventas),
        digitalVentas:    num2(server.digital_ventas),
        totalEgresos:     num2(server.total_egresos),
        efectivoEsperado: num2(server.efectivo_esperado),
        efectivoReal:     num2(server.efectivo_contado),
        diferencia:       num2(server.diferencia),
      } : {
        ...localSnap,
        efectivoReal: efectivoRealNum,
        diferencia:   num2(efectivoRealNum - localSnap.efectivoEsperado),
      }

      // ── Paso 2: PDF del turno (después de confirmar el cierre) ───────────
      try {
        await generateDailySalesReport(paidSnap, new Date(), expensesSnap, server ? {
          totalRevenue:  r.total,
          count:         r.count,
          totalExpenses: r.totalEgresos,
          note: r.count !== paidSnap.length
            ? `Totales confirmados por el servidor: incluyen ${Math.abs(r.count - paidSnap.length)} pedido(s) cobrado(s) que no estaban en el panel (p. ej. de un turno anterior sin cerrar).`
            : null,
        } : null)
      } catch (_) {
        // El PDF falla silenciosamente: el cierre ya se completó.
      }

      // ── Paso 3: Vaciar estado React de inmediato ───────────────────────────
      resetLocalOrders()

      // ── Paso 4: Limpiar cola offline (best effort) ─────────────────────────
      try {
        await Promise.allSettled([IDB.clearQueue?.()].filter(Boolean))
      } catch (_) {}

      // ── Paso 5: Archivar egresos activos (idempotente; el servidor ya lo hizo)
      try {
        await archiveActive()
      } catch (e) {
        console.warn('[CashierPanel] archiveActive:', e?.message)
      }

      // ── Paso 6: Cerrar el estado global de caja ─────────────────────────────
      await setCajaEstado(false, { closedAt: new Date().toISOString() })

      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'cash_close',
        entity: 'cierres_caja', entityId: server?.id || null,
        detail: {
          total: r.total, pedidos: r.count, efectivoEsperado: r.efectivoEsperado,
          efectivoContado: r.efectivoReal, diferencia: r.diferencia, historial: historialGuardado,
        },
      })

      setCierreResumen({
        ...r,
        fondoInicial:      cajaSnap?.fondoInicial || 0,
        openedAt:          cajaSnap?.openedAt || null,
        openedBy:          cajaSnap?.openedBy || '',
        historialGuardado,
      })
      setCierreMsg('success')
    } catch (err) {
      // Error inesperado no capturado por los try/catch internos
      setCierreMsg('error')
    } finally {
      // Siempre desbloquear el botón, sin importar el resultado
      closingRef.current = false
      setCierreLoading(false)
    }
  }, [
    paid, totalRevenue, byPayment, cajaSession, resetLocalOrders, cierreLoading,
    efectivoVentas, digitalVentas, totalEgresos, efectivoEsperado, efectivoRealNum,
    efectivoRealValido, archiveActive, setCajaEstado, todayExpenses,
    cierreBloqueado, loadCierreInfo, user,
  ])

  // ── Pantalla de carga ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
        <Loader2 size={22} style={{animation:'spin .8s linear infinite'}}/>
        <span style={{ color: 'var(--fog)', fontSize: 13 }}>Cargando datos de caja...</span>
      </div>
    )
  }

  // ── Pantalla de apertura de caja ───────────────────────────────────────────
  // Persiste entre recargas via localStorage; sólo vuelve a aparecer después
  // de un Cierre de Caja explícito o si el operador limpia el almacenamiento.
  if (!cajaSession) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: 'var(--ink)',
      }}>
        <div style={{
          background: 'var(--ink2)', border: '1px solid var(--line2)',
          borderRadius: 20, padding: '36px 32px', maxWidth: 380, width: '100%',
          textAlign: 'center', boxShadow: '0 20px 60px rgba(15,23,42,.15)',
          margin: '0 16px',
        }}>
          <h2 style={{
            fontFamily: 'var(--display)', fontSize: 24,
            color: 'var(--amber)', letterSpacing: 1, marginBottom: 4, lineHeight: 1,
          }}>
            APERTURA DE CAJA
          </h2>
          <p style={{ fontSize: 12, color: 'var(--fog)', marginBottom: 28, lineHeight: 1.7 }}>
            Registra el fondo inicial y abre el turno<br/>
            para comenzar a registrar ventas del día.
          </p>

          <div style={{ textAlign: 'left', marginBottom: 20 }}>
            <label style={{
              display: 'block', fontSize: 9, fontWeight: 700, color: 'var(--fog)',
              letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6,
            }}>
              Fondo Inicial (S/) — opcional
            </label>
            <input
              type="number"
              min="0"
              step="0.50"
              value={fondoInput}
              onChange={e => setFondoInput(e.target.value)}
              placeholder="0.00"
              onKeyDown={e => e.key === 'Enter' && handleAbrirCaja()}
              style={{
                width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
                borderRadius: 10, padding: '12px 14px', color: 'var(--snow)',
                fontSize: 18, outline: 'none', boxSizing: 'border-box',
                fontFamily: 'var(--mono)', textAlign: 'right',
              }}
              autoFocus
            />
          </div>

          <button
            onClick={handleAbrirCaja}
            style={{
              width: '100%', padding: 14, borderRadius: 12, border: 'none',
              background: 'linear-gradient(135deg, #16A34A, #15803D)',
              color: '#fff', fontSize: 15, fontWeight: 800, cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(22,163,74,.30)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all .2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(22,163,74,.40)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(22,163,74,.30)' }}
          >
            Abrir Turno de Caja
          </button>

          <p style={{ fontSize: 10, color: 'var(--ghost)', marginTop: 16, lineHeight: 1.5 }}>
            {formatFullDate(new Date())} · {user?.name || 'Cajero'}
          </p>
        </div>
      </div>
    )
  }

  // ── Panel principal ────────────────────────────────────────────────────────
  const openTime = cajaSession?.openedAt
    ? new Date(cajaSession.openedAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
    : '--:--'

  // Resumen a mostrar en el modal: usa el snapshot post-cierre si ya existe,
  // o los valores en vivo si el modal se abrió antes de confirmar el cierre.
  const modalTotal            = cierreResumen?.total            ?? serverPreview?.total            ?? totalRevenue
  const modalCount            = cierreResumen?.count            ?? serverPreview?.count            ?? paid.length
  const modalEfectivoVentas   = cierreResumen?.efectivoVentas   ?? serverPreview?.efectivoVentas   ?? efectivoVentas
  const modalDigitalVentas    = cierreResumen?.digitalVentas    ?? serverPreview?.digitalVentas    ?? digitalVentas
  const modalTotalEgresos     = cierreResumen?.totalEgresos     ?? serverPreview?.totalEgresos     ?? totalEgresos
  const modalEfectivoEsperado = cierreResumen?.efectivoEsperado ?? serverPreview?.efectivoEsperado ?? efectivoEsperado
  const previewDifiere = !cierreResumen && serverPreview && serverPreview.count !== paid.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ── Modal Cierre de Caja ── */}
      {showCierre && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(15,23,42,.45)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: 'var(--ink2)', border: '1px solid var(--line2)',
            borderRadius: 16, padding: '28px 24px', maxWidth: 360, width: '100%',
            maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', boxSizing: 'border-box',
            boxShadow: '0 20px 60px rgba(15,23,42,.12)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--amber)', letterSpacing: 1 }}>
                CERRAR CAJA
              </h2>
              <p style={{ fontSize: 12, color: 'var(--fog)', marginTop: 8, lineHeight: 1.5 }}>
                Esta acción generará el reporte de cierre,<br/>
                archivará las órdenes cobradas y liberará<br/>
                las mesas. Solo se puede cerrar sin pedidos pendientes de cobro.
              </p>
            </div>

            {/* Resumen — muestra snapshot si ya se cerró, o datos en vivo si aún no */}
            <div style={{
              background: 'var(--ink3)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '12px 16px', marginBottom: 20, textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: 'var(--fog)', letterSpacing: 1, textTransform: 'uppercase' }}>
                Total {cierreMsg === 'success' ? 'cerrado' : 'a cerrar'}
              </div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 30, color: '#16A34A', lineHeight: 1, marginTop: 4 }}>
                {formatPEN(modalTotal)}
              </div>
              <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 4 }}>
                {modalCount} orden{modalCount !== 1 ? 'es' : ''} cobrada{modalCount !== 1 ? 's' : ''}
              </div>
              {(cierreResumen?.fondoInicial ?? cajaSession?.fondoInicial) > 0 && (
                <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 3 }}>
                  Fondo inicial: {formatPEN(cierreResumen?.fondoInicial ?? cajaSession?.fondoInicial)} · Turno desde las {openTime}
                </div>
              )}
            </div>

            {/* Desglose de caja — efectivo, digital, egresos y saldo esperado */}
            <div style={{
              background: 'var(--ink3)', border: '1px solid var(--line)',
              borderRadius: 10, padding: '12px 14px', marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
                <span>Venta Efectivo</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--snow)' }}>{formatPEN(modalEfectivoVentas)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mist)', marginBottom: 6 }}>
                <span>Venta Digital (Yape/Plin/Tarjeta)</span>
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--snow)' }}>{formatPEN(modalDigitalVentas)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--mist)', marginBottom: 8 }}>
                <span>Egresos del día</span>
                <span style={{ fontFamily: 'var(--mono)', color: '#DC2626' }}>− {formatPEN(modalTotalEgresos)}</span>
              </div>
              <div style={{
                borderTop: '1px dashed var(--line2)', paddingTop: 8,
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--fog)' }}>Efectivo Esperado</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 800, color: 'var(--amber)' }}>
                  {formatPEN(modalEfectivoEsperado)}
                </span>
              </div>
            </div>

            {previewDifiere && (
              <div style={{ fontSize: 10.5, color: '#D97706', lineHeight: 1.45, marginTop: -8, marginBottom: 12 }}>
                El servidor cuenta {serverPreview.count} pedido(s) cobrado(s) y este panel {paid.length}: incluye cobros
                de un turno anterior que no se cerró. El cierre usa los montos del servidor.
              </div>
            )}

            {/* Pedidos sin cobrar: bloquean el cierre del turno */}
            {cierreMsg !== 'success' && (
              <div style={{ marginBottom: 14 }}>
                {!cierreInfo || (cierreInfoLoading && !openOrders) ? (
                  <div style={{ fontSize: 11, color: 'var(--fog)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }}/> Verificando pedidos sin cobrar…
                  </div>
                ) : cierreInfo.source === 'error' ? (
                  <div style={{ fontSize: 11, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AlertTriangle size={12}/> No se pudo verificar los pedidos sin cobrar.
                    <button onClick={loadCierreInfo} style={{
                      padding: '3px 10px', borderRadius: 14, border: '1px solid var(--line2)', background: 'var(--ink3)',
                      color: 'var(--mist)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer',
                    }}>Reintentar</button>
                  </div>
                ) : openOrders && openOrders.length > 0 ? (
                  <div style={{
                    background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.3)',
                    borderRadius: 10, padding: '10px 12px',
                  }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: '#DC2626', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <AlertTriangle size={13}/> {openOrders.length} pedido{openOrders.length !== 1 ? 's' : ''} sin cobrar — cóbralos o anúlalos para cerrar
                    </div>
                    <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                      {openOrders.map(o => {
                        const created = o.created_at ? new Date(o.created_at) : null
                        const old = created && created.toDateString() !== new Date().toDateString()
                        return (
                          <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', borderTop: '1px solid var(--line)' }}>
                            <div style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'var(--snow)', lineHeight: 1.35 }}>
                              <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{openOrderLabel(o)}</div>
                              <div style={{ color: 'var(--fog)' }}>
                                {formatPEN(o.total || 0)} · {ORDER_STATUS_LABEL[o.status] || o.status || 'pendiente'}
                                {old && created ? ` · del ${created.toLocaleDateString('es-PE')}` : ''}
                              </div>
                            </div>
                            <button
                              onClick={() => handleAnularAbierto(o)}
                              disabled={!!anulandoId}
                              title="Anular pedido (devuelve el stock)"
                              style={{
                                padding: '4px 8px', borderRadius: 8, border: '1px solid rgba(220,38,38,.4)',
                                background: 'transparent', color: '#DC2626', fontSize: 10, fontWeight: 800,
                                cursor: anulandoId ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
                              }}
                            >{anulandoId === o.id ? <Loader2 size={10} style={{ animation: 'spin .8s linear infinite' }}/> : <Ban size={10}/>} Anular</button>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      onClick={() => { setShowCierre(false); setCierreErr(''); setTab('pending') }}
                      style={{
                        marginTop: 8, width: '100%', padding: '7px', borderRadius: 8, border: '1px solid var(--line2)',
                        background: 'var(--ink3)', color: 'var(--mist)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      }}
                    >Ir a "Por Cobrar"</button>
                    <div style={{ fontSize: 9.5, color: 'var(--fog)', marginTop: 6, lineHeight: 1.4 }}>
                      Las mesas también pueden cobrarse desde la app del mesero. La lista se actualiza sola.
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: '#16A34A', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Check size={12}/> Sin pedidos pendientes de cobro
                  </div>
                )}
                {mesasHuerfanas.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 6, lineHeight: 1.4 }}>
                    Mesa{mesasHuerfanas.length !== 1 ? 's' : ''} {mesasHuerfanas.join(', ')} marcada{mesasHuerfanas.length !== 1 ? 's' : ''} como ocupada{mesasHuerfanas.length !== 1 ? 's' : ''} sin pedido: se liberarán al cerrar.
                  </div>
                )}
                {cierreInfo?.source === 'local' && !DEMO_MODE && (
                  <div style={{ fontSize: 9.5, color: '#D97706', marginTop: 6, lineHeight: 1.4 }}>
                    Ejecuta migracion-cierres-turno.sql para guardar el historial de cierres.
                  </div>
                )}
              </div>
            )}

            {/* Arqueo — conteo físico de efectivo, solo antes de confirmar */}
            {cierreMsg !== 'success' && (
              <div style={{ marginBottom: 16, textAlign: 'left' }}>
                <label style={{
                  display: 'block', fontSize: 9, fontWeight: 700, color: 'var(--fog)',
                  letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6,
                }}>
                  Efectivo Real Contado (S/) *
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.10"
                  value={efectivoReal}
                  onChange={e => setEfectivoReal(e.target.value)}
                  placeholder="0.00"
                  disabled={cierreLoading}
                  style={{
                    width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
                    borderRadius: 10, padding: '10px 14px', color: 'var(--snow)',
                    fontSize: 16, outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'var(--mono)', textAlign: 'right',
                  }}
                />
                {efectivoRealValido ? (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, fontSize: 11,
                  }}>
                    <span style={{ color: 'var(--fog)' }}>
                      {diferenciaCaja === 0 ? 'Caja cuadra exacto' : diferenciaCaja > 0 ? 'Sobrante' : 'Faltante'}
                    </span>
                    <span style={{
                      fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 13,
                      color: diferenciaCaja === 0 ? 'var(--mist)' : diferenciaCaja > 0 ? '#16A34A' : '#DC2626',
                    }}>
                      {diferenciaCaja > 0 ? '+' : ''}{formatPEN(diferenciaCaja)}
                    </span>
                  </div>
                ) : (
                  <p style={{ fontSize: 9, color: 'var(--fog)', marginTop: 6, lineHeight: 1.4 }}>
                    Ingresa el efectivo contado físicamente para calcular la diferencia y poder cerrar caja.
                  </p>
                )}
              </div>
            )}

            {cierreMsg === 'success' && cierreResumen && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: 'var(--ink3)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 11,
              }}>
                <span style={{ color: 'var(--fog)' }}>Efectivo contado: {formatPEN(cierreResumen.efectivoReal)}</span>
                <span style={{
                  fontFamily: 'var(--mono)', fontWeight: 800, fontSize: 13,
                  color: cierreResumen.diferencia === 0 ? 'var(--mist)' : cierreResumen.diferencia > 0 ? '#16A34A' : '#DC2626',
                }}>
                  {cierreResumen.diferencia > 0 ? '+' : ''}{formatPEN(cierreResumen.diferencia)}
                </span>
              </div>
            )}

            {cierreMsg === 'success' && (
              <div style={{
                background: 'rgba(22,163,74,.12)', border: '1px solid rgba(22,163,74,.3)',
                borderRadius: 8, padding: '10px 14px', fontSize: 12,
                color: '#16A34A', textAlign: 'center', marginBottom: 14,
              }}>
                ✓ Caja cerrada exitosamente. El reporte PDF ha sido generado.
                {cierreResumen && !cierreResumen.historialGuardado && !DEMO_MODE && (
                  <div style={{ fontSize: 10.5, color: '#D97706', marginTop: 4 }}>
                    El cierre no quedó en el historial: ejecuta migracion-cierres-turno.sql.
                  </div>
                )}
              </div>
            )}
            {cierreErr && cierreMsg !== 'success' && (
              <div style={{
                background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
                borderRadius: 8, padding: '10px 14px', fontSize: 12,
                color: '#DC2626', textAlign: 'center', marginBottom: 14,
              }}>
                ⚠ {cierreErr}
              </div>
            )}
            {cierreMsg === 'error' && !cierreErr && (
              <div style={{
                background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
                borderRadius: 8, padding: '10px 14px', fontSize: 12,
                color: '#DC2626', textAlign: 'center', marginBottom: 14,
              }}>
                ⚠ Error al cerrar caja. Verifica la conexión e intenta nuevamente.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              {cierreMsg === 'success' ? (
                /* Al cerrar el modal de éxito, limpiar la sesión de caja.
                   El operador verá la pantalla de "Apertura de Caja" para el próximo turno.
                   NO hay redirección automática al login. */
                <button
                  onClick={() => {
                    setShowCierre(false)
                    setCierreMsg('')
                    setCierreResumen(null)
                    setCierreInfo(null)
                    setEfectivoReal('')
                    saveCajaSession(null)
                    setCajaSession(null)
                  }}
                  style={{
                    flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(22,163,74,.4)',
                    background: 'rgba(22,163,74,.12)', color: '#16A34A',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <LogOut size={14}/> Finalizar turno
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setShowCierre(false)
                      setCierreMsg('')
                      setCierreErr('')
                      setCierreResumen(null)
                      setCierreInfo(null)
                    }}
                    disabled={cierreLoading}
                    style={{
                      flex: 1, padding: '11px', borderRadius: 10, border: '1px solid var(--line2)',
                      background: 'var(--ink3)', color: 'var(--mist)',
                      fontSize: 13, fontWeight: 700, cursor: cierreLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCierreCaja}
                    disabled={cierreLoading || !efectivoRealValido || cierreBloqueado}
                    title={cierreBloqueado ? 'Hay pedidos sin cobrar (o aún se están verificando)' : !efectivoRealValido ? 'Ingresa el efectivo real contado para poder cerrar caja' : undefined}
                    style={{
                      flex: 2, padding: '11px', borderRadius: 10, border: 'none',
                      background: (cierreLoading || !efectivoRealValido || cierreBloqueado) ? 'var(--ink3)' : 'linear-gradient(135deg, #DC2626, #B91C1C)',
                      color: (cierreLoading || !efectivoRealValido || cierreBloqueado) ? 'var(--fog)' : '#fff',
                      fontSize: 13, fontWeight: 800,
                      cursor: (cierreLoading || !efectivoRealValido || cierreBloqueado) ? 'not-allowed' : 'pointer',
                      letterSpacing: .5,
                    }}
                  >
                    {cierreLoading ? <><RotateCw size={13} style={{animation:'spin .8s linear infinite', marginRight:5}}/> Cerrando...</> : 'Confirmar Cierre'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Resumen de ingresos ── */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--line)',
        background: 'var(--ink1)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
          <div>
            <p style={{ fontSize: 9, color: 'var(--fog)', letterSpacing: 1.5, textTransform: 'uppercase' }}>
              Ventas del día · {formatFullDate(new Date())}
            </p>
            <p style={{ fontFamily: 'var(--display)', fontSize: 36, color: 'var(--amber)', lineHeight: 1, marginTop: 4 }}>
              {formatPEN(totalRevenue)}
            </p>
            <p style={{ fontSize: 9, color: '#16A34A', marginTop: 3, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Circle size={7} fill="#16A34A" color="#16A34A"/> Turno desde las {openTime}
              {cajaSession?.fondoInicial > 0 && ` · Fondo: ${formatPEN(cajaSession.fondoInicial)}`}
            </p>
            {/* Saldo en efectivo disponible en caja ahora mismo — ya descuenta
                automáticamente cualquier egreso registrado durante el turno. */}
            <p style={{ fontSize: 10, color: 'var(--mist)', marginTop: 4, fontWeight: 700 }}>
              Efectivo disponible en caja:{' '}
              <span style={{ color: efectivoEsperado >= 0 ? 'var(--snow)' : '#DC2626' }}>
                {formatPEN(efectivoEsperado)}
              </span>
              {totalEgresos > 0 && ` (después de ${formatPEN(totalEgresos)} en egresos)`}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <button
              onClick={handleGenerateReport}
              style={{
                padding: '8px 14px', background: 'var(--ink3)',
                border: '1px solid var(--line2)', borderRadius: 'var(--r2)',
                color: 'var(--mist)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <FileText size={13}/> Reporte PDF
            </button>
            <button
              onClick={() => { setCierreInfo(null); setCierreErr(''); setShowCierre(true) }}
              style={{
                padding: '8px 14px',
                background: 'linear-gradient(135deg, rgba(220,38,38,.12), rgba(185,28,28,.08))',
                border: '1px solid rgba(220,38,38,.35)', borderRadius: 'var(--r2)',
                color: '#DC2626', fontSize: 11, fontWeight: 800, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6, letterSpacing: .5,
              }}
            >
              <Flag size={13}/> Cerrar Caja
            </button>
          </div>
        </div>

        {/* ── Banner de impresión + Reimprimir ── */}
        {printBanner && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.3)',
            borderRadius: 'var(--r2)', padding: '8px 12px', marginBottom: 10,
            animation: 'fadeUp .25s ease forwards',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Printer size={13}/> {printBanner.msg} — Ticket impreso
            </span>
            <button
              onClick={() => { if (lastPrintRef.current) printReceipt(lastPrintRef.current) }}
              style={{
                padding: '4px 12px', borderRadius: 20, cursor: 'pointer',
                background: 'transparent', border: '1px solid rgba(22,163,74,.5)',
                color: '#16A34A', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <RotateCw size={12}/> Reimprimir
            </button>
          </div>
        )}

        {/* Desglose por método de pago */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(byPayment).map(([pm, total]) => (
            <div key={pm} style={{
              background: 'var(--ink3)', border: '1px solid var(--line)',
              borderRadius: 'var(--r2)', padding: '6px 12px',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {(() => { const PmIcon = PAYMENT_ICONS[pm] || Wallet; return <PmIcon size={14}/>; })()}
              <div>
                <div style={{ fontSize: 10, color: 'var(--fog)', textTransform: 'capitalize' }}>{pm}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--emerald)', fontWeight: 700 }}>
                  {formatPEN(total)}
                </div>
              </div>
            </div>
          ))}
          {Object.keys(byPayment).length === 0 && (
            <span style={{ fontSize: 11, color: 'var(--fog)' }}>
              No hay ventas registradas aún
            </span>
          )}
        </div>

        {/* Contadores */}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          {[
            { label: 'Por cobrar', val: served.length, color: '#2563EB' },
            { label: 'Cobrados',   val: paid.length,   color: '#16A34A' },
          ].map(s => (
            <div key={s.label} style={{
              flex: 1, background: 'var(--ink2)', border: '1px solid var(--line)',
              borderRadius: 'var(--r2)', padding: '8px 10px', textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--display)', fontSize: 22, color: s.color, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 1, letterSpacing: .5 }}>{s.label.toUpperCase()}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0,
      }}>
        {[
          { key: 'pending', label: `Por Cobrar (${served.length})` },
          { key: 'paid',    label: `Cobrados (${paid.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 14px', borderRadius: 20, border: 'none',
              fontWeight: 700, fontSize: 11, cursor: 'pointer', transition: 'all .15s',
              background: tab === t.key ? 'var(--amber)' : 'var(--ink3)',
              color: tab === t.key ? '#FFFFFF' : 'var(--mist)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Lista de órdenes ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(tab === 'pending' ? served : paid).map(order => (
          <OrderCard
            key={order.id}
            order={order}
            role="cashier"
            onUpdate={tab === 'pending' ? handleUpdate : updateOrder}
          />
        ))}

        {(tab === 'pending' ? served : paid).length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 8, paddingTop: 40,
          }}>
            {tab === 'pending' ? <Bell size={34} strokeWidth={1.5} style={{opacity:.5}}/> : <CheckCircle2 size={34} strokeWidth={1.5} style={{opacity:.5}}/>}
            <p style={{ color: 'var(--fog)', fontSize: 13 }}>
              {tab === 'pending'
                ? 'No hay pedidos por cobrar'
                : 'No hay ventas cobradas aún'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
