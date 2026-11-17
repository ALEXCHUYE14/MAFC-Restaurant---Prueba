/* ══════════════════════════════════════════════════════════════════
   TAMAÑOS DE UN PLATO (Fuente P. / Fuente M. / Fuente G. …)
   ══════════════════════════════════════════════════════════════════
   Módulo compartido por TODAS las apps (admin, mesero, carta), así los
   tamaños se interpretan igual en todas partes. Funciones puras.

   Un producto puede tener una lista opcional de tamaños, cada uno con su
   precio: [{ key:'P', label:'Fuente P.', price:15 }, …]. Sin lista → el
   producto funciona exactamente como siempre (un solo precio).

   Al venderse, cada tamaño es una LÍNEA propia del pedido:
     id       = id del producto (el mismo para todos los tamaños → el
                stock, su descuento, devolución y anulación no cambian)
     lineId   = "<id>::<key>" — identifica la línea en el carrito
     name     = "Ceviche Mixto (Fuente M.)" — así lo ven cocina, tickets
                y reportes sin ningún cambio
     price    = precio de ESE tamaño
   ══════════════════════════════════════════════════════════════════ */

export const MAX_VARIANTS = 6
export const DEFAULT_VARIANTS = [
  { key: 'P', label: 'Fuente P.' },
  { key: 'M', label: 'Fuente M.' },
  { key: 'G', label: 'Fuente G.' },
]

const KEY_RE = /^[A-Za-z0-9]{1,8}$/

// Limpia y valida lo que venga de la base de datos o de un formulario.
// Devuelve [] si no hay tamaños válidos (= producto de precio único).
export function normalizeVariants(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const key = String(v.key ?? '').trim()
    const label = String(v.label ?? '').trim().slice(0, 24)
    const price = Math.round(Number(v.price) * 100) / 100
    if (!KEY_RE.test(key) || seen.has(key) || !label) continue
    if (!isFinite(price) || price <= 0 || price > 100000) continue
    seen.add(key)
    out.push({ key, label, price })
    if (out.length >= MAX_VARIANTS) break
  }
  return out
}

export function hasVariants(item) {
  return Array.isArray(item?.variants) && item.variants.length > 0
}

// Precio más bajo (para "desde S/ …" y para el campo price del producto)
export function minVariantPrice(variants, fallback = 0) {
  const v = normalizeVariants(variants)
  return v.length ? Math.min(...v.map(x => x.price)) : fallback
}

export function lineIdOf(productId, variantKey) {
  return variantKey ? `${productId}::${variantKey}` : String(productId)
}

export function variantName(name, label) {
  return label ? `${name} (${label})` : name
}

export function findVariant(item, key) {
  if (!hasVariants(item) || !key) return null
  return item.variants.find(v => v.key === key) || null
}

// Producto + tamaño elegido → la línea que se agrega al carrito/pedido.
// Sin tamaño (producto de precio único) → el mismo producto con su lineId.
export function applyVariant(item, variant) {
  if (!item) return item
  if (!variant) return { ...item, lineId: lineIdOf(item.id), variantKey: null, variantLabel: null }
  return {
    ...item,
    lineId: lineIdOf(item.id, variant.key),
    variantKey: variant.key,
    variantLabel: variant.label,
    baseName: item.name,
    name: variantName(item.name, variant.label),
    price: variant.price,
  }
}

// Identificador de una línea ya creada (compatible con líneas antiguas sin lineId)
export function lineIdFromLine(line) {
  if (!line) return ''
  return line.lineId || lineIdOf(line.id, line.variantKey || null)
}
