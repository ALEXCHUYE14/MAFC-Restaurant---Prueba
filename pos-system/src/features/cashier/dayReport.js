/* ══════════════════════════════════════════════════════════════════
   REPORTE DEL DÍA (varios turnos) — cálculos puros, sin React ni red.
   ══════════════════════════════════════════════════════════════════
   · El "día" es el día calendario de Lima (America/Lima, UTC−5 todo el
     año: Perú no usa horario de verano). No depende de la zona horaria del
     navegador.
   · Todos los montos se suman en CÉNTIMOS enteros (sin errores de coma
     flotante) y se devuelven en soles con 2 decimales.
   · Un pedido pertenece al turno cuyo cierre lo incluye (cierres_caja.
     order_ids). Los cobrados sin cierre → "Turno en curso / sin cierre".
   ══════════════════════════════════════════════════════════════════ */

const LIMA_OFFSET = '-05:00'
const DAY_MS = 24 * 60 * 60 * 1000

// 'YYYY-MM-DD' de hoy en Lima
export function todayLima(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// Rango [inicio, fin) del día de Lima, como fechas UTC. null si la fecha no es válida.
export function limaDayRange(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  const start = new Date(`${dateStr}T00:00:00${LIMA_OFFSET}`)
  if (Number.isNaN(start.getTime())) return null
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

// Hora local de Lima (HH:MM) de una fecha ISO
export function limaTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', hour12: false })
}

const cents = v => Math.round((Number(v) || 0) * 100)
const soles = c => Math.round(c) / 100

// Céntimos por método de un pedido (un pago mixto se reparte por tramo)
export function orderMethodCents(o) {
  const out = {}
  const bd = Array.isArray(o?.payment_breakdown) ? o.payment_breakdown : null
  if (bd && bd.length) {
    for (const leg of bd) {
      const m = String(leg?.metodo || 'efectivo')
      out[m] = (out[m] || 0) + cents(leg?.monto)
    }
  } else {
    const m = String(o?.payment_method || 'efectivo') || 'efectivo'
    out[m] = (out[m] || 0) + cents(o?.total)
  }
  return out
}

function emptyAcc() {
  return { count: 0, total: 0, byMethod: {}, envasesCount: 0, envasesTotal: 0, descuentos: 0, descuentosCount: 0 }
}
function addOrder(acc, o) {
  acc.count += 1
  acc.total += cents(o?.total)
  const m = orderMethodCents(o)
  for (const k of Object.keys(m)) acc.byMethod[k] = (acc.byMethod[k] || 0) + m[k]
  acc.envasesCount += Math.max(0, Math.floor(Number(o?.packaging_count) || 0))
  acc.envasesTotal += cents(o?.packaging_total)
  const d = cents(o?.descuento_monto)
  if (d > 0) { acc.descuentos += d; acc.descuentosCount += 1 }
}
const methodsToSoles = bm => Object.fromEntries(Object.entries(bm).map(([k, v]) => [k, soles(v)]))

/**
 * orders:   pedidos cobrados en el día (paid_at dentro del día, sin anulados)
 * cierres:  filas de cierres_caja con closed_at en el día
 * egresos:  egresos con fecha en el día
 * anuladosAbiertos: pedidos 'anulado' aún no archivados, del día
 */
export function buildDayReport({ orders = [], cierres = [], egresos = [], anuladosAbiertos = [] } = {}) {
  const sortedCierres = [...(cierres || [])].sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at))
  const owner = new Map()
  sortedCierres.forEach((c, i) => {
    for (const id of (Array.isArray(c.order_ids) ? c.order_ids : [])) if (!owner.has(id)) owner.set(id, i)
  })

  const day = emptyAcc()
  const perShift = sortedCierres.map(() => emptyAcc())
  const open = emptyAcc()
  for (const o of orders || []) {
    if (!o || o.status === 'anulado') continue
    addOrder(day, o)
    const idx = owner.get(o.id)
    addOrder(idx === undefined ? open : perShift[idx], o)
  }

  const shifts = sortedCierres.map((c, i) => {
    const acc = perShift[i]
    return {
      id:            c.id,
      label:         `Turno ${i + 1}`,
      openedAt:      c.opened_at || null,
      closedAt:      c.closed_at || null,
      horario:       `${limaTime(c.opened_at)} – ${limaTime(c.closed_at)}`,
      abrio:         c.opened_by || '—',
      cerro:         c.closed_by || '—',
      count:         acc.count,
      total:         soles(acc.total),
      byMethod:      methodsToSoles(acc.byMethod),
      efectivo:      soles(acc.byMethod.efectivo || 0),
      envasesCount:  acc.envasesCount,
      envasesTotal:  soles(acc.envasesTotal),
      fondo:         soles(cents(c.fondo_inicial)),
      egresos:       soles(cents(c.total_egresos)),
      esperado:      soles(cents(c.efectivo_esperado)),
      contado:       soles(cents(c.efectivo_contado)),
      diferencia:    soles(cents(c.diferencia)),
      // Ventas que el cierre registró (puede incluir cobros de días anteriores)
      totalCierre:   soles(cents(c.total_ventas)),
      pedidosCierre: Number(c.pedidos_count) || 0,
    }
  })
  if (open.count > 0) {
    shifts.push({
      id: 'open', label: 'Turno en curso / sin cierre registrado', openedAt: null, closedAt: null,
      horario: '—', abrio: '—', cerro: '—',
      count: open.count, total: soles(open.total), byMethod: methodsToSoles(open.byMethod),
      efectivo: soles(open.byMethod.efectivo || 0), envasesCount: open.envasesCount, envasesTotal: soles(open.envasesTotal),
      fondo: null, egresos: null, esperado: null, contado: null, diferencia: null, totalCierre: null, pedidosCierre: null,
    })
  }

  const egresosCents = (egresos || []).reduce((s, e) => s + cents(e?.monto), 0)
  const difCents     = sortedCierres.reduce((s, c) => s + cents(c.diferencia), 0)
  const anuladosCount = sortedCierres.reduce((s, c) => s + (Number(c.anulados_count) || 0), 0) + (anuladosAbiertos || []).length
  const anuladosCents = sortedCierres.reduce((s, c) => s + cents(c.anulados_total), 0)
    + (anuladosAbiertos || []).reduce((s, o) => s + cents(o?.total), 0)

  return {
    consolidated: {
      total:         soles(day.total),
      count:         day.count,
      avg:           day.count ? soles(Math.round(day.total / day.count)) : 0,
      byMethod:      methodsToSoles(day.byMethod),
      envasesCount:  day.envasesCount,
      envasesTotal:  soles(day.envasesTotal),
      descuentos:    soles(day.descuentos),
      descuentosCount: day.descuentosCount,
      egresos:       soles(egresosCents),
      neto:          soles(day.total - egresosCents),
      diferencias:   soles(difCents),
      anuladosCount,
      anuladosTotal: soles(anuladosCents),
      cierresCount:  sortedCierres.length,
    },
    shifts,
  }
}
