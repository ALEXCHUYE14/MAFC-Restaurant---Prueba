/* ══════════════════════════════════════════════════════════════════
   carta.html — CARTA DIGITAL PÚBLICA (solo lectura)
   ══════════════════════════════════════════════════════════════════
   El cliente escanea el QR (Ajustes del admin → Carta digital) y ve los
   platos, bebidas y tragos que se registran en Stock (tabla `menu_items`).

   Garantías de diseño — por qué no puede afectar al resto del sistema:
     · SOLO LEE. No hay un solo insert/update/delete en este archivo.
       Pedidos, mesas, caja y cocina no se tocan.
     · "Mi selección" vive únicamente en el teléfono del cliente
       (localStorage). No se envía a ningún lado: el cliente se la muestra
       al mesero, que toma el pedido como siempre.
     · Bajo consumo de Supabase: 2 consultas livianas (solo las columnas
       necesarias, unos pocos KB), SIN Realtime (cada cliente conectado en
       vivo agotaría el límite de conexiones del plan gratuito) y fotos con
       carga diferida (solo se descargan las que aparecen en pantalla).
     · Se mantiene al día sola: mientras la carta está abierta y visible se
       vuelve a leer cada 2,5 min (agotados, precios, nombre/dirección). Con
       la pantalla apagada o en otra app NO consulta; al volver, actualiza.
     · Copia local de la última carta: si Supabase no responde, se muestra
       la última versión vista en vez de una pantalla vacía.
══════════════════════════════════════════════════════════════════ */
import React from 'react'
import * as ReactDOM from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY } from '@/config/supabaseConfig'
import {
  UtensilsCrossed, Fish, Soup, Salad, Beer, Wine, Coffee, CakeSlice, IceCreamCone,
  Pizza, Drumstick, EggFried, Sandwich, CupSoda, Martini, Flame, Beef, Shell,
  Cookie, GlassWater, Croissant, Search, X, MapPin, Plus, Minus, ShoppingBag,
  BookOpen, ConciergeBell, RefreshCw, Info, Trash2, ImageOff, ScanLine,
} from 'lucide-react'
import { encodeOrderQr } from '@/utils/orderQr'
import { normalizeVariants, hasVariants, findVariant, applyVariant, minVariantPrice } from '@/utils/variants'

const { useState, useEffect, useMemo, useRef, useCallback } = React

const _supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  // Página pública sin login: sin sesión que persistir ni refrescar.
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

/* ── Utilidades ─────────────────────────────────────────────────── */
const BIZ_LS_KEY   = 'antojitos_negocio_cfg_v1' // misma copia que admin/mesero/cocina
const CACHE_KEY    = 'carta_cache_v1'
const SEL_KEY      = 'carta_seleccion_v1'
const DEFAULT_NAME = 'Antojitos al Paso'
const REFRESH_MS   = 150 * 1000 // 2,5 min — solo con la carta visible
const MAX_QTY      = 50

function lsGet(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : null }
  catch { return null }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch { /* modo privado / lleno — se ignora */ }
}

const fmt = n => `S/ ${(Number(n) || 0).toFixed(2)}`

// minúsculas sin tildes — búsqueda y comparación de categorías
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Solo URLs seguras para <img>: http(s) o data:image (fotos antiguas guardadas en la fila)
function safeImg(url) {
  const u = String(url || '').trim()
  if (/^https?:\/\//i.test(u) || /^data:image\//i.test(u)) return u
  return null
}

// "ALMUERZOS" → "Almuerzos" (si el admin la escribió toda en mayúsculas)
function prettyCat(c) {
  const s = String(c || '').trim() || 'Otros'
  if (s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s)) {
    return s.toLowerCase().replace(/(^|\s)(\S)/g, (_, sp, ch) => sp + ch.toUpperCase())
  }
  return s
}

