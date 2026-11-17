import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { DEMO_MODE, DB } from '@/services/supabase'
import { MENU } from '@/data/menu'
import { IMG_PLACEHOLDER } from '@/utils/image'
import { useAuth } from '@/features/auth/AuthContext'
import { normalizeVariants, minVariantPrice } from '@/utils/variants'

const DEFAULT_INVENTORY = MENU.map(item => ({
  id:        `inv-${item.id}`,
  menuId:    item.id,
  name:      item.name,
  cat:       item.cat,
  available: true,
  stock:     null,
  alertAt:   null,
  price:     item.price, // valor inicial = precio del menú estático
  imgUrl:    null,       // null = usar imagen del menú estático (item.img)
  hidden:    false,
}))

let _demoInv = DEFAULT_INVENTORY.map(i => ({ ...i }))
let _demoInvListeners = new Set()
function notifyInv() { _demoInvListeners.forEach(cb => cb([..._demoInv])) }

const DemoInvStore = {
  subscribe(cb) {
    _demoInvListeners.add(cb)
    cb([..._demoInv])
    return () => _demoInvListeners.delete(cb)
  },
  update(id, data) {
    _demoInv = _demoInv.map(i => i.id === id ? { ...i, ...data } : i)
    notifyInv()
  },
}

const InventoryCtx = createContext(null)

