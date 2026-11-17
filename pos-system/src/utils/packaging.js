/* ══════════════════════════════════════════════════════════════════
   ENVASES DESCARTABLES PARA LLEVAR — cálculos compartidos
   (panel admin + app del mesero). migracion-envases.sql
   ══════════════════════════════════════════════════════════════════
   La app calcula para MOSTRAR y cobrar; la base de datos vuelve a
   calcular packaging_total y el total (trigger), así que un monto
   manipulado en el navegador no llega a guardarse.
   ══════════════════════════════════════════════════════════════════ */

export const PACKAGING_MAX = 99

// Cantidad válida: entero entre 0 y 99
export function clampPackaging(n) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v < 0) return 0
  return Math.min(PACKAGING_MAX, v)
}

// Precio por envase válido (0 – 50), redondeado a céntimos
export function cleanUnitPrice(p) {
  const v = Number(p)
  if (!Number.isFinite(v) || v < 0 || v > 50) return null
  return Math.round(v * 100) / 100
}

// Monto de envases en céntimos exactos (evita errores de coma flotante)
export function packagingTotal(count, unit) {
  const c = clampPackaging(count)
  const u = cleanUnitPrice(unit)
  if (!c || u === null) return 0
  return Math.round(c * Math.round(u * 100)) / 100
}

// Suma de platos (precio × cantidad), en céntimos exactos
export function itemsTotal(items) {
  const cents = (items || []).reduce((s, i) => {
    const price = Number(i?.price ?? i?.item?.price) || 0
    const qty   = Number(i?.qty ?? i?.quantity) || 0
    return s + Math.round(price * 100) * qty
  }, 0)
  return Math.round(cents) / 100
}

// Total general = platos + envases
export function grandTotal(items, count, unit) {
  return Math.round((itemsTotal(items) + packagingTotal(count, unit)) * 100) / 100
}

/* Lee la configuración (precio y si está activo). Recibe el cliente de
   Supabase de cada app. Devuelve null si la migración no se ejecutó o no
   hay conexión: en ese caso la opción de envases simplemente no aparece. */
export async function fetchPackagingConfig(client) {
  if (!client) return null
  try {
    const { data, error } = await client.from('envases_config').select('activo, precio').eq('id', 1).maybeSingle()
    if (error || !data) return null
    const unit = cleanUnitPrice(data.precio)
    if (unit === null) return null
    return { enabled: data.activo === true, unit }
  } catch (_) {
    return null
  }
}
