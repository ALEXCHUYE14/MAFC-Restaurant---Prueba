/* ══════════════════════════════════════════════════════════════════
   QR DE PEDIDO — formato compartido entre la carta (genera) y la app
   del mesero (escanea). Funciones puras, sin dependencias.
   ══════════════════════════════════════════════════════════════════
   El QR lleva SOLO "qué producto y cuántos". Nunca precios ni nombres:
   la app del mesero los toma de su propio catálogo vigente, así que un
   QR fabricado o viejo no puede cambiar un precio ni inventar un plato.

   Formato:  CPED1.<segundos en base36>.<id>*<cant>,<id>*<cant>,…
     id uuid  → "u" + 22 caracteres base64url (16 bytes) — más corto que
                los 36 del uuid, para que el QR sea menos denso y se lea
                fácil desde la pantalla del cliente.
     otro id  → "s" + id (solo [A-Za-z0-9_-], p. ej. ids numéricos)
   Ningún separador ('.', ',', '*') aparece dentro de un id codificado.

   Tamaño (Fuente P./M./G.): opcional, va pegado al id con "~":
     <id>~<tamaño>*<cant>   p. ej.  uAbC…~M*2
   El tamaño es solo su clave ([A-Za-z0-9], hasta 8): el PRECIO de ese
   tamaño lo pone la app del mesero desde su catálogo, nunca el QR.
   Los QR sin tamaño (formato anterior) se siguen leyendo igual.
══════════════════════════════════════════════════════════════════ */

export const ORDER_QR_PREFIX = 'CPED1'
export const ORDER_QR_MAX_LINES = 30   // productos distintos por código
export const ORDER_QR_MAX_QTY   = 50   // unidades por producto
const MAX_TEXT = 2000

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PLAIN_RE = /^[A-Za-z0-9_-]{1,40}$/
const B64U_RE  = /^[A-Za-z0-9_-]{22}$/
const VKEY_RE  = /^[A-Za-z0-9]{1,8}$/

function uuidToB64u(uuid) {
  const hex = uuid.replace(/-/g, '').toLowerCase()
  let bin = ''
  for (let i = 0; i < 32; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64uToUuid(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==')
  if (bin.length !== 16) return null
  let hex = ''
  for (let i = 0; i < 16; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function encodeId(id) {
  const s = String(id ?? '')
  if (UUID_RE.test(s)) return 'u' + uuidToB64u(s)
  if (PLAIN_RE.test(s)) return 's' + s
  return null // id con caracteres no soportados — se omite
}

function decodeId(token) {
  if (token.length < 2) return null
  const kind = token[0], body = token.slice(1)
  if (kind === 'u') return B64U_RE.test(body) ? b64uToUuid(body) : null
  if (kind === 's') return PLAIN_RE.test(body) ? body : null
  return null
}

/* lines: [{ id, qty, v? }] → texto del QR (v = clave del tamaño). Ignora líneas inválidas.
   Devuelve { text, included, omitted } — `omitted` > 0 si la lista
   superaba el máximo de productos distintos (la carta lo avisa). */
export function encodeOrderQr(lines, now = Date.now()) {
  const merged = new Map()
  for (const l of lines || []) {
    const idToken = encodeId(l?.id)
    const v = l?.v == null || l.v === '' ? null : String(l.v)
    if (v !== null && !VKEY_RE.test(v)) continue          // tamaño inválido → línea omitida
    const token = idToken ? (v ? `${idToken}~${v}` : idToken) : null
    const qty = Math.floor(Number(l?.qty))
    if (!token || !(qty > 0)) continue
    merged.set(token, Math.min(ORDER_QR_MAX_QTY, (merged.get(token) || 0) + qty))
  }
  const all = [...merged.entries()]
  const kept = all.slice(0, ORDER_QR_MAX_LINES)
  const ts = Math.max(0, Math.floor(now / 1000)).toString(36)
  return {
    text: `${ORDER_QR_PREFIX}.${ts}.${kept.map(([t, q]) => `${t}*${q}`).join(',')}`,
    included: kept.length,
    omitted: all.length - kept.length,
  }
}

/* Texto escaneado → { ok:true, createdAt, lines:[{id, qty, v}] }  (v = tamaño o null)
                    | { ok:false, reason }
   Estricto: cualquier cosa fuera de formato se rechaza entera (no se
   "rescatan" partes de un código dañado o ajeno). */
export function decodeOrderQr(text) {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > MAX_TEXT) return { ok: false, reason: 'invalid' }
  const parts = raw.split('.')
  if (parts.length !== 3 || parts[0] !== ORDER_QR_PREFIX) return { ok: false, reason: 'not-order' }
  if (!/^[0-9a-z]{1,10}$/.test(parts[1])) return { ok: false, reason: 'invalid' }
  const createdAt = parseInt(parts[1], 36) * 1000
  if (!parts[2]) return { ok: false, reason: 'empty' }

  const tokens = parts[2].split(',')
  if (tokens.length > ORDER_QR_MAX_LINES) return { ok: false, reason: 'invalid' }
  const merged = new Map()
  for (const tk of tokens) {
    const m = /^([A-Za-z0-9_-]{2,41})(?:~([A-Za-z0-9]{1,8}))?\*([1-9][0-9]{0,2})$/.exec(tk)
    if (!m) return { ok: false, reason: 'invalid' }
    const id = decodeId(m[1])
    const v = m[2] || null
    const qty = parseInt(m[3], 10)
    if (!id || qty > ORDER_QR_MAX_QTY) return { ok: false, reason: 'invalid' }
    const key = v ? `${id}~${v}` : id
    const prev = merged.get(key)
    merged.set(key, { id, v, qty: Math.min(ORDER_QR_MAX_QTY, (prev ? prev.qty : 0) + qty) })
  }
  return {
    ok: true,
    createdAt: isFinite(createdAt) ? createdAt : null,
    lines: [...merged.values()],
  }
}
