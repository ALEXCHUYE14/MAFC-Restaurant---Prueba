import { useSyncExternalStore } from 'react'

/* ══════════════════════════════════════════════════════════════════
   IMPRESORA BLUETOOTH (ESC/POS) — panel admin
   ══════════════════════════════════════════════════════════════════
   Port del BTService que ya funciona en producción dentro de
   src-apps/mesero/main.jsx (mismos servicios GATT, mismo troceado de
   20 bytes con pausas, misma detección de ancho por nombre) — pero como
   módulo con estado observable, para que Ajustes muestre "Conectada"/
   "Desconectada" y utils/print.js decida si imprime por Bluetooth.

   LÍMITE DE LA PLATAFORMA (no de este código): Web Bluetooth exige un
   gesto del usuario (clic) para ELEGIR la impresora la primera vez. Lo que
   sí se hace para que quede "ya conectada":
     - Se recuerda la impresora elegida (localStorage de este dispositivo).
     - Al abrir el panel se intenta reconectar en silencio con
       navigator.bluetooth.getDevices() (Chrome/Edge recientes). Si el
       navegador no lo soporta, basta pulsar "Conectar" una vez por sesión.
   Si en el momento de imprimir NO hay conexión, print.js usa la ventana de
   impresión del navegador exactamente como antes — nunca se pierde un ticket.
══════════════════════════════════════════════════════════════════ */

const LS_KEY   = 'antojitos_bt_printer_v1'
const SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb', '00001101-0000-1000-8000-00805f9b34fb']
const CHUNK    = 20   // bytes — las impresoras BLE baratas tienen buffers chicos
const wait     = ms => new Promise(r => setTimeout(r, ms))

export function isBluetoothSupported() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth
}

/* ── Preferencias recordadas en este dispositivo ─────────────────────────── */
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    return p && typeof p === 'object' ? p : {}
  } catch { return {} }
}
function savePrefs(patch) {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ ...loadPrefs(), ...patch })) }
  catch { /* almacenamiento bloqueado — no es crítico */ }
}

/* ── Estado observable ────────────────────────────────────────────────────── */
const prefs0 = loadPrefs()
let _state = {
  status:     'idle',            // idle | searching | connected | disconnected | error
  message:    '',
  deviceName: prefs0.name || '',  // nombre de la impresora recordada / conectada
  remembered: !!prefs0.id,
  paper:      ['58', '80'].includes(prefs0.paper) ? prefs0.paper : 'auto',
}
const _listeners = new Set()

function setState(patch) {
  _state = { ..._state, ...patch }
  _listeners.forEach(cb => { try { cb() } catch { /* un listener roto no frena a los demás */ } })
}

export function getPrinterState() { return _state }
export function subscribePrinter(cb) { _listeners.add(cb); return () => _listeners.delete(cb) }
export function usePrinter() { return useSyncExternalStore(subscribePrinter, getPrinterState) }

/* ── Conexión ──────────────────────────────────────────────────────────────── */
let _device = null
let _server = null
let _char   = null
let _canAck = false

export function isPrinterConnected() { return !!(_server && _server.connected) }

// Primera característica GATT con permiso de escritura (igual que mesero.html)
async function acquireChar() {
  const svcs = await _server.getPrimaryServices()
  for (const svc of svcs) {
    let chars
    try { chars = await svc.getCharacteristics() } catch { continue }
    for (const ch of chars) {
      if (ch.properties.write || ch.properties.writeWithoutResponse) {
        _char   = ch
        _canAck = !!ch.properties.write
        return
      }
    }
  }
  throw new Error('La impresora no expone una característica de escritura')
}

function attach(device) {
  _device = device
  device.addEventListener('gattserverdisconnected', () => {
    _server = null; _char = null
    setState({ status: 'disconnected', message: 'Impresora desconectada' })
  })
}

async function finishConnect(device) {
  _server = await device.gatt.connect()
  _char = null
  try { await acquireChar() } catch { /* se reintenta en la primera impresión */ }
  const name = device.name || 'Impresora'
  savePrefs({ id: device.id, name })
  setState({ status: 'connected', message: `Conectada a ${name}`, deviceName: name, remembered: true })
}

// Debe llamarse desde un clic (gesto del usuario) — exigencia de Web Bluetooth.
export async function connectPrinter() {
  if (!isBluetoothSupported()) {
    setState({ status: 'error', message: 'Este navegador no soporta Bluetooth. Usa Chrome o Edge (en Windows/Android).' })
    return false
  }
  try {
    setState({ status: 'searching', message: 'Buscando impresora…' })
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: SERVICES,
    })
    attach(device)
    setState({ message: `Conectando a ${device.name || 'impresora'}…` })
    await finishConnect(device)
    return true
  } catch (e) {
    const cancelled = /cancel/i.test(e?.message || '') || e?.name === 'NotFoundError'
    setState({
      status:  cancelled ? (_state.remembered ? 'disconnected' : 'idle') : 'error',
      message: cancelled ? 'Búsqueda cancelada' : (e?.message || 'No se pudo conectar'),
    })
    return false
  }
}

