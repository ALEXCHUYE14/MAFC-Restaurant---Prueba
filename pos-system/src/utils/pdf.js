import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatPEN } from './currency'
import { formatFullDate, tsToDate } from './dates'
import { getBusiness } from '../services/businessConfig'

// jsPDF usa fuentes estándar (Latin-1): un emoji o carácter fuera de ese rango
// saldría como basura en el PDF. Los datos del negocio (editables en Ajustes) se limpian.
const pdfSafe = s => Array.from(String(s ?? '')).filter(ch => { const c = ch.codePointAt(0); return (c >= 32 && c <= 126) || (c >= 160 && c <= 255) }).join('')
const bizName = () => pdfSafe(getBusiness().nombre)
const bizAddr = () => pdfSafe(getBusiness().direccion)

// Reporte formal: franjas de las tarjetas y todos los montos en negro
const BLACK = [0, 0, 0]

// Carga el logo como DataURL para incrustar en el PDF
async function loadLogoDataUrl() {
  try {
    const resp = await fetch('/img/logo/logo.png')
    if (!resp.ok) return null
    const blob = await resp.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

// override (opcional): totales confirmados por el servidor al cerrar el turno
// { totalRevenue, count, totalExpenses, note } — reemplazan los de las tarjetas.
export async function generateDailySalesReport(sales, date = new Date(), expenses = [], override = null) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

  const ov           = override && typeof override === 'object' ? override : null
  const totalRevenue = ov && Number.isFinite(Number(ov.totalRevenue)) ? Number(ov.totalRevenue) : sales.reduce((s, o) => s + (o.total || 0), 0)
  const salesCount   = ov && Number.isFinite(Number(ov.count)) ? Number(ov.count) : sales.length
  // Un pedido 'mixto' (pago dividido — ver migracion-pago-mixto.sql) reparte su
  // monto entre los métodos reales de payment_breakdown en vez de sumarlo entero
  // a un bucket genérico "mixto" — el reporte sigue mostrando cuánto entró de
  // verdad en efectivo/yape/tarjeta/plin, que es lo que le importa al dueño.
  const byPayment = sales.reduce((acc, o) => {
    const breakdown = Array.isArray(o.payment_breakdown) ? o.payment_breakdown : null
    if (breakdown && breakdown.length) {
      for (const leg of breakdown) acc[leg.metodo] = (acc[leg.metodo] || 0) + (Number(leg.monto) || 0)
    } else {
      const pm = o.payment_method || o.paymentMethod || 'efectivo'
      acc[pm] = (acc[pm] || 0) + (o.total || 0)
    }
    return acc
  }, {})
  // Cuenta un pedido en cada método que realmente usó (uno solo, o varios si fue mixto).
  const countForMethod = pm => sales.filter(s => {
    const breakdown = Array.isArray(s.payment_breakdown) ? s.payment_breakdown : null
    if (breakdown && breakdown.length) return breakdown.some(leg => leg.metodo === pm)
    return (s.payment_method || s.paymentMethod || 'efectivo') === pm
  }).length
  // Egresos del día — protegido contra monto null/undefined/NaN
  const safeExpenses = Array.isArray(expenses) ? expenses : []
  const totalExpenses = ov && Number.isFinite(Number(ov.totalExpenses)) ? Number(ov.totalExpenses) : safeExpenses.reduce((s, e) => s + (Number(e?.monto) || 0), 0)
  const netoDia       = totalRevenue - totalExpenses
  // Envases descartables cobrados (migracion-envases.sql) — ya están dentro
  // del total de cada pedido; aquí solo se informa cuánto corresponde a envases.
  const packCount = sales.reduce((s, o) => s + (Number(o.packaging_count) || 0), 0)
  const packTotal = Math.round(sales.reduce((s, o) => s + Math.round((Number(o.packaging_total) || 0) * 100), 0)) / 100

  const pageW    = 210
  const margin   = 16
  const contentW = pageW - margin * 2

  // ── Encabezado blanco (limpio, sin franja de color) ────
  doc.setFillColor(255, 255, 255)
  doc.rect(0, 0, pageW, 40, 'F')

  // Logo corporativo (carga asíncrona — si falla, se omite sin crashear)
  const logoDataUrl = await loadLogoDataUrl()
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin, 14, 22, 22)
  }

  // Nombre empresa (desplazado a la derecha del logo) — negro, look corporativo
  const textStartX = logoDataUrl ? margin + 26 : margin
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(20)
  doc.setFont('helvetica', 'bold')
  doc.text(bizName().toUpperCase(), textStartX, 24)

  doc.setTextColor(100, 116, 139)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text('REPORTE DE VENTAS DIARIAS' + (bizAddr() ? '  ·  ' + bizAddr() : ''), textStartX, 31)

  doc.setTextColor(71, 85, 105)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.text('FECHA', pageW - margin, 24, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(100, 116, 139)
  doc.text(formatFullDate(date), pageW - margin, 30, { align: 'right' })
  doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageW - margin, 36, { align: 'right' })

  // Línea divisoria amber
  doc.setDrawColor(217, 119, 6)
  doc.setLineWidth(0.4)
  doc.line(margin, 47, pageW - margin, 47)

  // ── Tarjetas de resumen ────────────────────────────────
  const cardY = 52
  const cardH = 26
  const gap   = 5
  const cardW = (contentW - gap * 2) / 3

  const metrics = [
    { label: 'TOTAL RECAUDADO', value: formatPEN(totalRevenue),                                   accent: BLACK },
    { label: 'N° PEDIDOS',      value: String(salesCount),                                        accent: BLACK },
    { label: 'PROMEDIO/PEDIDO', value: formatPEN(salesCount ? totalRevenue / salesCount : 0),     accent: BLACK },
  ]

  metrics.forEach((m, i) => {
    const x = margin + i * (cardW + gap)
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, cardY, cardW, cardH, 2, 2, 'FD')
    doc.setFillColor(...m.accent)
    doc.rect(x, cardY, cardW, 2.5, 'F')
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'bold')
    doc.text(m.label, x + cardW / 2, cardY + 10, { align: 'center' })
    doc.setTextColor(...m.accent)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(m.value, x + cardW / 2, cardY + 21, { align: 'center' })
  })

  // ── Segunda fila: Egresos y Neto del día ────────────────
  const card2Y = cardY + cardH + 6
  const card2H = 24
  const card2W = (contentW - gap) / 2

  const metrics2 = [
    { label: 'TOTAL EGRESOS',  value: formatPEN(totalExpenses), accent: BLACK },
    { label: 'NETO DEL DÍA',   value: formatPEN(netoDia),       accent: BLACK },
  ]

  metrics2.forEach((m, i) => {
    const x = margin + i * (card2W + gap)
    doc.setFillColor(248, 250, 252)
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.roundedRect(x, card2Y, card2W, card2H, 2, 2, 'FD')
    doc.setFillColor(...m.accent)
    doc.rect(x, card2Y, card2W, 2.5, 'F')
    doc.setTextColor(100, 116, 139)
    doc.setFontSize(6.5)
    doc.setFont('helvetica', 'bold')
    doc.text(m.label, x + card2W / 2, card2Y + 9, { align: 'center' })
    doc.setTextColor(...m.accent)
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.text(m.value, x + card2W / 2, card2Y + 19, { align: 'center' })
  })

  // Línea informativa de envases (solo si hubo)
  let afterCards = card2Y + card2H
  if (ov && ov.note) {
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(8)
    doc.setFont('helvetica', 'italic')
    const lines = doc.splitTextToSize(pdfSafe(ov.note), contentW)
    doc.text(lines, margin, afterCards + 6)
    afterCards += 4 + lines.length * 4
  }
  if (packCount > 0) {
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(8.5)
    doc.setFont('helvetica', 'normal')
    doc.text(
      `Incluye envases descartables: ${packCount} und.  ·  ${formatPEN(packTotal)}   (platos: ${formatPEN(Math.round((totalRevenue - packTotal) * 100) / 100)})`,
      margin, afterCards + 6,
    )
    afterCards += 6
  }

  // ── Sección: Métodos de pago ───────────────────────────
  const pmY = afterCards + 10
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('Métodos de Pago', margin, pmY)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(margin, pmY + 2, pageW - margin, pmY + 2)

  autoTable(doc, {
    startY: pmY + 5,
    margin: { left: margin, right: margin },
    head: [['Método de Pago', 'N° Transacciones', 'Monto Total']],
    body: Object.entries(byPayment).length
      ? Object.entries(byPayment).map(([pm, total]) => [
          pm.charAt(0).toUpperCase() + pm.slice(1),
          String(countForMethod(pm)),
          formatPEN(total),
        ])
      : [['Sin ventas', '0', formatPEN(0)]],
    styles: {
      font: 'helvetica', fontSize: 9,
      cellPadding: { top: 5, right: 8, bottom: 5, left: 8 },
      textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.2,
    },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    bodyStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'center' },
      2: { halign: 'right', fontStyle: 'bold', textColor: BLACK },
    },
  })

  // ── Sección: Egresos del día ────────────────────────────
  const expY = doc.lastAutoTable.finalY + 10
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`Egresos del Día (${safeExpenses.length})`, margin, expY)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(margin, expY + 2, pageW - margin, expY + 2)

  autoTable(doc, {
    startY: expY + 5,
    margin: { left: margin, right: margin },
    head: [['Concepto', 'Categoría', 'Método', 'Monto']],
    body: safeExpenses.length
      ? safeExpenses.map(e => [
          e?.concepto || '—',
          e?.categoria || 'Otros',
          e?.metodoPago ? e.metodoPago.charAt(0).toUpperCase() + e.metodoPago.slice(1) : '—',
          formatPEN(e?.monto),
        ])
      : [['Sin egresos registrados', '—', '—', formatPEN(0)]],
    styles: {
      font: 'helvetica', fontSize: 9,
      cellPadding: { top: 5, right: 8, bottom: 5, left: 8 },
      textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.2,
    },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    bodyStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { fontStyle: 'bold' },
      3: { halign: 'right', fontStyle: 'bold', textColor: BLACK },
    },
  })

  // ── Sección: Detalle de pedidos ────────────────────────
  const ordersY = doc.lastAutoTable.finalY + 10
  doc.setTextColor(30, 41, 59)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(`Detalle de Pedidos (${sales.length})`, margin, ordersY)
  doc.setDrawColor(226, 232, 240)
  doc.setLineWidth(0.3)
  doc.line(margin, ordersY + 2, pageW - margin, ordersY + 2)

  autoTable(doc, {
    startY: ordersY + 5,
    margin: { left: margin, right: margin },
    showHead: 'everyPage',
    head: [['Mesa / Zona', 'Mesero', 'Artículos', 'Pago', 'Total', 'Hora']],
    body: sales.length
      ? sales.map(o => {
          const mesaNum   = o.table_number ?? o.tableNumber ?? 0
          const mesaLabel = mesaNum > 0 ? `Mesa ${mesaNum}` : (o.zone || 'Externo')
          const pm        = o.payment_method || o.paymentMethod || 'efectivo'
          // Normalizar campos Supabase (snake_case) y legado (camelCase)
          const tsField   = o.paid_at || o.closed_at || o.closedAt || o.created_at || o.createdAt
          const d         = tsToDate(tsField)
          const horaStr   = d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })
          return [
            mesaLabel,
            o.waiter_name || o.waiterName || '–',
            (o.items || []).map(i => {
              const qty = i.qty ?? i.quantity ?? 1
              return `${qty}× ${i.item?.name || i.name || '?'}`
            }).join(', ').substring(0, 45),
            pm.charAt(0).toUpperCase() + pm.slice(1),
            formatPEN(o.total),
            horaStr,
          ]
        })
      : [['—', '—', 'Sin ventas registradas', '—', '—', '—']],
    styles: {
      font: 'helvetica', fontSize: 8,
      cellPadding: { top: 4, right: 5, bottom: 4, left: 5 },
      textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.2,
      overflow: 'linebreak',
    },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    bodyStyles: { fillColor: [255, 255, 255] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 22 },
      1: { cellWidth: 26 },
      4: { halign: 'right', fontStyle: 'bold', textColor: BLACK, cellWidth: 22 },
      5: { halign: 'center', cellWidth: 18 },
    },
  })

  // ── Pie de página por hoja ─────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pageH = doc.internal.pageSize.height
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.3)
    doc.line(margin, pageH - 14, pageW - margin, pageH - 14)
    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(148, 163, 184)
    doc.text(bizName() + (bizAddr() ? '  ·  ' + bizAddr() : ''), margin, pageH - 9)
    doc.text(
      `Página ${i} de ${pageCount}  ·  ${new Date().toLocaleDateString('es-PE')}`,
      pageW - margin, pageH - 9, { align: 'right' }
    )
  }

  doc.save(`reporte-ventas-${date.toISOString().split('T')[0]}.pdf`)
}

