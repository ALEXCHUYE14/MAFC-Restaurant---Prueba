// ══════════════════════════════════════════════════════════════════
// Edge Function: emitir-comprobante
// MAFC Restaurant  ──>  MAFC Facturación  ──>  SUNAT
// ══════════════════════════════════════════════════════════════════
// POST { accion: 'emitir', order_id, tipo: 'boleta'|'factura', cliente?: { numero, razon_social, email } }
// POST { accion: 'consultar', order_id }          → actualiza el estado SUNAT
//
// Por qué una Edge Function (y no llamar a la API desde el navegador):
//   · La API key de MAFC Facturación es un SECRETO: con ella se emiten
//     comprobantes a nombre del restaurante. Aquí vive como variable secreta.
//   · Los montos se leen del pedido en la BASE DE DATOS, nunca del navegador.
//   · Solo se factura un pedido COBRADO, una sola vez (único por pedido).
//
// Secretos (Supabase → Edge Functions → Secrets):
//   MAFC_API_URL        https://xxxx.trycloudflare.com/api/v1   (o el dominio del VPS)
//   MAFC_API_KEY        la key que da `php artisan mafc:api-key {ruc} mafc-restaurant`
//   MAFC_SERIE_BOLETA   B001   (opcional)
//   MAFC_SERIE_FACTURA  F001   (opcional)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya existen en toda Edge Function.
// ══════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2'
import { armarLineas, validarCliente } from './items.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Plazo para emitir desde el cobro (las boletas se informan a SUNAT en pocos días).
const DIAS_MAXIMOS = 3

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const falla = (mensaje: string, status = 422) => json({ ok: false, mensaje }, status)

const env = (k: string, def = '') => (Deno.env.get(k) ?? def).trim()

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return falla('Método no permitido', 405)

  const apiUrl = env('MAFC_API_URL').replace(/\/+$/, '')
  const apiKey = env('MAFC_API_KEY')
  if (!apiUrl || !apiKey) {
    return falla('Falta configurar MAFC_API_URL y MAFC_API_KEY en los secretos de la Edge Function.', 500)
  }

  let body: Record<string, any>
  try { body = await req.json() } catch { return falla('Petición inválida') }

  const orderId = String(body.order_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return falla('Pedido inválido')

  try {
    if (body.accion === 'consultar') return await consultar(orderId, apiUrl, apiKey)
    return await emitir(orderId, body, apiUrl, apiKey)
  } catch (e) {
    console.error('emitir-comprobante:', e)
    return falla(e instanceof Error ? e.message : 'Error inesperado', 500)
  }
})