export function InventoryProvider({ children }) {
  const { user } = useAuth()
  const [inventory, setInventory]   = useState(DEFAULT_INVENTORY)
  const [invLoading, setInvLoading] = useState(true)

  // Catálogo dinámico — platos/bebidas creados desde AdminDashboard → Stock.
  const [menuItems, setMenuItems]                 = useState([])
  const [menuItemsLoading, setMenuItemsLoading]   = useState(true)
  const [menuItemsTableMissing, setMenuItemsTableMissing] = useState(false)

  useEffect(() => {
    if (DEMO_MODE) {
      const unsub = DemoInvStore.subscribe(data => {
        setInventory(data)
        setInvLoading(false)
      })
      setMenuItemsLoading(false)
      return unsub
    }

    let mounted = true

    // ── Inventario (anulaciones del menú estático: precio/imagen/disponible/oculto) ──
    DB.getInventory()
      .then(data => {
        if (!mounted) return
        setInventory(data.length ? data : DEFAULT_INVENTORY)
        setInvLoading(false)
      })
      .catch(() => { if (mounted) setInvLoading(false) })

    // `row` llega parcial (solo las claves presentes en el evento) — se hace
    // MERGE sobre el plato existente, nunca reemplazo completo. Esto evita
    // que un UPDATE que no tocó img_url (p.ej. solo cambiar disponibilidad)
    // borre la imagen del estado local si Postgres omitió esa columna del
    // payload por ser un valor grande (TOAST) sin cambios en esa operación.
    const unsubInv = DB.subscribeInventory((row, deletedOld) => {
      if (deletedOld) {
        setInventory(prev => prev.filter(i => i.id !== deletedOld.id))
        return
      }
      if (!row) return
      setInventory(prev => {
        const exists = prev.find(i => i.id === row.id)
        return exists ? prev.map(i => i.id === row.id ? { ...i, ...row } : i) : [...prev, row]
      })
    })

    // ── Catálogo dinámico (platos nuevos creados por el admin) ──────────────
    DB.getMenuItems()
      .then(data => {
        if (!mounted) return
        setMenuItems(data)
        setMenuItemsLoading(false)
      })
      .catch(err => {
        if (!mounted) return
        console.warn('[MenuItems] tabla "menu_items" no disponible:', err?.message)
        setMenuItemsTableMissing(true)
        setMenuItemsLoading(false)
      })

    // `updated` llega parcial — merge sobre el plato existente (mismo motivo
    // que en subscribeInventory: no perder img_url si Postgres la omitió del
    // evento por ser TOAST y no haber cambiado en ese UPDATE puntual).
    const unsubItems = DB.subscribeMenuItems(
      added   => setMenuItems(prev => prev.find(m => m.id === added.id) ? prev : [...prev, added]),
      updated => setMenuItems(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m)),
      removed => setMenuItems(prev => prev.filter(m => m.id !== removed.id)),
    )

    return () => { mounted = false; unsubInv(); unsubItems() }
  }, [])

  // ── Precio de costo (tabla menu_item_costos, solo admin) ───────────────────
  // Se recarga al cambiar de usuario: antes del login (o para un usuario que
  // no es admin) RLS devuelve 0 filas → costs vacío, sin error.
  const [costs, setCosts]               = useState({})
  const [costsMissing, setCostsMissing] = useState(false)
  const isAdmin = user?.role === 'admin'
  useEffect(() => {
    if (DEMO_MODE || !isAdmin) { setCosts({}); return }
    let mounted = true
    DB.getMenuCosts()
      .then(({ costs: c, missing }) => { if (mounted) { setCosts(c); setCostsMissing(missing) } })
      .catch(e => console.warn('[Costos] carga falló:', e?.message))
    return () => { mounted = false }
  }, [isAdmin, user?.uid])

  const loading = invLoading || menuItemsLoading

  // Relee el catálogo dinámico desde la base de datos (p. ej. tras importar
  // un respaldo). Realtime ya propaga los cambios; esto cubre el caso en que
  // el WebSocket estaba caído. Si falla, se conserva la lista actual.
  const refreshMenuItems = useCallback(async () => {
    if (DEMO_MODE) return
    try { setMenuItems(await DB.getMenuItems()) }
    catch (e) { console.warn('[MenuItems] refresh falló:', e?.message) }
  }, [])

  // ── Acciones sobre platos del menú ESTÁTICO (via tabla inventory) o
  // CUSTOM (via tabla menu_items) — reciben el item ya combinado de
  // effectiveMenu y enrutan a la tabla correcta según item.source. ──────────

  const toggleAvailable = useCallback(async (item) => {
    const data = { available: !item.available }
    if (item.source === 'custom') {
      setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, ...data } : m))
      if (DEMO_MODE) return
      return DB.updateMenuItem(item.id, data).catch(e => console.error('toggleAvailable:', e))
    }
    if (!item.invId) return
    setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, ...data } : i))
    if (DEMO_MODE) return DemoInvStore.update(item.invId, data)
    return DB.updateInventoryItem(item.invId, data).catch(e => console.error('toggleAvailable:', e))
  }, [])

  const updateStock = useCallback(async (item, stock) => {
    const numStock = stock === '' ? null : Number(stock)
    if (numStock !== null && (isNaN(numStock) || numStock < 0)) return // entrada inválida — no-op
    const data = { stock: numStock, ...(numStock === 0 ? { available: false } : {}) }
    if (item.source === 'custom') {
      setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, ...data } : m))
      if (DEMO_MODE) return
      return DB.updateMenuItem(item.id, data).catch(e => console.error('updateStock:', e))
    }
    if (!item.invId) return
    setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, ...data } : i))
    if (DEMO_MODE) return DemoInvStore.update(item.invId, data)
    return DB.updateInventoryItem(item.invId, data).catch(e => console.error('updateStock:', e))
  }, [])

  // Umbral de "Stock bajo" — '' / null = sin alerta. Para productos custom
  // requiere la columna menu_items.alert_at (migracion-stock-alertas-compras.sql):
  // si aún no existe, se revierte el cambio en pantalla y se lanza un error
  // con un mensaje claro para que el panel lo muestre.
  const updateAlertAt = useCallback(async (item, value) => {
    const num = value === '' || value === null || value === undefined ? null : Number(value)
    if (num !== null && (!Number.isInteger(num) || num < 0)) {
      throw new Error('La alerta debe ser un número entero mayor o igual a 0')
    }
    const prevVal = item.alertAt ?? null
    if (num === prevVal) return
    if (item.source === 'custom') {
      setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, alertAt: num } : m))
      if (DEMO_MODE) return
      try {
        await DB.updateMenuItem(item.id, { alertAt: num })
      } catch (e) {
        setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, alertAt: prevVal } : m))
        const msg = String(e?.message || '')
        if (/alert_at/i.test(msg) || e?.code === 'PGRST204' || e?.code === '42703') {
          throw new Error('Falta ejecutar migracion-stock-alertas-compras.sql en Supabase para guardar la alerta')
        }
        throw e
      }
      return
    }
    if (!item.invId) return
    setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, alertAt: num } : i))
    if (DEMO_MODE) return DemoInvStore.update(item.invId, { alertAt: num })
    try {
      await DB.updateInventoryItem(item.invId, { alertAt: num })
    } catch (e) {
      setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, alertAt: prevVal } : i))
      throw e
    }
  }, [])

  // Precio de costo por producto ('' / null = sin costo). Solo productos
  // custom (los del catálogo dinámico, que es donde vive todo el menú hoy).
  const updateCost = useCallback(async (item, value) => {
    if (item.source !== 'custom') throw new Error('El costo solo se puede asignar a productos del catálogo')
    const num = value === '' || value === null || value === undefined ? null : Math.round(Number(value) * 100) / 100
    if (num !== null && (!isFinite(num) || num < 0)) throw new Error('El costo debe ser un número mayor o igual a 0')
    const prevVal = costs[item.id] ?? null
    if (num === prevVal) return
    const applyLocal = v => setCosts(prev => {
      const next = { ...prev }
      if (v === null) delete next[item.id]; else next[item.id] = v
      return next
    })
    applyLocal(num)
    if (DEMO_MODE) return
    try {
      await DB.setMenuCost(item.id, num)
      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'cost_change',
        entity: 'menu_item_costos', entityId: item.id,
        detail: { plato: item.name, antes: prevVal, despues: num },
      })
    } catch (e) {
      applyLocal(prevVal)
      const msg = String(e?.message || '')
      if (e?.code === '42P01' || e?.code === 'PGRST205' || /menu_item_costos/i.test(msg)) {
        setCostsMissing(true)
        throw new Error('Falta ejecutar migracion-kardex-costos.sql en Supabase para guardar costos')
      }
      throw e
    }
  }, [costs, user])

  // Historial de movimientos de stock (kardex). Solo lectura.
  const getStockMovements = useCallback((opts) => {
    if (DEMO_MODE) return Promise.resolve({ rows: [], missing: false })
    return DB.getStockMovements(opts)
  }, [])

  // Suma unidades al stock (mercadería que entra desde Compras). Para
  // productos custom usa la función atómica add_menu_stock; si la migración
  // aún no se ejecutó, cae al método anterior (leer stock actual y guardar).
  // Si el producto estaba en 0 (agotado), vuelve a quedar disponible.
  // Devuelve el stock nuevo. Lanza error si no se pudo guardar.
  // egresoId (opcional): compra que originó la suma — permite restarla si
  // luego se elimina esa compra (ver DB.addMenuStock).
  const addStock = useCallback(async (item, qty, egresoId = null) => {
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error('La cantidad a sumar debe ser un número entero mayor a 0')
    const cur = item.stock ?? null
    const fallbackStock = (cur ?? 0) + n
    const fallbackData = { stock: fallbackStock, ...(cur === 0 ? { available: true } : {}) }

    let newStock = fallbackStock
    if (item.source === 'custom') {
      if (DEMO_MODE) {
        setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, ...fallbackData } : m))
        return newStock
      }
      const row = await DB.addMenuStock(item.id, n, egresoId)
      if (row) {
        newStock = Number(row.stock)
        setMenuItems(prev => prev.map(m => m.id === item.id
          ? { ...m, stock: newStock, ...(row.available !== undefined ? { available: row.available } : {}) }
          : m))
      } else {
        // Respaldo: migración aún no ejecutada
        await DB.updateMenuItem(item.id, fallbackData)
        setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, ...fallbackData } : m))
      }
    } else {
      if (!item.invId) throw new Error('Producto no encontrado en el inventario')
      if (DEMO_MODE) {
        DemoInvStore.update(item.invId, fallbackData)
        return newStock
      }
      await DB.updateInventoryItem(item.invId, fallbackData)
      setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, ...fallbackData } : i))
    }
    DB.logAudit({
      actorId: user?.uid, actorName: user?.name, action: 'stock_add',
      entity: item.source === 'custom' ? 'menu_items' : 'inventory',
      entityId: item.source === 'custom' ? item.id : item.invId,
      detail: { plato: item.name, antes: cur, sumado: n, despues: newStock },
    })
    return newStock
  }, [user])

  // Precio editable por plato — null/'' revierte al precio por defecto del menú
  // (solo aplica a platos estáticos; los personalizados siempre requieren precio).
  const updatePrice = useCallback(async (item, price) => {
    // Con tamaños, el precio sale de cada tamaño (se edita en el formulario)
    if (Array.isArray(item?.variants) && item.variants.length) return
    const numPrice = price === '' || price === null || price === undefined ? null : Number(price)
    if (numPrice !== null && (isNaN(numPrice) || numPrice < 0)) return // entrada inválida — no-op
    const logPriceChange = () => DB.logAudit({
      actorId: user?.uid, actorName: user?.name, action: 'price_change',
      entity: item.source === 'custom' ? 'menu_items' : 'inventory',
      entityId: item.source === 'custom' ? item.id : item.invId,
      detail: { plato: item.name, antes: item.price, despues: numPrice },
    })
    if (item.source === 'custom') {
      if (numPrice === null || numPrice <= 0) return // los platos custom no pueden quedar sin precio
      setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, price: numPrice } : m))
      if (DEMO_MODE) return
      return DB.updateMenuItem(item.id, { price: numPrice })
        .then(logPriceChange)
        .catch(e => console.error('updatePrice:', e))
    }
    if (!item.invId) return
    setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, price: numPrice } : i))
    if (DEMO_MODE) return DemoInvStore.update(item.invId, { price: numPrice })
    return DB.updateInventoryItem(item.invId, { price: numPrice })
      .then(logPriceChange)
      .catch(e => console.error('updatePrice:', e))
  }, [user])

  // Imagen editable por plato — acepta URL o data-URI (subida comprimida).
  // '' / null revierte a la imagen por defecto del menú estático (o placeholder en custom).
  const updateImage = useCallback(async (item, imgUrl) => {
    const clean = (typeof imgUrl === 'string' && imgUrl.trim()) ? imgUrl.trim() : null
    if (item.source === 'custom') {
      setMenuItems(prev => prev.map(m => m.id === item.id ? { ...m, imgUrl: clean } : m))
      if (DEMO_MODE) return
      return DB.updateMenuItem(item.id, { imgUrl: clean }).catch(e => console.error('updateImage:', e))
    }
    if (!item.invId) return
    setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, imgUrl: clean } : i))
    if (DEMO_MODE) return DemoInvStore.update(item.invId, { imgUrl: clean })
    return DB.updateInventoryItem(item.invId, { imgUrl: clean }).catch(e => console.error('updateImage:', e))
  }, [])

  // Crea un plato/bebida nuevo — siempre en el catálogo dinámico (menu_items),
  // con id uuid generado por Supabase → nunca colisiona con los ids 1-17 del
  // menú estático ni con otros platos custom.
  const addMenuItem = useCallback(async (data) => {
    const name = (data?.name || '').trim()
    if (!name) throw new Error('El nombre es obligatorio')
    const cat = (data?.cat || '').trim()
    if (!cat) throw new Error('La categoría es obligatoria')
    const variants = normalizeVariants(data?.variants)
    if (Array.isArray(data?.variants) && data.variants.length && variants.length < 2) {
      throw new Error('Con tamaños, ingresa al menos 2 tamaños con nombre y precio mayor a 0')
    }
    // Con tamaños, el precio "base" del producto es el del tamaño más barato
    const price = variants.length ? minVariantPrice(variants) : Number(data?.price)
    if (!isFinite(price) || price <= 0) throw new Error('El precio debe ser un número mayor a 0')

    const payload = {
      name, cat, price,
      imgUrl:      data.imgUrl || null,
      description: (data.description || '').trim() || null,
      available:   data.available ?? true,
      ...(variants.length ? { variants } : {}),
    }

    if (DEMO_MODE) {
      const item = { id: `demo-item-${Date.now()}`, ...payload, stock: null, createdAt: new Date().toISOString() }
      setMenuItems(prev => [...prev, item])
      return item
    }

    const tempId = `temp-${Date.now()}`
    const optimistic = { id: tempId, ...payload, stock: null, createdAt: new Date().toISOString() }
    setMenuItems(prev => [...prev, optimistic])
    try {
      const row = await DB.addMenuItem(payload)
      setMenuItems(prev => prev.map(m => m.id === tempId ? row : m))
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'menu_item_create', entity: 'menu_items', entityId: row?.id, detail: payload })
      return row
    } catch (err) {
      setMenuItems(prev => prev.filter(m => m.id !== tempId))
      throw err
    }
  }, [user])

  // Edita nombre/categoría/precio/imagen/descripción/disponibilidad de un
  // plato CUSTOM de una sola vez (formulario de edición completo).
  const updateMenuItem = useCallback(async (item, data) => {
    if (item.source !== 'custom') throw new Error('Solo los platos personalizados admiten edición completa')
    const payload = {}
    if ('name' in data) {
      const name = (data.name || '').trim()
      if (!name) throw new Error('El nombre es obligatorio')
      payload.name = name
    }
    if ('cat' in data) {
      const cat = (data.cat || '').trim()
      if (!cat) throw new Error('La categoría es obligatoria')
      payload.cat = cat
    }
    if ('price' in data) {
      const price = Number(data.price)
      if (!isFinite(price) || price <= 0) throw new Error('El precio debe ser un número mayor a 0')
      payload.price = price
    }
    if ('imgUrl'      in data) payload.imgUrl      = data.imgUrl || null
    if ('description' in data) payload.description = (data.description || '').trim() || null
    if ('available'   in data) payload.available   = data.available
    if ('variants'    in data) {
      const variants = normalizeVariants(data.variants)
      if (Array.isArray(data.variants) && data.variants.length && variants.length < 2) {
        throw new Error('Con tamaños, ingresa al menos 2 tamaños con nombre y precio mayor a 0')
      }
      payload.variants = variants
      // Con tamaños, el precio "base" es el del tamaño más barato
      if (variants.length) payload.price = minVariantPrice(variants)
    }

    let previous = null
    setMenuItems(prev => prev.map(m => {
      if (m.id !== item.id) return m
      previous = m
      return { ...m, ...payload }
    }))
    if (DEMO_MODE) return
    try {
      const result = await DB.updateMenuItem(item.id, payload)
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'menu_item_update', entity: 'menu_items', entityId: item.id, detail: payload })
      return result
    } catch (e) {
      // Revertir el cambio en pantalla: lo guardado sigue siendo lo anterior
      if (previous) setMenuItems(prev => prev.map(m => m.id === item.id ? previous : m))
      console.error('updateMenuItem:', e)
      throw e
    }
  }, [user])

  // "Eliminar" un plato del catálogo — un plato custom se borra de verdad;
  // un plato estático (viene del código fuente, no se puede borrar) se oculta
  // de todos los menús (POS/Externos/mesero) mediante inventory.hidden.
  const removeMenuItem = useCallback(async (item) => {
    if (item.source === 'custom') {
      let removed = null
      setMenuItems(prev => { removed = prev.find(m => m.id === item.id) || null; return prev.filter(m => m.id !== item.id) })
      if (DEMO_MODE) return
      try {
        await DB.deleteMenuItem(item.id)
        DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'menu_item_delete', entity: 'menu_items', entityId: item.id, detail: { plato: item.name } })
      } catch (err) {
        if (removed) setMenuItems(prev => [...prev, removed])
        throw err
      }
      return
    }
    if (!item.invId) return
    setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, hidden: true } : i))
    if (DEMO_MODE) return DemoInvStore.update(item.invId, { hidden: true })
    try {
      await DB.updateInventoryItem(item.invId, { hidden: true })
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'menu_item_hide', entity: 'inventory', entityId: item.invId, detail: { plato: item.name } })
    } catch (err) {
      // Revertir el ocultamiento optimista — si no se pudo guardar, el plato
      // debe seguir visible en pantalla para no engañar al admin.
      setInventory(prev => prev.map(i => i.id === item.invId ? { ...i, hidden: false } : i))
      console.error('removeMenuItem:', err)
      throw err
    }
  }, [user])

  // Restaura un plato estático previamente "eliminado" (oculto).
  const restoreMenuItem = useCallback(async (invId) => {
    if (!invId) return
    setInventory(prev => prev.map(i => i.id === invId ? { ...i, hidden: false } : i))
    if (DEMO_MODE) return DemoInvStore.update(invId, { hidden: false })
    return DB.updateInventoryItem(invId, { hidden: false }).catch(e => console.error('restoreMenuItem:', e))
  }, [])

  // Descuenta stock al realizar una venta. orderItems = [{id, qty}] — id puede
  // ser el id numérico del menú estático o el uuid de un plato custom.
  const deductStock = useCallback(async (rawItems) => {
    // Junta las líneas del MISMO producto (p. ej. Fuente M. + Fuente G. del
    // mismo plato comparten stock) para descontar una sola vez la suma.
    const merged = new Map()
    for (const oi of rawItems || []) {
      if (!oi || oi.id == null) continue
      const q = Number(oi.qty) || 0
      if (q <= 0) continue
      merged.set(oi.id, (merged.get(oi.id) || 0) + q)
    }
    const orderItems = [...merged.entries()].map(([id, qty]) => ({ id, qty }))
    const staticDeduct = orderItems
      .map(oi => ({ inv: inventory.find(i => i.menuId === oi.id), qty: oi.qty }))
      .filter(x => x.inv && x.inv.stock !== null && x.inv.stock > 0)

    const customDeduct = orderItems
      .map(oi => ({ mi: menuItems.find(m => m.id === oi.id), qty: oi.qty }))
      .filter(x => x.mi && x.mi.stock !== null && x.mi.stock > 0)

    if (!staticDeduct.length && !customDeduct.length) return

    if (staticDeduct.length) {
      setInventory(prev => prev.map(item => {
        const match = staticDeduct.find(x => x.inv.id === item.id)
        if (!match) return item
        const newStock = Math.max(0, (item.stock || 0) - match.qty)
        return { ...item, stock: newStock, available: newStock > 0 ? item.available : false }
      }))
    }
    if (customDeduct.length) {
      setMenuItems(prev => prev.map(item => {
        const match = customDeduct.find(x => x.mi.id === item.id)
        if (!match) return item
        const newStock = Math.max(0, (item.stock || 0) - match.qty)
        return { ...item, stock: newStock, available: newStock > 0 ? item.available : false }
      }))
    }

    if (DEMO_MODE) {
      staticDeduct.forEach(({ inv, qty }) => {
        const newStock = Math.max(0, (inv.stock || 0) - qty)
        DemoInvStore.update(inv.id, { stock: newStock, available: newStock > 0 })
      })
      return
    }

    await Promise.all([
      ...staticDeduct.map(({ inv, qty }) =>
        DB.deductInventoryItem(inv.id, qty).catch(e => console.error('deductInventoryItem:', e))
      ),
      customDeduct.length ? DB.deductMenuStock(customDeduct.map(({ mi, qty }) => ({ id: mi.id, qty })))
        .then(ok => {
          if (ok) return // descuento atómico en la base de datos (migracion-descuento-stock.sql)
          // Respaldo: método anterior, solo si la migración aún no se ejecutó
          return Promise.all(customDeduct.map(({ mi, qty }) => {
            const newStock = Math.max(0, (mi.stock || 0) - qty)
            return DB.updateMenuItem(mi.id, { stock: newStock, ...(newStock === 0 ? { available: false } : {}) })
              .catch(e => console.error('deductMenuItem:', e))
          }))
        })
        .catch(e => console.error('deductMenuStock:', e)) : null,
    ])
  }, [inventory, menuItems])

  // ── Menú "efectivo" — combina el catálogo estático (id, nombre, categoría,
  // porciones) con las anulaciones del inventario (precio, imagen, disponible,
  // oculto, stock) y le suma el catálogo dinámico (platos creados desde el
  // AdminDashboard). Esta es la fuente única que consumen POS, Externos, el
  // panel de Stock y el mesero React para que cualquier cambio — o plato
  // nuevo — se vea reflejado en todas partes al instante.
  const effectiveMenu = useMemo(() => {
    const staticItems = MENU.map(item => {
      const inv = inventory.find(i => i.menuId === item.id)
      if (inv?.hidden) return null // "eliminado" desde Stock
      return {
        id:          item.id,
        source:      'static',
        invId:       inv?.id ?? null,
        cat:         item.cat,
        name:        item.name,
        price:       inv?.price != null ? inv.price : item.price,
        img:         inv?.imgUrl || item.img,
        description: item.portionDesc || null,
        portionTag:  item.portionTag,
        portionDesc: item.portionDesc,
        equivalence: item.equivalence,
        available:   inv?.available ?? true,
        stock:       inv?.stock ?? null,
        alertAt:     inv?.alertAt ?? null,
      }
    }).filter(Boolean)

    const customItems = menuItems.map(mi => ({
      id:          mi.id,
      source:      'custom',
      invId:       null,
      cat:         mi.cat,
      name:        mi.name,
      price:       mi.price,
      img:         mi.imgUrl || IMG_PLACEHOLDER,
      description: mi.description,
      portionTag:  null,
      portionDesc: mi.description,
      equivalence: null,
      available:   mi.available,
      stock:       mi.stock ?? null,
      alertAt:     mi.alertAt ?? null,
      variants:    Array.isArray(mi.variants) ? mi.variants : [],   // tamaños (Fuente P./M./G.)
      cost:        costs[mi.id] ?? null, // solo visible para el admin
    }))

    return [...staticItems, ...customItems]
  }, [inventory, menuItems, costs])

  // Lista de categorías reactiva — incluye las nuevas categorías que el
  // admin haya escrito al crear un plato, además de las 3 originales.
  const effectiveCategories = useMemo(() => {
    const cats = new Set(MENU.map(m => m.cat))
    menuItems.forEach(mi => { if (mi.cat) cats.add(mi.cat) })
    return ['Todos', ...cats]
  }, [menuItems])

  // Platos ocultos ("eliminados") del catálogo estático — se listan aparte en
  // Stock para poder restaurarlos si fue un error.
  const hiddenStaticItems = useMemo(() => MENU
    .map(item => {
      const inv = inventory.find(i => i.menuId === item.id)
      return inv?.hidden ? { id: item.id, name: item.name, cat: item.cat, invId: inv.id } : null
    })
    .filter(Boolean), [inventory])

  const unavailable = effectiveMenu.filter(i => !i.available)
  const lowStock     = effectiveMenu.filter(i => i.stock !== null && i.alertAt != null && i.stock <= i.alertAt)

  return (
    <InventoryCtx.Provider value={{
      inventory, loading, unavailable, lowStock,
      effectiveMenu, effectiveCategories, hiddenStaticItems,
      menuItemsTableMissing,
      toggleAvailable, updateStock, updatePrice, updateImage, deductStock,
      updateAlertAt, addStock, updateCost, costsMissing, getStockMovements,
      addMenuItem, updateMenuItem, removeMenuItem, restoreMenuItem, refreshMenuItems,
    }}>
      {children}
    </InventoryCtx.Provider>
  )
}

export function useInventory() {
  const ctx = useContext(InventoryCtx)
  if (!ctx) throw new Error('useInventory must be used inside InventoryProvider')
  return ctx
}
