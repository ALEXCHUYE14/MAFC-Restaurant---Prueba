import { useSyncExternalStore } from 'react'
import { DB } from './supabase'

/* ══════════════════════════════════════════════════════════════════
   CONFIGURACIÓN DEL NEGOCIO — nombre, RUC/DNI, dirección, Yape + QR
   ══════════════════════════════════════════════════════════════════
   Antes estos datos estaban escritos a mano en tickets, reportes y en
   los modales de cobro. Ahora viven en UNA fila compartida
   (tabla `negocio_config`, id = 1 — mismo patrón que `caja_estado`) que
   se edita desde Ajustes.

   Es un store a nivel de módulo (no un Context) a propósito: las
   funciones que imprimen (utils/print.js, utils/pdf.js) no son
   componentes de React y necesitan leer el valor actual de forma
   SÍNCRONA. La UI lo consume con el hook useBusiness().

   Valores por defecto = EXACTAMENTE los que estaban fijos en el código.
   Si la migración migracion-config-negocio.sql no se corrió, o Supabase
   no responde, el sistema imprime lo mismo de siempre — nada se rompe.
   Los cambios hechos desde Ajustes se guardan además en localStorage de
   este dispositivo, así que el ticket del admin ya sale con los datos
   nuevos aunque la tabla todavía no exista (Ajustes avisa cuando el
   cambio quedó solo en este dispositivo).
══════════════════════════════════════════════════════════════════ */

export const DEFAULT_BUSINESS = Object.freeze({
  nombre:        'Antojitos al Paso',
  tipoDocumento: 'RUC',
  documento:     '10456789012',
  direccion:     'Jr. Zepita #349 - Catacaos, Piura',
  yapeNumero:    '982 936 262',
  yapeTitular:   'Leonidas Juarez S.',
  yapeQrUrl:     null,
})

const LS_KEY = 'antojitos_negocio_cfg_v1'

function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch { return {} }
}

function persistLocal(business) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(business)) }
  catch { /* almacenamiento lleno o bloqueado — el valor en memoria sigue vigente */ }
}

// Snapshot inmutable — la referencia SOLO cambia cuando cambia el valor
// (requisito de useSyncExternalStore para no re-renderizar en bucle).
let _state = {
  business: { ...DEFAULT_BUSINESS, ...loadLocal() },
  // true  → el último cambio/lectura coincide con la base de datos
  // false → la tabla no existe / falló: los datos viven solo en este dispositivo
  // null  → todavía no se sabe
  synced: null,
}
const _listeners = new Set()

function setState(next) {
  _state = next
  _listeners.forEach(cb => { try { cb() } catch { /* un listener roto no debe frenar a los demás */ } })
}

export function getBusinessState() { return _state }
export function getBusiness()      { return _state.business }
export function subscribeBusiness(cb) {
  _listeners.add(cb)
  return () => _listeners.delete(cb)
}

// Hook para componentes — se re-renderiza solo cuando la configuración cambia.
export function useBusiness() {
  return useSyncExternalStore(subscribeBusiness, getBusinessState)
}

// "RUC: 10456789012" / "DNI: 12345678" — vacío si no hay documento cargado
// (los tickets simplemente omiten la línea, no imprimen "RUC: ").
export function formatBusinessDoc(b = _state.business) {
  const doc = (b.documento || '').trim()
  return doc ? `${b.tipoDocumento === 'DNI' ? 'DNI' : 'RUC'}: ${doc}` : ''
}

/* Localidad / ciudad derivadas de la dirección cargada en Ajustes, para los
   textos cortos de pantalla ("… · Catacaos"). Regla:
     "Jr. Zepita #349 - Catacaos, Piura" → localidad "Catacaos, Piura", ciudad "Catacaos"
     "Av. Grau 123, Piura"               → localidad "Piura",           ciudad "Piura"
     sin " - " ni coma / vacía           → ''  (la UI omite esa parte; nunca
                                               muestra la calle donde iba la ciudad)
   La misma regla está duplicada en src-apps/mesero y src-apps/cocina
   (bundles independientes) — mantenerlas iguales. */