// Reconexión silenciosa a la impresora ya autorizada (sin abrir el selector).
// Best-effort: cualquier fallo solo deja el estado en "desconectada".
export async function tryAutoReconnect() {
  if (isPrinterConnected()) return true
  const saved = loadPrefs()
  if (!saved.id || !isBluetoothSupported()) return false
  if (typeof navigator.bluetooth.getDevices !== 'function') {
    // El navegador no permite reconectar sin abrir el selector — hay que elegirla con un clic.
    setState({ status: 'disconnected', message: 'Este navegador no reconecta solo: pulsa "Elegir impresora"' })
    return false
  }
  try {
    setState({ status: 'searching', message: 'Reconectando impresora…' })
    const devices = await navigator.bluetooth.getDevices()
    const device = devices.find(d => d.id === saved.id)
    if (!device) throw new Error('Impresora no autorizada en este navegador')
    attach(device)
    // gatt.connect() puede quedarse esperando si la impresora está apagada
    await Promise.race([
      finishConnect(device),
      wait(8000).then(() => { throw new Error('La impresora no respondió (¿está encendida y cerca?)') }),
    ])
    return true
  } catch (e) {
    setState({ status: 'disconnected', message: e?.message || 'No se pudo reconectar' })
    return false
  }
}

export function disconnectPrinter({ forget = false } = {}) {
  try { if (_device && _device.gatt && _device.gatt.connected) _device.gatt.disconnect() } catch { /* ya desconectada */ }
  _server = null; _char = null
  if (forget) {
    _device = null
    savePrefs({ id: null, name: '' })
    setState({ status: 'idle', message: '', deviceName: '', remembered: false })
  } else {
    setState({ status: 'disconnected', message: 'Impresora desconectada' })
  }
}

/* ── Ancho de papel ───────────────────────────────────────────────────────── */
export function setPaperWidth(paper) {
  const p = ['58', '80'].includes(paper) ? paper : 'auto'
  savePrefs({ paper: p })
  setState({ paper: p })
}

// Columnas del ticket: elección manual, o detección por nombre (igual que mesero.html)
export function getPaperCols() {
  if (_state.paper === '58') return 32
  if (_state.paper === '80') return 48
  const n = (_device && _device.name) || _state.deviceName || ''
  return /80\s*mm|76\s*mm|\b80\b|PT-280|GP-80|XP-80|BTP-80|PRT-80/i.test(n) ? 48 : 32
}

/* ── Impresión ─────────────────────────────────────────────────────────────── */
// La impresora solo entiende ASCII: se quitan tildes/emojis para que nunca
// reciba bytes UTF-8 multibyte (los caracteres de control ESC/POS son ASCII y se conservan).
export function toAscii(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/\p{M}/gu, '')   // quita las tildes (marcas combinantes Unicode)
    .replace(/[^\x00-\x7F]/g, '')
}

let _queue = Promise.resolve() // una impresión a la vez — dos tickets nunca se mezclan

async function sendBytes(bytes) {
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK)
    const write = async () => {
      if (_canAck) { await _char.writeValue(slice) }
      else { await _char.writeValueWithoutResponse(slice); await wait(50) }
    }
    try {
      await write()
    } catch {
      // Un reintento: se vuelve a obtener la característica y se reenvía el mismo trozo
      _char = null
      await acquireChar()
      await write()
    }
  }
}

export function printRaw(text) {
  const job = _queue.then(async () => {
    if (!isPrinterConnected()) throw new Error('Impresora no conectada')
    if (!_char) await acquireChar()

    const enc  = new TextEncoder()
    // ESC @ (reset) + NUL (respiro) + ESC a 0 (alinear izq.) + ESC M 0 (fuente A)
    const init = new Uint8Array([0x1B, 0x40, 0x00, 0x1B, 0x61, 0x00, 0x1B, 0x4D, 0x00])
    const body = enc.encode(toAscii(text))
    // 3 saltos de línea + GS V A 3 (avanzar papel y corte parcial)
    const tail = new Uint8Array([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x03])

    const full = new Uint8Array(init.length + body.length + tail.length)
    full.set(init, 0)
    full.set(body, init.length)
    full.set(tail, init.length + body.length)

    await wait(350) // tiempo para que procese el reset antes de recibir texto
    await sendBytes(full)
    return true
  })
  // Si una impresión falla, la cola sigue viva para la siguiente
  _queue = job.catch(() => {})
  return job
}
