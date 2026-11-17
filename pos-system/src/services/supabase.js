import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY } from '@/config/supabaseConfig'
import { defaultZoneOf } from '@/data/zones'
import { normalizeVariants } from '@/utils/variants'

// ── Env ───────────────────────────────────────────────────────────────────────
// DEMO_MODE deshabilitado: siempre usar Supabase real.
export const DEMO_MODE = false

// Credenciales: centralizadas en src/config/supabaseConfig.js (única fuente de verdad).

// ── Cliente Supabase ──────────────────────────────────────────────────────────
export let supabase = null

if (!DEMO_MODE) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
  } catch (e) {
    console.warn('[Supabase] Error al inicializar cliente:', e.message)
    supabase = null
  }
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function loginWithEmail(email, password) {
  if (!supabase) {
    throw new Error('Supabase no está inicializado. Contacta al administrador del sistema.')
  }

  let authResult
  try {
    // Timeout de 12 s: si Supabase no responde, el botón "Verificando" no queda atascado.
    const authPromise = supabase.auth.signInWithPassword({ email, password })
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 12000)
    )
    authResult = await Promise.race([authPromise, timeoutPromise])
  } catch (err) {
    if (err.message === 'timeout') {
      throw new Error('El servidor tardó demasiado en responder. Verifica tu internet e inténtalo de nuevo.')
    }
    console.error('[Auth] Error de red:', err)
    throw new Error('No se puede conectar con el servidor. Verifica tu conexión a internet e inténtalo de nuevo.')
  }

  const { data: auth, error: authErr } = authResult

  if (authErr) {
    console.error('[Auth] Error Supabase:', authErr.message, authErr)
    const msg = authErr.message || ''
    if (msg === 'Failed to fetch' || msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network')) {
      throw new Error('Error de conexión con Supabase. Verifica tu internet o que el proyecto Supabase esté activo.')
    }
    if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('credentials') || msg === 'Invalid login credentials') {
      throw new Error('Correo o contraseña incorrectos. Verifica tus credenciales.')
    }
    throw new Error(msg || 'Error al iniciar sesión.')
  }

  if (!auth?.user) {
    throw new Error('No se recibieron datos de usuario. Inténtalo de nuevo.')
  }

  const { data: profile, error: profileErr } = await supabase
    .from('users')
    .select('*')
    .eq('id', auth.user.id)
    .single()

  if (profileErr) {
    console.error('[Auth] Error perfil:', profileErr.message, profileErr)
    if (profileErr.code === 'PGRST116') {
      throw new Error('Perfil no encontrado en la base de datos. Ejecuta el SQL de inserción de usuario en Supabase.')
    }
    throw new Error('Error al cargar el perfil: ' + profileErr.message)
  }

  if (!profile) {
    throw new Error('Perfil de usuario no encontrado. Ejecuta el SQL de inserción en Supabase.')
  }

  if (profile.role !== 'admin') {
    await supabase.auth.signOut()
    throw new Error('Acceso denegado — este usuario no tiene rol de Administrador.')
  }

  return { uid: profile.id, ...profile }
}

export async function signOut() {
  if (DEMO_MODE || !supabase) return
  await supabase.auth.signOut()
}

export function subscribeAuth(callback) {
  if (DEMO_MODE || !supabase) {
    callback(null)
    return () => {}
  }

  // ── Paso 1: Inicialización con getSession() ───────────────────────────────
  // Lee la sesión desde localStorage (sin red si el token no expiró).
  // Si el token expiró pero el refresh token es válido, Supabase lo renueva solo.
  // Si no hay sesión en absoluto → callback(null) muestra el login.
  supabase.auth.getSession().then(async ({ data: { session } }) => {
    if (!session) {
      return callback(null)
    }

    const fallback = {
      uid:   session.user.id,
      id:    session.user.id,
      email: session.user.email,
      role:  'admin',
      name:  session.user.user_metadata?.name || session.user.email,
    }

    try {
      const { data: profile, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', session.user.id)
        .single()

      if (error || !profile) {
        console.warn('[Auth] Perfil no disponible — sesión conservada:', error?.message)
        return callback(fallback)
      }

      callback({ uid: profile.id, ...profile })
    } catch (err) {
      console.warn('[Auth] Error cargando perfil — sesión conservada:', err.message)
      callback(fallback)
    }
  }).catch(err => {
    console.warn('[Auth] getSession falló — sin sesión activa:', err.message)
    callback(null)
  })

  // ── Paso 2: Escuchar ÚNICAMENTE el cierre de sesión explícito ────────────
  // SIGNED_OUT → el usuario presionó "Salir" o "Cerrar Caja" → limpiar estado.
  // TOKEN_REFRESHED, SIGNED_IN, INITIAL_SESSION, USER_UPDATED → IGNORADOS.
  // Ninguno de esos eventos debe nunca redirigir al login automáticamente.
  const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      callback(null)
    }
  })

  return () => subscription.unsubscribe()
}

// ── Helper: row de mesas → shape interna ─────────────────────────────────────
function mesaToTable(m) {
  const statusMap = { libre: 'available', ocupada: 'occupied', pendiente: 'cleaning' }
  const isLibre = m.estado === 'libre'
  return {
    id: `table-${m.numero_mesa}`,
    number: m.numero_mesa,
    capacity: m.numero_mesa <= 4 ? 2 : m.numero_mesa <= 12 ? 4 : 6,
    // zona guardada (mesas agregadas desde Ajustes) o la de siempre por rango
    zone: (m.zona || '').trim() || defaultZoneOf(m.numero_mesa),
    status: statusMap[m.estado] || 'available',
    waiterId:       null,
    waiterName:     isLibre ? null : (m.mesero_nombre || null),
    waiterColor:    isLibre ? null : (m.mesero_color  || null),
    openedAt:       null,
    currentOrderId: null,
  }
}

// ── Helper: row de inventory → shape interna (precio/imagen editables) ───────
function mapInventoryRow(r) {
  if (!r) return null
  return {
    id:        r.id,
    menuId:    r.menu_id,
    name:      r.name,
    cat:       r.cat,
    available: r.available ?? true,
    stock:     r.stock ?? null,
    alertAt:   r.alert_at ?? null,
    // price/imgUrl pueden ser null (columna no migrada o sin editar) → el
    // contexto usa el default del menú estático en ese caso.
    price:     r.price != null ? Number(r.price) : null,
    imgUrl:    r.img_url || null,
    // hidden = true → "eliminado" del catálogo (no puede borrarse de verdad
    // porque el plato vive en el código fuente); columna nueva, default false
    // si aún no se migró.
    hidden:    r.hidden ?? false,
  }
}

// ── Helper: row de menu_items → shape interna (catálogo dinámico) ────────────
function mapMenuItemRow(r) {
  if (!r) return null
  return {
    id:          r.id,
    name:        r.name,
    cat:         r.cat,
    price:       Number(r.price) || 0,
    imgUrl:      r.img_url || null,
    description: r.description || null,
    available:   r.available ?? true,
    stock:       r.stock ?? null,
    // alert_at (migracion-stock-alertas-compras.sql) — si la columna aún no
    // existe, la fila simplemente no la trae y queda null (sin alerta).
    alertAt:     r.alert_at ?? null,
    // Tamaños (migracion-tamanos-platos.sql) — [] = precio único
    variants:    normalizeVariants(r.variants),
    createdAt:   r.created_at,
  }
}

