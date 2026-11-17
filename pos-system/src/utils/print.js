import { getBusiness, formatBusinessDoc } from '../services/businessConfig'
import { isPrinterConnected, printRaw, getPaperCols, toAscii } from '../services/btPrinter'
import { clampPackaging, packagingTotal, cleanUnitPrice } from './packaging'

// Envases descartables del ticket: { count, unit, total, platos } o null si no hay.
// "platos" = total − envases (en céntimos, para que cuadre exacto).
function packagingLines(packagingCount, packagingUnit, total) {
  const count = clampPackaging(packagingCount)
  const unit  = cleanUnitPrice(packagingUnit)
  if (!count || unit === null) return null
  const pTotal = packagingTotal(count, unit)
  const platos = Math.round(((Number(total) || 0) - pTotal) * 100) / 100
  return { count, unit, total: pTotal, platos }
}

// ── Sanitización HTML (previene XSS en document.write) ───────────────────────
export function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
}

// ── Etiquetas de método de pago ───────────────────────────────────────────────
const PM_LABELS = {
  efectivo: 'Efectivo 💵',
  yape:     'Yape 📱',
  plin:     'Plin 📱',
  tarjeta:  'Tarjeta 💳',
}

/* ══════════════════════════════════════════════════════════════════
   TICKET — dos caminos, MISMO contenido y MISMOS datos del negocio
   (nombre, dirección, RUC/DNI salen de Ajustes → services/businessConfig):
     1) Bluetooth ESC/POS (texto plano) — si hay impresora conectada.
     2) Ventana de impresión del navegador (HTML 80mm) — el camino de
        siempre, y el respaldo si Bluetooth no está conectado o falla.
   Misma cadena que ya usa la app del mesero: Bluetooth → ventana.
══════════════════════════════════════════════════════════════════ */

const BOLD_ON  = '\x1b\x45\x01'
const BOLD_OFF = '\x1b\x45\x00'
// GS ! n — tamaño de letra (ESC/POS): bits 0-3 = ALTO, bits 4-7 = ANCHO.
// Se usa SOLO doble ALTO (n=0x01). Antes se enviaba 0x10 creyendo que era la
// altura, pero 0x10 es doble ANCHO: el título se centraba contando letras
// normales y se imprimía al doble de ancho → quedaba corrido a la derecha
// (igual que la línea del TOTAL). La altura no cambia el ancho de cada
// carácter, así que center()/lr() quedan exactos.
const SIZE_TALL   = '\x1d\x21\x01'
const SIZE_NORMAL = '\x1d\x21\x00'

