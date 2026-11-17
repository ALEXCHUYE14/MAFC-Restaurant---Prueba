// Convierte un pedido de MAFC Restaurant en las líneas del comprobante.
// Sin dependencias de Deno: se puede probar en Node.
//
// Regla de oro: la suma de las líneas debe ser EXACTAMENTE el total cobrado
// (orders.total = platos + envases − descuento, calculado por la base de datos).

export interface PedidoItem {
  name?: string
  price?: number | string
  qty?: number | string
  quantity?: number | string
  variantLabel?: string | null
  portionTag?: string | null
  cortesia?: boolean
}

export interface Pedido {
  items: PedidoItem[] | null
  total: number | string
  packaging_count?: number | null
  packaging_total?: number | string | null
  descuento_monto?: number | string | null
}

export interface LineaComprobante {
  descripcion: string
  cantidad: number
  precio_unitario: number
}

const num = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

interface Linea { descripcion: string; cantidad: number; centimos: number; esPlato: boolean }

export function armarLineas(pedido: Pedido): LineaComprobante[] {
  const lineas: Linea[] = []

  for (const it of Array.isArray(pedido.items) ? pedido.items : []) {
    const cantidad = num(it.qty ?? it.quantity)
    const precio = num(it.price)
    if (cantidad <= 0 || precio <= 0 || it.cortesia) continue // cortesías y precio 0 no se facturan

    let descripcion = String(it.name || 'Producto').trim()
    const variante = it.variantLabel || it.portionTag
    if (variante && !descripcion.toLowerCase().includes(String(variante).toLowerCase())) {
      descripcion += ` (${variante})`
    }
    lineas.push({ descripcion: descripcion.slice(0, 250), cantidad, centimos: Math.round(cantidad * precio * 100), esPlato: true })
  }

  const envases = Math.round(num(pedido.packaging_total) * 100)
  if (envases > 0) {
    const cant = Math.max(1, Math.round(num(pedido.packaging_count)))
    lineas.push({ descripcion: 'Envase descartable', cantidad: cant, centimos: envases, esPlato: false })
  }

  if (!lineas.length) throw new Error('El pedido no tiene productos con precio para facturar.')

  // Descuento: se reparte entre los platos en proporción a su importe
  // (nunca sobre envases, igual que en la base de datos).
  const descuento = Math.round(num(pedido.descuento_monto) * 100)
  if (descuento > 0) {
    const platos = lineas.filter(l => l.esPlato)
    const totalPlatos = platos.reduce((s, l) => s + l.centimos, 0)
    if (totalPlatos > 0) {
      const restante = Math.max(0, totalPlatos - descuento)
      let asignado = 0
      for (const l of platos) {
        l.centimos = Math.floor((l.centimos * restante) / totalPlatos)
        asignado += l.centimos
      }
      // los céntimos que sobran por redondeo van a la línea más grande
      const mayor = platos.reduce((a, b) => (b.centimos > a.centimos ? b : a))
      mayor.centimos += restante - asignado
    }
  }

  const objetivo = Math.round(num(pedido.total) * 100)
  const suma = lineas.reduce((s, l) => s + l.centimos, 0)
  const diferencia = objetivo - suma
  if (diferencia !== 0) {
    // Diferencias de 1–5 céntimos por redondeos se ajustan; más que eso es un dato inconsistente.
    if (Math.abs(diferencia) > 5) {
      throw new Error(`Los productos suman S/ ${(suma / 100).toFixed(2)} pero el total cobrado es S/ ${(objetivo / 100).toFixed(2)}.`)
    }
    const mayor = lineas.reduce((a, b) => (b.centimos > a.centimos ? b : a))
    mayor.centimos += diferencia
  }

  const resultado: LineaComprobante[] = []
  for (const l of lineas) {
    if (l.centimos <= 0) continue // un plato con descuento del 100 %
    const importe = l.centimos / 100
    const pu = Math.round((importe / l.cantidad) * 10000) / 10000
    // MAFC Facturación calcula round(cantidad × precio, 2): debe volver a dar el importe exacto
    if (Math.round(l.cantidad * pu * 100) === l.centimos) {
      resultado.push({ descripcion: l.descripcion, cantidad: l.cantidad, precio_unitario: pu })
    } else {
      resultado.push({ descripcion: `${l.cantidad} x ${l.descripcion}`.slice(0, 250), cantidad: 1, precio_unitario: importe })
    }
  }

  if (!resultado.length) throw new Error('El pedido no tiene importe para facturar.')
  return resultado
}

/** Datos del cliente según el tipo de comprobante (reglas SUNAT básicas). */
export function validarCliente(
  tipo: 'boleta' | 'factura',
  cliente: { numero?: string; razon_social?: string; email?: string } | null | undefined,
  total: number,
): { tipo_doc: string; numero: string; razon_social: string; email?: string } | null {
  const numero = String(cliente?.numero ?? '').replace(/\D/g, '')
  const nombre = String(cliente?.razon_social ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
  const email = String(cliente?.email ?? '').trim() || undefined

  if (tipo === 'factura') {
    if (!/^(10|15|16|17|20)\d{9}$/.test(numero)) throw new Error('La factura necesita un RUC válido de 11 dígitos.')
    if (nombre.length < 3) throw new Error('Escribe la razón social del cliente.')
    return { tipo_doc: '6', numero, razon_social: nombre, email }
  }

  if (!numero) {
    // SUNAT: boletas desde S/ 700 deben identificar al cliente
    if (total >= 700) throw new Error('Desde S/ 700 la boleta debe llevar el DNI y nombre del cliente.')
    return null // la API la emite a "CLIENTES VARIOS"
  }
  if (/^\d{8}$/.test(numero)) {
    if (nombre.length < 3) throw new Error('Escribe el nombre del cliente del DNI.')
    return { tipo_doc: '1', numero, razon_social: nombre, email }
  }
  if (/^(10|15|16|17|20)\d{9}$/.test(numero)) {
    if (nombre.length < 3) throw new Error('Escribe la razón social del cliente.')
    return { tipo_doc: '6', numero, razon_social: nombre, email }
  }
  throw new Error('El documento debe ser un DNI (8 dígitos) o un RUC (11 dígitos).')
}
