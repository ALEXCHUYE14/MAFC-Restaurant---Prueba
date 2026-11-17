import { supabase, DB } from './supabase'

/* ══════════════════════════════════════════════════════════════════
   RESPALDO DE STOCK — exportar / importar productos + imágenes (.zip)
   ══════════════════════════════════════════════════════════════════
   Contenido del .zip:
     stock.json   → { format, version, exportedAt, business, count, items[] }
                    cada item con la MISMA estructura de `menu_items`
                    (id, name, cat, price, description, available, stock…)
     imagenes/    → una foto por producto: imagenes/<id>.<jpg|png|webp>
     LEEME.txt    → explicación para quien abra el archivo

   Reglas de seguridad del import (para no romper nada del sistema):
     · SE CONSERVA EL id DE CADA PRODUCTO. Las mesas abiertas del mesero,
       los QR de la carta y el descuento de stock reconocen al producto
       por su id: el import actualiza el existente o lo recrea con el
       MISMO id (upsert), nunca crea un duplicado con id nuevo.
     · NUNCA BORRA. Lo que no está en el respaldo queda intacto.
     · Opción A por defecto: conserva stock y disponibilidad ACTUALES
       (un respaldo viejo no pisa las cantidades de hoy). Los productos
       que no existen hoy sí toman stock/disponibilidad del respaldo.
     · Todo el archivo se valida ANTES de escribir nada (formato, tipos,
       tamaños, imágenes reales por su firma binaria — no se acepta SVG).
       Si algo está mal, no se aplica nada.
     · Primero se suben las imágenes (no cambia ningún producto) y luego
       los productos en lotes. Repetir un import es seguro: es idempotente.
     · Solo un admin con sesión puede escribir (lo garantizan las políticas
       RLS de menu_items y del bucket menu-images).
   La librería de zip se carga solo al usar estos botones.
══════════════════════════════════════════════════════════════════ */

export const BACKUP_FORMAT  = 'restaurante-pos-stock'
export const BACKUP_VERSION = 1
const BUCKET = 'menu-images'

const LIMITS = {
  zipBytes:   150 * 1024 * 1024, // archivo .zip subido
  jsonBytes:   10 * 1024 * 1024, // stock.json descomprimido
  imageBytes:   8 * 1024 * 1024, // cada imagen descomprimida
  totalImages: 300 * 1024 * 1024,
  items:       3000,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

async function loadJSZip() {
  const mod = await import('jszip')
  return mod.default || mod
}

function requireSupabase() {
  if (!supabase) throw new Error('Sin conexión con la base de datos. Revisa tu internet e inténtalo de nuevo.')
  return supabase
}

// Tipo real de la imagen por su firma binaria (no se confía en la extensión)
function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return null
}

function dataUriToBytes(uri) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri)
  if (!m) throw new Error('data-URI inválido')
  if (m[2]) {
    const bin = atob(m[3])
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  return new TextEncoder().encode(decodeURIComponent(m[3]))
}