/* Reporte del DÍA (varios turnos) — consolidado + un resumen por turno.
   data = {
     dateLabel, consolidated: { total, count, avg, byMethod:{}, envasesCount,
       envasesTotal, egresos, neto, diferencias, anuladosCount, anuladosTotal },
     shifts: [{ label, horario, abrio, cerro, count, total, efectivo, egresos,
       esperado, contado, diferencia, envasesCount }],
     expenses: [{ concepto, categoria, monto, hora }],
     fileDate: 'YYYY-MM-DD',
   } */
export async function generateDayReport(data) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = 210, margin = 14, contentW = pageW - margin * 2
  const c = data?.consolidated || {}
  const money = v => formatPEN(Number(v) || 0)
  const opt = v => (v === null || v === undefined ? '—' : money(v))

  const logoDataUrl = await loadLogoDataUrl()
  if (logoDataUrl) doc.addImage(logoDataUrl, 'PNG', margin, 12, 20, 20)
  const tx = logoDataUrl ? margin + 24 : margin
  doc.setTextColor(0, 0, 0); doc.setFontSize(18); doc.setFont('helvetica', 'bold')
  doc.text(bizName().toUpperCase(), tx, 22)
  doc.setTextColor(100, 116, 139); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('REPORTE DEL DIA (TODOS LOS TURNOS)' + (bizAddr() ? '  ·  ' + bizAddr() : ''), tx, 28)
  doc.setTextColor(0, 0, 0); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(pdfSafe(data?.dateLabel || ''), pageW - margin, 22, { align: 'right' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(100, 116, 139)
  doc.text(`Generado: ${new Date().toLocaleString('es-PE')}`, pageW - margin, 28, { align: 'right' })
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4); doc.line(margin, 36, pageW - margin, 36)

  // Tarjetas del consolidado (franja y montos en negro)
  const cards = [
    ['TOTAL VENDIDO', money(c.total)], ['N° PEDIDOS', String(c.count || 0)], ['TICKET PROMEDIO', money(c.avg)],
    ['EGRESOS', money(c.egresos)], ['NETO DEL DIA', money(c.neto)], ['DIFERENCIAS ARQUEO', money(c.diferencias)],
  ]
  const cw = (contentW - 8) / 3, ch = 20
  cards.forEach(([label, value], i) => {
    const x = margin + (i % 3) * (cw + 4)
    const y = 41 + Math.floor(i / 3) * (ch + 4)
    doc.setFillColor(248, 250, 252); doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3)
    doc.roundedRect(x, y, cw, ch, 2, 2, 'FD')
    doc.setFillColor(...BLACK); doc.rect(x, y, cw, 2, 'F')
    doc.setTextColor(100, 116, 139); doc.setFontSize(6.5); doc.setFont('helvetica', 'bold')
    doc.text(label, x + cw / 2, y + 8, { align: 'center' })
    doc.setTextColor(...BLACK); doc.setFontSize(11.5)
    doc.text(value, x + cw / 2, y + 16, { align: 'center' })
  })
  let y = 41 + 2 * (ch + 4) + 4
  doc.setTextColor(0, 0, 0); doc.setFontSize(8.5); doc.setFont('helvetica', 'normal')
  const extras = []
  if (c.envasesCount > 0) extras.push(`Envases descartables: ${c.envasesCount} und. · ${money(c.envasesTotal)}`)
  if (c.anuladosCount > 0) extras.push(`Pedidos anulados: ${c.anuladosCount} · ${money(c.anuladosTotal)}`)
  if (c.descuentosCount > 0) extras.push(`Descuentos: ${c.descuentosCount} · ${money(c.descuentos)}`)
  if (extras.length) { doc.text(extras.join('     '), margin, y); y += 6 }

  const tableStyles = {
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [30, 41, 59], lineColor: [226, 232, 240], lineWidth: 0.2 },
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: margin, right: margin },
  }
  const section = title => {
    doc.setTextColor(30, 41, 59); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text(title, margin, y)
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(margin, y + 2, pageW - margin, y + 2)
  }

  // Por método de pago
  section('Ventas por Método de Pago')
  const methods = Object.entries(c.byMethod || {})
  autoTable(doc, {
    ...tableStyles, startY: y + 5,
    head: [['Método', 'Monto']],
    body: methods.length ? methods.map(([m, v]) => [pdfSafe(m.charAt(0).toUpperCase() + m.slice(1)), money(v)]) : [['Sin ventas', money(0)]],
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold', textColor: BLACK } },
  })
  y = doc.lastAutoTable.finalY + 10

  // Turnos
  section(`Turnos (${(data?.shifts || []).length})`)
  autoTable(doc, {
    ...tableStyles, startY: y + 5,
    head: [['Turno', 'Horario', 'Abrió / Cerró', 'Ped.', 'Ventas', 'Efectivo', 'Egresos', 'Esperado', 'Contado', 'Dif.']],
    body: (data?.shifts || []).length ? data.shifts.map(t => [
      pdfSafe(t.label), pdfSafe(t.horario), pdfSafe(`${t.abrio || '—'} / ${t.cerro || '—'}`), String(t.count || 0),
      money(t.total), money(t.efectivo), opt(t.egresos), opt(t.esperado), opt(t.contado), opt(t.diferencia),
    ]) : [['—', '—', 'Sin turnos', '0', money(0), money(0), '—', '—', '—', '—']],
    styles: { ...tableStyles.styles, fontSize: 7, cellPadding: 2 },
    columnStyles: {
      3: { halign: 'center' },
      4: { halign: 'right', fontStyle: 'bold', textColor: BLACK }, 5: { halign: 'right', textColor: BLACK },
      6: { halign: 'right', textColor: BLACK }, 7: { halign: 'right', textColor: BLACK },
      8: { halign: 'right', textColor: BLACK }, 9: { halign: 'right', fontStyle: 'bold', textColor: BLACK },
    },
  })
  y = doc.lastAutoTable.finalY + 10

  // Egresos del día
  const exps = Array.isArray(data?.expenses) ? data.expenses : []
  section(`Egresos del Día (${exps.length})`)
  autoTable(doc, {
    ...tableStyles, startY: y + 5,
    head: [['Hora', 'Concepto', 'Categoría', 'Monto']],
    body: exps.length ? exps.map(e => [pdfSafe(e.hora), pdfSafe(e.concepto || '—'), pdfSafe(e.categoria || 'Otros'), money(e.monto)])
      : [['—', 'Sin egresos', '—', money(0)]],
    columnStyles: { 3: { halign: 'right', fontStyle: 'bold', textColor: BLACK } },
  })

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    const pageH = doc.internal.pageSize.height
    doc.setDrawColor(226, 232, 240); doc.setLineWidth(0.3); doc.line(margin, pageH - 14, pageW - margin, pageH - 14)
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(148, 163, 184)
    doc.text(bizName(), margin, pageH - 9)
    doc.text(`Página ${i} de ${pageCount}`, pageW - margin, pageH - 9, { align: 'right' })
  }
  const fileDate = /^\d{4}-\d{2}-\d{2}$/.test(String(data?.fileDate || '')) ? data.fileDate : new Date().toISOString().slice(0, 10)
  doc.save(`reporte-dia-${fileDate}.pdf`)
}

