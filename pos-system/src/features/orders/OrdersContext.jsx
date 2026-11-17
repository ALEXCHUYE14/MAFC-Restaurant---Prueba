import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { DEMO_MODE, DB } from '@/services/supabase'
import * as IDB           from '@/services/offlineDB'
import { useAuth }        from '@/features/auth/AuthContext'

/* ── Demo store (sin cambios) ──────────────────────────────────────────────── */
let _demoOrders    = []
let _demoListeners = new Set()
let _demoId        = 100

function notifyDemo() { _demoListeners.forEach(cb => cb([..._demoOrders])) }

const DemoStore = {
  subscribe(cb) {
    _demoListeners.add(cb)
    cb([..._demoOrders])
    return () => _demoListeners.delete(cb)
  },
  add(order) {
    const id = `demo-order-${++_demoId}`
    _demoOrders.unshift({ id, ...order, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    notifyDemo()
    return id
  },
  update(id, data) {
    _demoOrders = _demoOrders.map(o => o.id === id ? { ...o, ...data, updated_at: new Date().toISOString() } : o)
    notifyDemo()
  },
  remove(id) {
    _demoOrders = _demoOrders.filter(o => o.id !== id)
    notifyDemo()
  },
  reset() { _demoOrders = []; notifyDemo() },
}

/* ── Context ───────────────────────────────────────────────────────────────── */
const OrdersCtx = createContext(null)

export function OrdersProvider({ children }) {
  const { user } = useAuth()
  const [orders,  setOrders]  = useState([])
  const [loading, setLoading] = useState(true)

  /* ── Carga inicial: Supabase → fallback a IndexedDB ─────────────────── */
  const loadOrders = useCallback(async () => {
    try {
      const data = await DB.getOrdersToday()
      setOrders(data)
      setLoading(false)
      // Cachear en IndexedDB para uso offline
      IDB.saveOrdersBulk(data).catch(() => {})
    } catch {
      // Supabase no disponible → cargar desde caché local
      try {
        const local = await IDB.getOrders()
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const todayOrders = local.filter(o => new Date(o.created_at) >= today && o.status !== 'anulado')
        setOrders(todayOrders)
      } catch (dbErr) {
        console.warn('[Orders] IndexedDB fallback falló:', dbErr?.message)
        setOrders([])
      }
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (DEMO_MODE) {
      const unsub = DemoStore.subscribe(data => { setOrders(data); setLoading(false) })
      return unsub
    }

    loadOrders()

    // Realtime Supabase — actualizaciones en tiempo real
    const unsub = DB.subscribeOrders(
      newOrder => {
        // Deduplicar: si ya existe (optimistic local), reemplazar con versión del servidor
        setOrders(prev => {
          const exists = prev.find(o => o.id === newOrder.id)
          if (exists) {
            // Actualizar preservando el orden original
            return prev.map(o => o.id === newOrder.id ? { ...newOrder, _pendingSync: false } : o)
          }
          return [newOrder, ...prev]
        })
        // Guardar versión confirmada del servidor en IDB
        IDB.saveOrder({ ...newOrder, _pendingSync: false }).catch(() => {})
      },
      updated => {
        setOrders(prev =>
          updated.status === 'archivado' || updated.status === 'anulado'
            ? prev.filter(o => o.id !== updated.id)
            : prev.map(o => o.id === updated.id ? { ...updated, _pendingSync: false } : o)
        )
        IDB.saveOrder({ ...updated, _pendingSync: false }).catch(() => {})
      },
      deleted => {
        setOrders(prev => prev.filter(o => o.id !== deleted.id))
        IDB.deleteOrder(deleted.id).catch(() => {})
      },
    )

    // Recarga cuando OfflineContext termina de sincronizar
    const syncHandler = () => loadOrders()
    window.addEventListener('pos:syncComplete', syncHandler)

    return () => {
      unsub()
      window.removeEventListener('pos:syncComplete', syncHandler)
    }
  }, [loadOrders])

  /* ── addOrder — Híbrido online/offline ──────────────────────────────── */
  const addOrder = useCallback(async (orderData) => {
    if (DEMO_MODE) return DemoStore.add(orderData)

    // Generar UUID en el cliente → mismo ID en local y Supabase
    const offlineId = crypto.randomUUID()
    const now       = new Date().toISOString()
    const fullOrder = {
      id:         offlineId,
      ...orderData,
      created_at: now,
      updated_at: now,
      _pendingSync: false,
    }

    // 1. Actualización optimista inmediata en el estado local
    setOrders(prev => [fullOrder, ...prev])

    // 2. Persistir en IndexedDB (funciona sin internet)
    IDB.saveOrder(fullOrder).catch(() => {})

    // 3. Intentar sincronizar con Supabase
    try {
      await DB.addOrder(fullOrder)  // fullOrder incluye id → Supabase usa nuestro UUID
      // Éxito: limpiar flag _pendingSync
      setOrders(prev => prev.map(o => o.id === offlineId ? { ...o, _pendingSync: false } : o))
      IDB.saveOrder({ ...fullOrder, _pendingSync: false }).catch(() => {})
    } catch {
      // Sin conexión o error de red → encolar para sincronizar después
      const pendingOrder = { ...fullOrder, _pendingSync: true }
      setOrders(prev => prev.map(o => o.id === offlineId ? pendingOrder : o))
      IDB.saveOrder(pendingOrder).catch(() => {})
      IDB.addToQueue({
        entity:   'orders',
        op:       'INSERT',
        entityId: offlineId,
        data:     fullOrder,  // sin _pendingSync para Supabase
      }).catch(() => {})
      // Notificar al OfflineContext que la cola cambió
      window.dispatchEvent(new CustomEvent('pos:queueChanged'))
    }

    return offlineId
  }, [])

  /* ── updateOrder — Híbrido online/offline ───────────────────────────── */
  const updateOrder = useCallback(async (id, data) => {
    if (DEMO_MODE) return DemoStore.update(id, data)

    const now = new Date().toISOString()
    const patch = { ...data, updated_at: now }

    // 1. Actualización optimista
    setOrders(prev => prev.map(o => o.id === id ? { ...o, ...patch } : o))

    // 2. Actualizar en IndexedDB
    IDB.getOrder(id)
      .then(local => local && IDB.saveOrder({ ...local, ...patch }))
      .catch(() => {})

    // 3. Intentar Supabase
    try {
      await DB.updateOrder(id, data)
    } catch {
      // Encolar el UPDATE
      IDB.addToQueue({
        entity:   'orders',
        op:       'UPDATE',
        entityId: id,
        data:     patch,
      }).catch(() => {})
      window.dispatchEvent(new CustomEvent('pos:queueChanged'))
    }
  }, [])

  /* ── deleteOrder ────────────────────────────────────────────────────── */
  const deleteOrder = useCallback(async (id) => {
    if (DEMO_MODE) return DemoStore.remove(id)

    setOrders(prev => prev.filter(o => o.id !== id))
    IDB.deleteOrder(id).catch(() => {})

    try {
      await DB.deleteOrder(id)
    } catch {
      IDB.addToQueue({ entity: 'orders', op: 'DELETE', entityId: id, data: { id } }).catch(() => {})
      window.dispatchEvent(new CustomEvent('pos:queueChanged'))
    }
  }, [])

  /* ── cancelOrder — Anular un pedido NO cobrado (solo admin) ──────────── */
  // Todo ocurre en la base de datos (función anular_pedido): verifica que no
  // esté cobrado, devuelve el stock descontado por sus rondas, lo marca como
  // 'anulado' y libera la mesa. Requiere conexión: no se encola offline, para
  // que nunca se anule "a ciegas" un pedido que quizá ya se cobró.
  const cancelOrder = useCallback(async (order, motivo = '') => {
    if (!order?.id) throw new Error('Pedido no válido')
    if (DEMO_MODE) { DemoStore.update(order.id, { status: 'anulado' }); return { returned_units: 0 } }
    const res = await DB.anularPedido(order.id, motivo)
    setOrders(prev => prev.filter(o => o.id !== order.id))
    IDB.getOrder(order.id)
      .then(local => local && IDB.saveOrder({ ...local, status: 'anulado' }))
      .catch(() => {})
    DB.logAudit({
      actorId: user?.uid, actorName: user?.name, action: 'order_cancel',
      entity: 'orders', entityId: order.id,
      detail: {
        mesa: order.table_number || null, zona: order.zone || null,
        total: order.total || 0, motivo: (motivo || '').trim() || null,
        stockDevuelto: res?.returned_units || 0,
      },
    })
    return res
  }, [user])

  /* ── resetOrders ────────────────────────────────────────────────────── */
  const resetOrders = useCallback(async () => {
    if (DEMO_MODE) { DemoStore.reset(); return }
    await DB.archiveOrders()
    setOrders([])
  }, [])

  /* ── resetLocalOrders ───────────────────────────────────────────────── */
  // Vacía el estado React de inmediato SIN llamar a Supabase.
  // Usado por CashierPanel tras el cierre de caja: el PANEL,
  // la sección PEDIDOS y los contadores de CAJA quedan en 0 / [].
  // NO hay redirección automática — el usuario mantiene control total de su sesión.
  const resetLocalOrders = useCallback(() => {
    if (DEMO_MODE) DemoStore.reset()
    setOrders([])
  }, [])

  // Derivados
  const pending    = orders.filter(o => o.status === 'pending')
  const inProgress = orders.filter(o => o.status === 'in_progress')
  const ready      = orders.filter(o => o.status === 'ready')
  const active     = orders.filter(o => !o.status?.startsWith('Pagado') && o.status !== 'paid' && o.status !== 'anulado')
  const todaySales = orders.filter(o => o.status?.startsWith('Pagado') || o.status === 'paid')
  const offlinePending = orders.filter(o => o._pendingSync).length

  return (
    <OrdersCtx.Provider value={{
      orders, loading, pending, inProgress, ready, active, todaySales,
      offlinePending,
      addOrder, updateOrder, deleteOrder, cancelOrder, resetOrders, resetLocalOrders,
    }}>
      {children}
    </OrdersCtx.Provider>
  )
}

export function useOrders() {
  const ctx = useContext(OrdersCtx)
  if (!ctx) throw new Error('useOrders must be used inside OrdersProvider')
  return ctx
}

export const STATUS_LABELS = {
  pending:             'Pendiente',
  in_progress:         'En Cocina',
  ready:               'Listo',
  served:              'Servido',
  paid:                'Pagado',
  'Pagado - Efectivo': 'Pagado · Efectivo',
  'Pagado - Yape':     'Pagado · Yape',
}

export const STATUS_NEXT = {
  pending:     'in_progress',
  in_progress: 'ready',
  ready:       'served',
  served:      'paid',
}

export const PAYMENT_METHODS = ['efectivo', 'yape']