// Ticket como texto ESC/POS. `cols`: 32 (58mm) o 48 (80mm). Todo se pasa por
// toAscii — la impresora térmica no entiende tildes, emojis ni UTF-8.
export function buildReceiptText({ mesa, zone, waiterName, items, total, paymentMethod, paymentBreakdown, customerName, customerPhone, packagingCount, packagingUnit, descuentoMonto, descuentoLabel }, cols = 32) {
  const W    = Math.max(32, cols)
  const biz  = getBusiness()
  const line = '='.repeat(W)
  const dash = '-'.repeat(W)
  const fit  = (s, max) => toAscii(s).trim().substring(0, Math.max(0, max))
  // Centra una línea; si no cabe en el ancho del papel la parte en varias
  // líneas por palabras (un nombre/dirección largos no se cortan a media palabra).
  const centerLines = s => {
    const out = []
    let cur = ''
    for (const word of toAscii(s).split(/\s+/).filter(Boolean)) {
      const w = word.substring(0, W)
      if (!cur) cur = w
      else if ((cur + ' ' + w).length <= W) cur += ' ' + w
      else { out.push(cur); cur = w }
    }
    if (cur) out.push(cur)
    return out.map(l => ' '.repeat(Math.max(0, Math.floor((W - l.length) / 2))) + l)
  }
  const center = s => centerLines(s).join('\n')
  // izquierda ... derecha, rellenando con espacios hasta el ancho del papel
  const lr = (l, r) => {
    const right = fit(r, W - 2)
    const left  = fit(l, W - right.length - 1)
    return left + ' '.repeat(Math.max(1, W - left.length - right.length)) + right
  }

  const now      = new Date()
  const dateStr  = now.toLocaleDateString('es-PE')
  const timeStr  = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }) // 24h: ocupa menos ancho en papel de 58mm
  const isTakeaway = !mesa || mesa === 0
  const safeTotal  = Number(total) || 0
  const subtotal   = safeTotal / 1.18
  const igv        = safeTotal - subtotal
  const pmLabel    = toAscii(PM_LABELS[paymentMethod] ?? String(paymentMethod || 'Efectivo')).trim()
  const doc        = formatBusinessDoc(biz)

  let s = line + '\n'
  s += SIZE_TALL + BOLD_ON + center((biz.nombre || '').toUpperCase()) + BOLD_OFF + SIZE_NORMAL + '\n'
  if (biz.direccion) s += center(biz.direccion) + '\n'
  if (doc)           s += center(doc) + '\n'
  s += line + '\n'

  if (isTakeaway) s += BOLD_ON + center(toAscii(zone || 'PARA LLEVAR').toUpperCase()) + BOLD_OFF + '\n'
  else            s += lr('Mesa:', `${mesa} ${fit(zone, 16)}`) + '\n'
  if (customerName)  s += lr('Cliente:', customerName) + '\n'
  if (customerName && customerPhone) s += lr('Tel:', customerPhone) + '\n'
  if (!isTakeaway && waiterName)     s += lr('Mesero:', waiterName) + '\n'
  s += lr('Fecha:', `${dateStr} ${timeStr}`) + '\n'
  s += dash + '\n'

  for (const i of items || []) {
    const qty    = i.qty || 1
    const pr     = `S/${((i.price || 0) * qty).toFixed(2)}`
    const prefix = `${qty}x `
    // Si el nombre no cabe en la línea del precio, sigue debajo (alineado bajo
    // el nombre) en vez de cortarse: "Chicharron de Mariscos (Fuente G.)".
    const words  = toAscii(String(i.name || '?')).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    if (!words.length) words.push('?')
    const firstW = Math.max(4, W - prefix.length - pr.length - 1)
    let first = ''
    while (words.length && (first ? first.length + 1 + words[0].length : words[0].length) <= firstW) {
      first = first ? `${first} ${words.shift()}` : words.shift()
    }
    if (!first) { const w = words.shift(); first = w.substring(0, firstW); if (w.length > firstW) words.unshift(w.substring(firstW)) }
    s += BOLD_ON + lr(prefix + first, pr) + BOLD_OFF + '\n'
    const restW = Math.max(4, W - prefix.length)
    let cur = ''
    for (let w of words) {
      while (w.length > restW) {                    // palabra más larga que el renglón
        if (cur) { s += BOLD_ON + ' '.repeat(prefix.length) + cur + BOLD_OFF + '\n'; cur = '' }
        s += BOLD_ON + ' '.repeat(prefix.length) + w.substring(0, restW) + BOLD_OFF + '\n'
        w = w.substring(restW)
      }
      if (!w) continue
      if (!cur) cur = w
      else if ((cur + ' ' + w).length <= restW) cur += ' ' + w
      else { s += BOLD_ON + ' '.repeat(prefix.length) + cur + BOLD_OFF + '\n'; cur = w }
    }
    if (cur) s += BOLD_ON + ' '.repeat(prefix.length) + cur + BOLD_OFF + '\n'
  }

  s += dash + '\n'
  // Descuento (cupón o manual): el total ya viene neto; se muestra el desglose
  const desc = Math.max(0, Math.round((Number(descuentoMonto) || 0) * 100) / 100)
  const pk = packagingLines(packagingCount, packagingUnit, safeTotal + desc)
  if (pk || desc > 0) {
    const platos = pk ? pk.platos : Math.round((safeTotal + desc) * 100) / 100
    s += lr('Total platos:', `S/${platos.toFixed(2)}`) + '\n'
    if (pk) s += lr(`Envases ${pk.count} x S/${pk.unit.toFixed(2)}:`, `S/${pk.total.toFixed(2)}`) + '\n'
    if (desc > 0) s += lr(`Descuento${descuentoLabel ? ' ' + toAscii(String(descuentoLabel)).slice(0, 18) : ''}:`, `-S/${desc.toFixed(2)}`) + '\n'
    s += dash + '\n'
  }
  s += lr('Subtotal:', `S/${subtotal.toFixed(2)}`) + '\n'
  s += lr('IGV 18%:',  `S/${igv.toFixed(2)}`) + '\n'
  s += line + '\n'
  s += SIZE_TALL + BOLD_ON + lr('TOTAL:', `S/${safeTotal.toFixed(2)}`) + BOLD_OFF + SIZE_NORMAL + '\n'
  s += line + '\n'
  if (Array.isArray(paymentBreakdown) && paymentBreakdown.length) {
    s += lr('Pago:', 'Mixto') + '\n'
    for (const leg of paymentBreakdown) {
      s += lr(`  ${toAscii(PM_LABELS[leg.metodo] ?? leg.metodo).trim()}`, `S/${Number(leg.monto).toFixed(2)}`) + '\n'
    }
  } else {
    s += lr('Pago:', pmLabel) + '\n'
  }
  s += dash + '\n'
  s += center('Gracias por su compra!') + '\n'
  s += center('Vuelva pronto') + '\n'
  s += dash + '\n'
  s += center('Conserve su comprobante') + '\n'
  return s
}

