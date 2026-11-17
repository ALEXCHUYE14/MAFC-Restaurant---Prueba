/* ══════════════════════════════════════════════════════════════════
   CRM — utilidades compartidas (panel admin + app del mesero)
   migracion-clientes-crm.sql
   ══════════════════════════════════════════════════════════════════ */

// Celular peruano (9 dígitos, empieza con 9) o DNI (8 dígitos).
// Acepta espacios, guiones y el prefijo +51. Devuelve null si no es válido.
export function normalizeDoc(input) {
  let d = String(input ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('51')) d = d.slice(2)
  if (/^9\d{8}$/.test(d)) return { tipo: 'celular', valor: d }
  if (/^\d{8}$/.test(d)) return { tipo: 'dni', valor: d }
  return null
}

// Muestra un documento parcialmente oculto (protege datos en pantalla)
export function maskDoc(valor) {
  const v = String(valor || '')
  if (v.length < 6) return v
  return v.slice(0, 3) + '•'.repeat(v.length - 5) + v.slice(-2)
}

// Rellena {nombre}, {negocio}, {premio}, {dias} — sin HTML, solo texto
export function fillTemplate(tpl, vars = {}) {
  return String(tpl || '').replace(/\{(nombre|negocio|premio|dias)\}/g, (_, k) => String(vars[k] ?? '').trim())
    .slice(0, 1000)
}

// Enlace de WhatsApp (wa.me) a un celular peruano con el mensaje.
// null si el celular no es válido.
export function whatsappLink(celular, text) {
  const d = normalizeDoc(celular)
  if (!d || d.tipo !== 'celular') return null
  return `https://wa.me/51${d.valor}?text=${encodeURIComponent(String(text || ''))}`
}

// Primer nombre para saludar
export function firstName(nombre) {
  return String(nombre || '').trim().split(/\s+/)[0] || ''
}

// Días entre una fecha y hoy (null si no hay fecha)
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / 86400000))
}

// Día y mes de hoy en Lima
export function limaDayMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', month: 'numeric', day: 'numeric' }).formatToParts(now)
  return {
    dia: Number(parts.find(p => p.type === 'day')?.value),
    mes: Number(parts.find(p => p.type === 'month')?.value),
  }
}

// Días que faltan para el cumpleaños (0 = hoy). null si no hay fecha.
export function daysToBirthday(dia, mes, now = new Date()) {
  if (!dia || !mes) return null
  const m = Number(mes), d = Number(dia)
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null
  const hoy  = limaDayMonth(now)
  const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(now))
  const base = Date.UTC(year, hoy.mes - 1, hoy.dia)
  // 29/02 u otro día que no existe ese año → último día del mes
  const at = y => Date.UTC(y, m - 1, Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate()))
  let next = at(year)
  if (next < base) next = at(year + 1)
  return Math.round((next - base) / 86400000)
}

// Mensaje claro para los errores de las funciones del CRM
export function crmErrorMessage(error) {
  const m = String(error?.message || error || '')
  if (/DOC_INVALIDO/.test(m))        return 'Escribe un celular (9 dígitos, empieza con 9) o un DNI (8 dígitos).'
  if (/NOMBRE_INVALIDO/.test(m))     return 'El nombre es demasiado largo.'
  if (/CUMPLE_INVALIDO/.test(m))     return 'Fecha de cumpleaños no válida.'
  if (/RATE_LIMIT/.test(m))          return 'Demasiadas consultas seguidas. Espera un minuto.'
  if (/SIN_PREMIO/.test(m))          return 'Este cliente ya no tiene un premio disponible.'
  if (/YA_CANJEADO/.test(m))         return 'Este pedido ya tiene un premio canjeado.'
  if (/ORDER_CLOSED/.test(m))        return 'El pedido ya fue cobrado o cerrado.'
  if (/ORDER_REQUIRED/.test(m))      return 'Primero envía el pedido a cocina; luego canjea el premio.'
  if (/ORDER_OTRO_CLIENTE/.test(m))  return 'Este pedido ya está ligado a otro cliente.'
  if (/CLIENTE_NO_EXISTE/.test(m))   return 'El cliente ya no existe.'
  if (/UNION_INVALIDA/.test(m))      return 'Elige otra ficha distinta para unir.'
  if (/CELULARES_DISTINTOS/.test(m)) return 'Las dos fichas tienen celulares distintos: no parecen la misma persona.'
  if (/DNI_DISTINTOS/.test(m))       return 'Las dos fichas tienen DNI distintos: no parecen la misma persona.'
  if (/CUPON_VENCIDO/.test(m))       return 'El cupón está vencido.'
  if (/CUPON_AGOTADO/.test(m))       return 'El cupón ya alcanzó su límite de usos.'
  if (/CUPON_OTRO_CLIENTE/.test(m))  return 'Este cupón es personal de otro cliente (liga primero al cliente correcto).'
  if (/CUPON_YA_APLICADO/.test(m))   return 'Ese cupón ya está aplicado a este pedido.'
  { const mm = /CUPON_MINIMO:([\d.]+)/.exec(m); if (mm) return `El cupón requiere un consumo mínimo de S/ ${Number(mm[1]).toFixed(2)} en platos.` }
  if (/CUPON_INVALIDO/.test(m))      return 'Cupón no válido o inactivo.'
  if (/MOTIVO_REQUERIDO/.test(m))    return 'Escribe el motivo del descuento.'
  if (/DESCUENTO_INVALIDO/.test(m))  return 'Descuento no válido.'
  if (/ENCUESTA|PUNTAJE_INVALIDO/.test(m)) return 'La encuesta no está disponible.'
  if (/ORDER_NOT_FOUND/.test(m))     return 'El pedido ya no existe.'
  if (/NOT_ALLOWED|row-level/i.test(m)) return 'No tienes permiso para esta acción.'
  if (/duplicate key|unique/i.test(m)) return 'Ya existe un cliente con ese celular o DNI.'
  if (/crm_|clientes|PGRST202|PGRST205|does not exist|could not find/i.test(m)) return 'Falta activar el CRM (migracion-clientes-crm.sql).'
  return 'No se pudo completar (revisa la conexión).'
}

// Descuento sobre los platos — MISMA fórmula que la base de datos
// (migracion-descuentos-cupones.sql): % redondeado a céntimos o monto fijo,
// nunca mayor que los platos. Cálculo en céntimos enteros.
export function discountAmount(itemsTotalSoles, pct = 0, fijo = 0) {
  const food = Math.max(0, Math.round((Number(itemsTotalSoles) || 0) * 100))
  const p = Number(pct) || 0, f = Number(fijo) || 0
  let d = 0
  if (p > 0) d = Math.round(food * Math.min(p, 100) / 100)
  else if (f > 0) d = Math.round(f * 100)
  return Math.min(Math.max(d, 0), food) / 100
}

// CSV para Excel: separador ";" (Excel en español), BOM UTF-8 y celdas
// protegidas contra "inyección de fórmulas" (=, +, -, @ al inicio).
export function toCsv(headers, rows) {
  const cell = v => {
    let s = v === null || v === undefined ? '' : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return '﻿' + [headers, ...rows].map(r => r.map(cell).join(';')).join('\r\n')
}

// true si el error indica que la migración del CRM no se ejecutó
export function isCrmMissing(error) {
  const code = error?.code
  const m = String(error?.message || '')
  return code === 'PGRST202' || code === '42883' || code === 'PGRST205' || code === '42P01'
    || /could not find the (function|table)|relation .* does not exist/i.test(m)
}
