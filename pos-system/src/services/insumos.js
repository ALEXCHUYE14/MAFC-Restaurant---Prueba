import { supabase } from '@/services/supabase'

/* ══════════════════════════════════════════════════════════════════
   INSUMOS — despensa de la cocina (limón, papa, aceite, pollo…)
   ══════════════════════════════════════════════════════════════════
   Tablas propias (migracion-insumos.sql), separadas de los productos de
   venta: nada de aquí aparece en el POS, la carta ni el mesero.
   Las sumas/restas de stock las hace la base de datos (funciones
   insumo_*), así una compra y un conteo al mismo tiempo nunca se pisan.
   Si la migración no se ejecutó, list() devuelve { missing: true } y la
   app simplemente lo avisa — nada se rompe.
   ══════════════════════════════════════════════════════════════════ */

export const INSUMO_UNITS = [
  { value: 'kg',      label: 'kg (kilos)' },
  { value: 'g',       label: 'g (gramos)' },
  { value: 'L',       label: 'L (litros)' },
  { value: 'mL',      label: 'mL (mililitros)' },
  { value: 'unid.',   label: 'unidades' },
  { value: 'docena',  label: 'docenas' },
  { value: 'atado',   label: 'atados' },
  { value: 'saco',    label: 'sacos' },
  { value: 'caja',    label: 'cajas' },
  { value: 'paquete', label: 'paquetes' },
  { value: 'balón',   label: 'balones (gas)' },
]

export const INSUMO_CATEGORIES = ['Verduras', 'Frutas', 'Carnes', 'Pescados y mariscos', 'Abarrotes', 'Lácteos', 'Bebidas', 'Limpieza', 'Gas y otros']

export const MOV_TYPES = {
  inicial:   { label: 'Stock inicial', color: 'var(--fog)' },
  compra:    { label: 'Compra',        color: '#16A34A' },
  conteo:    { label: 'Conteo',        color: '#2563EB' },
  consumo:   { label: 'Uso',           color: '#D97706' },
  merma:     { label: 'Merma',         color: '#DC2626' },
  anulacion: { label: 'Compra anulada', color: '#DC2626' },
}

// Cantidades con hasta 3 decimales, sin ceros de sobra: 1.5 · 0.25 · 12
export function fmtQty(n) {
  const v = Number(n)
  if (!isFinite(v)) return '—'
  return v.toLocaleString('es-PE', { maximumFractionDigits: 3 })
}

function isMissingTable(error, name) {
  if (!error) return false
  const msg = String(error.message || error.details || '')
  return error.code === '42P01' || error.code === 'PGRST205' || new RegExp(name, 'i').test(msg) && /does not exist|could not find|schema cache/i.test(msg)
}
function isMissingFn(error) {
  if (!error) return false
  const msg = String(error.message || error.details || '')
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(msg)
}

// Mensajes claros para los errores que lanzan las funciones SQL
function friendly(error) {
  const msg = String(error?.message || '')
  if (/NOT_ALLOWED/.test(msg))       return new Error('Solo el administrador puede hacer esto.')
  if (/QTY_INVALID/.test(msg))       return new Error('La cantidad debe ser mayor a 0.')
  if (/AMOUNT_INVALID/.test(msg))    return new Error('El monto no es válido.')
  if (/INSUMO_NOT_FOUND/.test(msg))  return new Error('Ese insumo ya no existe. Actualiza la lista.')
  if (/insumos_nombre_uq|duplicate key/i.test(msg)) return new Error('Ya existe un insumo con ese nombre.')
  if (isMissingFn(error) || isMissingTable(error, 'insumo')) return new Error('Falta ejecutar migracion-insumos.sql en Supabase.')
  return error instanceof Error ? error : new Error(msg || 'No se pudo completar la operación.')
}

function mapInsumo(r) {
  return {
    id:           r.id,
    nombre:       r.nombre,
    categoria:    r.categoria || '',
    unidad:       r.unidad || 'kg',
    stock:        Number(r.stock) || 0,
    minimo:       r.minimo != null ? Number(r.minimo) : null,
    costoUnit:    r.costo_unit != null ? Number(r.costo_unit) : null,
    activo:       r.activo !== false,
    ultimoConteo: r.ultimo_conteo || null,
    createdAt:    r.created_at,
  }
}

function mapMov(r) {
  return {
    id:         r.id,
    insumoId:   r.insumo_id,
    nombre:     r.insumo_nombre,
    unidad:     r.unidad,
    tipo:       r.tipo,
    cambio:     Number(r.cambio) || 0,
    antes:      r.antes != null ? Number(r.antes) : null,
    despues:    r.despues != null ? Number(r.despues) : null,
    costoUnit:  r.costo_unit != null ? Number(r.costo_unit) : null,
    monto:      r.monto != null ? Number(r.monto) : null,
    egresoId:   r.egreso_id || null,
    nota:       r.nota || '',
    actorName:  r.actor_name || '',
    createdAt:  r.created_at,
  }
}