// ── Ticket térmico 80mm por ventana de impresión del navegador ──────────────
function printReceiptWindow({ mesa, zone, waiterName, items, total, paymentMethod, paymentBreakdown, customerName, customerPhone, packagingCount, packagingUnit, descuentoMonto, descuentoLabel }, quiet = false) {
  const now        = new Date()
  const dateStr    = now.toLocaleDateString('es-PE')
  const timeStr    = now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
  const subtotal   = total / 1.18
  const igv        = total - subtotal
  const pmLabel    = PM_LABELS[paymentMethod] ?? String(paymentMethod || 'Efectivo 💵')
  const isTakeaway = !mesa || mesa === 0
  const biz        = getBusiness()
  const doc        = formatBusinessDoc(biz)
  const desc       = Math.max(0, Math.round((Number(descuentoMonto) || 0) * 100) / 100)
  const pk         = packagingLines(packagingCount, packagingUnit, (Number(total) || 0) + desc)
  const platosHtml = pk ? pk.platos : Math.round(((Number(total) || 0) + desc) * 100) / 100
  const packHtml   = (pk || desc > 0) ? `
    <div style="display:flex;justify-content:space-between"><span>Total platos:</span><span>S/${platosHtml.toFixed(2)}</span></div>
    ${pk ? `<div style="display:flex;justify-content:space-between"><span>Envases ${pk.count} x S/${pk.unit.toFixed(2)}:</span><span>S/${pk.total.toFixed(2)}</span></div>` : ''}
    ${desc > 0 ? `<div style="display:flex;justify-content:space-between"><span>Descuento${descuentoLabel ? ' ' + escHtml(String(descuentoLabel).slice(0, 30)) : ''}:</span><span>-S/${desc.toFixed(2)}</span></div>` : ''}
    <div class="sep"></div>` : ''

  const rowsHtml = items.map(i => `
    <div style="display:flex;justify-content:space-between;font-weight:700">
      <span>${escHtml(String(`${i.qty}x ${i.name}`).substring(0, 30))}</span>
      <span>S/${((i.price || 0) * (i.qty || 1)).toFixed(2)}</span>
    </div>`).join('')

  const zoneHeader = isTakeaway
    ? `<div style="background:#000;color:#fff;text-align:center;padding:3px;font-weight:bold;margin:4px 0">🥡 ${escHtml(zone || 'PARA LLEVAR')}</div>`
    : `<div style="display:flex;justify-content:space-between"><span>Mesa:</span><span>${escHtml(String(mesa))} · ${escHtml(zone)}</span></div>`

  const customerBlock = customerName ? `
    <div style="display:flex;justify-content:space-between"><span>Cliente:</span><span>${escHtml(customerName)}</span></div>
    ${customerPhone ? `<div style="display:flex;justify-content:space-between"><span>Tel:</span><span>${escHtml(customerPhone)}</span></div>` : ''}
  ` : ''

  const waiterBlock = !isTakeaway && waiterName
    ? `<div style="display:flex;justify-content:space-between"><span>Mesero:</span><span>${escHtml(waiterName)}</span></div>`
    : ''

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Ticket</title>
  <style>
    @page { size: auto; margin: 2mm 1mm; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',monospace; font-size:14px; font-weight:600; width:100%; max-width:80mm; color:#000; word-break:break-word; overflow-wrap:anywhere; }
    .c  { text-align:center; }
    .b  { font-weight:bold; }
    .sep{ border-top:1px dashed #000; margin:4px 0; }
    span { word-break:break-word; }
    @media print { * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; } }
  </style></head><body>
    <div class="c b" style="font-size:19px;letter-spacing:1px">${escHtml((biz.nombre || '').toUpperCase())}</div>
    ${biz.direccion ? `<div class="c" style="font-size:11px">${escHtml(biz.direccion)}</div>` : ''}
    ${doc ? `<div class="c" style="font-size:11px">${escHtml(doc)}</div>` : ''}
    <div class="sep"></div>
    ${zoneHeader}
    ${customerBlock}
    ${waiterBlock}
    <div style="display:flex;justify-content:space-between"><span>Fecha:</span><span>${dateStr}  ${timeStr}</span></div>
    <div class="sep"></div>
    ${rowsHtml}
    <div class="sep"></div>
    ${packHtml}
    <div style="display:flex;justify-content:space-between"><span>Subtotal:</span><span>S/${subtotal.toFixed(2)}</span></div>
    <div style="display:flex;justify-content:space-between"><span>IGV 18%:</span><span>S/${igv.toFixed(2)}</span></div>
    <div style="border-top:2px solid #000;margin:4px 0"></div>
    <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:20px"><span>TOTAL:</span><span>S/${total.toFixed(2)}</span></div>
    <div style="border-top:2px solid #000;margin:4px 0"></div>
    ${Array.isArray(paymentBreakdown) && paymentBreakdown.length ? `
      <div style="display:flex;justify-content:space-between"><span>Pago:</span><span>Mixto</span></div>
      ${paymentBreakdown.map(leg => `<div style="display:flex;justify-content:space-between;padding-left:10px">
        <span>${escHtml(PM_LABELS[leg.metodo] ?? leg.metodo)}</span><span>S/${Number(leg.monto).toFixed(2)}</span>
      </div>`).join('')}
    ` : `<div style="display:flex;justify-content:space-between"><span>Pago:</span><span>${escHtml(pmLabel)}</span></div>`}
    <div class="sep"></div>
    <div class="c b" style="font-size:13px;margin-top:6px">¡Gracias por su compra!</div>
    <div class="c" style="font-size:11px">Vuelva pronto 🍗</div>
    <div class="sep"></div>
    <div class="c" style="font-size:11px">Conserve su comprobante</div>
    <br/><br/>
  </body></html>`

  const win = window.open('', '_blank', 'width=340,height=520,toolbar=0,scrollbars=0')
  if (!win) {
    if (!quiet) alert('Habilita las ventanas emergentes para imprimir')
    return false
  }
  win.document.write(html)
  win.document.close()
  win.focus()
  win.onload = () => { win.print(); setTimeout(() => win.close(), 800) }
  return true
}

// ── Punto de entrada — misma firma y mismo valor de retorno de siempre ──────
// Con impresora Bluetooth conectada imprime por ahí; si no está conectada
// (o la impresión falla) usa la ventana del navegador. NO se intenta
// reconectar aquí: window.open debe ocurrir dentro del gesto del usuario o
// el navegador lo bloquea — la reconexión se hace al abrir el panel/Ajustes.
export function printReceipt(data) {
  if (isPrinterConnected()) {
    const text = buildReceiptText(data, getPaperCols())
    printRaw(text).catch(err => {
      console.warn('[Impresión] Bluetooth falló — usando ventana de impresión:', err?.message)
      const opened = printReceiptWindow(data, true)
      if (!opened) {
        alert(`⚠ No se pudo imprimir por Bluetooth (${err?.message || 'error desconocido'}).\nHabilita las ventanas emergentes para imprimir desde el navegador.`)
      }
    })
    return true
  }
  return printReceiptWindow(data)
}
