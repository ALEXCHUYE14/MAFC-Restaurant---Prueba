/**
 * offlineDB.js — Capa de persistencia local con IndexedDB
 *
 * Base de datos: antojitos_pos_v1
 * Stores:
 *   · orders      — Copia local de los pedidos (keyPath: 'id')
 *   · tables      — Estado de las mesas       (keyPath: 'id')
 *   · sync_queue  — Cola de operaciones pendientes (keyPath: 'id')
 *
 * Diseño:
 *   - Todos los métodos devuelven Promises.
 *   - Singleton: la conexión IDB se abre una sola vez y se reutiliza.
 *   - Sin dependencias externas (cero imports).
 */

const DB_NAME    = 'antojitos_pos_v1'
const DB_VERSION = 1

/** @type {Promise<IDBDatabase>} */
let _dbPromise = null

function getDB() {
  if (_dbPromise) return _dbPromise

  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = evt => {
      const db = evt.target.result

      if (!db.objectStoreNames.contains('orders')) {
        const s = db.createObjectStore('orders', { keyPath: 'id' })
        s.createIndex('by_created', 'created_at', { unique: false })
        s.createIndex('by_status',  'status',     { unique: false })
      }

      if (!db.objectStoreNames.contains('tables')) {
        db.createObjectStore('tables', { keyPath: 'id' })
      }

      if (!db.objectStoreNames.contains('sync_queue')) {
        const s = db.createObjectStore('sync_queue', { keyPath: 'id' })
        s.createIndex('by_time',   'timestamp', { unique: false })
        s.createIndex('by_status', 'status',    { unique: false })
      }
    }

    req.onsuccess = evt => resolve(evt.target.result)
    req.onerror   = evt => {
      console.error('[OfflineDB] Error al abrir IndexedDB:', evt.target.error)
      _dbPromise = null  // permite reintentar
      reject(evt.target.error)
    }
  })

  return _dbPromise
}

/** Envuelve un IDBRequest en una Promise */
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

/** Abre una transacción y ejecuta fn(store) → si devuelve IDBRequest lo envuelve */
async function withStore(storeName, mode, fn) {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result
    try { result = fn(store) } catch (e) { reject(e); return }

    if (result && typeof result.onsuccess !== 'undefined') {
      result.onsuccess = () => resolve(result.result)
      result.onerror   = () => reject(result.error)
    } else {
      tx.oncomplete = () => resolve(result)
      tx.onerror    = ()  => reject(tx.error)
      tx.onabort    = ()  => reject(new Error('IDB transaction aborted'))
    }
  })
}

/* ── ORDERS ──────────────────────────────────────────────────────────────── */

/** Guarda (insert o replace) un pedido en IndexedDB */
export const saveOrder   = order => withStore('orders', 'readwrite', s => s.put(order))

/** Obtiene todos los pedidos guardados localmente */
export const getOrders   = ()  => withStore('orders', 'readonly',  s => s.getAll())

/** Obtiene un pedido por id */
export const getOrder    = id  => withStore('orders', 'readonly',  s => s.get(id))

/** Elimina un pedido de IndexedDB */
export const deleteOrder = id  => withStore('orders', 'readwrite', s => s.delete(id))

/** Guarda un array de pedidos en una sola transacción (bulk) */
export async function saveOrdersBulk(orders) {
  if (!orders?.length) return
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('orders', 'readwrite')
    const store = tx.objectStore('orders')
    orders.forEach(o => store.put(o))
    tx.oncomplete = resolve
    tx.onerror    = reject
  })
}

/* ── TABLES ──────────────────────────────────────────────────────────────── */

/** Guarda una mesa en IndexedDB */
export const saveTable   = table  => withStore('tables', 'readwrite', s => s.put(table))

/** Obtiene todas las mesas guardadas */
export const getTables   = ()     => withStore('tables', 'readonly',  s => s.getAll())

/** Guarda un array de mesas en una sola transacción */
export async function saveTablesBulk(tables) {
  if (!tables?.length) return
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('tables', 'readwrite')
    const store = tx.objectStore('tables')
    tables.forEach(t => store.put(t))
    tx.oncomplete = resolve
    tx.onerror    = reject
  })
}

/* ── SYNC QUEUE ──────────────────────────────────────────────────────────── */

/**
 * Estructura de un item de la cola:
 * {
 *   id:        string (UUID),
 *   timestamp: number,
 *   status:    'pending' | 'syncing' | 'failed',
 *   retries:   number,
 *   entity:    'orders' | 'mesas',
 *   op:        'INSERT' | 'UPDATE' | 'DELETE',
 *   entityId:  string,   — ID del recurso afectado
 *   data:      object,   — Payload completo para Supabase (sin _pendingSync)
 * }
 */

/** Agrega una operación a la cola de sincronización */
export async function addToQueue(item) {
  const entry = {
    id:        crypto.randomUUID(),
    timestamp: Date.now(),
    status:    'pending',
    retries:   0,
    ...item,
  }
  await withStore('sync_queue', 'readwrite', s => s.add(entry))
  return entry
}

/** Devuelve todos los items pendientes de la cola, ordenados por timestamp */
export async function getQueue() {
  const all = await withStore('sync_queue', 'readonly', s => s.getAll())
  return all
    .filter(i => i.status !== 'done')
    .sort((a, b) => a.timestamp - b.timestamp)
}

/** Elimina un item de la cola (operación sincronizada exitosamente) */
export const removeFromQueue = id => withStore('sync_queue', 'readwrite', s => s.delete(id))

/** Actualiza un item de la cola (ej: incrementar retries) */
export async function updateQueueItem(id, patch) {
  const db = await getDB()
  return new Promise((resolve, reject) => {
    const tx    = db.transaction('sync_queue', 'readwrite')
    const store = tx.objectStore('sync_queue')
    const get   = store.get(id)
    get.onsuccess = () => {
      if (!get.result) { resolve(); return }
      const put = store.put({ ...get.result, ...patch })
      put.onsuccess = resolve
      put.onerror   = reject
    }
    get.onerror = reject
  })
}

/** Cuenta cuántos items están en estado 'pending' */
export async function getPendingCount() {
  const queue = await getQueue()
  return queue.filter(i => i.status === 'pending').length
}

/** Elimina TODOS los items de la cola (usar con cuidado) */
export const clearQueue = () => withStore('sync_queue', 'readwrite', s => s.clear())