// ── Helpers "parciales" para eventos Realtime de UPDATE ───────────────────────
// Postgres/Supabase puede omitir del payload columnas grandes (TOAST, como una
// imagen en base64 en img_url) que no cambiaron en ESA actualización puntual
// (p.ej. al marcar un plato "agotado" solo cambia `available`). mapInventoryRow
// / mapMenuItemRow normales convertirían esa ausencia en `null`, borrando la
// imagen del estado local aunque en la base de datos siga intacta. Estos
// helpers solo incluyen las claves que realmente vienen en el payload, para
// poder hacer merge sin pisar campos que no cambiaron.
function mapInventoryRowPartial(r) {
  if (!r) return {}
  const out = { id: r.id }
  if ('menu_id'   in r) out.menuId    = r.menu_id
  if ('name'      in r) out.name      = r.name
  if ('cat'       in r) out.cat       = r.cat
  if ('available' in r) out.available = r.available ?? true
  if ('stock'     in r) out.stock     = r.stock ?? null
  if ('alert_at'  in r) out.alertAt   = r.alert_at ?? null
  if ('price'     in r) out.price     = r.price != null ? Number(r.price) : null
  if ('img_url'   in r) out.imgUrl    = r.img_url || null
  if ('hidden'    in r) out.hidden    = r.hidden ?? false
  return out
}
function mapMenuItemRowPartial(r) {
  if (!r) return {}
  const out = { id: r.id }
  if ('name'        in r) out.name        = r.name
  if ('cat'         in r) out.cat         = r.cat
  if ('price'       in r) out.price       = Number(r.price) || 0
  if ('img_url'     in r) out.imgUrl      = r.img_url || null
  if ('description' in r) out.description = r.description || null
  if ('available'   in r) out.available   = r.available ?? true
  if ('stock'       in r) out.stock       = r.stock ?? null
  if ('alert_at'    in r) out.alertAt     = r.alert_at ?? null
  if ('variants'    in r) out.variants    = normalizeVariants(r.variants)
  return out
}

// Si falta la columna `variants` (migración no ejecutada), mensaje claro
function variantsColumnError(error) {
  const msg = String(error?.message || '')
  if (/variants/i.test(msg) && (error?.code === 'PGRST204' || error?.code === '42703' || /column|schema cache/i.test(msg))) {
    return new Error('Para guardar tamaños (Fuente P./M./G.) falta ejecutar migracion-tamanos-platos.sql en Supabase.')
  }
  return error
}

// ── Helper: row de egresos → shape interna ────────────────────────────────────
function mapEgresoRow(r) {
  if (!r) return null
  return {
    id:         r.id,
    concepto:   r.concepto,
    monto:      Number(r.monto) || 0,
    categoria:  r.categoria || 'Otros',
    metodoPago: r.metodo_pago || null,
    notas:      r.notas || null,
    createdBy:  r.created_by || null,
    fecha:      r.fecha || r.created_at,
    createdAt:  r.created_at,
    // archived = true → egreso de un turno de caja ya cerrado (queda en el
    // historial, pero ya no cuenta como "activo" del turno en curso). Si la
    // columna aún no existe (migración no aplicada), r.archived es undefined
    // → ?? false lo trata como activo, igual que el comportamiento previo.
    archived:   r.archived ?? false,
  }
}

// ── Helper: row de caja_estado → shape interna (fila única, id=1) ────────────
function mapCajaEstadoRow(r) {
  if (!r) return null
  return {
    isOpen:       r.is_open ?? false,
    openedAt:     r.opened_at || null,
    openedBy:     r.opened_by || null,
    fondoInicial: r.fondo_inicial != null ? Number(r.fondo_inicial) : 0,
    closedAt:     r.closed_at || null,
  }
}

// ── Pedidos CRUD + Realtime ───────────────────────────────────────────────────

// Guard reutilizable: lanza un error descriptivo si Supabase no está configurado
const _requireSB = () => {
  if (!supabase) throw new Error('Supabase no configurado — revisa src/config/supabaseConfig.js.')
  return supabase
}
// No-op unsubscribe para cuando Supabase no está disponible
const _noop = () => {}

// true SOLO si la función RPC no existe (migración no ejecutada). Estricto a
// propósito: un error real dentro de la función nunca debe confundirse con
// "falta la migración" (el cierre de caja decide su respaldo con esto).
export function isMissingRpcError(error) {
  const code = error?.code
  const msg  = String(error?.message || error?.details || '')
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(msg)
}
// true SOLO si la tabla no existe (migración no ejecutada)
export function isMissingTableError(error) {
  const code = error?.code
  const msg  = String(error?.message || error?.details || '')
  return code === 'PGRST205' || code === '42P01' || /could not find the table|relation .* does not exist/i.test(msg)
}