async function fetchImageBytes(url) {
  const u = String(url || '').trim()
  if (!u) return null
  if (/^data:image\//i.test(u)) return dataUriToBytes(u)
  if (!/^https?:\/\//i.test(u)) return null
  const res = await fetch(u, { mode: 'cors', credentials: 'omit' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

// Ejecuta `fn` sobre `list` con concurrencia limitada (no satura la red del celular)
async function pool(list, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (i < list.length) { const idx = i++; await fn(list[idx], idx) }
  })
  await Promise.all(workers)
}

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/* ── EXPORTAR ─────────────────────────────────────────────────────── */
export async function exportStockBackup({ businessName = '', actor = null, onProgress = () => {} } = {}) {
  const sb = requireSupabase()
  onProgress({ step: 'Leyendo productos…', done: 0, total: 0 })
  const { data, error } = await sb.from('menu_items')
    .select('id, name, cat, price, description, available, stock, img_url, created_at')
    .order('created_at', { ascending: true })
  if (error) throw new Error('No se pudieron leer los productos: ' + error.message)
  const rows = data || []

  const JSZip = await loadJSZip()
  const zip = new JSZip()
  const items = new Array(rows.length)
  const missing = []
  let images = 0, done = 0

  await pool(rows, 4, async (r, idx) => {
    let image = null
    if (r.img_url) {
      try {
        const bytes = await fetchImageBytes(r.img_url)
        const type = sniffImageType(bytes)
        if (!type) throw new Error('formato no soportado')
        image = `imagenes/${r.id}.${EXT_BY_TYPE[type]}`
        zip.file(image, bytes, { binary: true, compression: 'STORE' }) // ya vienen comprimidas
        images++
      } catch (e) {
        missing.push(r.name)
      }
    }
    items[idx] = {
      id:          r.id,
      name:        r.name,
      cat:         r.cat,
      price:       Number(r.price) || 0,
      description: r.description || null,
      available:   r.available !== false,
      stock:       r.stock ?? null,
      created_at:  r.created_at || null,
      image,                                                      // archivo dentro del zip (o null)
      img_url:     /^https?:\/\//i.test(r.img_url || '') ? r.img_url : null, // URL original (referencia)
    }
    done++
    onProgress({ step: 'Descargando imágenes…', done, total: rows.length })
  })

  const exportedAt = new Date().toISOString()
  zip.file('stock.json', JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt,
    business: businessName || null, count: items.length, items,
  }, null, 2))
  zip.file('LEEME.txt', [
    'RESPALDO DE STOCK — Restaurante POS',
    `Generado: ${new Date(exportedAt).toLocaleString('es-PE')}`,
    `Productos: ${items.length} · Imágenes: ${images}`,
    '',
    'Para restaurar: Panel admin → Stock → "Importar respaldo" y elige este .zip.',
    'No modifiques ni renombres los archivos: el sistema valida su estructura.',
  ].join('\r\n'))

  onProgress({ step: 'Comprimiendo…', done: rows.length, total: rows.length })
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  downloadBlob(blob, `respaldo-stock_${stamp()}.zip`)

  DB.logAudit({
    actorId: actor?.uid, actorName: actor?.name, action: 'stock_export', entity: 'menu_items',
    detail: { productos: items.length, imagenes: images, sin_imagen: missing.length },
  })
  return { count: items.length, images, missing, bytes: blob.size }
}

/* ── IMPORTAR: 1) leer y validar el .zip (no escribe nada) ─────────── */
function fail(msg) { throw new Error(msg) }

function validateItem(raw, i) {
  const where = `Producto #${i + 1}`
  if (!raw || typeof raw !== 'object') fail(`${where}: formato inválido.`)
  const id = String(raw.id || '')
  if (!UUID_RE.test(id)) fail(`${where}: identificador inválido.`)
  const name = String(raw.name ?? '').trim()
  if (!name || name.length > 120) fail(`${where}: el nombre está vacío o es demasiado largo.`)
  const cat = String(raw.cat ?? '').trim()
  if (!cat || cat.length > 60) fail(`${where} (${name}): la categoría está vacía o es demasiado larga.`)
  const price = Number(raw.price)
  if (!isFinite(price) || price < 0 || price > 100000) fail(`${where} (${name}): precio inválido.`)
  const description = raw.description == null ? null : String(raw.description).trim().slice(0, 1000) || null
  if (raw.available != null && typeof raw.available !== 'boolean') fail(`${where} (${name}): "available" debe ser verdadero o falso.`)
  let stock = raw.stock
  if (stock === undefined || stock === null || stock === '') stock = null
  else {
    stock = Number(stock)
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) fail(`${where} (${name}): stock inválido.`)
  }
  const image = raw.image == null ? null : String(raw.image)
  if (image !== null && !/^imagenes\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/i.test(image)) fail(`${where} (${name}): ruta de imagen inválida.`)
  const imgUrl = typeof raw.img_url === 'string' && /^https?:\/\//i.test(raw.img_url) && raw.img_url.length < 2000 ? raw.img_url : null
  return {
    id: id.toLowerCase(), name, cat, price: Math.round(price * 100) / 100, description,
    available: raw.available !== false, stock, image, imgUrl,
  }
}