// Ícono y orden de cada categoría según palabras clave (las categorías son
// texto libre en Stock). Comida primero, bebidas y tragos al final — como
// una carta impresa. Lo que no coincide queda en el medio, en orden alfabético.
const CAT_RULES = [
  { k: ['entrada', 'piqueo', 'aperitivo'],              icon: Croissant,       rank: 10 },
  { k: ['desayuno'],                                    icon: EggFried,        rank: 12 },
  { k: ['ceviche', 'marisco', 'pescado', 'tiradito'],   icon: Fish,            rank: 20 },
  { k: ['sopa', 'caldo', 'chilcano', 'aguadito'],       icon: Soup,            rank: 25 },
  { k: ['almuerzo', 'menu', 'criollo', 'segundo', 'plato'], icon: UtensilsCrossed, rank: 30 },
  { k: ['brasa', 'pollo', 'parrilla', 'anticucho'],     icon: Flame,           rank: 35 },
  { k: ['carne', 'res', 'lomo', 'bistec'],              icon: Beef,            rank: 38 },
  { k: ['alita', 'broaster', 'chicharron'],             icon: Drumstick,       rank: 40 },
  { k: ['fast', 'hamburguesa', 'sandwich', 'sanguche', 'salchipapa'], icon: Sandwich, rank: 45 },
  { k: ['pizza'],                                       icon: Pizza,           rank: 46 },
  { k: ['chifa', 'arroz', 'tallarin'],                  icon: Shell,           rank: 48 },
  { k: ['ensalada', 'vegetar', 'vegano'],               icon: Salad,           rank: 50 },
  { k: ['guarnicion', 'adicional', 'extra'],            icon: Cookie,          rank: 70 },
  { k: ['postre', 'dulce', 'torta', 'pastel'],          icon: CakeSlice,       rank: 75 },
  { k: ['helado'],                                      icon: IceCreamCone,    rank: 76 },
  { k: ['cafe', 'infusion', 'te '],                     icon: Coffee,          rank: 80 },
  { k: ['jugo', 'refresco', 'limonada', 'agua'],        icon: GlassWater,      rank: 82 },
  { k: ['bebida', 'gaseosa'],                           icon: CupSoda,         rank: 84 },
  { k: ['cerveza'],                                     icon: Beer,            rank: 88 },
  { k: ['vino'],                                        icon: Wine,            rank: 90 },
  { k: ['trago', 'coctel', 'cocktail', 'licor', 'bar'], icon: Martini,         rank: 92 },
]
function catMeta(cat) {
  const n = ` ${norm(cat)} `
  const rule = CAT_RULES.find(r => r.k.some(k => n.includes(k)))
  return rule ? { icon: rule.icon, rank: rule.rank } : { icon: UtensilsCrossed, rank: 60 }
}

// Fila SQL → plato de la carta (descarta filas sin nombre o precio inválido)
function mapRow(r) {
  if (!r || !r.id) return null
  const name = String(r.name || '').trim()
  const price = Number(r.price)
  if (!name || !isFinite(price) || price < 0) return null
  return {
    id:          String(r.id),
    name,
    cat:         String(r.cat || '').trim() || 'Otros',
    price,
    img:         safeImg(r.img_url),
    description: String(r.description || '').trim(),
    // stock 0 = agotado aunque `available` no se haya actualizado
    available:   r.available !== false && !(r.stock !== null && r.stock !== undefined && Number(r.stock) <= 0),
    variants:    normalizeVariants(r.variants),   // tamaños (Fuente P./M./G.) — [] = precio único
  }
}

// Clave de una línea de la selección: "<id>" o "<id>~<tamaño>"
const selKey = (id, v) => (v ? `${id}~${v}` : String(id))
const splitKey = key => { const i = String(key).indexOf('~'); return i < 0 ? [String(key), null] : [key.slice(0, i), key.slice(i + 1)] }
// Unidades de un producto en la selección, sumando todos sus tamaños
const qtyOfProduct = (sel, id) => Object.entries(sel).reduce((n, [k, q]) => (splitKey(k)[0] === id ? n + q : n), 0)
// Precio a mostrar en la tarjeta: con tamaños, el más bajo ("desde")
const displayPrice = item => (hasVariants(item) ? minVariantPrice(item.variants, item.price) : item.price)

/* ── Datos ──────────────────────────────────────────────────────── */
function readBiz() {
  const c = lsGet(BIZ_LS_KEY) || {}
  return {
    nombre:    String(c.nombre || '').trim() || DEFAULT_NAME,
    direccion: String(c.direccion || '').trim(),
  }
}

