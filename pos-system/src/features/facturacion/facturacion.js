/* ══════════════════════════════════════════════════════════════════
   FACTURACIÓN ELECTRÓNICA — cliente de la Edge Function `emitir-comprobante`
   ══════════════════════════════════════════════════════════════════
   El navegador NUNCA habla directo con MAFC Facturación ni conoce su API key:
   todo pasa por la Edge Function (ver supabase/functions/emitir-comprobante).

   Se activa por instalación con la variable de entorno:
     VITE_FACTURACION_ELECTRONICA=1   (en .env.local y en Vercel)
   Sin ella, el sistema funciona exactamente como antes.
   Lo usan la app del mesero (con su propio cliente de Supabase) y la Caja del
   panel admin — por eso cada función recibe el cliente `sb`.
   ══════════════════════════════════════════════════════════════════ */

export const FACTURACION_ACTIVA = String(import.meta.env.VITE_FACTURACION_ELECTRONICA || '') === '1'

const FUNCION = 'emitir-comprobante'

async function invocar(sb, body) {
  if (!sb) throw new Error('Sin conexión con el sistema')
  let timer
  try {
    const { data, error } = await Promise.race([
      sb.functions.invoke(FUNCION, { body }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('El servicio de facturación no respondió (revisa internet).')), 35000) }),
    ])
    if (error) {
      // FunctionsHttpError: el mensaje real viene en el cuerpo de la respuesta
      let mensaje = error.message
      try {
        const cuerpo = await error.context?.json?.()
        if (cuerpo?.mensaje) mensaje = cuerpo.mensaje
      } catch (_) { /* sin cuerpo */ }
      if (/Failed to send a request|FunctionsFetchError/i.test(mensaje)) {
        mensaje = 'No se pudo llamar a la función de facturación (¿está desplegada?).'
      } else if (/not found|404/i.test(mensaje) && !/pedido/i.test(mensaje)) {
        mensaje = 'Falta desplegar la función "emitir-comprobante" en Supabase.'
      }
      throw new Error(mensaje)
    }
    if (!data?.ok) throw new Error(data?.mensaje || 'No se pudo emitir el comprobante')
    return data
  } finally {
    clearTimeout(timer)
  }
}

/** Emite boleta o factura de un pedido cobrado. Si ya tenía, devuelve el mismo. */
export async function emitirComprobante(sb, { orderId, tipo, cliente, emitidoPor }) {
  const data = await invocar(sb, {
    accion: 'emitir',
    order_id: orderId,
    tipo,
    cliente: cliente && (cliente.numero || cliente.razon_social) ? cliente : null,
    emitido_por: emitidoPor || null,
  })
  return data.comprobante
}

/** Pide a MAFC Facturación el estado actual en SUNAT y lo guarda. */
export async function consultarComprobante(sb, orderId) {
  const data = await invocar(sb, { accion: 'consultar', order_id: orderId })
  return data.comprobante
}

/** Comprobante ya emitido de un pedido (o null). Lee la tabla, sin llamar a la API. */
export async function obtenerComprobante(sb, orderId) {
  if (!sb || !orderId) return null
  const { data, error } = await sb.from('comprobantes_electronicos').select('*').eq('order_id', orderId).maybeSingle()
  if (error) return null // migración aún no ejecutada: se comporta como "sin comprobante"
  return data
}

/** Comprobantes de varios pedidos → { [order_id]: comprobante } */
export async function obtenerComprobantes(sb, orderIds) {
  const ids = [...new Set((orderIds || []).filter(Boolean))]
  if (!sb || !ids.length) return {}
  const out = {}
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb
      .from('comprobantes_electronicos')
      .select('order_id, numero, tipo_doc, estado, enlace_ticket, enlace_pdf')
      .in('order_id', ids.slice(i, i + 100))
    if (error) return out
    for (const c of data || []) out[c.order_id] = c
  }
  return out
}

export const NOMBRE_TIPO = { '01': 'Factura', '03': 'Boleta' }

export const ESTADOS = {
  pendiente: { label: 'Enviando a SUNAT', color: '#D97706' },
  aceptado:  { label: 'Aceptado por SUNAT', color: '#059669' },
  observado: { label: 'Aceptado con observaciones', color: '#059669' },
  rechazado: { label: 'Rechazado por SUNAT', color: '#DC2626' },
  error:     { label: 'Error al enviar', color: '#DC2626' },
  anulado:   { label: 'Anulado', color: '#64748B' },
}

/** Mensaje para WhatsApp con el enlace al PDF. */
export function enlaceWhatsapp(comprobante, celular = '') {
  const tipo = NOMBRE_TIPO[comprobante.tipo_doc] || 'Comprobante'
  const texto = `${tipo} electrónica ${comprobante.numero} · S/ ${Number(comprobante.total || 0).toFixed(2)}\n${comprobante.enlace_pdf || ''}`
  const num = String(celular || '').replace(/\D/g, '')
  const destino = /^9\d{8}$/.test(num) ? `51${num}` : ''
  return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`
}