async function emitir(orderId: string, body: Record<string, any>, apiUrl: string, apiKey: string) {
  // ¿Ya tiene comprobante? → se devuelve el mismo (doble clic, reintento, otra pestaña)
  const { data: existente } = await db.from('comprobantes_electronicos').select('*').eq('order_id', orderId).maybeSingle()
  if (existente) return json({ ok: true, comprobante: existente, ya_existia: true })

  const { data: pedido, error } = await db
    .from('orders')
    .select('id, status, total, items, paid_at, packaging_count, packaging_total, descuento_monto, waiter_name')
    .eq('id', orderId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el pedido: ${error.message}`)
  if (!pedido) return falla('El pedido no existe.', 404)

  if (!pedido.paid_at || String(pedido.status) === 'anulado') {
    return falla('Solo se emite comprobante de un pedido cobrado.', 409)
  }
  const dias = (Date.now() - new Date(pedido.paid_at).getTime()) / 86_400_000
  if (dias > DIAS_MAXIMOS) {
    return falla(`El pedido se cobró hace más de ${DIAS_MAXIMOS} días; emite el comprobante desde MAFC Facturación.`, 409)
  }

  const tipo = body.tipo === 'factura' ? 'factura' : 'boleta'
  const total = Number(pedido.total) || 0
  if (total <= 0) return falla('El pedido no tiene monto para facturar.')

  let cliente, items
  try {
    cliente = validarCliente(tipo, body.cliente, total)
    items = armarLineas(pedido)
  } catch (e) {
    return falla(e instanceof Error ? e.message : String(e))
  }

  const payload: Record<string, unknown> = {
    tipo_doc: tipo === 'factura' ? '01' : '03',
    serie: tipo === 'factura' ? env('MAFC_SERIE_FACTURA', 'F001') : env('MAFC_SERIE_BOLETA', 'B001'),
    moneda: 'PEN',
    items,
  }
  if (cliente) payload.cliente = cliente

  const r = await llamarApi(`${apiUrl}/comprobantes`, apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `orden-${orderId}` },
    body: JSON.stringify(payload),
  })
  if (!r.ok) return falla(r.mensaje, r.status >= 500 ? 502 : 422)

  const c = r.data
  if (Math.round(Number(c?.totales?.total) * 100) !== Math.round(total * 100)) {
    console.warn(`Total distinto: pedido ${total} · comprobante ${c?.totales?.total}`)
  }

  const fila = {
    order_id: orderId,
    api_id: c.id,
    tipo_doc: c.tipo_doc,
    numero: c.numero,
    estado: c.estado,
    sunat_codigo: c.sunat?.codigo ?? null,
    sunat_descripcion: c.sunat?.descripcion ?? null,
    cliente_tipo_doc: c.cliente?.tipo_doc ?? null,
    cliente_numero: c.cliente?.numero ?? null,
    cliente_nombre: c.cliente?.razon_social ?? null,
    total: c.totales?.total ?? total,
    hash: c.hash ?? null,
    qr: c.qr ?? null,
    enlace_pdf: c.publico?.pdf ?? null,
    enlace_ticket: c.publico?.ticket ?? null,
    enlaces_vencen: c.publico?.vence ? new Date(c.publico.vence.replace(' ', 'T') + '-05:00').toISOString() : null,
    emitido_por: String(body.emitido_por ?? pedido.waiter_name ?? '').slice(0, 80) || null,
  }

  const { data: guardado, error: errGuardar } = await db
    .from('comprobantes_electronicos')
    .upsert(fila, { onConflict: 'order_id' })
    .select('*')
    .single()
  if (errGuardar) {
    // El comprobante YA existe en SUNAT/MAFC: se devuelve igual para poder imprimirlo.
    console.error('No se guardó en comprobantes_electronicos:', errGuardar.message)
    return json({ ok: true, comprobante: fila, aviso: 'Emitido, pero no se guardó en la base del restaurante.' })
  }

  return json({ ok: true, comprobante: guardado })
}

async function consultar(orderId: string, apiUrl: string, apiKey: string) {
  const { data: fila } = await db.from('comprobantes_electronicos').select('*').eq('order_id', orderId).maybeSingle()
  if (!fila) return json({ ok: true, comprobante: null })

  const r = await llamarApi(`${apiUrl}/comprobantes/${fila.api_id}`, apiKey, { method: 'GET' })
  if (!r.ok) return json({ ok: true, comprobante: fila, aviso: r.mensaje })

  const c = r.data
  const { data: actualizado } = await db
    .from('comprobantes_electronicos')
    .update({
      estado: c.estado,
      sunat_codigo: c.sunat?.codigo ?? null,
      sunat_descripcion: c.sunat?.descripcion ?? null,
      enlace_pdf: c.publico?.pdf ?? fila.enlace_pdf,
      enlace_ticket: c.publico?.ticket ?? fila.enlace_ticket,
      updated_at: new Date().toISOString(),
    })
    .eq('id', fila.id)
    .select('*')
    .single()

  return json({ ok: true, comprobante: actualizado ?? fila })
}

async function llamarApi(url: string, apiKey: string, init: RequestInit) {
  let res: Response
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(25_000),
    })
  } catch {
    return { ok: false as const, status: 503, mensaje: 'No se pudo conectar con el servicio de facturación. Revisa que MAFC Facturación esté encendido.', data: null }
  }

  let data: any = null
  try { data = await res.json() } catch { /* respuesta sin JSON */ }

  if (res.ok) return { ok: true as const, status: res.status, mensaje: '', data }

  const errores = data?.errors ? Object.values(data.errors).flat().join(' ') : ''
  const mensaje = errores || data?.mensaje || data?.message ||
    (res.status === 401 ? 'La API key de facturación no es válida.' : `Facturación respondió ${res.status}.`)
  return { ok: false as const, status: res.status, mensaje, data }
}