export async function readStockBackup(file, { onProgress = () => {} } = {}) {
  if (!file) fail('No se seleccionó ningún archivo.')
  if (!/\.zip$/i.test(file.name || '')) fail('El archivo debe ser un respaldo .zip exportado desde Stock.')
  if (file.size > LIMITS.zipBytes) fail('El archivo es demasiado grande (máx. 150 MB).')

  onProgress({ step: 'Abriendo archivo…' })
  const JSZip = await loadJSZip()
  let zip
  // Se lee a memoria primero (ArrayBuffer): funciona igual en todos los navegadores
  let buf
  try { buf = await file.arrayBuffer() }
  catch { fail('No se pudo leer el archivo. Inténtalo de nuevo.') }
  try { zip = await JSZip.loadAsync(buf) }
  catch { fail('El archivo no es un .zip válido o está dañado.') }

  const jsonFile = zip.file('stock.json')
  if (!jsonFile) fail('El .zip no contiene "stock.json". ¿Es un respaldo exportado desde Stock?')
  const declared = jsonFile._data && jsonFile._data.uncompressedSize
  if (declared && declared > LIMITS.jsonBytes) fail('"stock.json" es demasiado grande.')
  const text = await jsonFile.async('string')
  if (text.length > LIMITS.jsonBytes) fail('"stock.json" es demasiado grande.')

  let meta
  try { meta = JSON.parse(text) } catch { fail('"stock.json" está dañado (no es JSON válido).') }
  if (!meta || meta.format !== BACKUP_FORMAT) fail('Este archivo no es un respaldo de Stock de este sistema.')
  if (meta.version !== BACKUP_VERSION) fail(`Versión de respaldo no soportada (${meta.version}).`)
  if (!Array.isArray(meta.items)) fail('"stock.json" no contiene la lista de productos.')
  if (meta.items.length > LIMITS.items) fail(`El respaldo tiene demasiados productos (máx. ${LIMITS.items}).`)

  const items = meta.items.map(validateItem)
  const seen = new Set()
  for (const it of items) {
    if (seen.has(it.id)) fail(`El producto "${it.name}" está repetido en el respaldo.`)
    seen.add(it.id)
  }

  // Imágenes: se leen y verifican TODAS antes de aplicar nada
  let total = 0, done = 0
  const withImg = items.filter(i => i.image)
  for (const it of withImg) {
    const f = zip.file(it.image)
    if (!f) { it.image = null; it.imageMissing = true; continue }
    const size = f._data && f._data.uncompressedSize
    if (size && size > LIMITS.imageBytes) fail(`La imagen de "${it.name}" es demasiado grande (máx. 8 MB).`)
    const bytes = await f.async('uint8array')
    if (bytes.length > LIMITS.imageBytes) fail(`La imagen de "${it.name}" es demasiado grande (máx. 8 MB).`)
    total += bytes.length
    if (total > LIMITS.totalImages) fail('Las imágenes del respaldo superan el tamaño máximo permitido (300 MB).')
    const type = sniffImageType(bytes)
    if (!type) fail(`La imagen de "${it.name}" no es JPG, PNG ni WEBP válida.`)
    it.imageBytes = bytes
    it.imageType = type
    done++
    onProgress({ step: 'Verificando imágenes…', done, total: withImg.length })
  }

  return {
    exportedAt: meta.exportedAt || null,
    business: typeof meta.business === 'string' ? meta.business : null,
    items,
  }
}

/* ── IMPORTAR: 2) comparar con lo que hay hoy (no escribe nada) ────── */
export async function loadCurrentStock() {
  const sb = requireSupabase()
  const { data, error } = await sb.from('menu_items')
    .select('id, name, cat, price, description, available, stock, img_url')
  if (error) throw new Error('No se pudo leer el Stock actual: ' + error.message)
  return new Map((data || []).map(r => [String(r.id).toLowerCase(), r]))
}

// ¿La foto del respaldo es la misma que ya tiene el producto? (misma URL de origen)
const sameImage = (it, cur) => !!(cur && cur.img_url && it.imgUrl && cur.img_url === it.imgUrl)

export function planStockImport(items, current, { restoreStock = false } = {}) {
  const plan = { create: [], update: [], same: [] }
  for (const it of items) {
    const cur = current.get(it.id)
    if (!cur) { plan.create.push(it); continue }
    const imageChanges = it.imageBytes ? !sameImage(it, cur) : false
    const changed =
      cur.name !== it.name || cur.cat !== it.cat ||
      Number(cur.price) !== it.price ||
      (cur.description || null) !== it.description ||
      imageChanges ||
      (restoreStock && ((cur.available !== false) !== it.available || (cur.stock ?? null) !== it.stock))
    ;(changed ? plan.update : plan.same).push(it)
  }
  return plan
}