function sb() {
  if (!supabase) throw new Error('Sin conexión con la base de datos.')
  return supabase
}

export const InsumosDB = {
  // { rows, missing }
  async list() {
    if (!supabase) return { rows: [], missing: false }
    const { data, error } = await supabase.from('insumos').select('*').order('nombre')
    if (error) {
      if (isMissingTable(error, 'insumos')) return { rows: [], missing: true }
      throw friendly(error)
    }
    return { rows: (data || []).map(mapInsumo), missing: false }
  },

  async create({ nombre, categoria, unidad, minimo, stockInicial }) {
    const { data, error } = await sb().from('insumos').insert({
      nombre: nombre.trim(),
      categoria: (categoria || '').trim() || null,
      unidad,
      minimo: minimo ?? null,
    }).select().single()
    if (error) throw friendly(error)
    // El stock inicial se carga como un conteo (queda registrado en el historial)
    if (stockInicial != null && stockInicial > 0) {
      await this.conteoLote([{ id: data.id, queda: stockInicial, nota: 'Stock inicial' }])
    }
    return mapInsumo(data)
  },

  // Solo datos descriptivos — el stock NUNCA se edita directo (va por conteo/compra/uso)
  async update(id, { nombre, categoria, unidad, minimo, activo }) {
    const payload = { updated_at: new Date().toISOString() }
    if (nombre !== undefined)    payload.nombre = nombre.trim()
    if (categoria !== undefined) payload.categoria = (categoria || '').trim() || null
    if (unidad !== undefined)    payload.unidad = unidad
    if (minimo !== undefined)    payload.minimo = minimo
    if (activo !== undefined)    payload.activo = activo
    const { error } = await sb().from('insumos').update(payload).eq('id', id)
    if (error) throw friendly(error)
  },

  // Borra el insumo y TODO su historial (solo para insumos creados por error)
  async remove(id) {
    const { error } = await sb().from('insumos').delete().eq('id', id)
    if (error) throw friendly(error)
  },

  async entrada(id, cantidad, monto = null, egresoId = null, nota = null) {
    const { data, error } = await sb().rpc('insumo_entrada', {
      p_id: id, p_cantidad: cantidad, p_monto: monto, p_egreso_id: egresoId, p_nota: nota,
    })
    if (error) throw friendly(error)
    return data
  },

  async salida(id, cantidad, tipo = 'consumo', nota = null) {
    const { data, error } = await sb().rpc('insumo_salida', {
      p_id: id, p_cantidad: cantidad, p_tipo: tipo, p_nota: nota,
    })
    if (error) throw friendly(error)
    return data
  },

  // items: [{ id, queda, nota }]
  async conteoLote(items) {
    const clean = (items || [])
      .filter(i => i && i.id && isFinite(Number(i.queda)) && Number(i.queda) >= 0)
      .map(i => ({ id: i.id, queda: String(Math.round(Number(i.queda) * 1000) / 1000), nota: i.nota || null }))
    if (!clean.length) return []
    const { data, error } = await sb().rpc('insumo_conteo_lote', { p_items: clean })
    if (error) throw friendly(error)
    return data || []
  },

  // Best-effort: si se elimina una compra, resta lo que había sumado.
  // Nunca lanza error (si la migración no existe o no había insumo, no hace nada).
  async revertirCompra(egresoId) {
    if (!supabase || !egresoId) return 0
    try {
      const { data, error } = await supabase.rpc('insumo_revertir_compra', { p_egreso_id: egresoId })
      if (error) { if (!isMissingFn(error)) console.warn('[Insumos] revertir compra:', error.message); return 0 }
      return Number(data) || 0
    } catch (e) {
      console.warn('[Insumos] revertir compra:', e?.message)
      return 0
    }
  },

  // { rows, missing } — desde/hasta: ISO strings opcionales
  async movimientos({ desde = null, hasta = null, insumoId = null, limit = 2000 } = {}) {
    if (!supabase) return { rows: [], missing: false }
    let q = supabase.from('insumo_movimientos').select('*').order('created_at', { ascending: false }).limit(limit)
    if (desde)    q = q.gte('created_at', desde)
    if (hasta)    q = q.lt('created_at', hasta)
    if (insumoId) q = q.eq('insumo_id', insumoId)
    const { data, error } = await q
    if (error) {
      if (isMissingTable(error, 'insumo_movimientos')) return { rows: [], missing: true }
      throw friendly(error)
    }
    return { rows: (data || []).map(mapMov), missing: false }
  },
}