export function businessLocality(b = _state.business) {
  const dir = String(b?.direccion || '').trim()
  if (!dir) return ''
  const parts = dir.split(/\s+[-–—]\s+/)
  if (parts.length > 1) return parts[parts.length - 1].trim()
  const comma = dir.indexOf(',')
  return comma >= 0 ? dir.slice(comma + 1).trim() : ''
}
export function businessCity(b = _state.business) {
  return businessLocality(b).split(',')[0].trim()
}

/* ── Mapeo fila SQL (snake_case) → forma interna ───────────────────────────
   Solo incluye las claves presentes: los eventos UPDATE de Realtime pueden
   omitir columnas grandes sin cambios (la URL/data-URI del QR) — un mapeo
   "completo" convertiría esa ausencia en null y borraría el QR en pantalla.
   Mismo cuidado que mapMenuItemRowPartial en services/supabase.js. */
function mapRowPartial(r) {
  const out = {}
  if (!r) return out
  if ('nombre'         in r) out.nombre        = (r.nombre || '').trim() || DEFAULT_BUSINESS.nombre
  if ('tipo_documento' in r) out.tipoDocumento = r.tipo_documento === 'DNI' ? 'DNI' : 'RUC'
  if ('documento'      in r) out.documento     = r.documento || ''
  if ('direccion'      in r) out.direccion     = r.direccion || ''
  if ('yape_numero'    in r) out.yapeNumero    = r.yape_numero || ''
  if ('yape_titular'   in r) out.yapeTitular   = r.yape_titular || ''
  if ('yape_qr_url'    in r) out.yapeQrUrl     = r.yape_qr_url || null
  return out
}

// forma interna → columnas SQL (solo las claves que vienen en el parche)
const TO_COLUMN = {
  nombre: 'nombre', tipoDocumento: 'tipo_documento', documento: 'documento',
  direccion: 'direccion', yapeNumero: 'yape_numero', yapeTitular: 'yape_titular',
  yapeQrUrl: 'yape_qr_url',
}

let _started = false

// Idempotente — se llama al abrir el panel admin. Carga la fila compartida
// y se suscribe a cambios en vivo. Si la tabla no existe, deja el valor
// local/por defecto y marca synced = false (Ajustes lo muestra).
export function startBusinessSync() {
  if (_started) return
  _started = true

  DB.getNegocioConfig().then(row => {
    if (!row) { setState({ ..._state, synced: false }); return }
    const business = { ...DEFAULT_BUSINESS, ..._state.business, ...mapRowPartial(row) }
    persistLocal(business)
    setState({ business, synced: true })
  }).catch(() => setState({ ..._state, synced: false }))

  DB.subscribeNegocioConfig(rowPartial => {
    const business = { ..._state.business, ...mapRowPartial(rowPartial) }
    persistLocal(business)
    setState({ business, synced: true })
  })
}

/* Guarda un parche de configuración (forma interna: { nombre, documento, … }).
   1) aplica el cambio en memoria + localStorage de inmediato (el ticket del
      admin ya sale con los datos nuevos), y
   2) intenta escribirlo en la fila compartida.
   Devuelve { synced, error } — NUNCA lanza: si la tabla no existe el cambio
   queda igualmente guardado en este dispositivo y la UI avisa con claridad. */
export async function saveBusiness(patch, updatedBy) {
  const previous = _state
  const business = { ...previous.business, ...patch }
  persistLocal(business)
  setState({ business, synced: previous.synced })

  const columns = {}
  for (const [k, v] of Object.entries(patch)) {
    if (TO_COLUMN[k]) columns[TO_COLUMN[k]] = v === '' ? null : v
  }
  // `nombre` es NOT NULL en la tabla — nunca mandar null
  if ('nombre' in columns && !columns.nombre) columns.nombre = DEFAULT_BUSINESS.nombre

  try {
    await DB.saveNegocioConfig(columns, updatedBy)
    setState({ business: _state.business, synced: true })
    return { synced: true, error: null }
  } catch (e) {
    setState({ business: _state.business, synced: false })
    return { synced: false, error: e?.message || 'No se pudo guardar en la base de datos' }
  }
}