export const DB = {
  async addOrder(data) {
    const sb  = _requireSB()
    const now = new Date().toISOString()
    // Eliminar _pendingSync: es un flag interno de React, no es columna de BD
    // eslint-disable-next-line no-unused-vars
    const { _pendingSync, ...cleanData } = data
    const { data: row, error } = await sb
      .from('orders')
      .insert({ created_at: now, updated_at: now, ...cleanData })
      .select()
      .single()
    if (error) throw error
    return row.id
  },

  async updateOrder(id, data) {
    const sb = _requireSB()
    const { error } = await sb
      .from('orders')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  async deleteOrder(id) {
    const sb = _requireSB()
    const { error } = await sb.from('orders').delete().eq('id', id)
    if (error) throw error
  },

  async getOrdersToday() {
    if (!supabase) return []   // sin Supabase → lista vacía, no crash
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', today.toISOString())
      .neq('status', 'archivado')
      .neq('status', 'anulado')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  // Anula un pedido NO cobrado (migracion-anular-pedido.sql, solo admin):
  // devuelve el stock descontado, lo marca 'anulado' y libera la mesa.
  async anularPedido(orderId, motivo = '') {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('anular_pedido', { p_order_id: orderId, p_motivo: (motivo || '').trim() || null })
    if (error) {
      const msg = String(error.message || error.details || '')
      if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(msg)) {
        throw new Error('Falta ejecutar migracion-anular-pedido.sql en Supabase.')
      }
      if (/ORDER_CLOSED/.test(msg))    throw new Error('Este pedido ya fue cobrado, archivado o anulado.')
      if (/ORDER_NOT_FOUND/.test(msg)) throw new Error('El pedido ya no existe.')
      if (/NOT_ALLOWED/.test(msg))     throw new Error('Solo el administrador puede anular pedidos.')
      throw error
    }
    return data || {}
  },

  // Histórico por rango de fechas — a diferencia de getOrdersToday() NO excluye
  // status='archivado' (el cierre de caja archiva los pedidos del día, pero
  // siguen existiendo en la tabla) — usado para reportes que necesitan ver
  // días anteriores, como el panel de Personal/evaluación de meseros.
  async getOrdersInRange(startISO, endISO) {
    if (!supabase) return []
    // Columnas acotadas a lo que consumen sus dos únicos lectores hoy
    // (CustomersPanel y StaffPanel) — ninguno toca items/mesa/payment_method,
    // así que no viajan en esta consulta histórica de reportes.
    const { data, error } = await supabase
      .from('orders')
      .select('id, zone, notes, status, total, created_at, paid_at, waiter_id, waiter_name, is_modified')
      .gte('created_at', startISO)
      .lt('created_at', endISO)
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  // Suscripción Realtime — devuelve noop si Supabase no está disponible
  subscribeOrders(onInsert, onUpdate, onDelete) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`orders-rt-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' },
        payload => onInsert(payload.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' },
        payload => onUpdate(payload.new))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'orders' },
        payload => onDelete(payload.old))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] orders: conectado ✓')
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] orders ERROR:', err)
        if (status === 'TIMED_OUT')     console.warn('[Realtime] orders: timeout — reintentando…')
      })
    return () => supabase.removeChannel(channel)
  },

  // Tablas
  async getTablesInit() {
    if (!supabase) return []
    const { data } = await supabase.from('tables').select('*').order('number')
    return data || []
  },
  async updateTable(id, data) {
    const sb = _requireSB()
    const { error } = await sb
      .from('tables')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },
  subscribeTables(onChange) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`tables-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' },
        payload => onChange(payload))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] tables: conectado ✓')
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] tables ERROR:', err)
      })
    return () => supabase.removeChannel(channel)
  },

  // Inventario
  async getInventory() {
    if (!supabase) return []
    const { data, error } = await supabase.from('inventory').select('*').order('name')
    if (error) {
      // Puede fallar si el usuario aún no ejecutó la migración de price/img_url —
      // no rompemos la app, devolvemos vacío y el contexto usa sus defaults.
      console.warn('[Inventory] getInventory:', error.message)
      return []
    }
    return (data || []).map(mapInventoryRow)
  },
  async updateInventoryItem(id, data) {
    const sb = _requireSB()
    const payload = {}
    if ('available' in data) payload.available = data.available
    if ('stock'     in data) payload.stock     = data.stock
    if ('alertAt'   in data) payload.alert_at  = data.alertAt
    if ('price'     in data) payload.price     = data.price
    if ('imgUrl'    in data) payload.img_url   = data.imgUrl
    if ('hidden'    in data) payload.hidden    = data.hidden
    const { error } = await sb.from('inventory').update(payload).eq('id', id)
    if (error) throw error
  },
  async deductInventoryItem(id, qty) {
    if (!supabase) return
    const { data } = await supabase.from('inventory').select('stock').eq('id', id).single()
    if (!data || data.stock === null) return
    const newStock = Math.max(0, (data.stock || 0) - qty)
    const update   = { stock: newStock, ...(newStock === 0 ? { available: false } : {}) }
    const { error } = await supabase.from('inventory').update(update).eq('id', id)
    if (error) throw error
  },
  // Realtime — propaga a POS/Externos/App Mesero cualquier cambio hecho desde
  // el AdminDashboard (precio, imagen, disponibilidad, stock) al instante.
  // Usa mapInventoryRowPartial (no el mapeo completo): así el llamador puede
  // hacer merge sobre el estado previo sin arriesgarse a borrar img_url u
  // otra columna grande que Postgres haya omitido del payload por ser TOAST.
  subscribeInventory(onChange) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`inventory-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' },
        payload => {
          if (payload.eventType === 'DELETE') return onChange(null, payload.old)
          onChange(mapInventoryRowPartial(payload.new), null)
        })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] inventory: conectado ✓')
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] inventory ERROR:', err)
      })
    return () => supabase.removeChannel(channel)
  },

  // ── Menu Items — platos/bebidas creados desde el AdminDashboard ──────────────
  // (catálogo dinámico, separado del menú estático de 17 platos + su tabla
  // `inventory`; usa uuid como id → nunca colisiona con los ids numéricos 1-17)
  async getMenuItems() {
    if (!supabase) return []
    const { data, error } = await supabase.from('menu_items').select('*').order('created_at')
    if (error) {
      // Tabla aún no migrada — no rompemos la app, el catálogo dinámico queda vacío.
      console.warn('[MenuItems] getMenuItems:', error.message)
      return []
    }
    return (data || []).map(mapMenuItemRow)
  },
  async addMenuItem(data) {
    const sb = _requireSB()
    const { data: row, error } = await sb
      .from('menu_items')
      .insert({
        name:        data.name,
        cat:         data.cat,
        price:       data.price,
        img_url:     data.imgUrl || null,
        description: data.description || null,
        available:   data.available ?? true,
        // Solo se envía si el producto TIENE tamaños: así crear productos de
        // precio único nunca depende de que exista la columna `variants`.
        ...(normalizeVariants(data.variants).length ? { variants: normalizeVariants(data.variants) } : {}),
      })
      .select()
      .single()
    if (error) throw variantsColumnError(error)
    return mapMenuItemRow(row)
  },
  async updateMenuItem(id, data) {
    const sb = _requireSB()
    const payload = {}
    if ('name'        in data) payload.name        = data.name
    if ('cat'         in data) payload.cat          = data.cat
    if ('price'       in data) payload.price        = data.price
    if ('imgUrl'      in data) payload.img_url      = data.imgUrl
    if ('description' in data) payload.description  = data.description
    if ('available'   in data) payload.available    = data.available
    if ('stock'       in data) payload.stock        = data.stock
    // Solo se envía cuando el llamador lo pide explícitamente (campo "Alerta"
    // del panel Stock) — así ninguna otra edición depende de que la columna
    // alert_at exista en la base de datos.
    if ('alertAt'     in data) payload.alert_at     = data.alertAt
    // Tamaños: solo si el llamador los envía. Lista vacía → null (precio único).
    if ('variants'    in data) {
      const v = normalizeVariants(data.variants)
      payload.variants = v.length ? v : null
    }
    payload.updated_at = new Date().toISOString()
    const { error } = await sb.from('menu_items').update(payload).eq('id', id)
    if (error) throw variantsColumnError(error)
  },
  // Descuento ATÓMICO de stock (migracion-descuento-stock.sql): la base de
  // datos resta en una sola operación, así dos ventas simultáneas no se
  // pisan. items = [{ id, qty }]. Devuelve true si se aplicó; false si la
  // función aún no existe (el llamador usa entonces el método anterior).
  async deductMenuStock(items) {
    const sb = _requireSB()
    const { error } = await sb.rpc('deduct_menu_stock', { p_items: items })
    if (!error) return true
    const msg = String(error.message || error.details || '')
    if (error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(msg)) return false
    throw error
  },
  // Suma ATÓMICA de stock (migracion-stock-alertas-compras.sql) — la usa
  // Compras al registrar mercadería que entra. Devuelve la fila actualizada
  // { id, name, stock, available }, o null si la función aún no existe (el
  // llamador usa entonces el método anterior de leer y guardar).
  // egresoId (opcional): la compra que originó la suma. Si se pasa y existe
  // migracion-devoluciones-stock.sql, se recuerda el vínculo para poder
  // restarlo si después se elimina esa compra. Si esa migración aún no se
  // ejecutó, se suma igual con add_menu_stock (sin vínculo).
  async addMenuStock(id, qty, egresoId = null) {
    const sb = _requireSB()
    const isMissingFn = e => {
      const msg = String(e?.message || e?.details || '')
      return e?.code === 'PGRST202' || e?.code === '42883' || /could not find the function/i.test(msg)
    }
    if (egresoId) {
      const { data, error } = await sb.rpc('add_menu_stock_compra', { p_id: id, p_qty: qty, p_egreso_id: egresoId })
      if (!error) return data || {}
      if (!isMissingFn(error)) throw error
    }
    const { data, error } = await sb.rpc('add_menu_stock', { p_id: id, p_qty: qty })
    if (!error) return data || {}
    if (isMissingFn(error)) return null
    throw error
  },
  // Best-effort: al eliminar una compra, resta lo que sumó al stock de
  // productos (migracion-devoluciones-stock.sql). Nunca lanza error.
  async revertirCompraStock(egresoId) {
    if (!supabase || !egresoId) return 0
    try {
      const { data, error } = await supabase.rpc('revertir_compra_stock', { p_egreso_id: egresoId })
      if (error) {
        const msg = String(error.message || '')
        if (!(error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(msg))) {
          console.warn('[Stock] revertir compra:', msg)
        }
        return 0
      }
      return Number(data) || 0
    } catch (e) {
      console.warn('[Stock] revertir compra:', e?.message)
      return 0
    }
  },
  async deleteMenuItem(id) {
    const sb = _requireSB()
    const { error } = await sb.from('menu_items').delete().eq('id', id)
    if (error) throw error
  },
  // onUpdate recibe un objeto PARCIAL (solo las claves presentes en el
  // payload) — el llamador debe hacer merge sobre el estado previo, nunca
  // reemplazar el plato completo, para no perder img_url u otra columna
  // grande que Postgres pudo omitir del evento por ser TOAST. onInsert sí
  // recibe el objeto completo: un INSERT siempre trae todas las columnas.
  subscribeMenuItems(onInsert, onUpdate, onDelete) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`menu-items-rt-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'menu_items' },
        payload => onInsert(mapMenuItemRow(payload.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_items' },
        payload => onUpdate(mapMenuItemRowPartial(payload.new)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'menu_items' },
        payload => onDelete(payload.old))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] menu_items: conectado ✓')
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] menu_items ERROR:', err)
      })
    return () => supabase.removeChannel(channel)
  },

  // ── Egresos / Gastos ─────────────────────────────────────────────────────────
  async getEgresos() {
    if (!supabase) return []
    const { data, error } = await supabase.from('egresos').select('*').order('fecha', { ascending: false })
    if (error) throw error
    return (data || []).map(mapEgresoRow)
  },
  async addEgreso(data) {
    const sb = _requireSB()
    const { data: row, error } = await sb
      .from('egresos')
      .insert({
        concepto:    data.concepto,
        monto:       data.monto,
        categoria:   data.categoria || 'Otros',
        metodo_pago: data.metodoPago || null,
        notas:       data.notas || null,
        created_by:  data.createdBy || null,
        fecha:       data.fecha || new Date().toISOString(),
      })
      .select()
      .single()
    if (error) throw error
    return row.id
  },
  async updateEgreso(id, data) {
    const sb = _requireSB()
    const payload = {}
    if ('concepto'   in data) payload.concepto    = data.concepto
    if ('monto'      in data) payload.monto       = data.monto
    if ('categoria'  in data) payload.categoria   = data.categoria
    if ('metodoPago' in data) payload.metodo_pago = data.metodoPago
    if ('notas'      in data) payload.notas       = data.notas
    if ('fecha'      in data) payload.fecha       = data.fecha
    const { error } = await sb.from('egresos').update(payload).eq('id', id)
    if (error) throw error
  },
  async deleteEgreso(id) {
    const sb = _requireSB()
    const { error } = await sb.from('egresos').delete().eq('id', id)
    if (error) throw error
  },
  // Marca todos los egresos activos como archivados (Cierre de Caja). No
  // borra nada — quedan en el historial, solo dejan de contar como "activos"
  // del turno en curso. Si la columna `archived` no existe aún (migración
  // pendiente), lanza — el llamador (Cierre de Caja) debe capturarlo como
  // best-effort para no bloquear el cierre por esto.
  async archiveAllEgresos() {
    const sb = _requireSB()
    const { error } = await sb.from('egresos').update({ archived: true }).eq('archived', false)
    if (error) throw error
  },
  subscribeEgresos(onInsert, onUpdate, onDelete) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`egresos-rt-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'egresos' },
        payload => onInsert(mapEgresoRow(payload.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'egresos' },
        payload => onUpdate(mapEgresoRow(payload.new)))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'egresos' },
        payload => onDelete(payload.old))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] egresos: conectado ✓')
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] egresos ERROR:', err)
      })
    return () => supabase.removeChannel(channel)
  },

  // ── Caja — estado global compartido (abierta/cerrada) ────────────────────────
  // Fila única (id=1). A diferencia de la sesión de caja local del cajero
  // (localStorage, con todo el detalle del turno), esta tabla existe solo
  // para que POS, Externos y la app del mesero (mesero.html, en otro
  // dispositivo) sepan si hay una caja abierta ahora mismo. CashierPanel
  // escribe aquí al abrir/cerrar turno; nadie más escribe.
  async getCajaEstado() {
    if (!supabase) return null
    const { data, error } = await supabase.from('caja_estado').select('*').eq('id', 1).maybeSingle()
    if (error || !data) return null
    return mapCajaEstadoRow(data)
  },
  async updateCajaEstado(isOpen, meta = {}) {
    const sb = _requireSB()
    const nowIso = new Date().toISOString()
    const payload = { is_open: isOpen, updated_at: nowIso }
    if (isOpen) {
      payload.opened_at     = meta.openedAt || nowIso
      payload.opened_by     = meta.openedBy || null
      payload.fondo_inicial = Number(meta.fondoInicial) || 0
      payload.closed_at     = null
    } else {
      payload.closed_at = meta.closedAt || nowIso
    }
    const { error } = await sb.from('caja_estado').update(payload).eq('id', 1)
    if (error) throw error
  },
  subscribeCajaEstado(onChange) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`caja-estado-rt-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'caja_estado' },
        payload => onChange(mapCajaEstadoRow(payload.new)))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] caja_estado: conectado ✓')
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] caja_estado ERROR:', err)
      })
    return () => supabase.removeChannel(channel)
  },

  // ── Mesas ─────────────────────────────────────────────────────────────────
  async getMesas() {
    if (!supabase) return []
    const { data } = await supabase.from('mesas').select('*').order('numero_mesa')
    return (data || []).map(mesaToTable)
  },
  async updateMesaEstado(numero_mesa, estado, extra = {}) {
    const sb = _requireSB()
    const { error } = await sb
      .from('mesas')
      .update({ estado, ultima_actualizacion: new Date().toISOString(), ...extra })
      .eq('numero_mesa', numero_mesa)
    if (error) throw error
  },
  subscribeMesas(onChange) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`mesas-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mesas' },
        payload => onChange(payload))
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log('[Realtime] mesas: conectado ✓')
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] mesas ERROR:', err)
        if (status === 'TIMED_OUT')     console.warn('[Realtime] mesas: timeout — reintentando…')
      })
    return () => supabase.removeChannel(channel)
  },

  // ── Cierre de Caja ────────────────────────────────────────────────────────

  /**
   * RPC atómica con SECURITY DEFINER — bypasa RLS y corre en una sola transacción.
   * Archiva pedidos de salón y externos YA completados; libera todas las mesas.
   * Para Llevar/Delivery con kitchen_status != 'ready' NO se archivan: el cocinero
   * los sigue viendo hasta marcarlos "Listo".
   * Requiere ejecutar el script SQL incluido en este archivo.
   */
  async cerrarCajaReset() {
    const sb = _requireSB()
    const { error } = await sb.rpc('cerrar_caja_reset')
    if (error) throw error
  },

  async cerrarCajaYReiniciarDia() {
    const sb = _requireSB()
    const { error } = await sb.rpc('cerrar_caja_y_reiniciar_dia')
    if (error) throw error
  },

  async reiniciarJornadaDiaria() {
    const sb = _requireSB()
    const { error } = await sb.rpc('cerrar_caja_y_reiniciar_jornada')
    if (error) throw error
  },

  // ── Cierre de turno con historial (migracion-cierres-turno.sql) ──────────────
  // Vista previa calculada en el servidor + pedidos sin cobrar + mesas ocupadas
  // sin pedido. Lanza el error de Supabase tal cual (el llamador detecta si la
  // migración falta con isMissingRpcError).
  async estadoCierreCaja(fondo = 0) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('estado_cierre_caja', { p_fondo: Number(fondo) || 0 })
    if (error) throw error
    return data || null
  },

  // Cierre ATÓMICO: si hay pedidos sin cobrar lanza TURNO_CON_PEDIDOS_ABIERTOS
  // y no cambia nada. Devuelve el resumen guardado (montos del servidor).
  async cerrarTurnoCaja({ fondo, efectivoContado, openedAt, openedBy }) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('cerrar_turno_caja', {
      p_fondo:            Number(fondo) || 0,
      p_efectivo_contado: Number(efectivoContado),
      p_opened_at:        openedAt || null,
      p_opened_by:        openedBy || null,
    })
    if (error) throw error
    return data
  },

  // ── CRM de clientes (migracion-clientes-crm.sql) ───────────────────────────
  // Los errores se lanzan tal cual: el llamador usa crmErrorMessage/isCrmMissing.
  async crmIdentificar({ doc, nombre = null, acepta = false, cumpleDia = null, cumpleMes = null, celularExtra = null, creadoPor = null }) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('crm_identificar', {
      p_doc: doc, p_nombre: nombre, p_acepta: !!acepta,
      p_cumple_dia: cumpleDia || null, p_cumple_mes: cumpleMes || null,
      p_celular_extra: celularExtra || null, p_creado_por: creadoPor || null,
    })
    if (error) throw error
    return data
  },
  async crmCanjear({ clienteId, orderId = null, producto = null, por = null }) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('crm_canjear_premio', { p_cliente: clienteId, p_order: orderId, p_producto: producto, p_por: por })
    if (error) throw error
    return data
  },
  async crmVincularCanje(canjeId, orderId) {
    const sb = _requireSB()
    const { error } = await sb.rpc('crm_vincular_canje', { p_canje: canjeId, p_order: orderId })
    if (error) throw error
  },
  async crmAnularCanje(canjeId) {
    const sb = _requireSB()
    const { error } = await sb.rpc('crm_anular_canje', { p_canje: canjeId })
    if (error) throw error
  },
  async crmResumenClientes() {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('crm_resumen_clientes')
    if (error) throw error
    return data || []
  },
  async crmStatsCliente(clienteId) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('crm_stats_cliente', { p_cliente: clienteId })
    if (error) throw error
    return data || null
  },
  async getCrmConfig() {
    const sb = _requireSB()
    const { data, error } = await sb.from('crm_config').select('*').eq('id', 1).maybeSingle()
    if (error) throw error
    return data
  },
  async updateCrmConfig(patch) {
    const sb = _requireSB()
    const { data, error } = await sb.from('crm_config').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1).select('id')
    if (error) throw error
    if (!data || !data.length) throw new Error('NOT_ALLOWED')
  },
  async createCliente(row) {
    const sb = _requireSB()
    const { data, error } = await sb.from('clientes').insert(row).select('id').single()
    if (error) throw error
    return data.id
  },
  async getCliente(id) {
    const sb = _requireSB()
    const { data, error } = await sb.from('clientes').select('*').eq('id', id).maybeSingle()
    if (error) throw error
    return data
  },
  async updateCliente(id, patch) {
    const sb = _requireSB()
    const { error } = await sb.from('clientes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
  },
  async deleteCliente(id) {
    const sb = _requireSB()
    const { error } = await sb.from('clientes').delete().eq('id', id)
    if (error) throw error
  },
  // ── CRM avanzado (migracion-crm-avanzado.sql) ──
  async crmImportarAntiguos() {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('crm_importar_clientes_antiguos')
    if (error) throw error
    return data || {}
  },
  async crmUnirClientes(destinoId, origenId) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('crm_unir_clientes', { p_destino: destinoId, p_origen: origenId })
    if (error) throw error
    return data || {}
  },
  async crmCrearEncuesta(clienteId, por = null) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('crm_crear_encuesta', { p_cliente: clienteId, p_por: por })
    if (error) throw error
    return data
  },
  async getEncuestas({ clienteId = null, limit = 200 } = {}) {
    const sb = _requireSB()
    let q = sb.from('encuestas').select('id, cliente_id, puntaje, comentario, created_at, respondida_at, clientes(nombre)')
      .not('respondida_at', 'is', null).order('respondida_at', { ascending: false }).limit(limit)
    if (clienteId) q = q.eq('cliente_id', clienteId)
    const { data, error } = await q
    if (error) throw error
    return data || []
  },

  // ── Descuentos y cupones (migracion-descuentos-cupones.sql) ──
  async cuponesConUsos() {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('cupones_con_usos')
    if (error) throw error
    return data || []
  },
  async createCupon(row) {
    const sb = _requireSB()
    const { error } = await sb.from('cupones').insert(row)
    if (error) throw error
  },
  async updateCupon(id, patch) {
    const sb = _requireSB()
    const { error } = await sb.from('cupones').update(patch).eq('id', id)
    if (error) throw error
  },
  async aplicarCupon(orderId, codigo) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('aplicar_cupon', { p_order: orderId, p_codigo: codigo })
    if (error) throw error
    return data
  },
  async quitarDescuento(orderId) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('quitar_descuento', { p_order: orderId })
    if (error) throw error
    return data
  },
  async aplicarDescuentoManual(orderId, { pct = 0, fijo = 0, motivo }) {
    const sb = _requireSB()
    const { data, error } = await sb.rpc('aplicar_descuento_manual', { p_order: orderId, p_pct: pct, p_fijo: fijo, p_motivo: motivo })
    if (error) throw error
    return data
  },

  async getClienteHistorial(clienteId, celular = null) {
    const sb = _requireSB()
    const [o, c] = await Promise.all([
      sb.from('orders').select('id, zone, table_number, status, total, items, created_at, paid_at, payment_method, waiter_name')
        .eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(200),
      sb.from('clientes_canjes').select('*').eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(50),
    ])
    if (o.error) throw o.error
    // Reservas: por cliente_id o, para las antiguas, por el mismo teléfono
    let reservas = []
    try {
      let q = sb.from('reservas').select('*').order('fecha_hora', { ascending: false }).limit(50)
      q = celular ? q.or(`cliente_id.eq.${clienteId},telefono.eq.${celular}`) : q.eq('cliente_id', clienteId)
      const r = await q
      if (!r.error) reservas = r.data || []
    } catch (_) { /* sin tabla de reservas */ }
    return { orders: o.data || [], canjes: c.error ? [] : (c.data || []), reservas }
  },

  // ── Reporte del día (solo admin; la RLS de cierres_caja lo exige) ──────────
  // Lee todo lo del rango [startISO, endISO) en páginas de 1000 filas.
  // cierresMissing = true si migracion-cierres-turno.sql no se ejecutó.
  async getDayReportData(startISO, endISO) {
    const sb = _requireSB()
    const PAGE = 1000
    const all = async (build) => {
      const out = []
      for (let from = 0; from < 50000; from += PAGE) {
        const { data, error } = await build().range(from, from + PAGE - 1)
        if (error) throw error
        out.push(...(data || []))
        if (!data || data.length < PAGE) break
      }
      return out
    }
    const orders = await all(() => sb.from('orders').select('*')
      .gte('paid_at', startISO).lt('paid_at', endISO).neq('status', 'anulado')
      .order('paid_at', { ascending: true }))
    const anuladosAbiertos = await all(() => sb.from('orders').select('id, total, updated_at')
      .eq('status', 'anulado').gte('updated_at', startISO).lt('updated_at', endISO))
    let cierres = [], cierresMissing = false
    try {
      cierres = await all(() => sb.from('cierres_caja').select('*')
        .gte('closed_at', startISO).lt('closed_at', endISO).order('closed_at', { ascending: true }))
    } catch (e) {
      if (isMissingTableError(e)) cierresMissing = true
      else throw e
    }
    let egresos = []
    try {
      egresos = (await all(() => sb.from('egresos').select('*')
        .gte('fecha', startISO).lt('fecha', endISO).order('fecha', { ascending: true }))).map(mapEgresoRow)
    } catch (e) {
      if (!isMissingTableError(e)) throw e
    }
    return { orders, anuladosAbiertos, cierres, egresos, cierresMissing }
  },

  async ejecutarCierreCajaTotal() {
    const sb = _requireSB()
    const { error } = await sb.rpc('ejecutar_cierre_caja_total')
    if (error) throw error
  },

  async archiveOrders() {
    const sb = _requireSB()
    const now = new Date().toISOString()
    // No archivar pedidos externos (Para Llevar, Delivery, Recojo) que el cocinero
    // aún no marcó como "Listo" — solo desaparecen de cocina cuando kitchen_status='ready'
    const { error } = await sb
      .from('orders')
      .update({ status: 'archivado', updated_at: now })
      .neq('status', 'archivado')
      .or('zone.is.null,zone.not.in.(Para Llevar,Delivery,Recojo en Local),kitchen_status.eq.ready')
    if (error) throw error
  },

  // ── Personal — bitácora de turnos de meseros (mesero_sesiones) ──────────────
  // Tabla creada por migracion-seguridad-pines-sesiones.sql, ya escrita por
  // mesero.html en cada inicio/cierre de turno. Si la migración aún no se
  // corrió en este proyecto, la tabla no existe — degrada a [] en vez de
  // romper el panel de Personal (mismo patrón defensivo que usa el propio
  // mesero.html para el PIN individual).
  async getMeseroSesiones(startISO, endISO) {
    if (!supabase) return []
    try {
      const { data, error } = await supabase
        .from('mesero_sesiones')
        .select('*')
        .gte('login_at', startISO)
        .lt('login_at', endISO)
        .order('login_at', { ascending: false })
      if (error) throw error
      return data || []
    } catch (e) {
      console.warn('[Personal] mesero_sesiones no disponible (¿falta migracion-seguridad-pines-sesiones.sql?):', e?.message)
      return []
    }
  },

  // ── Auditoría — bitácora de acciones administrativas (best-effort) ──────────
  // Se llama SIEMPRE DESPUÉS de que la operación real ya tuvo éxito — nunca
  // antes, nunca bloquea ni cambia el resultado de quien la invoca (los
  // call-sites en los Contexts no la esperan/awaitean por esta misma razón).
  // Si audit_log no existe todavía (migracion-auditoria.sql no corrida) o el
  // insert falla por cualquier motivo, solo se registra un warning — la
  // operación que se estaba auditando YA SE GUARDÓ y sigue intacta.
  async logAudit({ actorId, actorName, action, entity, entityId, detail } = {}) {
    if (!supabase || !action) return
    try {
      const { error } = await supabase.from('audit_log').insert({
        actor_id:   actorId || null,
        actor_name: actorName || null,
        action,
        entity:     entity || null,
        entity_id:  entityId != null ? String(entityId) : null,
        detail:     detail || {},
      })
      if (error) throw error
    } catch (e) {
      console.warn('[Auditoría] no se pudo registrar (¿falta migracion-auditoria.sql?):', e?.message)
    }
  },

  // ── Kardex — historial de movimientos de stock (migracion-kardex-costos.sql)
  // Lo escribe un trigger en la base de datos; la app solo lee. Devuelve
  // { rows, missing } — missing=true si la tabla aún no existe.
  async getStockMovements({ itemId = null, limit = 300 } = {}) {
    if (!supabase) return { rows: [], missing: false }
    let q = supabase
      .from('stock_movimientos')
      .select('id, item_id, item_name, antes, despues, cambio, motivo, actor_name, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (itemId) q = q.eq('item_id', itemId)
    const { data, error } = await q
    if (error) {
      const msg = String(error.message || '')
      if (error.code === '42P01' || error.code === 'PGRST205' || /stock_movimientos/i.test(msg)) {
        return { rows: [], missing: true }
      }
      throw error
    }
    return { rows: data || [], missing: false }
  },

  // ── Precio de costo por producto (tabla aparte, solo admin) ────────────────
  // Devuelve { costs: { [itemId]: number }, missing }. Para un usuario que no
  // es admin, RLS devuelve 0 filas (sin error) → costs vacío.
  async getMenuCosts() {
    if (!supabase) return { costs: {}, missing: false }
    const { data, error } = await supabase.from('menu_item_costos').select('item_id, cost')
    if (error) {
      const msg = String(error.message || '')
      if (error.code === '42P01' || error.code === 'PGRST205' || /menu_item_costos/i.test(msg)) {
        return { costs: {}, missing: true }
      }
      console.warn('[Costos] no se pudieron leer:', msg)
      return { costs: {}, missing: false }
    }
    const costs = {}
    ;(data || []).forEach(r => { if (r.item_id) costs[r.item_id] = Number(r.cost) })
    return { costs, missing: false }
  },
  // cost = null → se borra el costo de ese producto.
  async setMenuCost(itemId, cost) {
    const sb = _requireSB()
    const { error } = cost === null
      ? await sb.from('menu_item_costos').delete().eq('item_id', itemId)
      : await sb.from('menu_item_costos').upsert({ item_id: itemId, cost, updated_at: new Date().toISOString() }, { onConflict: 'item_id' })
    if (error) throw error
  },

  async getAuditLog({ limit = 300 } = {}) {
    if (!supabase) return []
    try {
      // Acotado a lo que pinta AuditPanel hoy (no usa actor_id/entity/entity_id)
      const { data, error } = await supabase
        .from('audit_log')
        .select('id, actor_name, action, detail, created_at')
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return data || []
    } catch (e) {
      console.warn('[Auditoría] no se pudo leer (¿falta migracion-auditoria.sql?):', e?.message)
      return []
    }
  },

  // ── Personal — calificación de turno (mesero_evaluaciones) ──────────────────
  // A diferencia de logAudit() (best-effort, silenciosa), ESTA es la acción
  // principal que el admin está tomando al calificar a un mesero — si falla,
  // el error debe llegar a la UI (el botón "Evaluar turno" lo muestra), no
  // perderse en silencio. Por eso lanza el error en vez de atraparlo.
  async addEvaluacionMesero({ waiterId, waiterName, rating, comentario, evaluadoPor }) {
    const sb = _requireSB()
    const { error } = await sb.from('mesero_evaluaciones').insert({
      waiter_id:    waiterId,
      waiter_name:  waiterName || null,
      rating,
      comentario:   comentario || null,
      evaluado_por: evaluadoPor || null,
    })
    if (error) throw error
  },

  // Lectura sí es defensiva (igual que getMeseroSesiones): si la migración no
  // se corrió, el panel de Personal debe seguir funcionando sin esta columna
  // en vez de romperse.
  async getEvaluacionesMesero(startISO, endISO) {
    if (!supabase) return []
    try {
      const { data, error } = await supabase
        .from('mesero_evaluaciones')
        .select('*')
        .gte('created_at', startISO)
        .lt('created_at', endISO)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    } catch (e) {
      console.warn('[Personal] mesero_evaluaciones no disponible (¿falta migracion-evaluaciones-mesero.sql?):', e?.message)
      return []
    }
  },

  // ── Reservas de mesa ─────────────────────────────────────────────────────────
  // CRUD normal (no best-effort): si algo falla, el panel de Reservas debe
  // enterarse y mostrar el error, igual que Egresos o Catálogo.
  async getReservas({ startISO, endISO } = {}) {
    if (!supabase) return []
    try {
      let query = supabase.from('reservas').select('*').order('fecha_hora', { ascending: true })
      if (startISO) query = query.gte('fecha_hora', startISO)
      if (endISO)   query = query.lt('fecha_hora', endISO)
      const { data, error } = await query
      if (error) throw error
      return data || []
    } catch (e) {
      console.warn('[Reservas] tabla no disponible (¿falta migracion-reservas.sql?):', e?.message)
      return []
    }
  },

  async addReserva(data) {
    const sb = _requireSB()
    const { data: row, error } = await sb.from('reservas').insert({
      cliente_nombre: data.clienteNombre,
      telefono:       data.telefono || null,
      personas:       data.personas || 1,
      fecha_hora:     data.fechaHora,
      mesa_numero:    data.mesaNumero || null,
      notas:          data.notas || null,
      created_by:     data.createdBy || null,
      // Ficha del cliente (migracion-clientes-crm.sql) — solo si se eligió una
      ...(data.clienteId ? { cliente_id: data.clienteId } : {}),
    }).select().single()
    if (error) throw error
    return row.id
  },

  async updateReservaEstado(id, estado) {
    const sb = _requireSB()
    const { error } = await sb.from('reservas')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
  },

  async deleteReserva(id) {
    const sb = _requireSB()
    const { error } = await sb.from('reservas').delete().eq('id', id)
    if (error) throw error
  },

  // ── Configuración del negocio (negocio_config, fila única id = 1) ────────────
  // Mismo patrón que caja_estado. Devuelve la fila cruda (snake_case) — el
  // mapeo a la forma interna vive en services/businessConfig.js. Degrada a
  // null si la tabla no existe (migracion-config-negocio.sql sin correr).
  async getNegocioConfig() {
    if (!supabase) return null
    try {
      const { data, error } = await supabase.from('negocio_config').select('*').eq('id', 1).maybeSingle()
      if (error || !data) return null
      return data
    } catch (e) {
      console.warn('[Negocio] negocio_config no disponible (¿falta migracion-config-negocio.sql?):', e?.message)
      return null
    }
  },
  // `columns` ya viene en snake_case. Lanza si no se pudo guardar — quien
  // llama (saveBusiness) lo atrapa y avisa; el cambio local no se pierde.
  async saveNegocioConfig(columns, updatedBy) {
    const sb = _requireSB()
    const { data, error } = await sb
      .from('negocio_config')
      .update({ ...columns, updated_at: new Date().toISOString(), updated_by: updatedBy || null })
      .eq('id', 1)
      .select('id')
    if (error) throw error
    // RLS que bloquea el UPDATE no da error — solo devuelve 0 filas. Sin este
    // chequeo parecería que guardó cuando en realidad no escribió nada.
    if (!data || data.length === 0) {
      throw new Error('No se guardó en la base de datos: falta correr migracion-config-negocio.sql o tu usuario no es admin.')
    }
  },
  subscribeNegocioConfig(onChange) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`negocio-config-rt-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'negocio_config' },
        payload => { if (payload.new) onChange(payload.new) })
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] negocio_config ERROR:', err)
      })
    return () => supabase.removeChannel(channel)
  },

  // ── Mesas agregadas desde Ajustes ────────────────────────────────────────────
  // rows = [{ numero, zona }]. Las políticas RLS de `mesas` (migracion-mesas-
  // meseros.sql) solo dejan INSERTAR a un admin. Un INSERT bloqueado por RLS da
  // error; si falta la columna `zona` (migración sin correr) también — ambos
  // casos se traducen a un mensaje que dice qué hacer.
  async addMesas(rows) {
    const sb  = _requireSB()
    const now = new Date().toISOString()
    const build = withId => rows.map(r => ({
      ...(withId ? { id: `table-${r.numero}` } : {}),
      numero_mesa: r.numero, estado: 'libre', zona: r.zona || null, ultima_actualizacion: now,
    }))
    // El esquema base define mesas.id como TEXT sin valor por defecto ('table-1', 'table-2'…),
    // pero una base creada con la versión anterior del README lo tiene autogenerado. Se prueba
    // primero sin id y, si la base exige uno (not-null en "id"), se reintenta con 'table-N'.
    let { data, error } = await sb.from('mesas').insert(build(false)).select('numero_mesa')
    if (error && (error.code === '23502' || /null value in column "?id"?/i.test(error.message || ''))) {
      ;({ data, error } = await sb.from('mesas').insert(build(true)).select('numero_mesa'))
    }
    if (error) {
      if (/zona/i.test(error.message || '')) throw new Error('Falta correr migracion-mesas-meseros.sql en Supabase.')
      if (/duplicate|unique/i.test(error.message || '')) throw new Error('Alguien más agregó mesas al mismo tiempo. Recarga e inténtalo de nuevo.')
      throw error
    }
    if (!data || data.length !== rows.length) {
      throw new Error('No se pudieron agregar las mesas: falta correr migracion-mesas-meseros.sql o tu usuario no es admin.')
    }
    return data.map(r => r.numero_mesa)
  },
  // Solo mesas AGREGADAS (> 30) y libres — así lo impone también la política RLS.
  async deleteMesa(numero) {
    const sb = _requireSB()
    const { data, error } = await sb.from('mesas').delete().eq('numero_mesa', numero).select('numero_mesa')
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('No se pudo quitar la mesa: debe estar libre y ser una mesa agregada (mayor a 30).')
    }
  },

  // ── Perfiles de meseros (tabla `meseros`) ────────────────────────────────────
  // Devuelve filas crudas (snake_case) o null si la tabla no existe todavía.
  async getMeseros() {
    if (!supabase) return null
    try {
      const { data, error } = await supabase
        .from('meseros').select('*').order('sort_order').order('created_at')
      if (error || !data) return null
      return data
    } catch (e) {
      console.warn('[Meseros] tabla no disponible (¿falta migracion-mesas-meseros.sql?):', e?.message)
      return null
    }
  },
  async addMesero(row) {
    const sb = _requireSB()
    const { data, error } = await sb.from('meseros').insert(row).select('id')
    if (error) {
      if (/duplicate|unique/i.test(error.message || '')) throw new Error('Ya existe un mesero con ese nombre.')
      throw error
    }
    if (!data || data.length === 0) throw new Error('No se pudo crear el mesero: falta correr migracion-mesas-meseros.sql o tu usuario no es admin.')
  },
  async updateMesero(id, patch) {
    const sb = _requireSB()
    const { data, error } = await sb.from('meseros').update(patch).eq('id', id).select('id')
    if (error) {
      if (/duplicate|unique/i.test(error.message || '')) throw new Error('Ya existe un mesero con ese nombre.')
      throw error
    }
    if (!data || data.length === 0) throw new Error('No se guardó el cambio: tu usuario no es admin o el perfil no existe.')
  },
  // Cambiar el nombre de un mesero. mesero.html identifica las MESAS ABIERTAS por
  // nombre (mesas.mesero_nombre), así que mientras tenga una mesa abierta no se
  // permite: cambiarlo la dejaría "huérfana" (dejaría de ser suya). La comprobación
  // se hace contra la base — no contra lo que muestra la pantalla del admin.
  // Todo lo demás (ventas, pedidos, sesiones, PIN) se enlaza por id y no se ve afectado.
  // Los registros históricos conservan el nombre que tenían en su momento a propósito:
  // reescribir miles de pedidos archivados dispararía eventos Realtime hacia cocina.
  async renameMesero(id, oldName, newName) {
    const sb = _requireSB()
    const { data: open, error: openErr } = await sb
      .from('mesas').select('numero_mesa').eq('mesero_nombre', oldName).neq('estado', 'libre')
    if (openErr) throw openErr
    if (open && open.length) {
      const nums = open.map(m => m.numero_mesa).sort((a, b) => a - b).join(', ')
      throw new Error(`${oldName} tiene ${open.length === 1 ? 'la mesa' : 'las mesas'} ${nums} abierta${open.length === 1 ? '' : 's'}. Espera a que ${open.length === 1 ? 'la cierre' : 'las cierre'} para cambiarle el nombre.`)
    }
    // El avatar toma la inicial del nombre nuevo (el "K" de Carmen era solo un valor sembrado)
    await DB.updateMesero(id, { name: newName, initial: newName.charAt(0).toUpperCase() })
    // Red de seguridad para la ventana de milisegundos entre la comprobación y el cambio:
    // si justo se abrió una mesa con el nombre anterior, pasa al nuevo. Best-effort.
    try {
      await sb.from('mesas').update({ mesero_nombre: newName }).eq('mesero_nombre', oldName).neq('estado', 'libre')
    } catch { /* no crítico */ }
  },
  // PIN individual — set_mesero_pin() (migracion-seguridad-pines-sesiones.sql)
  // guarda solo el HASH; el PIN nunca queda en texto plano ni en esta tabla.
  async setMeseroPin(id, pin) {
    const sb = _requireSB()
    const { error } = await sb.rpc('set_mesero_pin', { p_waiter_id: id, p_pin: pin })
    if (error) throw error
  },
  // ¿este mesero ya tiene PIN propio? true/false, o null si la función no existe.
  async getMeseroPinConfigured(id) {
    if (!supabase) return null
    try {
      const { data, error } = await supabase.rpc('mesero_pin_configured', { p_waiter_id: id })
      if (error) return null
      return !!data
    } catch { return null }
  },
  subscribeMeseros(onChange) {
    if (!supabase) return _noop
    const channel = supabase
      .channel(`meseros-rt-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meseros' }, () => onChange())
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') console.error('[Realtime] meseros ERROR:', err)
      })
    return () => supabase.removeChannel(channel)
  },

  async liberarTodasMesas() {
    if (!supabase) return
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('mesas')
      .update({ estado: 'libre', mesero_nombre: null, mesero_color: null, ultima_actualizacion: now })
      .neq('estado', 'libre')
    if (!error) return

    const { error: err2 } = await supabase
      .from('mesas')
      .update({ estado: 'libre', ultima_actualizacion: now })
      .neq('estado', 'libre')
    if (err2) console.warn('[liberarTodasMesas]', err2.message)
  },
}

// (Se eliminaron los usuarios/contraseñas de demostración que estaban escritos
// aquí: no los usaba ningún flujo y quedaban visibles en el sitio publicado.
// El inicio de sesión real es SIEMPRE con Supabase Auth.)

/*
 * ── SQL para crear tablas en Supabase ─────────────────────────────────────────
 *
 * Ejecuta esto en el SQL Editor de tu proyecto Supabase:
 *
 * create table public.orders (
 *   id          uuid    default gen_random_uuid() primary key,
 *   table_number integer not null,
 *   zone        text,
 *   waiter_id   text,
 *   waiter_name text,
 *   waiter_avatar text,
 *   waiter_color  text,
 *   items       jsonb   not null default '[]',
 *   status      text    not null default 'pending',
 *   total       numeric(10,2) default 0,
 *   subtotal    numeric(10,2) default 0,
 *   payment_method text,
 *   paid_at     timestamptz,
 *   notes       text,
 *   created_at  timestamptz default now(),
 *   updated_at  timestamptz default now()
 * );
 *
 * create table public.tables (
 *   id          text    primary key,
 *   number      integer not null,
 *   capacity    integer default 4,
 *   status      text    default 'available',
 *   current_order_id uuid references orders(id),
 *   waiter_id   text,
 *   waiter_name text,
 *   opened_at   timestamptz,
 *   updated_at  timestamptz default now()
 * );
 *
 * create table public.inventory (
 *   id          text    primary key,
 *   menu_id     integer,
 *   name        text    not null,
 *   cat         text,
 *   available   boolean default true,
 *   stock       integer,
 *   alert_at    integer
 * );
 *
 * create table public.users (
 *   id          uuid    references auth.users(id) primary key,
 *   email       text    not null,
 *   name        text,
 *   role        text    not null default 'waiter',
 *   avatar      text,
 *   color       text
 * );
 *
 * -- Habilitar Realtime para pedidos
 * alter publication supabase_realtime add table public.orders;
 * alter publication supabase_realtime add table public.tables;
 *
 * -- ══════════════════════════════════════════════════════════════
 * -- ROW LEVEL SECURITY — Políticas basadas en rol (ejecutar en SQL Editor)
 * -- ══════════════════════════════════════════════════════════════
 *
 * -- 1. Habilitar RLS en todas las tablas
 * alter table public.orders         enable row level security;
 * alter table public.tables         enable row level security;
 * alter table public.inventory      enable row level security;
 * alter table public.users          enable row level security;
 * alter table public.mesas          enable row level security;
 * alter table public.ventas_meseros enable row level security;
 *
 * -- 2. Función helper: obtiene el rol del usuario autenticado
 * create or replace function public.get_user_role()
 * returns text language sql stable security definer as $$
 *   select role from public.users where id = auth.uid();
 * $$;
 *
 * -- 3. ORDERS — Admin ve todo; mesero solo inserta sus propias órdenes
 * create policy "admin_orders_all"
 *   on public.orders for all
 *   using (public.get_user_role() = 'admin');
 *
 * create policy "waiter_orders_insert"
 *   on public.orders for insert
 *   with check (
 *     public.get_user_role() = 'waiter'
 *     and waiter_id = auth.uid()::text
 *   );
 *
 * create policy "waiter_orders_select_own"
 *   on public.orders for select
 *   using (
 *     public.get_user_role() = 'waiter'
 *     and waiter_id = auth.uid()::text
 *   );
 *
 * -- 4. MESAS — Todos los autenticados pueden leer; solo admin o el mesero asignado puede actualizar
 * create policy "auth_mesas_select"
 *   on public.mesas for select
 *   using (auth.role() = 'authenticated');
 *
 * create policy "auth_mesas_update"
 *   on public.mesas for update
 *   using (auth.role() = 'authenticated');
 *
 * -- 5. VENTAS_MESEROS — Cada mesero solo ve y escribe sus propias ventas
 * create policy "waiter_ventas_insert"
 *   on public.ventas_meseros for insert
 *   with check (mesero_id = auth.uid()::text);
 *
 * create policy "waiter_ventas_select"
 *   on public.ventas_meseros for select
 *   using (
 *     mesero_id = auth.uid()::text
 *     or public.get_user_role() = 'admin'
 *   );
 *
 * -- 6. INVENTORY — Solo admin puede modificar; todos los autenticados pueden leer
 * create policy "auth_inventory_select"
 *   on public.inventory for select
 *   using (auth.role() = 'authenticated');
 *
 * create policy "admin_inventory_modify"
 *   on public.inventory for all
 *   using (public.get_user_role() = 'admin');
 *
 * -- 7. USERS — Cada usuario solo ve su propio perfil; admin ve todos
 * create policy "users_select_own"
 *   on public.users for select
 *   using (
 *     id = auth.uid()
 *     or public.get_user_role() = 'admin'
 *   );
 *
 * -- 8. Habilitar Realtime con las tablas necesarias
 * alter publication supabase_realtime add table public.orders;
 * alter publication supabase_realtime add table public.mesas;
 * alter publication supabase_realtime add table public.ventas_meseros;
 *
 * -- ══════════════════════════════════════════════════════════════
 * -- MIGRACIÓN — Precio/Imagen editables + Egresos (ejecutar en SQL Editor)
 * -- Requerido para: AdminDashboard → Stock (precio, imagen, disponibilidad)
 * -- y el nuevo módulo de Egresos. Sin esto, el admin verá los precios e
 * -- imágenes por defecto del menú y el panel de Egresos mostrará un aviso.
 * -- ══════════════════════════════════════════════════════════════
 *
 * -- 9. Ampliar inventory con precio e imagen editables desde el AdminDashboard
 * alter table public.inventory add column if not exists price   numeric(10,2);
 * alter table public.inventory add column if not exists img_url text;
 * alter publication supabase_realtime add table public.inventory;
 *
 * -- 10. Nueva tabla de Egresos / Gastos
 * create table if not exists public.egresos (
 *   id          uuid primary key default gen_random_uuid(),
 *   concepto    text not null,
 *   monto       numeric(10,2) not null,
 *   categoria   text not null default 'Otros',
 *   metodo_pago text,
 *   notas       text,
 *   created_by  text,
 *   fecha       timestamptz not null default now(),
 *   created_at  timestamptz not null default now()
 * );
 * alter table public.egresos enable row level security;
 *
 * create policy "admin_egresos_all"
 *   on public.egresos for all
 *   using (public.get_user_role() = 'admin');
 *
 * alter publication supabase_realtime add table public.egresos;
 *
 * -- ══════════════════════════════════════════════════════════════
 * -- MIGRACIÓN — Catálogo de platos editable (CRUD) desde AdminDashboard
 * -- Requerido para: crear platos/bebidas nuevos, editar/eliminar existentes.
 * -- Usa bloques DO...EXCEPTION para poder re-ejecutar el script sin errores
 * -- si ya se corrió antes (a diferencia de "create policy" simple).
 * -- ══════════════════════════════════════════════════════════════
 *
 * -- 11. "Eliminar" un plato del catálogo estático (no se puede borrar del
 * --     código fuente en tiempo real, así que se oculta de todos los menús)
 * alter table public.inventory add column if not exists hidden boolean not null default false;
 *
 * -- 12. Nueva tabla de platos/bebidas creados desde el AdminDashboard
 * --     (id uuid → nunca colisiona con los ids 1-17 del menú estático)
 * create table if not exists public.menu_items (
 *   id          uuid primary key default gen_random_uuid(),
 *   name        text not null,
 *   cat         text not null,
 *   price       numeric(10,2) not null check (price >= 0),
 *   img_url     text,
 *   description text,
 *   available   boolean not null default true,
 *   stock       integer,
 *   created_at  timestamptz not null default now(),
 *   updated_at  timestamptz not null default now()
 * );
 * alter table public.menu_items enable row level security;
 *
 * do $$ begin
 *   create policy "auth_menu_items_select"
 *     on public.menu_items for select
 *     using (auth.role() = 'authenticated');
 * exception when duplicate_object then null;
 * end $$;
 *
 * do $$ begin
 *   create policy "admin_menu_items_modify"
 *     on public.menu_items for all
 *     using (public.get_user_role() = 'admin');
 * exception when duplicate_object then null;
 * end $$;
 *
 * do $$ begin
 *   alter publication supabase_realtime add table public.menu_items;
 * exception when duplicate_object then null;
 * end $$;
 *
 * -- ══════════════════════════════════════════════════════════════
 * -- MIGRACIÓN — Estado global de Caja + archivado de Egresos por turno
 * -- Requerido para: bloquear "Enviar a Cocina" en POS/Externos/App Mesero
 * -- cuando la caja está cerrada, y reiniciar los egresos "activos" al
 * -- cerrar caja (quedan archivados en el historial, no se borran).
 * -- ══════════════════════════════════════════════════════════════
 *
 * -- 13. Egresos — columna de archivado por cierre de caja
 * alter table public.egresos add column if not exists archived boolean not null default false;
 *
 * -- 14. Estado global de caja — fila única (id=1), visible desde POS,
 * --     Externos y app mesero.html (en cualquier dispositivo)
 * create table if not exists public.caja_estado (
 *   id            int primary key default 1,
 *   is_open       boolean not null default false,
 *   opened_at     timestamptz,
 *   opened_by     text,
 *   fondo_inicial numeric(10,2),
 *   closed_at     timestamptz,
 *   updated_at    timestamptz not null default now(),
 *   constraint caja_estado_singleton check (id = 1)
 * );
 * insert into public.caja_estado (id, is_open) values (1, false)
 *   on conflict (id) do nothing;
 * alter table public.caja_estado enable row level security;
 *
 * do $$ begin
 *   create policy "auth_caja_estado_select"
 *     on public.caja_estado for select
 *     using (auth.role() = 'authenticated');
 * exception when duplicate_object then null;
 * end $$;
 *
 * do $$ begin
 *   create policy "admin_caja_estado_modify"
 *     on public.caja_estado for update
 *     using (public.get_user_role() = 'admin');
 * exception when duplicate_object then null;
 * end $$;
 *
 * do $$ begin
 *   alter publication supabase_realtime add table public.caja_estado;
 * exception when duplicate_object then null;
 * end $$;
 */