function useCarta() {
  const cached = useMemo(() => lsGet(CACHE_KEY), [])
  const [items, setItems]     = useState(() => Array.isArray(cached?.items) ? cached.items : null)
  const [biz, setBiz]         = useState(readBiz)
  const [loading, setLoading] = useState(!Array.isArray(cached?.items))
  const [error, setError]     = useState(false)
  const lastLoad  = useRef(0)
  const inFlight  = useRef(false)
  const lastSig   = useRef(Array.isArray(cached?.items) ? JSON.stringify(cached.items) : '')

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    lastLoad.current = Date.now()
    try {
      const BASE_COLS = 'id, name, cat, price, img_url, description, available, stock'
      let [menuRes, bizRes] = await Promise.all([
        _supabase.from('menu_items')
          .select(BASE_COLS + ', variants')
          .order('created_at', { ascending: true }),
        _supabase.from('negocio_config').select('nombre, direccion').eq('id', 1).maybeSingle(),
      ])
      // migracion-tamanos-platos.sql aún no ejecutada → la carta sigue funcionando
      if (menuRes.error && /variants/i.test(String(menuRes.error.message || ''))) {
        menuRes = await _supabase.from('menu_items').select(BASE_COLS).order('created_at', { ascending: true })
      }
      if (menuRes.error) throw menuRes.error
      const list = (menuRes.data || []).map(mapRow).filter(Boolean)
      // Si nada cambió se conserva la MISMA referencia: sin re-render, sin
      // parpadeo y sin reiniciar la posición de la categoría activa.
      const sig = JSON.stringify(list)
      if (sig !== lastSig.current) {
        lastSig.current = sig
        setItems(list)
        lsSet(CACHE_KEY, { items: list, at: Date.now() })
      }
      setError(false)

      // negocio_config es opcional (migración) — si falla se queda la copia local
      if (!bizRes.error && bizRes.data) {
        const nombre    = String(bizRes.data.nombre || '').trim() || DEFAULT_NAME
        const direccion = String(bizRes.data.direccion || '').trim()
        setBiz(prev => (prev.nombre === nombre && prev.direccion === direccion) ? prev : { nombre, direccion })
      }
    } catch (e) {
      console.warn('[Carta] no se pudo cargar:', e?.message || e)
      setError(true)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const due = () => !document.hidden && Date.now() - lastLoad.current >= REFRESH_MS
    // Revisión periódica: solo consulta si la carta está visible y ya pasó
    // el intervalo (el chequeo cada 30 s no cuesta nada; la consulta sí).
    const timer = setInterval(() => { if (due()) load() }, 30 * 1000)
    // Al volver a la pestaña / desbloquear el teléfono / recuperar internet
    const onVisible = () => { if (due()) load() }
    const onOnline  = () => { if (!document.hidden) load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [load])

  return { items, biz, loading, error, reload: load }
}

// Selección del cliente { id: qty } — solo en este teléfono
function useSelection() {
  const [sel, setSel] = useState(() => {
    const raw = lsGet(SEL_KEY) || {}
    const clean = {}
    for (const [id, q] of Object.entries(raw)) {
      const n = Math.floor(Number(q))
      if (n > 0) clean[id] = Math.min(n, MAX_QTY)
    }
    return clean
  })
  useEffect(() => { lsSet(SEL_KEY, sel) }, [sel])

  const setQty = useCallback((id, qty) => {
    setSel(prev => {
      const n = Math.max(0, Math.min(MAX_QTY, Math.floor(Number(qty) || 0)))
      const next = { ...prev }
      if (n === 0) delete next[id]
      else next[id] = n
      return next
    })
  }, [])
  const clear = useCallback(() => setSel({}), [])
  return { sel, setQty, clear }
}

/* ── Componentes ────────────────────────────────────────────────── */
function Thumb({ src, alt, size = 30 }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <ImageOff size={size} strokeWidth={1.5} aria-hidden="true" />
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />
}

function ItemCard({ item, qty, onOpen }) {
  return (
    <button className={`item${item.available ? '' : ' off'}`} onClick={() => onOpen(item)}
      aria-label={`${item.name}, ${hasVariants(item) ? 'desde ' : ''}${fmt(displayPrice(item))}${item.available ? '' : ', agotado'}`}>
      <div className="item-body">
        <div className="item-name">{item.name}</div>
        {item.description && <div className="item-desc">{item.description}</div>}
        <div className="item-foot">
          <span className="price">{hasVariants(item) && <small style={{ fontWeight: 600, opacity: .7 }}>desde </small>}{fmt(displayPrice(item))}</span>
          {!item.available && <span className="badge out">Agotado</span>}
          {item.available && qty > 0 && <span className="badge qty">{qty} en tu lista</span>}
        </div>
      </div>
      <div className="thumb">
        <Thumb src={item.img} alt={item.name} />
        {item.available && <span className="thumb-add" aria-hidden="true"><Plus size={16} strokeWidth={2.5} /></span>}
      </div>
    </button>
  )
}

function useSheetLock(open, onClose) {
  useEffect(() => {
    if (!open) return
    document.body.classList.add('lock')
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.classList.remove('lock')
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
}

// Plato con tamaños: una fila por tamaño, cada una con su cantidad
function VariantSheet({ item, sel, onClose, onSave }) {
  const [qtys, setQtys] = useState(() => Object.fromEntries(item.variants.map(v => [v.key, sel[selKey(item.id, v.key)] || 0])))
  const [broken, setBroken] = useState(false)
  useSheetLock(true, onClose)
  const img = !broken && item.img
  const total = item.variants.reduce((s, v) => s + v.price * (qtys[v.key] || 0), 0)
  const hadAny = item.variants.some(v => (sel[selKey(item.id, v.key)] || 0) > 0)
  const units = Object.values(qtys).reduce((s, q) => s + q, 0)
  const bump = (k, d) => setQtys(p => ({ ...p, [k]: Math.max(0, Math.min(MAX_QTY, (p[k] || 0) + d)) }))
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <button className="sheet-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <div className="sheet-scroll">
          {img
            ? <img className="sheet-img" src={img} alt={item.name} decoding="async" onError={() => setBroken(true)} />
            : <div className="sheet-img sheet-img-ph"><ImageOff size={40} strokeWidth={1.4} /></div>}
          <div className="sheet-pad">
            <div className="sheet-cat">{prettyCat(item.cat)}</div>
            <h2 className="sheet-title">{item.name}</h2>
            {item.description && <p className="sheet-desc">{item.description}</p>}
            {!item.available ? (
              <div className="notice" style={{ marginTop: 14 }}>
                <Info size={16} style={{ marginTop: 1 }} />
                <span>Este producto está agotado por ahora. Consulta con tu mesero por alternativas.</span>
              </div>
            ) : (
              <div style={{ marginTop: 14 }}>
                {item.variants.map(v => (
                  <div className="sel-row" key={v.key} style={{ padding: '10px 0' }}>
                    <div className="sel-info">
                      <div className="sel-name">{v.label}</div>
                      <div className="sel-price">{fmt(v.price)}</div>
                    </div>
                    <div className="stepper">
                      <button onClick={() => bump(v.key, -1)} disabled={!(qtys[v.key] > 0)} aria-label={`Quitar un ${item.name} ${v.label}`}><Minus size={16} /></button>
                      <span aria-live="polite">{qtys[v.key] || 0}</span>
                      <button onClick={() => bump(v.key, 1)} disabled={(qtys[v.key] || 0) >= MAX_QTY} aria-label={`Agregar un ${item.name} ${v.label}`}><Plus size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        {item.available && (
          <div className="sheet-foot">
            <button className={`btn btn-block ${units === 0 ? 'btn-ghost' : 'btn-primary'}`}
              disabled={units === 0 && !hadAny}
              onClick={() => { item.variants.forEach(v => onSave(selKey(item.id, v.key), qtys[v.key] || 0)); onClose() }}>
              {units === 0
                ? <><Trash2 size={18} /> Quitar de mi lista</>
                : hadAny
                  ? <>Actualizar · {fmt(total)}</>
                  : <><Plus size={18} /> Agregar · {fmt(total)}</>}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function ItemSheet({ item, currentQty, onClose, onSave }) {
  const [qty, setQty] = useState(currentQty > 0 ? currentQty : 1)
  const [broken, setBroken] = useState(false)
  useSheetLock(true, onClose)
  const img = !broken && item.img
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <button className="sheet-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <div className="sheet-scroll">
          {img
            ? <img className="sheet-img" src={img} alt={item.name} decoding="async" onError={() => setBroken(true)} />
            : <div className="sheet-img sheet-img-ph"><ImageOff size={40} strokeWidth={1.4} /></div>}
          <div className="sheet-pad">
            <div className="sheet-cat">{prettyCat(item.cat)}</div>
            <h2 className="sheet-title">{item.name}</h2>
            {item.description && <p className="sheet-desc">{item.description}</p>}
            <div className="sheet-price">{fmt(item.price)}</div>
            {!item.available && (
              <div className="notice" style={{ marginTop: 14 }}>
                <Info size={16} style={{ marginTop: 1 }} />
                <span>Este producto está agotado por ahora. Consulta con tu mesero por alternativas.</span>
              </div>
            )}
          </div>
        </div>
        {item.available && (
          <div className="sheet-foot">
            <div className="stepper">
              <button onClick={() => setQty(q => Math.max(currentQty > 0 ? 0 : 1, q - 1))}
                disabled={qty <= (currentQty > 0 ? 0 : 1)} aria-label="Quitar uno"><Minus size={18} /></button>
              <span aria-live="polite">{qty}</span>
              <button onClick={() => setQty(q => Math.min(MAX_QTY, q + 1))}
                disabled={qty >= MAX_QTY} aria-label="Agregar uno"><Plus size={18} /></button>
            </div>
            <button className={`btn btn-block ${qty === 0 ? 'btn-ghost' : 'btn-primary'}`}
              onClick={() => { onSave(item.id, qty); onClose() }}>
              {qty === 0
                ? <><Trash2 size={18} /> Quitar de mi lista</>
                : currentQty > 0
                  ? <>Actualizar · {fmt(item.price * qty)}</>
                  : <><Plus size={18} /> Agregar · {fmt(item.price * qty)}</>}
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function SelectionSheet({ lines, total, count, onQty, onClear, onShow, onClose }) {
  useSheetLock(true, onClose)
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Mi selección">
        <div className="sheet-grip" />
        <button className="sheet-close" onClick={onClose} aria-label="Cerrar"><X size={18} /></button>
        <h2 className="sheet-h">Mi selección</h2>
        <p className="sheet-sub">{count} {count === 1 ? 'producto' : 'productos'} · muéstrala a tu mesero para hacer tu pedido</p>
        <div className="sheet-scroll">
          {lines.map(({ key, item, qty }) => (
            <div className="sel-row" key={key}>
              <div className="sel-img"><Thumb src={item.img} alt="" size={20} /></div>
              <div className="sel-info">
                <div className="sel-name">{item.name}</div>
                <div className="sel-price">{fmt(item.price)} c/u</div>
              </div>
              <div className="stepper">
                <button onClick={() => onQty(key, qty - 1)} aria-label={`Quitar un ${item.name}`}>
                  {qty === 1 ? <Trash2 size={16} /> : <Minus size={16} />}
                </button>
                <span>{qty}</span>
                <button onClick={() => onQty(key, qty + 1)} disabled={qty >= MAX_QTY} aria-label={`Agregar un ${item.name}`}><Plus size={16} /></button>
              </div>
            </div>
          ))}
          <div className="sel-total"><span>Total referencial</span><strong>{fmt(total)}</strong></div>
          <div style={{ padding: '0 20px 14px' }}>
            <div className="notice" style={{ marginTop: 0 }}>
              <Info size={16} style={{ marginTop: 1 }} />
              <span>Esta lista no se envía automáticamente. Tu pedido se confirma con tu mesero.</span>
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClear} aria-label="Vaciar selección"><Trash2 size={18} /></button>
          <button className="btn btn-accent btn-block" onClick={onShow}><ConciergeBell size={18} /> Mostrar al mesero</button>
        </div>
      </div>
    </>
  )
}

// QR del pedido para que el mesero lo escanee desde su app. Solo lleva
// "qué producto y cuántos" (ver src/utils/orderQr.js) — se genera en el
// teléfono del cliente: no consulta ni escribe nada en la base de datos.
function OrderQr({ lines }) {
  const [img, setImg]   = useState(null)
  const [fail, setFail] = useState(false)
  const enc = useMemo(() => encodeOrderQr(lines.map(l => ({ id: l.id, v: l.v, qty: l.qty }))), [lines])

  useEffect(() => {
    let alive = true
    setFail(false)
    if (!enc.included) { setImg(null); return }
    import('qrcode')
      .then(mod => (mod.default || mod).toDataURL(enc.text, {
        errorCorrectionLevel: enc.text.length > 400 ? 'L' : 'M', margin: 2, width: 640,
        color: { dark: '#000000', light: '#FFFFFF' },
      }))
      .then(url => { if (alive) setImg(url) })
      .catch(() => { if (alive) { setImg(null); setFail(true) } })
    return () => { alive = false }
  }, [enc])

  if (fail || !enc.included) return null
  return (
    <div className="qr-box">
      <div className="qr-frame">
        {img ? <img src={img} alt="Código QR de tu pedido" /> : <div className="skel" style={{ width: '100%', height: '100%' }} />}
      </div>
      <div className="qr-cap"><ScanLine size={16} /> Tu mesero escanea este código para tomar tu pedido</div>
      {enc.omitted > 0 && (
        <div className="qr-warn">Tu lista es muy larga para un solo código: {enc.omitted} {enc.omitted === 1 ? 'producto no entró' : 'productos no entraron'}. El mesero los verá en la lista de abajo.</div>
      )}
    </div>
  )
}

function ShowToWaiter({ lines, total, bizName, onClose }) {
  useSheetLock(true, onClose)
  return (
    <div className="show" role="dialog" aria-modal="true" aria-label="Pedido para el mesero">
      <div className="show-inner">
        <div className="show-head">
          <div>
            <div className="sheet-cat">{bizName}</div>
            <div className="show-title">Mi pedido</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <OrderQr lines={lines} />
        <div className="show-list">
          {lines.map(({ key, item, qty }) => (
            <div className="show-row" key={key}>
              <span className="show-qty">{qty}×</span>
              <span className="show-name">{item.name}</span>
              <span className="show-sub">{fmt(item.price * qty)}</span>
            </div>
          ))}
        </div>
        <div className="show-total"><span>Total referencial</span><strong>{fmt(total)}</strong></div>
        <div className="notice"><Info size={16} style={{ marginTop: 1 }} /><span>El precio final lo confirma el mesero al tomar tu pedido.</span></div>
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid" style={{ paddingTop: 26 }} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="item" style={{ boxShadow: 'none' }}>
          <div className="item-body">
            <div className="skel" style={{ height: 16, width: '70%' }} />
            <div className="skel" style={{ height: 12, width: '90%', marginTop: 10 }} />
            <div className="skel" style={{ height: 16, width: 70, marginTop: 'auto' }} />
          </div>
          <div className="thumb skel" />
        </div>
      ))}
    </div>
  )
}

function App() {
  const { items, biz, loading, error, reload } = useCarta()
  const { sel, setQty, clear } = useSelection()
  const [query, setQuery]       = useState('')
  const [activeCat, setActive]  = useState(null)
  const [openId, setOpenId]     = useState(null)
  const [notice, setNotice]     = useState('')
  const [showSel, setShowSel]   = useState(false)
  const [showWaiter, setShowWaiter] = useState(false)
  const sectionRefs = useRef({})
  const chipsRef    = useRef(null)
  const jumping     = useRef(false)

  useEffect(() => { document.title = `Carta · ${biz.nombre}` }, [biz.nombre])

  // Agrupa por categoría (sin distinguir mayúsculas/tildes) y ordena
  const sections = useMemo(() => {
    if (!items) return []
    const q = norm(query)
    const groups = new Map()
    for (const it of items) {
      if (q && !norm(`${it.name} ${it.description} ${it.cat}`).includes(q)) continue
      const key = norm(it.cat) || 'otros'
      if (!groups.has(key)) groups.set(key, { key, title: prettyCat(it.cat), ...catMeta(it.cat), items: [] })
      groups.get(key).items.push(it)
    }
    const list = [...groups.values()]
    // dentro de cada sección: disponibles primero, luego por nombre
    list.forEach(g => g.items.sort((a, b) => (b.available - a.available) || a.name.localeCompare(b.name, 'es')))
    return list.sort((a, b) => (a.rank - b.rank) || a.title.localeCompare(b.title, 'es'))
  }, [items, query])

  // Líneas de la selección con datos vigentes (descarta lo eliminado o agotado)
  const lines = useMemo(() => {
    if (!items) return []
    const byId = new Map(items.map(i => [i.id, i]))
    return Object.entries(sel)
      .map(([key, qty]) => {
        const [id, v] = splitKey(key)
        const base = byId.get(id)
        if (!base) return null
        if (hasVariants(base)) {
          const variant = findVariant(base, v)
          if (!variant) return null                      // tamaño que ya no existe
          return { key, id, v, qty, item: applyVariant(base, variant) }
        }
        if (v) return null                                // el plato ya no tiene tamaños
        return { key, id, v: null, qty, item: base }
      })
      .filter(l => l && l.item.available && l.qty > 0)
  }, [items, sel])
  const count = lines.reduce((s, l) => s + l.qty, 0)
  const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0)

  // El detalle abierto se lee SIEMPRE de los datos vigentes: si el precio o
  // la disponibilidad cambian mientras el cliente lo mira, se ve al instante.
  // Si el plato se eliminó de Stock, el detalle se cierra solo.
  const openItem = useMemo(() => (items && openId ? items.find(i => i.id === openId) || null : null), [items, openId])
  useEffect(() => { if (openId && items && !openItem) setOpenId(null) }, [openId, items, openItem])

  // Limpia de la selección lo que ya no existe o se agotó — y lo AVISA
  // (no debe desaparecer de la lista del cliente sin explicación).
  useEffect(() => {
    if (!items) return
    const valid = new Set(lines.map(l => l.key))
    const stale = Object.keys(sel).filter(k => !valid.has(k))
    if (!stale.length) return
    const byId = new Map(items.map(i => [i.id, i]))
    const names = [...new Set(stale.map(k => byId.get(splitKey(k)[0])?.name).filter(Boolean))]
    stale.forEach(k => setQty(k, 0))
    if (names.length) {
      setNotice(`${names.join(', ')} ${names.length === 1 ? 'se agotó y se quitó' : 'se agotaron y se quitaron'} de tu lista.`)
    } else {
      setNotice('Algunos productos ya no están disponibles y se quitaron de tu lista.')
    }
  }, [items, lines, sel, setQty])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  // Si la lista queda vacía, cierra las vistas de selección
  useEffect(() => { if (count === 0) { setShowSel(false); setShowWaiter(false) } }, [count])

  // Categoría activa según la sección visible (scroll-spy)
  useEffect(() => {
    if (!sections.length || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(entries => {
      if (jumping.current) return
      const visible = entries.filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (visible) setActive(visible.target.dataset.key)
    }, { rootMargin: '-140px 0px -55% 0px', threshold: 0 })
    sections.forEach(s => { const el = sectionRefs.current[s.key]; if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [sections])

  // Mantiene visible el chip activo dentro de la barra horizontal
  useEffect(() => {
    if (!activeCat || !chipsRef.current) return
    // Búsqueda por dataset (no por selector CSS): la clave es texto libre del admin
    const chip = [...chipsRef.current.children].find(c => c.dataset.key === activeCat)
    if (chip) chip.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [activeCat])

  const jumpTo = key => {
    const el = sectionRefs.current[key]
    if (!el) return
    setActive(key)
    jumping.current = true
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => { jumping.current = false }, 700)
  }

  const closeItem    = useCallback(() => setOpenId(null), [])
  const closeSel     = useCallback(() => setShowSel(false), [])
  const closeWaiter  = useCallback(() => setShowWaiter(false), [])
  const totalItems   = items ? items.length : 0

  return (
    <>
      <header className="hero">
        <img className="hero-logo" src="/img/logo/logo.png" alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
        <div className="hero-eyebrow"><BookOpen size={14} /> Carta digital</div>
        <h1 className="hero-name">{biz.nombre}</h1>
        {biz.direccion && (
          <div className="hero-addr"><MapPin size={14} /><span>{biz.direccion}</span></div>
        )}
      </header>

      <div className="bar">
        <div className="wrap">
          <label className="search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar plato, bebida o trago" aria-label="Buscar en la carta"
              enterKeyHint="search" autoComplete="off"
            />
            {query && <button className="search-clear" onClick={() => setQuery('')} aria-label="Borrar búsqueda"><X size={16} /></button>}
          </label>
          {sections.length > 1 && (
            <nav className="chips" ref={chipsRef} aria-label="Categorías">
              {sections.map(s => (
                <button key={s.key} data-key={s.key}
                  className={`chip${activeCat === s.key ? ' on' : ''}`} onClick={() => jumpTo(s.key)}>
                  <s.icon size={16} strokeWidth={1.9} /> {s.title}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>

      <main className="wrap">
        {loading && !items && <Skeleton />}

        {!loading && !items && error && (
          <div className="state">
            <div className="state-icon"><RefreshCw size={28} /></div>
            <h2>No pudimos cargar la carta</h2>
            <p>Revisa tu conexión a internet e inténtalo nuevamente.</p>
            <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={reload}><RefreshCw size={18} /> Reintentar</button>
          </div>
        )}

        {items && totalItems === 0 && (
          <div className="state">
            <div className="state-icon"><UtensilsCrossed size={28} /></div>
            <h2>Estamos preparando nuestra carta</h2>
            <p>Pronto verás aquí nuestros platos, bebidas y tragos.</p>
          </div>
        )}

        {items && totalItems > 0 && sections.length === 0 && (
          <div className="state">
            <div className="state-icon"><Search size={28} /></div>
            <h2>Sin resultados</h2>
            <p>No encontramos “{query}”. Prueba con otra palabra.</p>
            <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={() => setQuery('')}>Ver toda la carta</button>
          </div>
        )}

        {sections.map(s => (
          <section key={s.key} className="section" data-key={s.key}
            ref={el => { if (el) sectionRefs.current[s.key] = el; else delete sectionRefs.current[s.key] }}
            aria-labelledby={`sec-${s.key}`}>
            <div className="section-head">
              <div className="section-icon"><s.icon size={20} strokeWidth={1.9} /></div>
              <div style={{ minWidth: 0 }}>
                <h2 className="section-title" id={`sec-${s.key}`}>{s.title}</h2>
                <div className="section-count">{s.items.length} {s.items.length === 1 ? 'opción' : 'opciones'}</div>
              </div>
              <div className="section-rule" />
            </div>
            <div className="grid">
              {s.items.map(it => <ItemCard key={it.id} item={it} qty={qtyOfProduct(sel, it.id)} onOpen={i => setOpenId(i.id)} />)}
            </div>
          </section>
        ))}

        {items && totalItems > 0 && (
          <footer className="site">
            <div><strong>{biz.nombre}</strong></div>
            <div style={{ marginTop: 4 }}>Precios en soles (S/) · sujetos a disponibilidad</div>
            {error && <div style={{ marginTop: 8 }}>Mostrando la última carta guardada · sin conexión</div>}
          </footer>
        )}
      </main>

      {count > 0 && !showSel && !showWaiter && !openItem && (
        <div className="dock">
          <button className="dock-btn" onClick={() => setShowSel(true)}>
            <ShoppingBag size={20} />
            <span className="dock-label">Mi selección</span>
            <span className="dock-count">{count}</span>
            <span className="dock-total">{fmt(total)}</span>
          </button>
        </div>
      )}

      {notice && (
        <div className="toast" role="status" aria-live="polite">
          <Info size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{notice}</span>
          <button onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={16} /></button>
        </div>
      )}

      {openItem && (hasVariants(openItem)
        ? <VariantSheet key={openItem.id} item={openItem} sel={sel} onClose={closeItem} onSave={setQty} />
        : <ItemSheet key={openItem.id} item={openItem} currentQty={sel[openItem.id] || 0}
            onClose={closeItem} onSave={setQty} />
      )}
      {showSel && count > 0 && (
        <SelectionSheet lines={lines} total={total} count={count} onQty={setQty}
          onClear={() => { clear(); setShowSel(false) }}
          onShow={() => { setShowSel(false); setShowWaiter(true) }}
          onClose={closeSel} />
      )}
      {showWaiter && count > 0 && (
        <ShowToWaiter lines={lines} total={total} bizName={biz.nombre} onClose={closeWaiter} />
      )}
    </>
  )
}

/* ── Error boundary: nunca una pantalla en blanco ───────────────── */
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { console.error('[Carta]', err) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="state">
        <div className="state-icon"><RefreshCw size={28} /></div>
        <h2>Algo salió mal</h2>
        <p>Recarga la página para ver la carta.</p>
        <button className="btn btn-primary" style={{ marginTop: 18 }} onClick={() => window.location.reload()}>Recargar</button>
      </div>
    )
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary><App /></ErrorBoundary>
)