export function generateOrderTicket(order) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 200] })

  doc.setFillColor(6, 8, 9)
  doc.rect(0, 0, 80, 200, 'F')
  doc.setTextColor(245, 166, 35)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(bizName().toUpperCase(), 40, 12, { align: 'center' })
  doc.setTextColor(136, 153, 187)
  doc.setFontSize(8)
  doc.text('━━━━━━━━━━━━━━━━━━━━━━━━━━━', 40, 17, { align: 'center' })
  doc.setTextColor(240, 244, 255)
  doc.text(`Mesa: ${order.tableNumber}  Mesero: ${order.waiterName}`, 8, 24)
  doc.text(`Pedido: #${order.id?.substring(0, 8).toUpperCase()}`, 8, 30)
  doc.text(`Hora: ${new Date(tsToDate(order.createdAt)).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}`, 8, 36)
  doc.setTextColor(136, 153, 187)
  doc.text('━━━━━━━━━━━━━━━━━━━━━━━━━━━', 40, 40, { align: 'center' })

  let y = 46
  ;(order.items || []).forEach(item => {
    doc.setTextColor(240, 244, 255)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text(`${item.quantity}× ${item.name}`, 8, y)
    doc.text(formatPEN(item.price * item.quantity), 72, y, { align: 'right' })
    if (item.notes) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7)
      doc.setTextColor(136, 153, 187)
      doc.text(`  → ${item.notes}`, 8, y + 4)
      y += 10
    } else {
      y += 7
    }
  })

  doc.setTextColor(136, 153, 187)
  doc.text('━━━━━━━━━━━━━━━━━━━━━━━━━━━', 40, y + 2, { align: 'center' })
  doc.setTextColor(245, 166, 35)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text('TOTAL', 8, y + 10)
  doc.text(formatPEN(order.total), 72, y + 10, { align: 'right' })
  if (order.paymentMethod) {
    doc.setFontSize(8)
    doc.setTextColor(46, 204, 113)
    doc.text(`Pago: ${order.paymentMethod}`, 8, y + 17)
  }

  doc.setFontSize(7)
  doc.setTextColor(74, 88, 112)
  doc.text('¡Gracias por su visita!', 40, y + 26, { align: 'center' })

  doc.save(`ticket-${order.id?.substring(0, 8)}.pdf`)
}
