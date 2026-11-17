import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { DEMO_MODE, DB } from '@/services/supabase'
import * as IDB           from '@/services/offlineDB'
import { defaultZoneOf }  from '@/data/zones'

// ─── 30 mesas base en 3 zonas — el mínimo que el sistema siempre muestra ──────
// Las mesas agregadas desde Ajustes (número > 30) llegan de la tabla `mesas`
// (ver mergeTables): esta lista es solo el punto de partida y el respaldo.
export const DEFAULT_TABLES = Array.from({ length: 30 }, (_, i) => ({
  id:             `table-${i + 1}`,
  number:         i + 1,
  zone:           defaultZoneOf(i + 1),
  capacity:       i < 4 ? 2 : i < 12 ? 4 : 6,
  status:         'available',
  currentOrderId: null,
  waiterId:       null,
  waiterName:     null,
  openedAt:       null,
}))

const ESTADO_MAP = { libre: 'available', ocupada: 'occupied', pendiente: 'cleaning' }

// ─── Demo store ────────────────────────────────────────────────────────────────
let _demoTables    = DEFAULT_TABLES.map(t => ({ ...t }))
let _demoListeners = new Set()
function notifyTables() { _demoListeners.forEach(cb => cb([..._demoTables])) }

const DemoTableStore = {
  subscribe(cb) {
    _demoListeners.add(cb)
    cb([..._demoTables])
    return () => _demoListeners.delete(cb)
  },
  updateByNumber(number, data) {
    _demoTables = _demoTables.map(t => t.number === number ? { ...t, ...data } : t)
    notifyTables()
  },
}

// ─── Mesas base + mesas de la base de datos ───────────────────────────────────
// Une las 30 base con cualquier mesa que exista en `mesas` (las agregadas desde
// Ajustes). `prev` (opcional) conserva los campos locales de cada mesa
// (waiterId, openedAt…) al refrescar; el estado y la zona vienen de la base.
// Una mesa que ya no existe en la base y no es una de las 30 base se descarta.
function mergeTables(data, prev = []) {
  const prevBy = new Map(prev.map(t => [t.number, t]))
  const dataBy = new Map(data.map(d => [d.number, d]))
  const numbers = [...new Set([...DEFAULT_TABLES.map(t => t.number), ...data.map(d => d.number)])]
    .sort((a, b) => a - b)
  return numbers.map(n => {
    const def = DEFAULT_TABLES.find(t => t.number === n) || {
      id: `table-${n}`, number: n, zone: defaultZoneOf(n), capacity: 6, status: 'available',
      currentOrderId: null, waiterId: null, waiterName: null, openedAt: null,
    }
    const base = prevBy.get(n) || def
    const m = dataBy.get(n)
    return m
      ? { ...base, zone: m.zone || base.zone, status: m.status, waiterName: m.waiterName || null, waiterColor: m.waiterColor || null }
      : base
  })
}

// ─── Mesas base que NO existen como fila en la tabla `mesas` ────────────────────
// El esquema base solo siembra las mesas 1-15; las 30 existían en el código. Sin
// fila en `mesas`, un mesero que abre la mesa 20 no puede compartir su ocupación
// con los demás (el UPDATE no encuentra fila). Ajustes ofrece crear las que faltan.
export function missingBaseTables(data) {
  const have = new Set(data.map(d => d.number))
  return DEFAULT_TABLES.map(t => t.number).filter(n => !have.has(n))
}

// ─── Extrae el número de mesa desde un id ("table-5" → 5) o número directo ───
function toNumber(idOrNumber) {
  if (typeof idOrNumber === 'number') return idOrNumber
  if (typeof idOrNumber === 'string') return parseInt(idOrNumber.replace('table-', ''), 10)
  return NaN
}

// ─── Context ───────────────────────────────────────────────────────────────────
const TablesCtx = createContext(null)