/* ── IMPORTAR: 3) aplicar ──────────────────────────────────────────── */
async function uploadBackupImage(sb, it) {
  const ext = EXT_BY_TYPE[it.imageType] || 'jpg'
  const path = `${it.id}-${Date.now()}.${ext}`
  const blob = new Blob([it.imageBytes], { type: it.imageType })
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, {
    contentType: it.imageType, cacheControl: '31536000', upsert: false,
  })
  if (error) throw error
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path)
  if (!data?.publicUrl) throw new Error('No se obtuvo la URL de la imagen')
  return data.publicUrl
}

export async function applyStockImport(plan, current, { restoreStock = false, actor = null, onProgress = () => {} } = {}) {
  const sb = requireSupabase()
  const work = [...plan.create, ...plan.update]
  const imgUrl = new Map()
  const imageErrors = []
  let uploaded = 0, done = 0

  // 1) Imágenes — ningún producto cambia todavía
  const needUpload = work.filter(it => it.imageBytes && !sameImage(it, current.get(it.id)))
  await pool(needUpload, 3, async it => {
    try { imgUrl.set(it.id, await uploadBackupImage(sb, it)); uploaded++ }
    catch (e) { imageErrors.push(it.name) }
    done++
    onProgress({ step: 'Subiendo imágenes…', done, total: needUpload.length })
  })
  if (needUpload.length && uploaded === 0) {
    throw new Error('No se pudo subir ninguna imagen (¿sesión vencida o falta el bucket "menu-images"?). No se modificó ningún producto.')
  }

  // Imagen final de cada producto: la recién subida; si no hay archivo o
  // falló la subida, se conserva la imagen ACTUAL (nunca se borra una foto).
  const resolveImg = it => {
    if (imgUrl.has(it.id)) return imgUrl.get(it.id)
    const cur = current.get(it.id)
    if (cur) return cur.img_url || null
    return it.imgUrl // producto nuevo sin archivo: URL original si existía
  }
  const now = new Date().toISOString()

  const createRows = plan.create.map(it => ({
    id: it.id, name: it.name, cat: it.cat, price: it.price, description: it.description,
    available: it.available, stock: it.stock, img_url: resolveImg(it), updated_at: now,
  }))
  const updateRows = plan.update.map(it => ({
    id: it.id, name: it.name, cat: it.cat, price: it.price, description: it.description,
    img_url: resolveImg(it), updated_at: now,
    ...(restoreStock ? { available: it.available, stock: it.stock } : {}),
  }))

  // 2) Productos, en lotes (cada lote es una sola operación en la base de datos)
  const CHUNK = 200
  const batches = []
  for (let i = 0; i < createRows.length; i += CHUNK) batches.push(createRows.slice(i, i + CHUNK))
  for (let i = 0; i < updateRows.length; i += CHUNK) batches.push(updateRows.slice(i, i + CHUNK))
  let written = 0
  for (const rows of batches) {
    onProgress({ step: 'Guardando productos…', done: written, total: createRows.length + updateRows.length })
    const { error } = await sb.from('menu_items').upsert(rows, { onConflict: 'id' })
    if (error) {
      throw new Error(
        `Se guardaron ${written} de ${createRows.length + updateRows.length} productos y falló el resto: ${error.message}. ` +
        'Puedes volver a importar el mismo archivo: es seguro repetirlo.'
      )
    }
    written += rows.length
  }

  DB.logAudit({
    actorId: actor?.uid, actorName: actor?.name, action: 'stock_import', entity: 'menu_items',
    detail: {
      nuevos: createRows.length, actualizados: updateRows.length, sin_cambios: plan.same.length,
      imagenes_subidas: uploaded, imagenes_fallidas: imageErrors.length, restaurar_stock: restoreStock,
    },
  })
  return { created: createRows.length, updated: updateRows.length, same: plan.same.length, uploaded, imageErrors }
}