export function TablesProvider({ children }) {
  const [tables,  setTables]  = useState(DEFAULT_TABLES)
  const [loading, setLoading] = useState(true)
  // números de las 30 base que faltan en la base de datos (ver missingBaseTables).
  // Solo se calcula cuando la lectura devolvió filas: una lectura vacía por error
  // de red no debe hacer creer que faltan las 30.
  const [missingBase, setMissingBase] = useState([])

  // Refresca la lista desde la base — se usa cuando se AGREGA o QUITA una mesa
  // (eventos INSERT/DELETE de Realtime) y al terminar una alta desde Ajustes.
  const reload = useCallback(() => {
    if (DEMO_MODE) return Promise.resolve()
    return DB.getMesas()
      .then(data => {
        if (!data.length) return
        setMissingBase(missingBaseTables(data))
        setTables(prev => {
          const merged = mergeTables(data, prev)
          IDB.saveTablesBulk(merged).catch(() => {})
          return merged
        })
      })
      .catch(() => { /* sin conexión: se queda con lo que ya hay */ })
  }, [])

  /* ── Carga inicial ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (DEMO_MODE) {
      const unsub = DemoTableStore.subscribe(data => { setTables(data); setLoading(false) })
      return unsub
    }

    DB.getMesas()
      .then(data => {
        const merged = data.length ? mergeTables(data) : DEFAULT_TABLES
        if (data.length) setMissingBase(missingBaseTables(data))
        setTables(merged)
        IDB.saveTablesBulk(merged).catch(() => {})
        setLoading(false)
      })
      .catch(async () => {
        // Sin conexión → cargar desde IDB
        try {
          const local = await IDB.getTables()
          if (local?.length) {
            const baseIds = new Set(DEFAULT_TABLES.map(d => d.id))
            setTables([
              ...DEFAULT_TABLES.map(def => {
                const l = local.find(t => t.id === def.id)
                return l ? { ...def, ...l } : def
              }),
              // mesas agregadas desde Ajustes que quedaron guardadas en este dispositivo
              ...local.filter(l => !baseIds.has(l.id)),
            ])
          }
        } catch { /* IDB no disponible */ }
        setLoading(false)
      })

    // Realtime — cambios en mesas
    const unsub = DB.subscribeMesas(payload => {
      // Mesa agregada o quitada (desde Ajustes, en este u otro dispositivo)
      if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') { reload(); return }
      if (!payload.new) return
      const { numero_mesa, estado, mesero_nombre, mesero_color, zona } = payload.new
      const status  = ESTADO_MAP[estado] || 'available'
      const isLibre = estado === 'libre'

      setTables(prev => {
        const updated = prev.map(t => {
          if (t.number !== numero_mesa) return t
          const newT = {
            ...t,
            status,
            zone:           (zona || '').trim() || t.zone,
            waiterName:     isLibre ? null : (mesero_nombre ?? t.waiterName),
            waiterId:       isLibre ? null : t.waiterId,
            currentOrderId: isLibre ? null : t.currentOrderId,
            openedAt:       isLibre ? null : t.openedAt,
          }
          IDB.saveTable(newT).catch(() => {})
          return newT
        })
        return updated
      })
    })

    return unsub
  }, [reload])

  /* ── occupyTable ── Híbrido online/offline ─────────────────────────── */
  const occupyTable = useCallback(async (tableIdOrNumber, { waiterId, waiterName } = {}) => {
    if (DEMO_MODE) {
      const n = toNumber(tableIdOrNumber)
      DemoTableStore.updateByNumber(n, { status: 'occupied', waiterId, waiterName })
      return
    }

    const number = toNumber(tableIdOrNumber)
    if (isNaN(number)) {
      console.warn('[Tables] occupyTable: id inválido:', tableIdOrNumber)
      return
    }

    // Actualización optimista
    setTables(prev => prev.map(t => {
      if (t.number !== number) return t
      const newT = { ...t, status: 'occupied', waiterId, waiterName }
      IDB.saveTable(newT).catch(() => {})
      return newT
    }))

    // Intentar Supabase
    try {
      await DB.updateMesaEstado(number, 'ocupada', { mesero_nombre: waiterName || null })
    } catch {
      IDB.addToQueue({
        entity:   'mesas',
        op:       'UPDATE',
        entityId: `table-${number}`,
        data:     { numero_mesa: number, estado: 'ocupada', extra: { mesero_nombre: waiterName || null } },
      }).catch(() => {})
      window.dispatchEvent(new CustomEvent('pos:queueChanged'))
    }
  }, [])

  /* ── freeTable ── Híbrido online/offline ───────────────────────────── */
  const freeTable = useCallback(async (tableIdOrNumber) => {
    if (DEMO_MODE) {
      const n = toNumber(tableIdOrNumber)
      DemoTableStore.updateByNumber(n, { status: 'available', waiterId: null, waiterName: null, openedAt: null, currentOrderId: null })
      return
    }

    const number = toNumber(tableIdOrNumber)
    if (isNaN(number)) return

    setTables(prev => prev.map(t => {
      if (t.number !== number) return t
      const newT = { ...t, status: 'available', waiterId: null, waiterName: null, openedAt: null, currentOrderId: null }
      IDB.saveTable(newT).catch(() => {})
      return newT
    }))

    try {
      await DB.updateMesaEstado(number, 'libre', { mesero_nombre: null, mesero_color: null })
    } catch {
      IDB.addToQueue({
        entity:   'mesas',
        op:       'UPDATE',
        entityId: `table-${number}`,
        data:     { numero_mesa: number, estado: 'libre', extra: { mesero_nombre: null, mesero_color: null } },
      }).catch(() => {})
      window.dispatchEvent(new CustomEvent('pos:queueChanged'))
    }
  }, [])

  // Compatibilidad con código que usa el id string
  const updateTable = useCallback(async (id, data) => {
    const number = toNumber(id)
    if (DEMO_MODE) { DemoTableStore.updateByNumber(number, data); return }
    setTables(prev => prev.map(t => {
      if (t.id !== id) return t
      const newT = { ...t, ...data }
      IDB.saveTable(newT).catch(() => {})
      return newT
    }))
  }, [])

  const available = tables.filter(t => t.status === 'available')
  const occupied  = tables.filter(t => t.status === 'occupied')
  const reserved  = tables.filter(t => t.status === 'reserved')
  const cleaning  = tables.filter(t => t.status === 'cleaning')

  return (
    <TablesCtx.Provider value={{
      tables, loading, missingBase,
      available, occupied, reserved, cleaning,
      updateTable, occupyTable, freeTable, reload,
    }}>
      {children}
    </TablesCtx.Provider>
  )
}

export function useTables() {
  const ctx = useContext(TablesCtx)
  if (!ctx) throw new Error('useTables must be used inside TablesProvider')
  return ctx
}

// ─── Colores de estado — Light Mode Enterprise ───────────────────────────────
export const TABLE_STATUS_COLORS = {
  available: { bg: 'rgba(22,163,74,.08)',  border: 'rgba(22,163,74,.25)',  text: '#16A34A', icon: '✓' },
  occupied:  { bg: 'rgba(220,38,38,.08)', border: 'rgba(220,38,38,.25)',  text: '#DC2626', icon: '●' },
  reserved:  { bg: 'rgba(37,99,235,.08)', border: 'rgba(37,99,235,.25)',  text: '#2563EB', icon: '◎' },
  cleaning:  { bg: 'rgba(217,119,6,.08)', border: 'rgba(217,119,6,.25)',  text: '#D97706', icon: '○' },
}
