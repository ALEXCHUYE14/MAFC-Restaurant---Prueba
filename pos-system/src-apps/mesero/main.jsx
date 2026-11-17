/* ══════════════════════════════════════════════════════════════════
   mesero.html — ahora servido vía el build de Vite en vez de
   Babel-Standalone transpilando en el navegador en cada carga.
   ══════════════════════════════════════════════════════════════════
   Todo lo que sigue después de este preámbulo es EXACTAMENTE el mismo
   código que corría inline en public/mesero.html — se extrajo línea
   por línea, sin reescribir nada, para no arriesgar ningún cambio de
   comportamiento en la app de la que depende toda la operación diaria
   del local. Los únicos cambios reales están en este preámbulo:
     - React/ReactDOM/supabase-js ahora se importan como paquetes npm
       (compilados/minificados en el build) en vez de cargarse desde
       un CDN + Babel-Standalone en cada visita.
     - Se quitó el guard "si el CDN de Supabase no cargó" — ya no
       aplica: el cliente de Supabase ahora es un import, no un script
       que pueda fallar en cargar por separado.
══════════════════════════════════════════════════════════════════ */
import React from 'react'
import * as ReactDOM from 'react-dom/client'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY } from '@/config/supabaseConfig'
import {
  Flame, Sandwich, CupSoda, Martini, UtensilsCrossed,
  Banknote, CreditCard, Smartphone, Printer, Trash2, Plus, PlusCircle,
  Check, CheckCircle2, X, XCircle, Zap, Lock, Star, Loader2, ShoppingCart,
  Armchair, Ruler, NotebookPen, ChefHat, AlertTriangle, Ban, Moon, Sun,
  Bike, Store, MapPin, ShoppingBag, BarChart3, RotateCw, Share2, Copy, KeyRound, Split, Bluetooth,
  Bell, ScanLine, CameraOff, ImagePlus, Wifi, Link2, Unlink, UserRound, UserPlus, Gift,
} from 'lucide-react'
import { decodeOrderQr } from '@/utils/orderQr'
import { normalizeVariants, hasVariants, applyVariant, findVariant, lineIdFromLine, minVariantPrice } from '@/utils/variants'
import { clampPackaging, packagingTotal, itemsTotal, fetchPackagingConfig, PACKAGING_MAX } from '@/utils/packaging'
import { normalizeDoc, crmErrorMessage, isCrmMissing, discountAmount } from '@/utils/crm'

const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ══════════════════════════════════════════════
   ERROR BOUNDARY — nunca dejar la pantalla en negro
   ══════════════════════════════════════════════
   Este archivo no tenía ningún Error Boundary — una excepción sin
   capturar durante el render tumbaba TODO el árbol de React y dejaba
   solo el fondo de <body> visible (pantalla negra en modo oscuro).
   Envuelve <App/> al final del archivo: si algo se rompe, el mesero
   ve un aviso con el error real y un botón para recargar — nunca una
   pantalla vacía sin ninguna pista de qué pasó. */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', this.props.label || '', error, info && info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 20, margin: 10, borderRadius: 12,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#DC2626', fontSize: 13, lineHeight: 1.6,
        }}>
          <strong>⚠️ {this.props.label || 'Algo salió mal'}</strong>
          <div style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: 11, opacity: .85, wordBreak: 'break-word' }}>
            {String((this.state.error && this.state.error.message) || this.state.error)}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 10, padding: '8px 18px', borderRadius: 8, border: 'none', background: '#DC2626', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 13 }}
          >Recargar página</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Placeholder de imagen — se usa cuando una foto de plato (URL rota,
   data-URI corrupto, sin conexión) falla al cargar, para nunca dejar un
   hueco roto en el diseño del menú. ── */
const IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
  '<rect width="100" height="100" fill="#334155"/>' +
  '<g fill="none" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="50" cy="40" r="16"/><path d="M22 82c0-15 12-27 28-27s28 12 28 27"/></g></svg>'
);
function imgFallback(e) {
  const el = e && (e.currentTarget || e.target);
  if (!el || el.src === IMG_PLACEHOLDER) return;
  el.src = IMG_PLACEHOLDER;
}

/* ══════════════════════════════════════════════
   SUPABASE — cliente y funciones de pedidos
══════════════════════════════════════════════ */
const _supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    // mesero.html NUNCA usa sesiones de Supabase Auth — el login es propio
    // (PIN por mesero, ver Login/verifyMeseroPinOrFallback), toda operación
    // real pasa siempre con la misma anon key. Sin esto, el cliente igual
    // levanta internamente un GoTrueClient que coordina pestañas vía
    // navigator.locks sobre "sb-...-auth-token" — si la app queda abierta
    // en más de una pestaña/ventana del mismo dispositivo, ese lock puede
    // ser "robado" entre pestañas y cualquier request falla con "Lock ...
    // was released because another request stole it" (el mismo bug
    // reportado y corregido en cocina.html). Desactivar sesión/autorefresh
    // apaga ese mecanismo por completo — no hay nada que coordinar entre
    // pestañas si no hay sesión que persistir. Cero impacto funcional.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }
);

/* ══════════════════════════════════════════════
   DATOS DEL NEGOCIO — se editan en AdminDashboard → Ajustes
   ══════════════════════════════════════════════
   Nombre, RUC/DNI, dirección y datos de Yape (número, titular, QR) ya no
   están escritos a mano: viven en la fila única `negocio_config` (mismo
   patrón que `caja_estado`) y el admin los cambia desde Ajustes.
   BIZ arranca con EXACTAMENTE los valores que estaban fijos en este
   archivo (y con la copia local que guarde el dispositivo); si la tabla
   no existe o Supabase no responde, todo sale como siempre — nada se
   bloquea. Las funciones de ticket leen BIZ en el momento de imprimir;
   los modales usan useBiz() para refrescarse si el admin cambia algo. */
const BIZ_LS_KEY = 'antojitos_negocio_cfg_v1'; // misma clave que usa el panel admin (mismo origen)
const BIZ_DEFAULT = {
  nombre: 'Antojitos al Paso', tipoDocumento: 'RUC', documento: '10456789012',
  direccion: 'Jr. Zepita #349 - Catacaos', yapeNumero: '982 936 262',
  yapeTitular: 'Leonidas Juarez S.', yapeQrUrl: null,
};
let BIZ = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(BIZ_LS_KEY) || 'null');
    return { ...BIZ_DEFAULT, ...(c && typeof c === 'object' ? c : {}) };
  } catch (_) { return { ...BIZ_DEFAULT }; }
})();
const _bizListeners = new Set();

// Fila SQL (o parche parcial de Realtime) → BIZ. Solo toca las claves presentes:
// un UPDATE de Realtime puede omitir columnas grandes sin cambios (el QR) y no
// debe borrarlas del estado local.
function applyBizRow(r) {
  if (!r) return;
  const p = {};
  if ('nombre'         in r) p.nombre        = (r.nombre || '').trim() || BIZ_DEFAULT.nombre;
  if ('tipo_documento' in r) p.tipoDocumento = r.tipo_documento === 'DNI' ? 'DNI' : 'RUC';
  if ('documento'      in r) p.documento     = r.documento || '';
  if ('direccion'      in r) p.direccion     = r.direccion || '';
  if ('yape_numero'    in r) p.yapeNumero    = r.yape_numero || '';
  if ('yape_titular'   in r) p.yapeTitular   = r.yape_titular || '';
  if ('yape_qr_url'    in r) p.yapeQrUrl     = r.yape_qr_url || null;
  BIZ = { ...BIZ, ...p };
  try { localStorage.setItem(BIZ_LS_KEY, JSON.stringify(BIZ)); } catch (_) {}
  _bizListeners.forEach(fn => { try { fn(BIZ); } catch (_) {} });
}
function useBiz() {
  const [b, setB] = useState(BIZ);
  useEffect(() => {
    _bizListeners.add(setB);
    setB(BIZ); // por si cambió entre el primer render y el montaje
    return () => { _bizListeners.delete(setB); };
  }, []);
  return b;
}
// Nombre visible del negocio — nunca vacío (si el admin lo deja en blanco o la
// copia local está corrupta, cae al valor por defecto).
const bizName = (b = BIZ) => String((b && b.nombre) || '').trim() || BIZ_DEFAULT.nombre;
// Dirección / localidad / ciudad desde Ajustes, para los textos cortos de pantalla.
// MISMA regla que businessLocality() en src/services/businessConfig.js:
//   "Jr. Zepita #349 - Catacaos, Piura" → localidad "Catacaos, Piura", ciudad "Catacaos"
//   sin " - " ni coma / vacía → '' (la parte se omite; nunca se muestra la calle como ciudad)
const bizAddress  = (b = BIZ) => String((b && b.direccion) || '').trim();
const bizLocality = (b = BIZ) => {
  const dir = bizAddress(b);
  if (!dir) return '';
  const parts = dir.split(/\s+[-–—]\s+/);
  if (parts.length > 1) return parts[parts.length - 1].trim();
  const comma = dir.indexOf(',');
  return comma >= 0 ? dir.slice(comma + 1).trim() : '';
};
const bizCity = (b = BIZ) => bizLocality(b).split(',')[0].trim();
// "RUC: 1045…" / "DNI: …" — vacío si no hay documento cargado (el ticket omite la línea)
const bizDocLine = () => {
  const d = (BIZ.documento || '').trim();
  return d ? `${BIZ.tipoDocumento === 'DNI' ? 'DNI' : 'RUC'}: ${d}` : '';
};

/* ══════════════════════════════════════════════
   MÉTODOS DE PAGO — Tarjeta/Plin + Pago Mixto (cobro dividido)
   ══════════════════════════════════════════════
   Mismas reglas que el panel admin (src/utils/payments.js) — duplicadas
   aquí porque mesero.html es un bundle de Vite independiente que no puede
   importar de src/ (ver "DATOS DEL NEGOCIO" más arriba, mismo motivo).
   Mantener ambas copias en sync si se cambia algo acá.
   'mixto' se guarda en orders.payment_breakdown (jsonb) — ver
   migracion-pago-mixto.sql, que además valida la suma en el SERVIDOR con
   un trigger: aunque este código tuviera un bug, Postgres rechaza un
   desglose que no cuadre con el total. */
const PAYMENT_METHODS_M = [
  { key: 'efectivo', icon: '💵', label: 'Efectivo', color: '#2ecc71' },
  { key: 'tarjeta',  icon: '💳', label: 'Tarjeta',  color: '#3b9eff' },
  { key: 'yape',     icon: '📱', label: 'Yape',     color: '#742eff' },
  { key: 'plin',     icon: '📱', label: 'Plin',     color: '#0ea5e9' },
];
// El campo `icon` (emoji) de arriba sigue usándose en texto plano (toasts,
// reportes de turno, tickets impresos — una impresora térmica no entiende
// SVG). Este mapa es SOLO para los botones/tarjetas visuales (JSX).
const PAYMENT_ICON_SVG = { efectivo: Banknote, tarjeta: CreditCard, yape: Smartphone, plin: Smartphone };

function buildPayStatusM(method) {
  if (method === 'mixto') return 'Pagado - Mixto';
  const found = PAYMENT_METHODS_M.find(m => m.key === method);
  return `Pagado - ${found ? found.label : 'Efectivo'}`;
}

function validateBreakdownM(legs, total) {
  const cents = v => Math.round((Number(v) || 0) * 100);
  const clean = (legs || []).filter(l => l && l.metodo && Number(l.monto) > 0);
  if (clean.length === 0) return { ok: false, message: 'Ingresa al menos un monto' };
  if (clean.length === 1) return { ok: false, message: 'Un pago dividido necesita al menos 2 métodos' };
  const usados = new Set(clean.map(l => l.metodo));
  if (usados.size !== clean.length) return { ok: false, message: 'No repitas el mismo método de pago' };
  const suma = clean.reduce((s, l) => s + cents(l.monto), 0);
  const totalCents = cents(total);
  if (suma !== totalCents) {
    return {
      ok: false,
      message: suma < totalCents
        ? `Falta S/ ${((totalCents - suma) / 100).toFixed(2)} para completar el total`
        : `Te pasaste por S/ ${((suma - totalCents) / 100).toFixed(2)} del total`,
    };
  }
  return { ok: true, message: '', legs: clean };
}

async function saveOrderToSupabase(mesa, items, waiter, zone, round1, pack = null, clienteId = null) {
  // Envases descartables (migracion-envases.sql): la base recalcula su monto
  // y el total; aquí se envía la cantidad y el total esperado.
  const packCount = pack ? clampPackaging(pack.count) : 0;
  const total = itemsTotal(items) + packagingTotal(packCount, pack && pack.unit);
  const baseItems = items.map(i => ({
    id: i.id, name: i.name, price: i.price,
    qty: i.qty, note: i.note || '', portionTag: i.portionTag,
    lineId: lineIdFromLine(i), variantKey: i.variantKey || null, variantLabel: i.variantLabel || null,
    sentQty: i.qty, // primer envío: todo el carrito queda marcado como enviado a cocina
    ...(i.cortesia ? { cortesia: true } : {}),
  }));
  const payload = {
    table_number:  mesa,
    zone:          zone,
    waiter_id:     waiter.id,
    waiter_name:   waiter.name,
    items: baseItems,
    status:  'pending',
    total:   parseFloat(total.toFixed(2)),
    payment_method: null,
    // rounds = historial de envíos a cocina — el primero es la RONDA 1 / NUEVA COMANDA.
    rounds: [round1],
    created_at: new Date().toISOString(),
    ...(packCount > 0 ? { packaging_count: packCount } : {}),
    // Ficha del cliente (migracion-clientes-crm.sql) — solo si se identificó
    ...(clienteId ? { cliente_id: clienteId } : {}),
  };
  let { data, error } = await _supabase.from('orders').insert(payload).select().single();
  if (error && /rounds/i.test(error.message || '')) {
    // Migración de la columna `rounds` aún no aplicada en Supabase —
    // reintenta sin esa columna para no romper el envío de pedidos.
    const { rounds, ...fallback } = payload;
    ({ data, error } = await _supabase.from('orders').insert(fallback).select().single());
  }
  if (error) {
    const msg = String(error.message || '');
    console.warn('Supabase insert error:', msg);
    // migracion-concurrencia-mesas.sql: la mesa ya tiene un pedido abierto
    if (/MESA_OCUPADA/.test(msg)) throw new Error('MESA_OCUPADA');
    // migracion-unir-mesas.sql: la mesa está unida a otra (la cuenta va en la principal)
    const unida = /MESA_UNIDA:(\d+)/.exec(msg);
    if (unida) { const err = new Error('MESA_UNIDA'); err.principal = Number(unida[1]); throw err; }
    throw new Error(msg || 'SAVE_FAILED');
  }
  return data?.id || null;
}

/* Pedido ABIERTO de una mesa (el más reciente, últimas 18 h) — se usa cuando
   la base de datos rechaza crear otro pedido para esa mesa (MESA_OCUPADA). */
async function fetchOpenOrderForTable(mesa) {
  const cutoff = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
  const q = cols => _supabase.from('orders').select(cols)
    .eq('table_number', mesa)
    .in('status', ['pending', 'preparing', 'ready', 'in_progress'])
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1);
  let { data, error } = await q('id, waiter_id, waiter_name, items, rounds, status');
  if (error && /rounds/i.test(error.message || '')) ({ data, error } = await q('id, waiter_id, waiter_name, items, status'));
  if (error) throw error;
  return (data && data[0]) || null;
}

function isPaidStatus(status) {
  return status && (status.startsWith('Pagado') || status === 'paid' || status === 'served' || status === 'archivado' || status === 'anulado');
}

/* modifyOrderInSupabase — AMPLIACIÓN de un pedido ya enviado.
   `newRound` es SOLO la ronda nueva (número provisional — se recalcula
   abajo). El historial previo de rondas se lee de Supabase en este mismo
   momento (no del estado local del mesero, que puede estar desactualizado
   si la pestaña estuvo en segundo plano) y la ronda nueva se le agrega —
   así nunca se pisa un avance que cocina ya haya guardado (p.ej. una ronda
   que el cocinero ya marcó "Lista" mientras el mesero no tenía foco).
   El pedido puede ampliarse en CUALQUIER estado de cocina (pendiente, en
   preparación o incluso ya "Listo para servir") — solo se bloquea si ya
   fue PAGADO/cerrado. Devuelve {prevStatus, roundN} — roundN es el número
   real que quedó asignado a la ronda (por si el local estaba desactualizado). */
// ¿El error indica que la función RPC aún no existe (migración pendiente)?
// En ese caso se usa el método anterior — la app nunca se rompe por esto.
function isMissingRpc(error) {
  const msg = String((error && (error.message || error.details)) || '');
  return !!error && (error.code === 'PGRST202' || error.code === '42883' ||
    /could not find the function|function .* does not exist/i.test(msg));
}

/* Descuenta del Stock lo enviado en UNA ronda (migracion-descuento-stock.sql).
   La base de datos descuenta lo que quedó GUARDADO en esa ronda del pedido,
   una sola vez aunque se reintente, y de forma atómica (20 meseros vendiendo
   a la vez no se pisan). Nunca bloquea el envío a cocina: si falla o la
   migración aún no se ejecutó, el pedido sigue normal (como antes).
   Devuelve los nombres de productos que se agotaron con esta ronda. */
/* Devuelve al Stock unidades YA ENVIADAS a cocina que el mesero quitó del
   pedido (p. ej. el cliente canceló una cerveza). migracion-devoluciones-
   stock.sql: la base de datos solo devuelve lo que realmente se descontó
   para ese pedido y producto, una sola vez, y solo con el pedido abierto.
   Best-effort: nunca bloquea al mesero. Devuelve las unidades devueltas. */
async function returnItemStock(orderId, itemId, qty) {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!orderId || !UUID_RE.test(String(itemId)) || !(qty > 0)) return 0;
  try {
    const { data, error } = await _supabase.rpc('return_order_item_stock', {
      p_order_id: orderId, p_item_id: itemId, p_qty: Math.floor(qty),
    });
    if (error) {
      if (!isMissingRpc(error)) console.warn('[Stock] devolución falló:', error.message);
      return 0;
    }
    return Number(data && data.returned) || 0;
  } catch (e) {
    console.warn('[Stock] devolución falló:', e?.message);
    return 0;
  }
}

async function deductRoundStock(orderId, roundN) {
  if (!orderId || !roundN) return [];
  try {
    const { data, error } = await _supabase.rpc('deduct_order_round_stock', { p_order_id: orderId, p_round_n: roundN });
    if (error) {
      if (!isMissingRpc(error)) console.warn('[Stock] descuento de ronda falló:', error.message);
      return [];
    }
    const items = (data && Array.isArray(data.items)) ? data.items : [];
    return items.filter(i => i && Number(i.stock) === 0).map(i => i.name).filter(Boolean);
  } catch (e) {
    console.warn('[Stock] descuento de ronda falló:', e?.message);
    return [];
  }
}

async function modifyOrderInSupabase(orderId, items, newRound) {
  // Carrito COMPLETO acumulado (histórico + nuevo), todo marcado como enviado.
  const cleanItems = items.map(i => ({
    id: i.id, name: i.name, price: i.price,
    qty: i.qty, note: i.note || '', portionTag: i.portionTag,
    lineId: lineIdFromLine(i), variantKey: i.variantKey || null, variantLabel: i.variantLabel || null,
    sentQty: i.qty,
    ...(i.cortesia ? { cortesia: true } : {}),
  }));

  // Camino principal (migracion-rondas-atomicas.sql): la base de datos agrega
  // la ronda en UN solo paso con el pedido bloqueado — si cocina cambia otra
  // ronda en el mismo instante, ninguna de las dos se pierde.
  const { data: rpcData, error: rpcError } = await _supabase.rpc('append_order_round', {
    p_order_id: orderId,
    p_items:    cleanItems,
    p_round:    { ...newRound, n: undefined },
  });
  if (!rpcError && rpcData && rpcData.round) {
    return { prevStatus: rpcData.prev_status, round: rpcData.round };
  }
  if (rpcError && !isMissingRpc(rpcError)) {
    const m = String(rpcError.message || '');
    if (/ORDER_PAID/.test(m))      throw new Error('El pedido ya fue PAGADO/cerrado y no puede modificarse.');
    if (/ORDER_NOT_FOUND/.test(m)) throw new Error('El pedido ya no existe en el sistema.');
    throw new Error('Error al modificar el pedido: ' + m);
  }

  // Respaldo: método anterior (solo si la migración aún no se ejecutó)
  return modifyOrderLegacy(orderId, items, newRound);
}

async function modifyOrderLegacy(orderId, items, newRound) {
  let { data: orderData, error: fetchError } = await _supabase
    .from('orders')
    .select('status, rounds')
    .eq('id', orderId)
    .single();
  if (fetchError && /rounds/i.test(fetchError.message || '')) {
    // Migración de la columna `rounds` aún no aplicada — reintenta sin ella.
    ({ data: orderData, error: fetchError } = await _supabase
      .from('orders').select('status').eq('id', orderId).single());
  }
  if (fetchError) throw new Error('Error al verificar el pedido: ' + fetchError.message);
  const currentStatus = orderData?.status;
  if (isPaidStatus(currentStatus)) {
    throw new Error('El pedido ya fue PAGADO/cerrado y no puede modificarse.');
  }
  // Base de verdad = rondas ya guardadas en Supabase (no el estado local del
  // mesero). Si la columna no existe aún (migración pendiente), se parte de [].
  const serverRounds = Array.isArray(orderData?.rounds) ? orderData.rounds : [];
  const round = { ...newRound, n: serverRounds.length + 1 };
  const allRounds = [...serverRounds, round];

  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const payload = {
    // items = carrito COMPLETO acumulado (histórico + nuevo) — se conserva íntegro
    // para que AdminDashboard/Caja/pre-cuenta sigan viendo el total real de la mesa.
    items: items.map(i => ({
      id: i.id, name: i.name, price: i.price,
      qty: i.qty, note: i.note || '', portionTag: i.portionTag,
    lineId: lineIdFromLine(i), variantKey: i.variantKey || null, variantLabel: i.variantLabel || null,
      sentQty: i.qty, // se marca todo como ya enviado a cocina tras esta ampliación
      ...(i.cortesia ? { cortesia: true } : {}),
    })),
    total:       parseFloat(total.toFixed(2)),
    is_modified: true,
    rounds:      allRounds,
    // El estado agregado se recalcula desde las rondas — si la mesa amplía
    // un pedido que ya estaba "Listo", vuelve a 'pending' para que cocina
    // reciba la nueva ronda como pendiente de preparar.
    status:      aggregateRoundsStatus(allRounds),
    updated_at:  new Date().toISOString(),
  };
  let { error } = await _supabase.from('orders').update(payload).eq('id', orderId);
  if (error && /rounds/i.test(error.message || '')) {
    // Migración aún no aplicada — reintenta sin esa columna (degrada a mostrar
    // el pedido completo en cocina, pero no rompe el guardado de la ampliación).
    const { rounds, ...fallback } = payload;
    ({ error } = await _supabase.from('orders').update(fallback).eq('id', orderId));
  }
  if (error) throw new Error('Error al modificar el pedido: ' + error.message);
  return { prevStatus: currentStatus, round };
}

// paymentBreakdown (opcional): [{metodo, monto}, ...] de un cobro dividido —
// el trigger de la base (migracion-pago-mixto.sql) revalida la suma contra
// `total` y, si pasa, fuerza payment_method='mixto' por su cuenta.
// Forma en que se guardan los ítems de un pedido (misma que al crearlo).
function orderItemsForDb(items) {
  return (items || [])
    .filter(i => i && i.qty > 0)
    .map(i => ({
      id: i.id, name: i.name, price: i.price,
      qty: i.qty, note: i.note || '', portionTag: i.portionTag,
    lineId: lineIdFromLine(i), variantKey: i.variantKey || null, variantLabel: i.variantLabel || null,
      sentQty: Math.min(i.sentQty || 0, i.qty),
      ...(i.cortesia ? { cortesia: true } : {}),
    }));
}
function orderTotalOf(items) {
  return Math.round((items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0) * 100) / 100;
}

/* Mantiene el pedido guardado al día cuando el mesero QUITA algo que ya
   había enviado a cocina (antes el pedido en la base seguía mostrando los
   productos y el total viejos hasta el cobro). Guarda solo lo ENVIADO
   (lo pendiente de enviar nunca estuvo en el pedido). Solo pedidos abiertos;
   nunca toca uno ya cobrado. Best-effort: no bloquea al mesero. */
async function syncSentOrderItems(orderId, localItems) {
  if (!orderId) return;
  const sent = (localItems || [])
    .map(i => ({ ...i, qty: Math.min(i.sentQty || 0, i.qty) }))
    .filter(i => i.qty > 0);
  if (!sent.length) return; // el pedido queda como estaba; se resolverá al cobrar/cerrar
  try {
    const { error } = await _supabase
      .from('orders')
      .update({ items: orderItemsForDb(sent), total: orderTotalOf(sent), updated_at: new Date().toISOString() })
      .eq('id', orderId)
      .in('status', ['pending', 'preparing', 'ready']);
    if (error) console.warn('[Pedido] no se pudo actualizar tras quitar un producto:', error.message);
  } catch (e) {
    console.warn('[Pedido] no se pudo actualizar tras quitar un producto:', e?.message);
  }
}

// finalItems (opcional): lo que realmente se cobró. Se guarda junto con el
// pago para que el pedido refleje el total cobrado — y para que el trigger
// del pago dividido valide contra ESE total (antes, si el mesero había
// quitado algo ya enviado, el total guardado era el viejo y el pago dividido
// era rechazado por la base).
async function updateOrderPayment(orderId, paymentMethod, paymentBreakdown = null, finalItems = null, packCount = null) {
  if (!orderId) return;
  const statusLabel = buildPayStatusM(paymentMethod);
  const payload = {
    status:             statusLabel,
    payment_method:     paymentMethod,
    payment_breakdown:  paymentBreakdown,
    paid_at:            new Date().toISOString(),
    updated_at:         new Date().toISOString(),
  };
  // Nunca se sobrescribe con una lista vacía (p. ej. si el carrito local se perdió)
  if (Array.isArray(finalItems) && finalItems.length) {
    payload.items = orderItemsForDb(finalItems.map(i => ({ ...i, sentQty: i.qty })));
    payload.total = orderTotalOf(finalItems);
  }
  // Envases: la base recalcula packaging_total y el total (platos + envases)
  if (packCount !== null) payload.packaging_count = clampPackaging(packCount);
  const { error } = await _supabase
    .from('orders')
    .update(payload)
    .eq('id', orderId);
  if (error) console.warn('Supabase update error:', error.message);
}

async function saveVentaMesero(meseroId, meseroNombre, mesaNro, total, metodoPago, zona, items) {
  try {
    const { error } = await _supabase.from('ventas_meseros').insert({
      mesero_id:     meseroId,
      mesero_nombre: meseroNombre,
      mesa_nro:      mesaNro,
      total:         parseFloat(total.toFixed(2)),
      metodo_pago:   metodoPago,
      zona:          zona || 'General',
      fecha_hora:    new Date().toISOString(), // forzado explícito — no depender del default de DB
      items: items.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
    });
    if (error) console.warn('saveVentaMesero DB error:', error.message);
  } catch(e) { console.warn('saveVentaMesero:', e.message); }
}

async function updateMesaEstado(numeroMesa, estado, extra = {}) {
  try {
    await _supabase
      .from('mesas')
      .update({ estado, ultima_actualizacion: new Date().toISOString(), ...extra })
      .eq('numero_mesa', numeroMesa);
  } catch(e) { console.warn('updateMesaEstado:', e.message); }
}

/* ── UNIR MESAS (migracion-unir-mesas.sql) ─────────────────────────────────
   mesas.unida_a = número de la mesa PRINCIPAL. La principal tiene el pedido y
   la cuenta; las unidas solo se ven ocupadas y llevan a la principal. */
function applyMesaJoins(prev, rows) {
  if (!Array.isArray(rows) || !rows.length) return prev;
  let changed = false;
  const next = prev.map(t => {
    const m = rows.find(r => r.numero_mesa === t.id);
    if (!m) return t;
    const j = Number.isInteger(m.unida_a) && m.unida_a !== t.id ? m.unida_a : null;
    if ((t.joinedTo ?? null) === j) return t;
    changed = true;
    return { ...t, joinedTo: j };
  });
  return changed ? next : prev;
}
/* ── ENVASES DESCARTABLES PARA LLEVAR (migracion-envases.sql) ──────────────
   Precio fijo por envase (Ajustes del admin). No usa stock. La cantidad se
   guarda en el pedido (packaging_count) y la base calcula el monto y el
   total, así el cobro y el cierre de caja cuadran exacto. */
let _packCfg = null;
const _packListeners = new Set();
async function reloadPackCfg() {
  _packCfg = await fetchPackagingConfig(_supabase);
  _packListeners.forEach(fn => { try { fn(_packCfg); } catch (_) {} });
  return _packCfg;
}
reloadPackCfg().catch(() => {});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') reloadPackCfg().catch(() => {});
});
function usePackCfg() {
  const [cfg, setCfg] = useState(_packCfg);
  useEffect(() => {
    _packListeners.add(setCfg);
    setCfg(_packCfg);
    return () => { _packListeners.delete(setCfg); };
  }, []);
  return cfg;
}
// Envases de una mesa: sin platos no hay envases que cobrar
function tablePack(t) {
  const count = t && (t.items || []).length ? clampPackaging(t.packaging) : 0;
  const unit  = Number(t && t.packagingUnit) || 0;
  return { count, unit, total: packagingTotal(count, unit) };
}
// Descuento de la mesa (cupón): sobre los platos, igual que la base de datos
function tableDiscount(t) {
  const d = t && t.descuento;
  if (!d || !(t.items || []).length) return { monto: 0, label: null };
  return { monto: discountAmount(itemsTotal(t.items), d.pct, d.fijo), label: d.label || 'Descuento' };
}
function tableGrandTotal(t) {
  return Math.round((itemsTotal(t && t.items) + tablePack(t).total - tableDiscount(t).monto) * 100) / 100;
}
// Descuentos guardados de varios pedidos (best-effort: sin migración → {})
async function fetchOrdersDescuento(ids) {
  if (!ids || !ids.length) return {};
  try {
    const { data, error } = await _supabase.from('orders').select('id, descuento_pct, descuento_fijo, cupon_codigo, descuento_motivo').in('id', ids);
    if (error || !data) return {};
    const map = {};
    data.forEach(o => {
      const pct = Number(o.descuento_pct) || 0, fijo = Number(o.descuento_fijo) || 0;
      map[o.id] = pct > 0 || fijo > 0 ? { pct, fijo, label: o.cupon_codigo ? `Cupón ${o.cupon_codigo}` : (o.descuento_motivo || 'Descuento') } : null;
    });
    return map;
  } catch (_) { return {}; }
}
const sameDesc = (a, b) => (!a && !b) || (!!a && !!b && a.pct === b.pct && a.fijo === b.fijo && a.label === b.label);
// Guarda la cantidad de envases de un pedido abierto. Devuelve lo guardado.
async function setOrderPackaging(orderId, count) {
  const { data, error } = await _supabase.from('orders')
    .update({ packaging_count: clampPackaging(count), updated_at: new Date().toISOString() })
    .eq('id', orderId)
    .in('status', ['pending', 'preparing', 'ready', 'in_progress'])
    .select('packaging_count, packaging_unit');
  if (error) throw error;
  if (!data || !data.length) throw new Error('El pedido ya fue cobrado o cerrado');
  return data[0];
}
// Envases guardados de varios pedidos (best-effort: sin migración → {})
async function fetchOrdersPackaging(ids) {
  if (!ids || !ids.length) return {};
  try {
    const { data, error } = await _supabase.from('orders').select('id, packaging_count, packaging_unit').in('id', ids);
    if (error || !data) return {};
    const map = {};
    data.forEach(o => { map[o.id] = { count: clampPackaging(o.packaging_count), unit: o.packaging_unit != null ? Number(o.packaging_unit) : null }; });
    return map;
  } catch (_) { return {}; }
}

/* ── CLIENTES (CRM) — migracion-clientes-crm.sql ───────────────────────────
   El mesero NUNCA lee la lista de clientes: solo funciones del servidor que
   devuelven el primer nombre y la fidelidad. Identificar al cliente es
   opcional y no frena la venta. */
let _crmAvailable = true;   // false si la migración no está ejecutada
async function crmRpc(fn, args) {
  const { data, error } = await _supabase.rpc(fn, args);
  if (error) {
    if (isCrmMissing(error)) _crmAvailable = false;
    throw error;
  }
  return data;
}
// Productos que se pueden dar como premio (categoría configurada, sin tamaños)
function premioProductsM(catalog, categoria) {
  const cat = String(categoria || '').trim().toLowerCase();
  if (!cat) return [];
  return (catalog || []).filter(m =>
    String(m?.cat || '').trim().toLowerCase() === cat && m.available !== false && !hasVariants(m) &&
    (m.stock === null || m.stock === undefined || Number(m.stock) > 0));
}

function joinErrorMessage(error) {
  const m = String(error?.message || '');
  const n = /MESA_NO_LIBRE:(\d+)/.exec(m);
  if (n) return `La Mesa ${n[1]} ya no está libre (alguien la tomó). Actualiza y elige otra.`;
  if (/UNION_PRINCIPAL/.test(m)) return 'Primero envía el pedido de esta mesa a cocina; luego podrás unirle otras mesas.';
  if (/UNION_INVALID/.test(m)) return 'Selección no válida.';
  if (/unir_mesas|separar_mesas|PGRST202|does not exist/i.test(m)) return 'Falta activar "Unir mesas" (migracion-unir-mesas.sql).';
  return 'No se pudo completar (revisa la conexión).';
}

/* ══════════════════════════════════════════════
   SEGURIDAD — PIN individual por mesero + bitácora
   ══════════════════════════════════════════════
   Antes, TODOS los meseros compartían el mismo PIN "1414" (hardcodeado
   en el código fuente) tanto para iniciar turno como para cerrarlo — sin
   validación en servidor y sin registro de quién entró/salió y cuándo.

   Ahora el PIN se valida contra Postgres vía la función RPC
   verify_mesero_pin() (definida en migracion-seguridad-pines-sesiones.sql):
   el cliente nunca ve el hash guardado, solo recibe true/false.

   IMPORTANTE — degradación segura: si la migración aún no se corrió (la
   función RPC no existe todavía en Supabase), verifyMeseroPinOrFallback
   nunca bloquea el acceso — cae de vuelta al PIN compartido histórico
   para que ningún mesero se quede afuera por una migración pendiente. */
async function verifyMeseroPinOrFallback(waiterId, pin) {
  try {
    // Paso 1 — ¿este mesero YA tiene un PIN individual asignado? Permite un
    // rollout incremental: mientras un mesero no tenga PIN propio, sigue
    // aceptando el PIN compartido histórico SOLO para él — nadie se queda
    // afuera por una migración parcialmente aplicada.
    const { data: configured, error: cfgError } = await _supabase.rpc('mesero_pin_configured', { p_waiter_id: waiterId });
    if (cfgError) throw cfgError;
    if (!configured) return pin === '1414';

    // Paso 2 — tiene PIN propio: se valida SOLO contra ese PIN (el
    // compartido "1414" deja de funcionar para este mesero).
    const { data, error } = await _supabase.rpc('verify_mesero_pin', { p_waiter_id: waiterId, p_pin: pin });
    if (error) throw error;
    return !!data;
  } catch(e) {
    // SOLO si la migración no se aplicó (las funciones RPC no existen) se cae
    // al PIN compartido. Antes cualquier error (sin internet, error del
    // servidor) también aceptaba "1414" para CUALQUIER mesero — incluso para
    // los que ya tenían PIN propio. Ahora un error de conexión rechaza el
    // ingreso con un mensaje claro (nunca deja pasar por falla).
    // Demasiados intentos fallidos: el servidor bloqueó este perfil 5 minutos
    if (/PIN_LOCKED/.test(String(e?.message || ''))) throw new Error('PIN_LOCKED');
    // Solo si falta una función en la base de datos (migración pendiente)
    if (isMissingRpc(e)) {
      console.warn('[PIN] Funciones de PIN aún no instaladas — usando PIN compartido de respaldo');
      return pin === '1414';
    }
    console.warn('[PIN] No se pudo verificar el PIN:', e?.message);
    throw new Error('PIN_CHECK_FAILED');
  }
}

// Registra el inicio de turno en la bitácora — no bloquea el login si falla
// (la tabla puede no existir aún si la migración no se corrió).
async function logMeseroSesionInicio(waiter) {
  try {
    const { error } = await _supabase.from('mesero_sesiones').insert({
      waiter_id:   waiter.id,
      waiter_name: waiter.name,
      device:      (navigator.userAgent || '').slice(0, 180),
    });
    if (error) throw error;
  } catch(e) { console.warn('[bitácora] No se pudo registrar inicio de turno:', e.message); }
}

// Cierra cualquier sesión abierta de este mesero (logout_at null) al
// cerrar turno — de forma best-effort, nunca bloquea el cierre.
async function logMeseroSesionFin(waiterId) {
  try {
    const { error } = await _supabase.from('mesero_sesiones')
      .update({ logout_at: new Date().toISOString() })
      .eq('waiter_id', waiterId)
      .is('logout_at', null);
    if (error) throw error;
  } catch(e) { console.warn('[bitácora] No se pudo registrar cierre de turno:', e.message); }
}

/* ══════════════════════════════════════════════
   KITCHEN ALERTS — audio y voz para el mesero
══════════════════════════════════════════════ */
function playKitchenBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 3 campanadas consecutivas con fundamental + 2 armónicos cada una
    [0, 0.65, 1.30].forEach(ringStart => {
      [[880, 0.55, 1.8], [1108, 0.32, 1.4], [1320, 0.18, 1.0]].forEach(([freq, g, dur]) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        const t = ctx.currentTime + ringStart;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(g, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.start(t); osc.stop(t + dur);
      });
    });
  } catch(e) { console.warn('kitchenBell:', e.message); }
  // Vibración de hardware — funciona aunque el teléfono esté en silencio.
  // Patrón fuerte a propósito: la alerta de "pedido listo" no debe pasar
  // desapercibida en un salón ruidoso.
  try { if ('vibrate' in navigator) navigator.vibrate([500, 200, 500, 200, 800]); } catch(_) {}
}

function speakKitchenReady(mesa, waiterName) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const nombre = waiterName ? `${waiterName}, ` : '';
    const utt = new SpeechSynthesisUtterance(
      `${nombre}el pedido de la mesa ${mesa} ya está listo, puedes venir a recoger.`
    );
    utt.lang = 'es-ES'; utt.rate = 0.82; utt.volume = 1; utt.pitch = 1;
    window.speechSynthesis.speak(utt);
  } catch(e) {}
}

/* ── Desbloqueo de audio/voz ──────────────────────────────────────────────
   Chrome y Safari suspenden un AudioContext nuevo (y a veces silencian la
   PRIMERA llamada a speechSynthesis.speak()) si no ocurren dentro de un
   gesto real del usuario (tap/click). La alerta de "pedido listo" llega
   minutos después disparada por Supabase Realtime — NO es un gesto — así
   que sin este desbloqueo previo, la primera campanada/voz de la sesión
   podría no sonar en algunos navegadores. Se llama UNA vez, en el mismo
   gesto de login donde ya se pide permiso de notificaciones. No reproduce
   nada audible: solo "despierta" el motor de audio/voz del origen para que
   las alertas reales, que llegan después, sí suenen. Si algo de esto no
   está disponible o falla, no rompe nada — el login sigue igual. */
function unlockAudioAndVoice() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    setTimeout(() => { try { ctx.close(); } catch(_) {} }, 200);
  } catch(_) {}
  try {
    if (window.speechSynthesis) {
      const warm = new SpeechSynthesisUtterance(' ');
      warm.volume = 0; // inaudible — solo habilita el motor de voz para después
      window.speechSynthesis.speak(warm);
    }
  } catch(_) {}
}

function speakTakeawayReady(customerName) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const nombre = customerName ? customerName : 'cliente';
    const utt = new SpeechSynthesisUtterance(
      `Atención. El pedido para llevar de ${nombre} ya está listo. Favor de recoger y entregar.`
    );
    utt.lang = 'es-ES'; utt.rate = 0.82; utt.volume = 1; utt.pitch = 1;
    window.speechSynthesis.speak(utt);
  } catch(e) {}
}

function speakExternalReady(customerName, zone) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const nombre = customerName || 'cliente';
    const tipo   = zone === 'Delivery' ? 'delivery' : 'recojo en local';
    const utt    = new SpeechSynthesisUtterance(
      `Atención. El pedido de ${tipo} para ${nombre} ya está listo para entregar.`
    );
    utt.lang = 'es-ES'; utt.rate = 0.82; utt.volume = 1; utt.pitch = 1;
    window.speechSynthesis.speak(utt);
  } catch(e) {}
}

/* ══════════════════════════════════════════════
   MESEROS — perfiles del login (se crean en AdminDashboard → Ajustes)
   ══════════════════════════════════════════════
   Antes era una constante de 4 perfiles. Ahora WAITERS es la lista viva de
   la tabla `meseros` (el admin crea/edita/desactiva perfiles en Ajustes y
   llegan aquí por Realtime). Arranca con los MISMOS 4 de siempre (y con la
   copia local que guarde el dispositivo), así que si la tabla no existe o
   Supabase no responde, el login funciona exactamente como antes.
   El login solo muestra los activos; los inactivos se conservan en la lista
   porque sus mesas/ventas anteriores siguen resolviendo su color y nombre. */
const WAITERS_LS_KEY = 'antojitos_meseros_v1';
const WAITERS_DEFAULT = [
  { id:'w1', name:'Carlos', color:'#f5a623', initial:'C', active:true },
  { id:'w2', name:'María',  color:'#e63946', initial:'M', active:true },
  { id:'w3', name:'Pedro',  color:'#3b9eff', initial:'P', active:true },
  { id:'w4', name:'Carmen', color:'#2ecc71', initial:'K', active:true },
];
// #RRGGBB → fondo translúcido del avatar (mismos valores que tenían los 4 originales)
const waiterBg = c => {
  const m = /^#([0-9a-f]{6})$/i.exec(String(c || ''));
  if (!m) return 'rgba(245,166,35,0.15)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.15)`;
};
const normWaiter = r => {
  const name  = String(r.name || '').trim();
  const color = /^#[0-9a-f]{6}$/i.test(r.color || '') ? r.color : '#f5a623';
  return {
    id: String(r.id), name, color, bg: waiterBg(color),
    initial: String(r.initial || name.charAt(0) || '?').toUpperCase().slice(0, 1),
    active: r.active !== false,
  };
};
let WAITERS = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(WAITERS_LS_KEY) || 'null');
    if (Array.isArray(c) && c.length) {
      const list = c.filter(x => x && x.id && String(x.name || '').trim()).map(normWaiter);
      if (list.length) return list;
    }
  } catch (_) {}
  return WAITERS_DEFAULT.map(normWaiter);
})();
let _waitersVersion = 0;
const _waitersListeners = new Set();
// Filas de la tabla `meseros` (o el respaldo local) → WAITERS. Si no hay filas
// válidas NO se toca nada (nunca dejar el login vacío por una lectura fallida).
function applyWaiterRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const list = rows.filter(r => r && r.id && String(r.name || '').trim()).map(normWaiter);
  if (!list.length || JSON.stringify(list) === JSON.stringify(WAITERS)) return;
  WAITERS = list;
  try { localStorage.setItem(WAITERS_LS_KEY, JSON.stringify(list)); } catch (_) {}
  _waitersVersion += 1;
  _waitersListeners.forEach(fn => { try { fn(_waitersVersion); } catch (_) {} });
}
// Re-renderiza App cuando cambian los perfiles (los componentes leen WAITERS al renderizar)
function useWaitersVersion() {
  const [v, setV] = useState(_waitersVersion);
  useEffect(() => {
    _waitersListeners.add(setV);
    setV(_waitersVersion);
    return () => { _waitersListeners.delete(setV); };
  }, []);
  return v;
}

/* ══════════════════════════════════════════════
   MENÚ FIJO — vacío a propósito
   ══════════════════════════════════════════════
   Los 17 platos originales (Brasas/Fast Food/Bebidas) se retiraron a
   pedido — sus fotos en img/ ya no existen en el repo (se borraron en
   el commit "Restaurante Mejoras", 9f6b5b2) y se decidió no reemplazar
   estas fichas fijas por unas sin foto.
   El menú real ahora vive 100% en el catálogo dinámico (tabla
   `menu_items`, administrado desde AdminDashboard → Stock → "Agregar
   plato", con imagen subida a Supabase Storage) — `customItems` más
   abajo. MenuScreen ya combina MENU (ahora vacío) con `customItems`
   sin ningún cambio adicional: basta con agregar platos nuevos desde
   el panel admin para que aparezcan aquí en tiempo real.
   Si en el futuro se quiere volver a un catálogo fijo con fotos,
   agregar objetos aquí con el mismo shape que antes (id, cat, img,
   name, price, portionTag, portionDesc, equivalence, portionDetails). */
const MENU = [];
// CATS ya no es una constante fija: MenuScreen la recalcula incluyendo las
// categorías nuevas que el admin haya creado (ver useMemo en MenuScreen).

/* ══════════════════════════════════════════════
   MESAS Y ZONAS — 30 base + las que agrega el admin en Ajustes
   ══════════════════════════════════════════════
   Las 30 mesas originales siguen repartidas por rango (1-12 Salón Principal,
   13-22 Terraza, 23-30 Privados). Las mesas nuevas viven en la tabla `mesas`
   con su `zona` y llegan por Realtime (INSERT/DELETE). TABLE_LAYOUT es la
   lista de mesas vigente y ZONES la agrupación por zona; arrancan con las 30
   de siempre (o con la copia local del dispositivo), así que sin la migración
   o sin conexión el mapa es idéntico al de antes. La regla de zona por
   defecto es la misma de src/data/zones.js (defaultZoneOf). */
const LAYOUT_LS_KEY = 'antojitos_mesas_layout_v1';
const DEFAULT_ZONE_NAMES = ['Salón Principal', 'Terraza', 'Privados'];
const defaultZoneOf = n => n <= 12 ? 'Salón Principal' : n <= 22 ? 'Terraza' : n <= 30 ? 'Privados' : 'Salón Principal';
const DEFAULT_LAYOUT = Array.from({length:30}, (_,i) => ({ n:i+1, zona:defaultZoneOf(i+1) }));
const buildZones = layout => {
  const by = new Map();
  layout.forEach(({n, zona}) => { if (!by.has(zona)) by.set(zona, []); by.get(zona).push(n); });
  const names = [
    ...DEFAULT_ZONE_NAMES.filter(z => by.has(z)),
    ...[...by.keys()].filter(z => !DEFAULT_ZONE_NAMES.includes(z)),
  ];
  return names.map(name => ({ name, tables: by.get(name).sort((a,b) => a-b) }));
};
// Las 30 mesas base SIEMPRE forman parte del mapa, existan o no como fila en la tabla
// `mesas` (el esquema base solo siembra 1-15; el resto vivía solo en el código). Las
// mesas extra (31+) llegan de la base. Misma regla que el panel admin (mergeTables).
const withBaseTables = extra => {
  const byN = new Map(DEFAULT_LAYOUT.map(x => [x.n, x]));
  (extra || []).forEach(x => { if (x && Number.isInteger(x.n) && x.n > 0 && typeof x.zona === 'string') byN.set(x.n, x); });
  return [...byN.values()].sort((a,b) => a.n - b.n);
};
let TABLE_LAYOUT = (() => {
  try {
    const c = JSON.parse(localStorage.getItem(LAYOUT_LS_KEY) || 'null');
    if (Array.isArray(c) && c.length) return withBaseTables(c);
  } catch (_) {}
  return DEFAULT_LAYOUT;
})();
let ZONES = buildZones(TABLE_LAYOUT);
let _layoutVersion = 0;
const _layoutListeners = new Set();
// Filas de `mesas` ({numero_mesa, zona}) → distribución vigente = las 30 base + las
// filas de la base (mesas agregadas desde Ajustes, o la zona guardada de una base).
// Una base con solo 15 filas ya NO recorta el mapa a 15. Si no llega ninguna fila
// válida no se toca nada (una lectura vacía nunca debe vaciar el mapa).
function applyMesasRows(rows) {
  if (!Array.isArray(rows)) return;
  const fromDb = rows
    .map(r => ({ n: r.numero_mesa, zona: String(r.zona || '').trim() || defaultZoneOf(r.numero_mesa) }))
    .filter(x => Number.isInteger(x.n) && x.n > 0);
  if (!fromDb.length) return;
  const layout = withBaseTables(fromDb);
  if (JSON.stringify(layout) === JSON.stringify(TABLE_LAYOUT)) return;
  TABLE_LAYOUT = layout;
  ZONES = buildZones(layout);
  try { localStorage.setItem(LAYOUT_LS_KEY, JSON.stringify(layout)); } catch (_) {}
  _layoutVersion += 1;
  _layoutListeners.forEach(fn => { try { fn(_layoutVersion); } catch (_) {} });
}
// Re-renderiza App cuando cambia la distribución de mesas
function useMesasLayoutVersion() {
  const [v, setV] = useState(_layoutVersion);
  useEffect(() => {
    _layoutListeners.add(setV);
    setV(_layoutVersion);
    return () => { _layoutListeners.delete(setV); };
  }, []);
  return v;
}

const mkTable = n => ({
  id: n, occupied: false, items: [], waiterId: null,
  waiterName: null, waiterColor: null, openAt: null, supabaseOrderId: null,
  rounds: [], // historial de rondas enviadas a cocina — [{n,status,items,sentAt,readyAt}]
});
const mkTables = () => TABLE_LAYOUT.map(x => mkTable(x.n));

/* ── Rondas: helpers compartidos ─────────────────────────────────
   Cada ronda = {n, items:[...], status:'pendiente'|'en_cocina'|'listo', sentAt, startedAt, readyAt}.
   El estado agregado del pedido (columna `status` en Supabase, la que ya
   consume todo el sistema — urgencias, badges, isPaid, AdminDashboard)
   se deriva SIEMPRE de las rondas: así una mesa puede seguir sumando
   rondas nuevas aunque las anteriores ya estén "Listas". */
const aggregateRoundsStatus = rounds => {
  if (!Array.isArray(rounds) || !rounds.length) return 'pending';
  if (rounds.some(r => r.status === 'pendiente')) return 'pending';
  if (rounds.some(r => r.status === 'en_cocina')) return 'preparing';
  return 'ready'; // todas las rondas están 'listo'
};

/* ══════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════ */
const fmt     = n => `S/ ${(+n||0).toFixed(2)}`;
const fmtS    = n => `S/${(+n||0).toFixed(2)}`;
const nowT    = () => {
  const d = new Date(), h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
  return `${(h%12)||12}:${m} ${h<12?'AM':'PM'}`;
};
const elapsed = d => { if(!d) return ''; const m = Math.floor((Date.now()-d)/60000); if(m<1) return '<1m'; if(m<60) return `${m}m`; return `${Math.floor(m/60)}h ${m%60}m`; };

/* Convierte texto a ASCII puro para impresoras térmicas básicas:
   elimina tildes/diacríticos y caracteres Unicode (fracciones ¼½⅛ etc.) */
const toThermal = s => String(s||'')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')    // quita diacríticos combinados (tildes, ñ → n, etc.)
  .replace(/[^\x00-\x7F]/g, '')        // elimina cualquier no-ASCII restante (¼ ½ ⅛ …)
  .trim();

/* COMANDA WEB PRINT — fallback cuando no hay impresora física disponible.
   Usa UTF-8 completo (tildes y fracciones se renderizan bien en HTML). */
const printComandaWeb = (mesa, items, waiter, zone, isModification = false, roundN = null, stationLabel = null, packCount = 0, aviso = null) => {
  const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const up  = s => String(s||'').toUpperCase();
  const now = new Date();
  const h   = now.getHours(), mm = String(now.getMinutes()).padStart(2,'0');
  const timeStr = `${(h%12)||12}:${mm} ${h<12?'AM':'PM'}`;

  const itemsCopy = items.slice(); // captura inmutable antes de cualquier re-render
  const rows = itemsCopy.map(it => {
    const tag = it.portionTag
      ? `<span class="portion-tag">${esc(it.portionTag)}</span>`
      : '';
    return `<div class="item-row">
      <div class="item-line">
        <span class="qty-badge">${esc(it.qty||1)}&times;</span>
        ${tag}
        <span class="name">${esc(up(it.name||'?'))}</span>
      </div>
      ${it.note ? `<div class="nota">&#9733; NOTA: ${esc(up(it.note))}</div>` : ''}
    </div>`;
  }).join('');

  const totalItems = itemsCopy.reduce((s,i)=>s+(i.qty||1),0);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Comanda</title>
  <style>
    @page { size: 80mm auto; margin: 3mm 2mm; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',Courier,monospace; font-size:14px; width:76mm; color:#000; background:#fff; }
    .hdr { text-align:center; padding:6px 4px 4px; font-size:14px; font-weight:900; letter-spacing:1px; border-bottom:2px solid #000; }
    .hdr-title { font-size:17px; font-weight:900; display:block; }
    .meta { font-size:13px; color:#000; padding:5px 6px; border-bottom:2px solid #000; line-height:1.6; }
    .meta strong { font-weight:900; }
    .items-section { border-bottom:2px solid #000; }
    .item-row { padding:7px 6px 5px; border-bottom:1px dashed #000; page-break-inside:avoid; }
    .item-line { display:flex; align-items:flex-start; gap:5px; }
    .qty-badge { font-size:18px; font-weight:900; white-space:nowrap; min-width:40px; flex-shrink:0; }
    .portion-tag { font-size:13px; font-weight:900; color:#000; border:1px solid #000;
                   padding:1px 4px; white-space:nowrap; flex-shrink:0; }
    .name { font-weight:900; font-size:16px; text-transform:uppercase;
            word-break:break-word; line-height:1.4; }
    .nota { font-size:13px; color:#000; font-weight:700; margin-top:3px;
            padding:2px 4px; border-left:3px solid #000; }
    .ftr { text-align:center; font-size:12px; padding:5px 4px 8px; font-weight:700; }
    @media print {
      * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
      body { width:100%; }
      @page { margin:2mm 1mm; }
    }
  </style></head><body>
  <div class="hdr" style="${isModification ? 'background:#000;color:#fff;' : ''}">
    <span class="hdr-title">${isModification ? `** AMPLIACIÓN — RONDA ${roundN||'?'} **` : '** NUEVA COMANDA — RONDA 1 **'}</span>
    ${esc(up(BIZ.nombre))}
  </div>
  ${stationLabel ? `<div style="text-align:center;font-weight:900;font-size:15px;padding:4px;border-bottom:2px solid #000;letter-spacing:1px;">&gt;&gt;&gt; ${esc(up(stationLabel))} &lt;&lt;&lt;</div>` : ''}
  <div class="meta">
    <div><strong>MESA:</strong> ${esc(String(mesa).padStart(2,'0'))} &nbsp;&nbsp;
         <strong>ZONA:</strong> ${esc(up(zone||'SALON'))}</div>
    <div><strong>MESERO:</strong> ${esc(up(typeof waiter==='object'?waiter.name:waiter))}</div>
    <div><strong>HORA:</strong> ${esc(timeStr)} &nbsp;&nbsp; ${esc(now.toLocaleDateString('es-PE'))}</div>
    ${isModification ? '<div style="font-weight:900;">⚠ SOLO ÍTEMS NUEVOS DE ESTA RONDA</div>' : ''}
  </div>
  <div class="items-section">${rows}</div>
  ${aviso ? `<div style="text-align:center;font-weight:900;font-size:15px;padding:5px 4px;border-bottom:2px solid #000;background:#000;color:#fff;">&#9888; CLIENTE: ${esc(up(aviso))}</div>` : ''}
  ${packCount > 0 ? `<div style="text-align:center;font-weight:900;font-size:15px;padding:5px 4px;border-bottom:2px solid #000;">PARA LLEVAR: ${esc(packCount)} ENVASE${packCount !== 1 ? 'S' : ''} (TOTAL DEL PEDIDO)</div>` : ''}
  <div class="ftr">TOTAL: ${totalItems} ITEM${totalItems!==1?'S':''}</div>
  <script>
    (function(){
      var attempts = 0;
      function tryPrint(){
        if(document.readyState === 'complete'){
          setTimeout(function(){ window.print(); window.onafterprint = function(){ window.close(); }; }, 100);
        } else if(attempts < 10){
          attempts++;
          setTimeout(tryPrint, 150);
        }
      }
      window.onload = tryPrint;
      tryPrint();
    })();
  <\/script>
  </body></html>`;
  const win = window.open('','_blank','width=380,height=600,toolbar=0');
  if(win){ win.document.write(html); win.document.close(); }
  else { alert('⚠ El navegador bloqueó la ventana de impresión.\nPor favor permite ventanas emergentes (pop-ups) para este sitio e intenta de nuevo.'); }
};

/* TICKET TEXT WEB PRINT — para texto preformateado (ticket de pre-cuenta) */
const printTextWeb = (text, title = 'Ticket') => {
  const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <style>
    @page { size: auto; margin: 2mm 1mm; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'Courier New',monospace; font-size:14px; font-weight:600; width:100%; max-width:80mm; color:#000; white-space:pre-wrap; word-break:break-word; }
    @media print { button { display:none; } * { -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; } }
  </style></head><body>${esc(text)}
  <script>window.onload=()=>{window.print();window.onafterprint=()=>window.close();}<\/script>
  </body></html>`;
  const win = window.open('','_blank','width=380,height=500,toolbar=0');
  if(win){ win.document.write(html); win.document.close(); }
};

/* COMANDA STRING — formato 58mm (32 ch) / 80mm (48 ch) para impresora térmica.
   Usa toThermal() para ASCII puro. Incluye portionTag para que cocina sepa la porción. */
const buildComandaStr = (mesa, items, waiter, zone, cols = 32, isModification = false, roundN = null, stationLabel = null, packCount = 0, aviso = null) => {
  const W    = Math.max(32, cols); // mínimo 32 columnas para evitar líneas vacías
  const line = '='.repeat(W);
  const sep  = '-'.repeat(W);
  const up   = str => toThermal(String(str||'').toUpperCase());
  let s = '';
  s += line + '\n';
  s += isModification
    ? `\x1b\x45\x01  ** AMPLIACION - RONDA ${roundN||'?'} **\x1b\x45\x00\n`
    : `\x1b\x45\x01  ** NUEVA COMANDA - RONDA 1 **\x1b\x45\x00\n`;
  // Solo aparece cuando hay 2+ impresoras repartiendo la comanda por estación
  if (stationLabel) s += `\x1b\x45\x01  >>> ${up(stationLabel)} <<<\x1b\x45\x00\n`;
  s += line + '\n';
  s += `ZONA: ${up(zone||'SALON PRINCIPAL').substring(0,10).padEnd(11)}MESA: ${String(mesa).padStart(2,'0')}\n`;
  s += `MESERO: ${up(waiter).substring(0,14).padEnd(14)} ${nowT()}\n`;
  if (isModification) s += `\x1b\x45\x01  SOLO ITEMS NUEVOS DE ESTA RONDA\x1b\x45\x00\n`;
  s += sep + '\n';

  if (!Array.isArray(items) || items.length === 0) {
    s += '  (SIN PRODUCTOS)\n';
  } else {
    items.forEach((it, idx) => {
      const qty  = String(it.qty || 1);
      const name = up(it.name || '?').substring(0, W - qty.length - 6);
      // ESC E 1 = bold ON, ESC E 0 = bold OFF — resalta nombre del plato
      s += `\x1b\x45\x01${qty} UNI. ${name}\x1b\x45\x00\n`;
      if (it.portionTag) {
        const pt = toThermal(String(it.portionTag)).substring(0, W - 5);
        if (pt) s += `  >> ${pt}\n`;
      }
      if (it.note) s += `\x1b\x45\x01  * NOTA: ${up(it.note).substring(0, W - 9)}\x1b\x45\x00\n`;
      if (idx < items.length - 1) s += ' '.repeat(W) + '\n'; // separador visual entre ítems
    });
  }

  s += sep + '\n';
  if (aviso) {
    s += `\x1b\x45\x01!! CLIENTE: ${up(aviso).substring(0, W - 13)}\x1b\x45\x00\n`;
    s += sep + '\n';
  }
  if (packCount > 0) {
    s += `\x1b\x45\x01PARA LLEVAR: ${packCount} ENVASE${packCount !== 1 ? 'S' : ''}\x1b\x45\x00\n`;
    s += `(total del pedido)\n`;
    s += sep + '\n';
  }
  s += `TOTAL ITEMS: ${(items||[]).reduce((a,i) => a + (i.qty||1), 0)}\n`;
  s += line + '\n';
  return s;
};

const buildTicketStr = (mesa, items, waiter, zone, cols = 32, pack = null, desc = null) => {
  const platos   = itemsTotal(items);
  const pk       = pack && pack.count > 0 ? pack : null;
  const dsc      = desc && desc.monto > 0 ? desc : null;
  const total    = Math.round((platos + (pk ? pk.total : 0) - (dsc ? dsc.monto : 0)) * 100) / 100;
  const subtotal = total / 1.18;
  const igv      = total - subtotal;
  const W = cols;
  const line  = '='.repeat(W);
  const dline = '-'.repeat(W);
  // toThermal quita tildes/no-ASCII: la impresora nunca recibe UTF-8 multibyte
  const clean = str => toThermal(String(str ?? '')).replace(/\s+/g, ' ').trim();
  // Parte un texto en líneas de hasta `width` caracteres, por palabras
  const wrap = (str, width) => {
    const out = []; let cur = '';
    for (const word of clean(str).split(' ').filter(Boolean)) {
      let w = word;
      while (w.length > width) {                      // palabra más larga que el renglón
        if (cur) { out.push(cur); cur = ''; }
        out.push(w.slice(0, width)); w = w.slice(width);
      }
      if (!w) continue;
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= width) cur += ' ' + w;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out.length ? out : [''];
  };
  const center = str => wrap(str, W)
    .map(l => ' '.repeat(Math.max(0, Math.floor((W - l.length) / 2))) + l + '\n').join('');
  // izquierda ……… derecha, exactamente al ancho del papel
  const lr = (left, right) => {
    const r = clean(right).slice(0, W - 2);
    const l = clean(left).slice(0, Math.max(0, W - r.length - 1));
    return l + ' '.repeat(Math.max(1, W - l.length - r.length)) + r + '\n';
  };
  // GS ! n — ESC/POS: bits 0-3 = ALTO, bits 4-7 = ANCHO. Se usa SOLO doble
  // ALTO (0x01). Antes se enviaba 0x10, que es doble ANCHO: el título se
  // centraba contando letras normales pero se imprimía al doble de ancho y
  // quedaba corrido a la derecha (igual que la línea del TOTAL).
  const SIZE_TALL = '\x1d\x21\x01', SIZE_NORMAL = '\x1d\x21\x00';
  const BOLD_ON = '\x1b\x45\x01', BOLD_OFF = '\x1b\x45\x00';

  let s = line + '\n';
  // Datos del negocio: salen de Ajustes del admin (BIZ)
  s += `${SIZE_TALL}${BOLD_ON}${center((BIZ.nombre || '').toUpperCase())}${BOLD_OFF}${SIZE_NORMAL}`;
  if (BIZ.direccion) s += center(BIZ.direccion);
  if (bizDocLine())  s += center(bizDocLine());
  s += line + '\n';
  s += center('PRE-CUENTA');
  s += lr(`Mesa: ${mesa}`, zone || 'Salon');
  if (waiter) s += lr('Mesero:', waiter);
  s += lr('Fecha:', `${new Date().toLocaleDateString('es-PE')} ${nowT()}`);
  s += dline + '\n';

  items.forEach(it => {
    const qty = it.qty || 1;
    const pr  = `S/${((it.price||0)*qty).toFixed(2)}`;
    // Nombre limpio: se quitan las porciones entre paréntesis (ej. "(250g)"),
    // pero el TAMAÑO del plato se conserva: "Jalea Fuente M."
    const base = String(it.baseName || it.name || '?').replace(/\s*\(.*?\)/g, '').trim() || '?';
    const name = it.variantLabel ? `${base} ${it.variantLabel}` : base;
    const prefix = `${qty} UNI. `;
    // 1ª línea: cantidad + nombre … precio. Si el nombre no cabe, sigue en
    // las líneas de abajo (alineado bajo el nombre), nunca se corta.
    const firstW = Math.max(4, W - prefix.length - pr.length - 1);
    const restW  = Math.max(4, W - prefix.length);
    const firstLines = wrap(name, firstW);
    const first = firstLines[0];
    const rest  = firstLines.length > 1 ? wrap(firstLines.slice(1).join(' '), restW) : [];
    s += BOLD_ON + prefix + first + ' '.repeat(Math.max(1, W - prefix.length - first.length - pr.length)) + pr + BOLD_OFF + '\n';
    rest.forEach(l => { s += BOLD_ON + ' '.repeat(prefix.length) + l + BOLD_OFF + '\n'; });
    // Nota del ítem (si existe) — las porciones/portionTag NO se muestran al cliente
    if (it.note) wrap(`* ${it.note}`, W - 3).forEach(l => { s += '   ' + l + '\n'; });
  });

  s += dline + '\n';
  if (pk || dsc) {
    s += lr('Total platos:', `S/${platos.toFixed(2)}`);
    if (pk) s += lr(`Envases ${pk.count} x S/${pk.unit.toFixed(2)}:`, `S/${pk.total.toFixed(2)}`);
    if (dsc) s += lr(`${dsc.label || 'Descuento'}:`, `-S/${dsc.monto.toFixed(2)}`);
    s += dline + '\n';
  }
  s += lr('Subtotal:', `S/${subtotal.toFixed(2)}`);
  s += lr('IGV 18%:',  `S/${igv.toFixed(2)}`);
  s += line + '\n';
  s += `${SIZE_TALL}${BOLD_ON}${lr('TOTAL:', `S/${total.toFixed(2)}`)}${BOLD_OFF}${SIZE_NORMAL}`;
  s += line + '\n';
  s += center('Gracias! Vuelva pronto!');
  return s;
};

/* ══════════════════════════════════════════════
   BLUETOOTH
══════════════════════════════════════════════ */
/* ══════════════════════════════════════════════
   IMPRESORAS BLUETOOTH — registro de 1 o más
   ══════════════════════════════════════════════
   Reemplaza al BTService de una sola impresora: ahora se pueden emparejar
   varias (ej. "Cocina" + "Barra") y cada una se queda con las categorías
   del menú que le toca imprimir (ver PrintersModal). La impresora marcada
   "predeterminada" recibe todo lo que ninguna otra reclame — así, con 1
   sola impresora configurada (el caso de siempre hasta ahora), el
   comportamiento es IDÉNTICO a antes: todo va a esa única impresora.

   La conexión GATT (device/server/char) es por sesión, igual que antes —
   Web Bluetooth exige un gesto del usuario, así que al recargar la página
   hay que tocar "Conectar" de nuevo por cada impresora (el BTService
   anterior tampoco recordaba la conexión entre recargas). Lo que SÍ se
   recuerda entre sesiones es la configuración (nombre, categorías
   asignadas, cuál es la predeterminada) — localStorage.
══════════════════════════════════════════════ */
const PRINTERS_LS_KEY = 'antojitos_impresoras_v1';
const BT_SERVICES = ['000018f0-0000-1000-8000-00805f9b34fb','00001101-0000-1000-8000-00805f9b34fb'];

function loadPrinterConfigs() {
  try {
    const arr = JSON.parse(localStorage.getItem(PRINTERS_LS_KEY) || 'null');
    if (Array.isArray(arr) && arr.length) {
      return arr.map(p => ({
        id: p.id, label: p.label || 'Impresora',
        categories: Array.isArray(p.categories) ? p.categories : [],
        isDefault: !!p.isDefault,
        // Dispositivo Bluetooth recordado (para reconectar solo, sin buscar)
        deviceId:   typeof p.deviceId === 'string' ? p.deviceId : null,
        deviceName: typeof p.deviceName === 'string' ? p.deviceName : '',
        // Tipo: 'bt' (Bluetooth, de siempre) | 'red' (tiketera de red vía agente)
        kind:    p.kind === 'red' ? 'red' : 'bt',
        netId:   typeof p.netId === 'string' ? p.netId : null,
        netName: typeof p.netName === 'string' ? p.netName : '',
        netCols: [32, 42, 48].includes(p.netCols) ? p.netCols : 48,
      }));
    }
  } catch (_) { /* localStorage bloqueado — se usa la impresora única de siempre */ }
  return null;
}
function savePrinterConfigs() {
  try {
    localStorage.setItem(PRINTERS_LS_KEY, JSON.stringify(
      _printers.map(p => ({
        id: p.id, label: p.label, categories: p.categories, isDefault: p.isDefault,
        deviceId: p.deviceId || null, deviceName: p.deviceName || '',
        kind: p.kind === 'red' ? 'red' : 'bt',
        netId: p.netId || null, netName: p.netName || '', netCols: p.netCols || 48,
      }))
    ));
  } catch (_) { /* no es crítico */ }
}

/* ── Reconexión automática (sin volver a buscar la impresora) ──────────────
   Misma técnica que el panel admin (src/services/btPrinter.js): se recuerda
   el dispositivo elegido y, al abrir la app (o al volver a ella, o si la
   impresora se apagó un momento), se reconecta en silencio con
   navigator.bluetooth.getDevices(). Si el navegador no lo permite, en
   Ajustes basta tocar "Reconectar" (el selector muestra solo esa impresora).
   Preferencia por dispositivo (localStorage) — activada por defecto. */
const BT_AUTO_LS_KEY = 'antojitos_bt_auto_v1';
function btAutoReconnectEnabled() {
  try { return localStorage.getItem(BT_AUTO_LS_KEY) !== 'off'; } catch (_) { return true; }
}
function setBtAutoReconnect(on) {
  try { localStorage.setItem(BT_AUTO_LS_KEY, on ? 'on' : 'off'); } catch (_) {}
}
function btCanSilentReconnect() {
  return !!(navigator.bluetooth && typeof navigator.bluetooth.getDevices === 'function');
}
const _btBoundDevices = new WeakSet(); // evita registrar 2 veces el aviso de desconexión

/* Texto apto para la tiketera: sin caracteres multibyte (se translitera
   á→a, ñ→n…; lo demás → '?'). Lo usan la impresión Bluetooth y la de red. */
const PRINTER_LATIN = {'á':'a','à':'a','â':'a','ä':'a','ã':'a','å':'a',
                       'é':'e','è':'e','ê':'e','ë':'e',
                       'í':'i','ì':'i','î':'i','ï':'i',
                       'ó':'o','ò':'o','ô':'o','ö':'o','õ':'o',
                       'ú':'u','ù':'u','û':'u','ü':'u',
                       'ñ':'n','ç':'c','ý':'y',
                       'Á':'A','À':'A','Â':'A','Ä':'A','Ã':'A',
                       'É':'E','È':'E','Ê':'E','Ë':'E',
                       'Í':'I','Ì':'I','Î':'I','Ï':'I',
                       'Ó':'O','Ò':'O','Ô':'O','Ö':'O','Õ':'O',
                       'Ú':'U','Ù':'U','Û':'U','Ü':'U',
                       'Ñ':'N','Ç':'C'};
function toPrinterAscii(text) {
  return String(text ?? '').replace(/[^\x00-\x7F]/g, c => PRINTER_LATIN[c] ?? '?');
}

/* ── IMPRESORAS DE RED (Wi-Fi / LAN) — migracion-impresion-red.sql ─────────
   El navegador (página HTTPS) no puede hablar directo con una tiketera de la
   red local, así que el ticket se ENCOLA en Supabase y el agente de
   impresión (agente-impresion.js, en una PC del local) lo imprime. */
async function enqueueNetPrint(netId, text, tipo, origen) {
  if (!netId) throw new Error('Elige la impresora de red');
  const b64 = btoa(toPrinterAscii(text));        // solo ASCII → btoa es seguro
  if (b64.length > 16000) throw new Error('Ticket demasiado largo para la impresora de red');
  let timer;
  try {
    const { error } = await Promise.race([
      _supabase.rpc('encolar_impresion', {
        p_impresora: netId, p_tipo: tipo, p_contenido: b64, p_origen: origen || null,
      }),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Sin respuesta del sistema (revisa internet)')), 12000); }),
    ]);
    if (error) {
      const m = String(error.message || '');
      if (/PRINTER_NOT_FOUND/.test(m)) throw new Error('La impresora de red ya no existe o está desactivada');
      if (/PRINT_RATE_LIMIT/.test(m)) throw new Error('Demasiadas impresiones seguidas: espera un momento');
      if (/encolar_impresion|PGRST202|does not exist/i.test(m)) throw new Error('Falta activar la impresión por red (migracion-impresion-red.sql)');
      throw new Error(m || 'No se pudo enviar a la impresora de red');
    }
  } finally {
    clearTimeout(timer);
  }
  return true;
}
async function fetchNetPrinters() {
  const { data, error } = await _supabase.from('impresoras_red')
    .select('id, nombre, ancho_cols, activa').eq('activa', true).order('nombre');
  if (error) throw error;
  return data || [];
}
async function fetchAgentOnline() {
  const { data, error } = await _supabase.rpc('agente_impresion_activo');
  if (error) return null;           // sin migración / sin internet: estado desconocido
  return data === true;
}

// Una impresora = una conexión GATT independiente (mismo protocolo ESC/POS
// que el BTService original, ahora instanciado una vez por impresora).
function createPrinterSlot(id, label, categories, isDefault, deviceId = null, deviceName = '', net = null) {
  return {
    id, label, categories, isDefault,
    deviceId, deviceName,          // impresora recordada (persistida)
    kind:    net?.kind === 'red' ? 'red' : 'bt',
    netId:   net?.netId || null,   // impresora de red elegida (tabla impresoras_red)
    netName: net?.netName || '',
    netCols: net?.netCols || 48,
    device: null, server: null, _char: null, _canAck: false,
    _lastDevice: null,             // último BluetoothDevice usado (para reconectar)
    _manualOff: false,             // true = el mesero la desconectó a propósito
    _reconnecting: null,           // promesa en curso (evita reconexiones simultáneas)
    _retryTimer: null,
    status: deviceId ? 'disconnected' : 'idle', // idle | searching | connected | disconnected | error
    message: '',

    get cols() {
      if (this.kind === 'red') return this.netCols || 48;
      const n = this.device?.name || '';
      return /80\s*mm|76\s*mm|\b80\b|PT-280|GP-80|XP-80|BTP-80|PRT-80/i.test(n) ? 48 : 32;
    },
    // Red: "conectada" = tiene una impresora de red elegida (el envío real lo
    // hace el agente; si falla el encolado, se usa la ventana del navegador).
    get connected() { return this.kind === 'red' ? !!this.netId : !!this.server?.connected; },

    async _acquireChar() {
      const svcs = await this.server.getPrimaryServices();
      for (const svc of svcs) {
        let chars;
        try { chars = await svc.getCharacteristics(); } catch { continue; }
        for (const ch of chars) {
          if (ch.properties.write || ch.properties.writeWithoutResponse) {
            this._char   = ch;
            this._canAck = !!ch.properties.write;
            return;
          }
        }
      }
      throw new Error('Sin característica de escritura en impresora');
    },

    _setStatus(status, message) {
      this.status = status; this.message = message || '';
      _notifyPrinters();
    },

    // Conecta GATT a un dispositivo ya elegido (con tope de tiempo: si la
    // impresora está apagada, gatt.connect() puede quedarse esperando).
    async _connectDevice(dev) {
      if (!_btBoundDevices.has(dev)) {
        _btBoundDevices.add(dev);
        dev.addEventListener('gattserverdisconnected', () => this._onDisconnected(dev));
      }
      this._lastDevice = dev;
      let timer;
      try {
        const srv = await Promise.race([
          dev.gatt.connect(),
          new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('La impresora no respondió (¿está encendida y cerca?)')), 9000); }),
        ]);
        this.device = dev; this.server = srv; this._char = null;
      } catch (e) {
        try { dev.gatt.disconnect(); } catch (_) {}
        throw e;
      } finally {
        clearTimeout(timer);
      }
      // Recordar la impresora para reconectar sola la próxima vez
      if (this.deviceId !== dev.id || this.deviceName !== (dev.name || '')) {
        this.deviceId = dev.id; this.deviceName = dev.name || '';
        savePrinterConfigs();
      }
      /* Cache characteristic immediately so first print is instant */
      try { await this._acquireChar(); } catch { /* will retry on first print */ }
      this._setStatus('connected', `✓ ${dev.name || 'Impresora'}`);
    },

    _onDisconnected(dev) {
      if (this._lastDevice && this._lastDevice !== dev) return; // evento de un dispositivo viejo
      const wasConnected = !!this.server;
      this.device = null; this.server = null; this._char = null;
      if (!wasConnected) return; // ya se manejó (desconexión manual o intento fallido)
      this._setStatus('disconnected', 'Desconectada');
      // Si se cortó sola (apagada, fuera de alcance), reintentar en silencio
      if (!this._manualOff && btAutoReconnectEnabled()) this._scheduleRetry(0);
    },

    _scheduleRetry(attempt) {
      clearTimeout(this._retryTimer);
      const delays = [3000, 8000, 20000];
      if (attempt >= delays.length) return;
      this._retryTimer = setTimeout(async () => {
        if (this.connected || this._manualOff) return;
        const ok = await this.reconnect({ silent: true });
        if (!ok) this._scheduleRetry(attempt + 1);
      }, delays[attempt]);
    },

    // Elegir impresora con el selector del navegador (requiere un toque).
    // preferRemembered: el selector muestra solo la impresora recordada.
    async connect(cb, { preferRemembered = false } = {}) {
      cb = typeof cb === 'function' ? cb : () => {};
      if (!navigator.bluetooth) {
        this._setStatus('error', 'BT no disponible en este navegador');
        cb('error','BT no disponible en este browser');
        return false;
      }
      try {
        this._manualOff = false;
        clearTimeout(this._retryTimer);
        this._setStatus('searching', 'Buscando impresora...');
        cb('searching','Buscando impresora...');
        const opts = preferRemembered && this.deviceName
          ? { filters: [{ name: this.deviceName }], optionalServices: BT_SERVICES }
          : { acceptAllDevices: true, optionalServices: BT_SERVICES };
        const dev = await navigator.bluetooth.requestDevice(opts);
        this._setStatus('searching', `Conectando a ${dev.name||'Impresora'}...`);
        cb('searching',`Conectando a ${dev.name||'Impresora'}...`);
        await this._connectDevice(dev);
        cb('connected',`✓ ${dev.name||'Impresora'}`);
        return true;
      } catch(e) {
        const cancelled = /cancel/i.test(e?.message || '') || e?.name === 'NotFoundError';
        const msg = cancelled ? 'Cancelado' : (e?.message || 'Error de conexión');
        this._setStatus(this.deviceId ? 'disconnected' : (cancelled ? 'idle' : 'error'), msg);
        cb('error', msg);
        return false;
      }
    },

    // Reconexión SIN selector a la impresora recordada. Best-effort: nunca
    // lanza error; devuelve true/false.
    async reconnect({ silent = false } = {}) {
      if (this.connected) return true;
      if (this.kind === 'red') return false;
      if (!this.deviceId || !navigator.bluetooth) return false;
      if (this._reconnecting) return this._reconnecting;
      this._reconnecting = (async () => {
        try {
          let dev = this._lastDevice && this._lastDevice.id === this.deviceId ? this._lastDevice : null;
          if (!dev) {
            if (!btCanSilentReconnect()) {
              if (!silent) this._setStatus('disconnected', 'Este navegador no reconecta solo: toca "Reconectar"');
              return false;
            }
            const list = await navigator.bluetooth.getDevices();
            dev = list.find(d => d.id === this.deviceId) || null;
            if (!dev) {
              this._setStatus('disconnected', 'Toca "Reconectar" para autorizar la impresora otra vez');
              return false;
            }
          }
          this._setStatus('searching', `Reconectando ${this.deviceName || 'impresora'}...`);
          await this._connectDevice(dev);
          return true;
        } catch (e) {
          this._setStatus('disconnected', e?.message || 'No se pudo reconectar');
          return false;
        } finally {
          this._reconnecting = null;
        }
      })();
      return this._reconnecting;
    },

    async print(text, tipo = 'comanda', origen = null) {
      if (this.kind === 'red') {
        // Error → lo atrapa quien imprime y usa la ventana del navegador
        return enqueueNetPrint(this.netId, text, tipo, origen || this.label);
      }
      if (!this.server?.connected) throw new Error('Impresora no conectada');
      /* Re-acquire characteristic if not cached (e.g. first print after error) */
      if (!this._char) await this._acquireChar();

      /* Strip non-ASCII so printer never sees multi-byte UTF-8 sequences.
         Transliterate common Latin chars rather than dropping them entirely. */
      const safe = toPrinterAscii(text);

      /* Build full ESC/POS frame:
         ESC @ = printer init | 0x00 = warm-up NUL | ESC a 0 = left-align
         ESC M 0 = Font A (12×24 dot matrix, larger/clearer than Font B)
         body | 3×LF + GS V A 3 = paper feed + partial cut */
      const enc  = new TextEncoder();
      const init = new Uint8Array([0x1B,0x40, 0x00, 0x1B,0x61,0x00, 0x1B,0x4D,0x00]);
      const body = enc.encode(safe);
      const tail = new Uint8Array([0x0A,0x0A,0x0A, 0x1D,0x56,0x41,0x03]);
      const full = new Uint8Array(init.length + body.length + tail.length);
      full.set(init, 0);
      full.set(body, init.length);
      full.set(tail, init.length + body.length);

      /* Chunk strategy: 20 bytes para todos los modos con pausa entre cada chunk.
         Las impresoras térmicas BLE baratas tienen buffers ESC/POS de ~128-160 bytes;
         enviar 512 bytes de golpe hace que procesen solo la cabecera y descarten
         los ítems. Chunks de 20 bytes + pausa = máxima compatibilidad. */
      const canAck = this._canAck;
      const CHUNK  = 20;
      const GAP    = canAck ? 25 : 50; // ms — ACK confirma recepción pero la impresora aún necesita tiempo
      const delay  = ms => new Promise(r => setTimeout(r, ms));

      /* Espera a que la impresora procese ESC @ antes de enviar datos.
         350ms para impresoras lentas de 58mm. */
      await delay(350);

      for (let i = 0; i < full.length; i += CHUNK) {
        const slice = full.slice(i, i + CHUNK);
        try {
          if (canAck) {
            await this._char.writeValue(slice);
          } else {
            await this._char.writeValueWithoutResponse(slice);
            if (GAP) await delay(GAP);
          }
        } catch {
          /* One automatic retry: re-acquire characteristic and resend the same slice */
          this._char = null;
          await this._acquireChar();
          if (this._canAck) {
            await this._char.writeValue(slice);
          } else {
            await this._char.writeValueWithoutResponse(slice);
            if (GAP) await delay(GAP);
          }
        }
      }
      return true;
    },

    disconnect() {
      this._manualOff = true;       // no reintentar: fue a propósito
      clearTimeout(this._retryTimer);
      const dev = this.device;
      this._char = null; this.device = null; this.server = null;
      try { dev?.gatt?.disconnect(); } catch (_) {}
      this._setStatus(this.deviceId ? 'disconnected' : 'idle', 'Desconectada');
    },

    // Olvidar la impresora recordada (deja de reconectarse sola)
    forget() {
      this.disconnect();
      this.deviceId = null; this.deviceName = ''; this._lastDevice = null;
      savePrinterConfigs();
      this._setStatus('idle', '');
    },
  };
}

let _printers = (loadPrinterConfigs() || [{ id: 'p1', label: 'Impresora', categories: [], isDefault: true }])
  .map(c => createPrinterSlot(c.id, c.label, c.categories, c.isDefault, c.deviceId || null, c.deviceName || '',
    { kind: c.kind, netId: c.netId, netName: c.netName, netCols: c.netCols }));
if (_printers.length && !_printers.some(p => p.isDefault)) _printers[0].isDefault = true;

let _printersVersion = 0;
const _printersListeners = new Set();
function _notifyPrinters() {
  _printersVersion += 1;
  _printersListeners.forEach(fn => { try { fn(_printersVersion); } catch (_) {} });
}
// Re-renderiza quien la use cuando cambia algo del registro de impresoras
function usePrintersVersion() {
  const [v, setV] = useState(_printersVersion);
  useEffect(() => {
    _printersListeners.add(setV);
    setV(_printersVersion);
    return () => { _printersListeners.delete(setV); };
  }, []);
  return v;
}

const PrinterRegistry = {
  list()         { return _printers; },
  getDefault()   { return _printers.find(p => p.isDefault) || _printers[0]; },
  anyConnected() { return _printers.some(p => p.connected); },

  addSlot(label) {
    const id = 'p' + Date.now().toString(36);
    const slot = createPrinterSlot(id, label || `Impresora ${_printers.length + 1}`, [], _printers.length === 0);
    _printers = [..._printers, slot];
    savePrinterConfigs();
    _notifyPrinters();
    return slot;
  },
  removeSlot(id) {
    if (_printers.length <= 1) return; // siempre debe quedar al menos una impresora configurada
    const target = _printers.find(p => p.id === id);
    if (!target) return;
    if (target.connected) target.disconnect();
    const wasDefault = target.isDefault;
    _printers = _printers.filter(p => p.id !== id);
    if (wasDefault && _printers.length) _printers[0].isDefault = true;
    savePrinterConfigs();
    _notifyPrinters();
  },
  rename(id, label) {
    const target = _printers.find(p => p.id === id);
    if (!target) return;
    target.label = (label || '').trim() || target.label;
    savePrinterConfigs();
    _notifyPrinters();
  },
  setCategories(id, categories) {
    const target = _printers.find(p => p.id === id);
    if (!target) return;
    target.categories = categories;
    savePrinterConfigs();
    _notifyPrinters();
  },
  setDefault(id) {
    _printers.forEach(p => { p.isDefault = p.id === id; });
    savePrinterConfigs();
    _notifyPrinters();
  },
  // Bluetooth ⇄ Red. Al pasar a Red se suelta y olvida el Bluetooth (si no,
  // la reconexión automática lo volvería a tomar).
  setKind(id, kind) {
    const target = _printers.find(p => p.id === id);
    if (!target || (kind !== 'bt' && kind !== 'red') || target.kind === kind) return;
    if (kind === 'red') {
      if (target.server || target.deviceId) target.forget();
      target.kind = 'red';
      target.status = 'idle'; target.message = '';
    } else {
      target.kind = 'bt';
      target.netId = null; target.netName = '';
      target._manualOff = false;
      target.status = 'idle'; target.message = '';
    }
    savePrinterConfigs();
    _notifyPrinters();
  },
  setNet(id, net) {
    const target = _printers.find(p => p.id === id);
    if (!target || target.kind !== 'red') return;
    target.netId   = net?.id || null;
    target.netName = net?.nombre || '';
    target.netCols = [32, 42, 48].includes(Number(net?.ancho_cols)) ? Number(net.ancho_cols) : 48;
    savePrinterConfigs();
    _notifyPrinters();
  },
  async connectSlot(id, cb, opts) {
    const target = _printers.find(p => p.id === id);
    if (!target) return false;
    if (target.kind === 'red') return target.connected;
    const ok = await target.connect((status, msg) => { _notifyPrinters(); cb?.(status, msg); }, opts);
    _notifyPrinters();
    return ok;
  },
  disconnectSlot(id) {
    const target = _printers.find(p => p.id === id);
    target?.disconnect();
    _notifyPrinters();
  },
  forgetSlot(id) {
    const target = _printers.find(p => p.id === id);
    target?.forget();
    _notifyPrinters();
  },
  // Reconexión con un toque: primero en silencio; si el navegador no lo
  // permite, abre el selector mostrando solo la impresora recordada.
  async reconnectSlot(id) {
    const target = _printers.find(p => p.id === id);
    if (!target) return false;
    if (target.kind === 'red') return target.connected;
    target._manualOff = false;
    if (await target.reconnect()) return true;
    return target.connect(null, { preferRemembered: true });
  },
  // Reconecta en silencio todas las impresoras recordadas que no estén
  // conectadas (respetando las que el mesero desconectó a propósito).
  async reconnectAllSilent() {
    if (!btAutoReconnectEnabled() || !btCanSilentReconnect()) return;
    await Promise.all(_printers
      .filter(p => p.kind !== 'red' && p.deviceId && !p.connected && !p._manualOff)
      .map(p => p.reconnect({ silent: true })));
  },
};

// Al abrir la app y cada vez que se vuelve a ella: reconectar en silencio
// las impresoras recordadas (sin abrir el selector). Así, salir del perfil
// o cerrar turno (que recarga la página) no obliga a buscarla de nuevo.
setTimeout(() => { PrinterRegistry.reconnectAllSilent().catch(() => {}); }, 1200);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') PrinterRegistry.reconnectAllSilent().catch(() => {});
});

// Reparte los ítems de una comanda entre las impresoras configuradas según
// categoría — ej. los ítems de categoría "Tragos" van a la impresora que
// tenga esa categoría asignada; el resto va a la predeterminada. Con 1 sola
// impresora configurada (que siempre es la predeterminada), esto devuelve
// un único grupo con TODOS los ítems — comportamiento idéntico a antes.
function splitItemsForStations(items) {
  const printers = PrinterRegistry.list();
  const def = PrinterRegistry.getDefault();
  const groups = new Map(); // printerId -> { printer, items }
  for (const it of (items || [])) {
    const match = printers.find(p => p.id !== def.id && p.categories.includes(it.cat));
    const target = match || def;
    if (!groups.has(target.id)) groups.set(target.id, { printer: target, items: [] });
    groups.get(target.id).items.push(it);
  }
  return [...groups.values()];
}

// Imprime una comanda repartida entre estaciones: 1 ticket por impresora que
// tenga ítems que le correspondan (una estación sin ítems de los suyos no
// imprime nada). Si una impresora no está conectada, o falla al imprimir,
// esos ítems caen a la ventana de impresión del navegador — el mismo
// respaldo de siempre, ahora aplicado por estación.
function printComandaToStations({ mesa, items, waiter, zone, isModification, roundN, packaging = 0, aviso = null }) {
  const groups = splitItemsForStations(items);
  const multi = groups.length > 1;
  for (const { printer, items: groupItems } of groups) {
    const stationLabel = multi ? printer.label : null;
    if (printer.connected) {
      const cmd = buildComandaStr(mesa, groupItems, waiter.name, zone, printer.cols, isModification, roundN, stationLabel, packaging, aviso);
      printer.print(cmd, 'comanda', waiter?.name).catch(() => {
        printComandaWeb(mesa, groupItems, waiter, zone, isModification, roundN, stationLabel, packaging, aviso);
      });
    } else {
      printComandaWeb(mesa, groupItems, waiter, zone, isModification, roundN, stationLabel, packaging, aviso);
    }
  }
}

/* ══════════════════════════════════════════════
   IMPRESORA DE RED — Wi-Fi / IP
   Envía ESC/POS vía HTTP POST a un gateway
   local (print-gateway.js) que abre TCP 9100.
══════════════════════════════════════════════ */
const NetPrinterService = (() => {
  const STORE_KEY = 'antojitos_net_printer';
  let _cfg = null;

  const _load = () => {
    try { const r = localStorage.getItem(STORE_KEY); _cfg = r ? JSON.parse(r) : null; }
    catch(e) { _cfg = null; }
  };

  _load(); // inicializar al arrancar

  return {
    get isConfigured() { return !!((_cfg||{}).url); },
    get url()          { return (_cfg||{}).url || ''; },

    configure(url) {
      _cfg = url ? { url } : null;
      try {
        if (url) localStorage.setItem(STORE_KEY, JSON.stringify({ url }));
        else     localStorage.removeItem(STORE_KEY);
      } catch(e) {}
    },

    async print(text) {
      if (!_cfg?.url) throw new Error('Impresora de red no configurada');

      // Payload ESC/POS: init + warm-up NUL + texto ASCII + feed & cut
      // El byte 0x00 (NUL) tras ESC @ da tiempo a la impresora para completar el reset
      // antes de recibir el primer byte de texto, evitando que el primer ítem aparezca truncado.
      const enc    = new TextEncoder();
      const init   = new Uint8Array([0x1B, 0x40, 0x00, 0x1B, 0x4D, 0x00]); // ESC @ + NUL + Font A (más nítida)
      const body   = enc.encode(text);
      const feed   = new Uint8Array([0x0A,0x0A,0x0A,0x1D,0x56,0x41,0x03]); // feed + corte parcial

      const full = new Uint8Array(init.length + body.length + feed.length);
      full.set(init, 0);
      full.set(body, init.length);
      full.set(feed, init.length + body.length);

      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 7000); // timeout 7s
      try {
        const res = await fetch(_cfg.url, {
          method:  'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body:    full,
          signal:  ctrl.signal,
        });
        clearTimeout(tid);
        if (!res.ok) throw new Error(`Gateway devolvió HTTP ${res.status}`);
        return true;
      } catch(e) {
        clearTimeout(tid);
        if (e.name === 'AbortError') throw new Error('Sin respuesta del gateway (timeout 7s)');
        throw e;
      }
    },
  };
})();

/* ══════════════════════════════════════════════
   MODAL: CONFIG IMPRESORA DE RED
══════════════════════════════════════════════ */
function PrinterConfigModal({ onClose }) {
  const [url,     setUrl]     = React.useState(NetPrinterService.url);
  const [testing, setTesting] = React.useState(false);
  const [result,  setResult]  = React.useState(null);

  const handleSave = () => {
    NetPrinterService.configure(url.trim());
    onClose(!!url.trim());
  };

  const handleTest = async () => {
    if (!url.trim()) return;
    setTesting(true); setResult(null);
    // Configurar temporalmente para la prueba
    NetPrinterService.configure(url.trim());
    try {
      await NetPrinterService.print(
        '================================\n' +
        '   TEST IMPRESORA — RED OK\n' +
        `   ${toThermal((BIZ.nombre || '').toUpperCase())}\n` +
        '================================\n'
      );
      setResult({ ok: true, msg: '✓ Impresora respondió correctamente' });
    } catch(e) {
      setResult({ ok: false, msg: '✗ ' + e.message });
    }
    setTesting(false);
  };

  const overlay = {
    position:'fixed',inset:0,background:'rgba(0,0,0,.75)',display:'flex',
    alignItems:'flex-end',justifyContent:'center',zIndex:1000,
  };
  const box = {
    background:'#FFFFFF',borderRadius:'18px 18px 0 0',width:'100%',
    maxWidth:480,padding:'24px 20px 40px',
    boxShadow:'0 -4px 24px rgba(0,0,0,0.08)',border:'1px solid var(--line)',
  };
  const inp = {
    width:'100%',background:'var(--ink3)',border:'1.5px solid var(--line)',borderRadius:8,
    padding:'10px 12px',color:'var(--snow)',fontSize:12,fontFamily:'monospace',
    marginBottom:12,boxSizing:'border-box',
  };
  const btnRow = { display:'flex',gap:8,marginBottom:8 };

  return (
    <div style={overlay} onClick={()=>onClose(NetPrinterService.isConfigured)}>
      <div style={box} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:18,fontWeight:900,color:'#f5a623',marginBottom:4,fontFamily:'var(--display)'}}>
          🖨️ Impresora de Red (Wi-Fi)
        </div>
        <div style={{fontSize:11,color:'var(--mist)',marginBottom:18,lineHeight:1.5}}>
          Introduce la URL del <strong style={{color:'var(--snow)'}}>gateway local</strong>{' '}
          (ejecuta <code style={{color:'#f5a623'}}>print-gateway.js</code> en la PC de cocina).
          Ejemplo: <code style={{color:'#3b9eff'}}>http://192.168.1.100:8008/print</code>
        </div>

        <label style={{fontSize:11,color:'var(--fog)',display:'block',marginBottom:6}}>
          URL del gateway de impresión
        </label>
        <input
          value={url}
          onChange={e=>setUrl(e.target.value)}
          placeholder="http://192.168.1.xxx:8008/print"
          style={inp}
        />

        {result && (
          <div style={{
            padding:'8px 12px',borderRadius:8,marginBottom:12,fontSize:12,fontWeight:700,
            background: result.ok ? 'rgba(46,204,113,.15)' : 'rgba(230,57,70,.15)',
            color:      result.ok ? '#2ecc71'              : '#e63946',
          }}>{result.msg}</div>
        )}

        <div style={btnRow}>
          <button
            onClick={handleTest}
            disabled={testing || !url.trim()}
            style={{
              flex:1,padding:'10px 0',borderRadius:8,border:'1px solid #444',
              background:'transparent',color:'var(--snow)',fontSize:13,
              fontWeight:700,cursor:'pointer',opacity: (!url.trim()||testing) ? 0.5 : 1,
            }}
          >{testing ? '⏳ Probando...' : 'Probar conexión'}</button>
          <button
            onClick={handleSave}
            style={{
              flex:2,padding:'10px 0',borderRadius:8,border:'none',
              background:'linear-gradient(135deg,#f5a623,#e67e22)',
              color:'#000',fontSize:13,fontWeight:900,cursor:'pointer',
            }}
          >Guardar</button>
        </div>
        <button
          onClick={()=>{ NetPrinterService.configure(''); onClose(false); }}
          style={{
            width:'100%',padding:'8px 0',borderRadius:8,border:'none',
            background:'transparent',color:'var(--fog)',fontSize:12,cursor:'pointer',
          }}
        >Quitar impresora de red</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════ */
function Clock() {
  const [t,setT] = useState(nowT());
  useEffect(()=>{ const i=setInterval(()=>setT(nowT()),1000); return()=>clearInterval(i); },[]);
  return <span className="clock-chip">{t}</span>;
}

/* ══════════════════════════════════════════════
   TOASTS
══════════════════════════════════════════════ */
function Toasts({list,remove}) {
  const icons = { ok:CheckCircle2, err:XCircle, info:Zap };
  return (
    <div className="toast-wrap">
      {list.map(t => {
        const Icon = icons[t.type] || Zap;
        return (
          <div key={t.id} className={`toast ${t.type}`} onClick={()=>remove(t.id)}>
            <Icon size={15} style={{verticalAlign:'-3px', marginRight:4, flexShrink:0}} /> {t.msg}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════
   SPLASH
══════════════════════════════════════════════ */
function Splash({onDone}) {
  const biz = useBiz(); // nombre del negocio (Ajustes del admin) — se actualiza en vivo
  const [pct,setPct] = useState(0);
  const [msg,setMsg] = useState('Iniciando sistema...');
  const msgs = ['Cargando menú...','Sincronizando mesas...','Calibrando impresora...','¡Listo!'];
  useEffect(()=>{
    const steps = [
      [300,  20, 'Cargando menú...'],
      [700,  55, 'Sincronizando mesas...'],
      [1100, 80, 'Calibrando sistema...'],
      [1600, 100,'¡Listo para servir!'],
    ];
    steps.forEach(([t,p,m]) => setTimeout(()=>{ setPct(p); setMsg(m); }, t));
    setTimeout(onDone, 2100);
  },[]);
  return (
    <div className="splash">
      <div className="splash-orb"><img src="img/logo/logo.png" alt={bizName(biz)}/></div>
      <div className="splash-name">{bizName(biz).toUpperCase()}</div>
      <div className="splash-tagline">{['APP MESERO PRO', bizCity(biz).toUpperCase()].filter(Boolean).join(' · ')}</div>
      <div className="splash-bar-wrap">
        <div className="splash-bar" style={{width:`${pct}%`}}/>
      </div>
      <div className="splash-status">{msg}</div>
      <div className="splash-v">{[bizLocality(biz).toUpperCase(), `${WAITERS.filter(w => w.active).length} MESEROS`, `${TABLE_LAYOUT.length} MESAS`].filter(Boolean).join(' · ')}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   LOGIN — SPLIT SCREEN
══════════════════════════════════════════════ */
function Login({onLogin}) {
  const biz = useBiz(); // dirección del pie del login (Ajustes del admin)
  const [sel,setSel] = useState(null);
  const [pin,setPin] = useState('');
  const [err,setErr] = useState('');
  const [checking,setChecking] = useState(false);

  const handleLogin = async () => {
    if(!sel) { setErr('Selecciona tu perfil'); return; }
    if(checking) return;
    setChecking(true);
    let ok = false;
    try {
      ok = await verifyMeseroPinOrFallback(sel.id, pin);
    } catch (e) {
      setChecking(false);
      setErr(e?.message === 'PIN_LOCKED'
        ? 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo.'
        : 'No se pudo verificar el PIN. Revisa tu conexión e inténtalo de nuevo.');
      return;
    }
    setChecking(false);
    if(!ok) { setErr('PIN incorrecto'); return; }
    // Solicitar permiso de notificaciones al iniciar sesión (gesto de usuario)
    if('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    // Desbloquea AudioContext/speechSynthesis en este mismo gesto — ver
    // unlockAudioAndVoice() para el porqué.
    unlockAudioAndVoice();
    onLogin(sel);
  };

  return (
    <div className="login-wrap">

      {/* ── Panel derecho: Formulario ── */}
      <div className="login-right">
        <div className="login-right-inner">

          {/* Logo compacto — solo móvil */}
          <div className="login-mobile-brand">
            <img src="img/logo/logo.png" alt="RESTAURANTE POS"/>
            <div className="login-title" style={{textAlign:'center'}}>RESTAURANTE POS</div>
          </div>

          <div className="login-card">
            <div className="login-title">Iniciar Turno</div>
            <div className="login-sub">Selecciona tu perfil e ingresa tu PIN</div>

            <div className="login-label">Tu perfil</div>
            <div className="login-waiter-grid">
              {(WAITERS.some(w => w.active) ? WAITERS.filter(w => w.active) : WAITERS).map(w => (
                <div key={w.id}
                  className={`waiter-option ${sel?.id===w.id?'selected':''}`}
                  onClick={()=>{setSel(w);setErr('');}}>
                  <div className="waiter-avatar-sm" style={{background:w.bg,color:w.color}}>{w.initial}</div>
                  <div className="waiter-name-sm">{w.name}</div>
                </div>
              ))}
            </div>

            <form autoComplete="off" onSubmit={e=>{e.preventDefault();handleLogin();}}>
              <div className="login-label">PIN de acceso</div>
              <input
                className="login-input" type="password" maxLength={4}
                placeholder="• • • •" value={pin} inputMode="numeric"
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                onChange={e=>{ setPin(e.target.value); setErr(''); }}
              />
              {err && (
                <div style={{fontSize:11,color:'var(--crimson)',marginBottom:10,
                  background:'rgba(230,57,70,0.1)',border:'1px solid rgba(230,57,70,0.2)',
                  borderRadius:6,padding:'7px 10px',display:'flex',alignItems:'center',gap:4}}>
                  <AlertTriangle size={12}/> {err}
                </div>
              )}
              <button type="submit" className="login-btn" disabled={checking} style={checking?{opacity:.7,cursor:'wait'}:undefined}>
                {checking ? 'Verificando…' : 'Iniciar Turno →'}
              </button>
            </form>
            {bizAddress(biz) && <div className="login-footer">{bizAddress(biz)}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NOTE MODAL
══════════════════════════════════════════════ */
const NOTE_PRESETS = [
  'Sin ensalada','Extra salsa','Sin cebolla','Bien cocido','Papas extra',
  'Sin picante','Sin limón','Al término medio','Poco ají','Sin ají',
];

function NoteModal({item,onSave,onClose}) {
  const [note,setNote] = useState(item.note||'');
  const [active,setActive] = useState([]);
  const togglePreset = p => {
    if(active.includes(p)) {
      const nw = active.filter(x=>x!==p);
      setActive(nw);
      setNote(nw.join(', '));
    } else {
      const nw=[...active,p];
      setActive(nw);
      setNote(nw.join(', '));
    }
  };
  return (
    <div className="quick-modal" onClick={onClose}>
      <div className="quick-box" onClick={e=>e.stopPropagation()}>
        <div style={{width:36,height:3,background:'var(--line2)',borderRadius:2,margin:'0 auto 16px'}}/>
        <div className="quick-title"><NotebookPen size={16} style={{verticalAlign:-3,marginRight:5}} /> Nota — {item.name}</div>
        {(item.portionTag || item.equivalence) && (
          <div className="quick-sub">{[item.portionTag, item.equivalence].filter(Boolean).join(' · ')}</div>
        )}
        <div className="note-presets">
          {NOTE_PRESETS.map(p => (
            <div key={p} className={`note-preset ${active.includes(p)?'active':''}`} onClick={()=>togglePreset(p)}>{p}</div>
          ))}
        </div>
        <textarea
          className="note-textarea"
          placeholder="Escribe una nota personalizada..."
          value={note}
          onChange={e=>setNote(e.target.value)}
          maxLength={200}
        />
        <button className="note-btn" onClick={()=>onSave(note)}>
          Guardar Nota
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   COMANDA PREVIEW — visual ticket de cocina
══════════════════════════════════════════════ */
function ComandaModal({mesa,items,waiter,zone,btConnected,onSend,onClose,isModification,roundN,packagingCount=0}) {
  const total = items.reduce((a,i)=>a+i.price*i.qty,0);
  return (
    <div className="comanda-modal" onClick={onClose}>
      <div className="comanda-box" onClick={e=>e.stopPropagation()}>
        <div className="comanda-title" style={{display:'flex',alignItems:'center',gap:6}}>
          {isModification ? <PlusCircle size={17} /> : <ChefHat size={17} />}
          {isModification ? `Ampliación — Ronda ${roundN}` : 'Vista Previa Comanda — Ronda 1'}
        </div>
        <div className="comanda-sub">Mesa {mesa} · {waiter.name} · {zone}</div>
        {isModification && (
          <div style={{
            background:'rgba(245,166,35,0.14)', border:'1px solid rgba(245,166,35,0.5)',
            borderRadius:8, padding:'9px 13px', marginBottom:8,
            fontSize:12, color:'#f5a623', fontWeight:700,
            display:'flex', alignItems:'center', gap:8,
          }}>
            <PlusCircle size={16} style={{flexShrink:0}} />
            Solo estos ítems NUEVOS se enviarán a cocina — el resto del pedido ya fue notificado y sigue igual (aunque ya esté "Listo").
          </div>
        )}

        <div className="comanda-ticket">
          <div className="comanda-ticket-hdr">
            ◉ {isModification ? `AMPLIACIÓN — RONDA ${roundN} — COCINA` : 'NUEVA COMANDA — RONDA 1 — COCINA'} · {(BIZ.nombre || '').toUpperCase()} ◉
          </div>
          <div className="comanda-ticket-body">
            <div className="comanda-meta">
              <div><strong>Mesa:</strong> {String(mesa).padStart(2,'0')} &nbsp;|&nbsp; <strong>Zona:</strong> {zone}</div>
              <div><strong>Mesero:</strong> {waiter.name} &nbsp;|&nbsp; <strong>Hora:</strong> {nowT()}</div>
            </div>

            {items.map((it,idx) => (
              <div key={lineIdFromLine(it)} className="comanda-line">
                <div className="comanda-product-row">
                  <div className="comanda-qty">{it.qty}</div>
                  <div style={{flex:1}}>
                    <div>{it.name}</div>
                  </div>
                </div>

                {/* Portion detail box — solo aplica a platos del menú fijo
                    (traen portionTag/equivalence/portionDetails). Los platos
                    nuevos del catálogo dinámico (Stock → "Agregar plato") no
                    tienen esta info — no hay nada que mostrar aquí para ellos. */}
                {it.portionTag && (
                <div className="comanda-portion-box">
                  <div className="comanda-portion-title">Detalle de Porción</div>
                  <div className="comanda-portion-detail">
                    <span className="comanda-equiv">{it.portionTag}</span>
                    {it.equivalence}
                  </div>
                  {it.portionDetails && it.portionDetails.length > 0 && (
                    <div style={{marginTop:4,borderTop:'1px dashed #ddd',paddingTop:4}}>
                      {it.portionDetails.map(pd => (
                        <div key={pd.label} style={{fontSize:10,color:'#555',display:'flex',gap:6}}>
                          <span style={{minWidth:60,color:'#888'}}>{pd.label}:</span>
                          <span style={{fontWeight:700}}>{pd.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {it.qty > 1 && (
                    <div style={{marginTop:4,paddingTop:4,borderTop:'1px dashed #ddd',fontSize:10,color:'#333',fontWeight:700}}>
                      TOTAL: {it.qty} × {it.portionTag} = {it.qty} {it.portionTag.includes('1/2')?'mitades':it.portionTag.includes('1/4')?'cuartos':it.portionTag.includes('1/8')?'octavos':'unidades'}
                    </div>
                  )}
                </div>
                )}
                {it.note && (
                  <div className="comanda-note">
                    <AlertTriangle size={13} style={{verticalAlign:-2,marginRight:4,flexShrink:0}} /><span><strong>NOTA:</strong> {it.note}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
          {packagingCount > 0 && (
            <div style={{textAlign:'center',fontWeight:800,fontSize:12,padding:'6px 0',borderTop:'1px dashed currentColor'}}>
              Para llevar: {packagingCount} envase{packagingCount !== 1 ? 's' : ''} (total del pedido)
            </div>
          )}
          <div className="comanda-ticket-ftr">
            <span>{items.reduce((s,i)=>s+i.qty,0)} ítems</span>
            <span className="comanda-total">S/ {total.toFixed(2)}</span>
          </div>
        </div>

        <button className="cm-btn confirm" onClick={onSend} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
          {isModification
            ? (btConnected ? <><Printer size={16}/> Imprimir y Enviar Ampliación</> : <><PlusCircle size={16}/> Confirmar Ampliación en Cocina</>)
            : (btConnected ? <><Printer size={16}/> Imprimir y Enviar a Cocina</> : <><Flame size={16}/> Enviar a Cocina</>)
          }
        </button>
        <button className="cm-btn secondary" onClick={onClose}>Regresar y Editar</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   CART SHEET
══════════════════════════════════════════════ */
/* ══════════════════════════════════════════════
   CLIENTE DE LA MESA — celular o DNI (opcional)
══════════════════════════════════════════════ */
const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Set','Oct','Nov','Dic'];
function ClienteModal({ cliente, hasOrder, catalog, waiterName, onSet, onCanjear, onClose }) {
  const [doc, setDoc]     = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');
  const [reg, setReg]     = useState(null);
  const [form, setForm]   = useState({ nombre: '', dia: '', mes: '', acepta: false, celular: '' });
  const [pickPremio, setPickPremio] = useState(false);

  // Refresca la fidelidad del cliente ya ligado a la mesa
  useEffect(() => {
    if (!cliente?.id) return;
    let alive = true;
    crmRpc('crm_estado_cliente', { p_cliente: cliente.id })
      .then(st => { if (alive && st) onSet({ ...cliente, stats: st }, { silent: true }); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cliente?.id]);

  const toCliente = r => ({ id: r.id, nombre: r.nombre, cumple_hoy: !!r.cumple_hoy, stats: r.stats || null, nuevo: !!r.nuevo });

  async function buscar() {
    if (busy) return;
    setErr('');
    const d = normalizeDoc(doc);
    if (!d) { setErr('Escribe un celular (9 dígitos, empieza con 9) o un DNI (8 dígitos).'); return; }
    setBusy(true);
    try {
      const r = await crmRpc('crm_identificar', { p_doc: d.valor });
      if (r?.encontrado) { onSet(toCliente(r)); setDoc(''); setReg(null); }
      else { setReg(d); setForm({ nombre: '', dia: '', mes: '', acepta: false, celular: '' }); }
    } catch (e) { setErr(crmErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function registrar() {
    if (busy || !reg) return;
    const nombre = form.nombre.trim().replace(/\s+/g, ' ');
    if (!nombre) { setErr('Escribe el nombre del cliente.'); return; }
    if (nombre.length > 80) { setErr('El nombre es demasiado largo.'); return; }
    const dia = form.dia ? Number(form.dia) : null, mes = form.mes ? Number(form.mes) : null;
    if ((dia && !mes) || (!dia && mes)) { setErr('Completa día y mes del cumpleaños (o deja ambos vacíos).'); return; }
    setBusy(true); setErr('');
    try {
      const r = await crmRpc('crm_identificar', {
        p_doc: reg.valor, p_nombre: nombre, p_acepta: !!form.acepta, p_cumple_dia: dia, p_cumple_mes: mes,
        p_celular_extra: reg.tipo === 'dni' ? (form.celular || null) : null, p_creado_por: waiterName || null,
      });
      if (r?.encontrado) { onSet(toCliente(r)); setReg(null); setDoc(''); }
    } catch (e) { setErr(crmErrorMessage(e)); }
    finally { setBusy(false); }
  }

  const st = cliente?.stats || null;
  const productos = st ? premioProductsM(catalog, st.premio_categoria) : [];
  const inp = { width:'100%', boxSizing:'border-box', background:'var(--ink3)', border:'1px solid var(--line2)', borderRadius:10, padding:'11px 12px', color:'var(--snow)', fontSize:15, outline:'none' };
  const btnS = { padding:'11px 12px', borderRadius:10, border:'1px solid var(--line2)', background:'var(--ink3)', color:'var(--mist)', fontSize:13, fontWeight:800, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 };

  return (
    <div className="ticket-modal" onClick={onClose} style={{ zIndex: 950 }}>
      <div className="ticket-box" onClick={e=>e.stopPropagation()} style={{ maxHeight:'calc(100vh - 32px)', overflowY:'auto' }}>
        <div style={{fontFamily:'var(--display)',fontSize:20,color:'var(--amber)',marginBottom:4,display:'flex',alignItems:'center',gap:7}}>
          <UserRound size={18}/> Cliente
        </div>
        <div style={{fontSize:11,color:'var(--mist)',marginBottom:12}}>Opcional: suma visitas para su premio de fidelidad.</div>

        {cliente ? (
          <div style={{ background:'var(--ink3)', border:'1px solid var(--line2)', borderRadius:12, padding:'12px 14px', marginBottom:12 }}>
            <div style={{ fontSize:17, fontWeight:800, color:'var(--snow)' }}>
              ¡Hola, {cliente.nombre}! {cliente.cumple_hoy && <span style={{color:'#DB2777'}}>🎂 ¡Feliz cumpleaños!</span>}
            </div>
            {st && (
              <div style={{ fontSize:13, color:'var(--mist)', marginTop:4 }}>
                {cliente.nuevo ? 'Cliente nuevo · ' : ''}Visita {st.visita_actual} de {st.meta}
                {st.premio_disponible && <div style={{ marginTop:6, fontWeight:800, color:'#16A34A' }}><Gift size={13} style={{verticalAlign:-2}}/> ¡Hoy le toca: {st.premio_texto}!</div>}
                {st.aviso && <div style={{ marginTop:6, fontWeight:800, color:'#DC2626' }}><AlertTriangle size={13} style={{verticalAlign:-2}}/> {st.aviso}</div>}
              </div>
            )}
            {st?.premio_disponible && (
              hasOrder ? (
                <button onClick={() => setPickPremio(v => !v)} style={{ ...btnS, width:'100%', marginTop:10, background:'#16A34A', color:'#fff', border:'none' }}>
                  <Gift size={14}/> Canjear {st.premio_texto}
                </button>
              ) : (
                <div style={{ fontSize:11.5, color:'#D97706', marginTop:8 }}>Envía primero el pedido a cocina; luego canjea el premio aquí.</div>
              )
            )}
            {pickPremio && (
              <div style={{ marginTop:8 }}>
                {productos.length === 0
                  ? <div style={{ fontSize:12, color:'#D97706' }}>No hay productos disponibles en “{st.premio_categoria}”.</div>
                  : productos.map(pr => (
                    <button key={pr.id} disabled={busy} onClick={async () => { setBusy(true); try { await onCanjear(pr); setPickPremio(false); } finally { setBusy(false); } }}
                      style={{ ...btnS, width:'100%', marginBottom:6, justifyContent:'flex-start', color:'var(--snow)' }}>{pr.name}</button>
                  ))}
              </div>
            )}
            <button onClick={() => onSet(null)} style={{ ...btnS, width:'100%', marginTop:10, color:'#DC2626' }}><X size={14}/> Quitar cliente de la mesa</button>
          </div>
        ) : (
          <>
            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <input value={doc} onChange={e => { setDoc(e.target.value); setErr(''); setReg(null); }}
                onKeyDown={e => { if (e.key === 'Enter') buscar(); }}
                inputMode="numeric" maxLength={15} placeholder="Celular o DNI" style={{ ...inp, flex:1 }} autoFocus />
              <button onClick={buscar} disabled={busy || !doc.trim()} style={{ ...btnS, background:'var(--amber)', color:'#fff', border:'none' }}>
                {busy && !reg ? <Loader2 size={14} style={{animation:'spin .8s linear infinite'}}/> : 'Buscar'}
              </button>
            </div>
            {reg && (
              <div style={{ border:'1px dashed var(--line2)', borderRadius:12, padding:'10px 12px', marginBottom:8, display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ fontSize:12, color:'var(--mist)' }}>No está registrado. Registro rápido ({reg.tipo === 'dni' ? 'DNI' : 'celular'} {reg.valor}):</div>
                <input value={form.nombre} maxLength={80} placeholder="Nombre" onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} style={inp} />
                {reg.tipo === 'dni' && <input value={form.celular} maxLength={15} inputMode="numeric" placeholder="Celular (opcional)" onChange={e => setForm(f => ({ ...f, celular: e.target.value }))} style={inp} />}
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <span style={{ fontSize:12, color:'var(--fog)' }}>Cumpleaños:</span>
                  <select value={form.dia} onChange={e => setForm(f => ({ ...f, dia: e.target.value }))} style={{ ...inp, width:80, padding:'8px' }}>
                    <option value="">Día</option>{Array.from({length:31},(_,i)=>i+1).map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <select value={form.mes} onChange={e => setForm(f => ({ ...f, mes: e.target.value }))} style={{ ...inp, width:96, padding:'8px' }}>
                    <option value="">Mes</option>{MESES_CORTOS.map((m,i) => <option key={m} value={i+1}>{m}</option>)}
                  </select>
                </div>
                <label style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:12, color:'var(--mist)', lineHeight:1.4 }}>
                  <input type="checkbox" checked={form.acepta} onChange={e => setForm(f => ({ ...f, acepta: e.target.checked }))} style={{ marginTop:3 }} />
                  Acepta recibir promociones y saludos por WhatsApp.
                </label>
                <button onClick={registrar} disabled={busy} style={{ ...btnS, background:'var(--amber)', color:'#fff', border:'none' }}>
                  {busy ? <Loader2 size={14} style={{animation:'spin .8s linear infinite'}}/> : <UserPlus size={14}/>} Registrar y ligar a la mesa
                </button>
              </div>
            )}
          </>
        )}
        {err && <div style={{ fontSize:12, color:'#DC2626', marginBottom:8 }}>{err}</div>}
        <button className="cm-btn secondary" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}

function CartSheet({mesa,items,waiter,zone,btConnected,onClose,onQty,onNote,onSendKitchen,onPrintTicket,onCloseTable,existingOrderId,cajaAbierta=true,rounds=[],joinedTables=[],freeTables=[],onJoin,onUnjoin,packaging=null,cliente=null,onOpenCliente=null,descuento=null,onCupon=null,onQuitarCupon=null}) {
  const [noteTarget,setNoteTarget] = useState(null);
  const [showJoin,setShowJoin] = useState(false);
  const [joinSel,setJoinSel] = useState([]);
  const [joinBusy,setJoinBusy] = useState(false);
  const [showComanda,setShowComanda] = useState(false);
  const packTotal = packaging && items.length ? packaging.total : 0;
  const descTotal = descuento && items.length ? descuento.monto : 0;
  const total = Math.round((itemsTotal(items) + packTotal - descTotal) * 100) / 100;
  const cartCount = items.reduce((s,i)=>s+i.qty,0);
  // Ítems (o cantidades) que aún no se han enviado a cocina — solo estos
  // viajan en la próxima comanda/ampliación.
  const pendingItems = useMemo(() => items
    .map(it => ({ ...it, qty: it.qty - (it.sentQty || 0) }))
    .filter(it => it.qty > 0), [items]);
  const pendingCount = pendingItems.reduce((s,i)=>s+i.qty,0);
  const isModification = !!existingOrderId;
  const nothingPendingToSend = isModification && pendingCount === 0;
  const nextRoundN = (rounds?.length || 0) + 1;
  const ROUND_LABEL = { pendiente:'Pendiente', en_cocina:'En cocina', listo:'Lista ✓' };
  const ROUND_COLOR = { pendiente:'#D97706', en_cocina:'#1D4ED8', listo:'#047857' };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}/>
      <div className="cart-sheet">
        <div className="sheet-handle"/>
        <div className="sheet-hdr">
          <div className="sheet-hdr-row">
            <div className="sheet-title">Pedido</div>
            <div className="sheet-mesa">Mesa {mesa}</div>
          </div>
          <div className="sheet-waiter">
            <span style={{color:waiter.color}}>●</span> {waiter.name} · {zone} · {cartCount} ítem{cartCount!==1?'s':''}
          </div>
          {onOpenCliente && (
            <button onClick={onOpenCliente} style={{
              marginTop:8, display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:20,
              border:`1px ${cliente ? 'solid' : 'dashed'} ${cliente?.stats?.premio_disponible ? '#16A34A' : 'var(--line2)'}`,
              background: cliente ? 'rgba(217,119,6,.08)' : 'transparent', color: cliente ? 'var(--snow)' : 'var(--mist)',
              fontSize:11.5, fontWeight:800, cursor:'pointer', maxWidth:'100%',
            }}>
              <UserRound size={12}/>
              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {cliente ? `${cliente.nombre}${cliente.stats ? ` · visita ${cliente.stats.visita_actual}/${cliente.stats.meta}` : ''}` : 'Cliente (celular o DNI)'}
              </span>
              {cliente?.stats?.premio_disponible && <Gift size={12} style={{ color:'#16A34A' }}/>}
              {cliente?.cumple_hoy && <span>🎂</span>}
              {cliente?.stats?.aviso && <AlertTriangle size={12} style={{ color:'#DC2626' }}/>}
            </button>
          )}
          {cliente?.stats?.aviso && (
            <div style={{ marginTop:6, fontSize:11.5, fontWeight:800, color:'#DC2626', display:'flex', alignItems:'center', gap:5 }}>
              <AlertTriangle size={12}/> {cliente.stats.aviso}
            </div>
          )}
          {/* Cupón de descuento — con el pedido ya enviado a cocina */}
          {onCupon && existingOrderId && (
            descuento && descuento.monto > 0 ? (
              <div style={{ marginTop:8, display:'inline-flex', alignItems:'center', gap:6, padding:'4px 6px 4px 10px', borderRadius:20, border:'1px solid #16A34A', color:'#16A34A', fontSize:11.5, fontWeight:800 }}>
                🎟 {descuento.label}: −{fmtS(descuento.monto)}
                <span onClick={onQuitarCupon} title="Quitar descuento" style={{ cursor:'pointer', display:'inline-flex', padding:2 }}><X size={12}/></span>
              </div>
            ) : (
              <button onClick={onCupon} style={{ marginTop:8, marginLeft:6, display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:20, border:'1px dashed var(--line2)', background:'transparent', color:'var(--mist)', fontSize:11.5, fontWeight:800, cursor:'pointer' }}>
                🎟 Cupón
              </button>
            )
          )}
          {/* Indicativo de rondas — permite ver de un vistazo qué ya está
              Listo y qué sigue en cocina, sin perder el historial. */}
          {rounds.length > 0 && (
            <div style={{display:'flex', flexWrap:'wrap', gap:6, marginTop:8}}>
              {rounds.map(r => (
                <div key={r.n} style={{
                  fontSize:10, fontWeight:800, padding:'3px 9px', borderRadius:20,
                  color:ROUND_COLOR[r.status]||'#666',
                  background:'#fff', border:`1px solid ${ROUND_COLOR[r.status]||'#ccc'}55`,
                }}>
                  Ronda {r.n} · {ROUND_LABEL[r.status]||r.status}
                </div>
              ))}
            </div>
          )}
          {/* Unir mesas — solo cuando el pedido ya existe (mesa ocupada) */}
          {onJoin && (existingOrderId || joinedTables.length > 0) && (
            <div style={{display:'flex', flexWrap:'wrap', alignItems:'center', gap:6, marginTop:8}}>
              {joinedTables.map(n => (
                <span key={n} style={{
                  fontSize:10, fontWeight:800, padding:'3px 6px 3px 9px', borderRadius:20,
                  color:'var(--amber)', border:'1px solid rgba(217,119,6,.4)', background:'rgba(217,119,6,.08)',
                  display:'inline-flex', alignItems:'center', gap:4,
                }}>
                  <Link2 size={11}/> Mesa {n}
                  <span title={`Separar Mesa ${n}`} onClick={() => { if (window.confirm(`¿Separar la Mesa ${n}? Quedará libre.`)) onUnjoin(n); }}
                    style={{cursor:'pointer', display:'inline-flex', padding:2}}><X size={11}/></span>
                </span>
              ))}
              <button onClick={() => { setJoinSel([]); setShowJoin(true); }} style={{
                fontSize:10.5, fontWeight:800, padding:'4px 10px', borderRadius:20, cursor:'pointer',
                border:'1px dashed var(--line2)', background:'transparent', color:'var(--mist)',
                display:'inline-flex', alignItems:'center', gap:4,
              }}><Link2 size={11}/> Unir mesas</button>
              {joinedTables.length > 1 && (
                <button onClick={() => { if (window.confirm('¿Separar todas las mesas unidas? Quedarán libres.')) onUnjoin(null); }} style={{
                  fontSize:10.5, fontWeight:800, padding:'4px 10px', borderRadius:20, cursor:'pointer',
                  border:'1px solid var(--line2)', background:'transparent', color:'#DC2626',
                  display:'inline-flex', alignItems:'center', gap:4,
                }}><Unlink size={11}/> Separar todas</button>
              )}
            </div>
          )}
        </div>

        {showJoin && (
          <div style={{padding:'10px 16px', borderBottom:'1px solid var(--line2)', background:'var(--ink3)'}}>
            <div style={{fontSize:12, fontWeight:800, color:'var(--snow)', marginBottom:4}}>Unir a la Mesa {mesa}</div>
            <div style={{fontSize:10.5, color:'var(--fog)', marginBottom:8, lineHeight:1.4}}>
              Elige mesas LIBRES. Quedarán ocupadas y su consumo va en la cuenta de la Mesa {mesa}. Al cobrar, se liberan todas.
            </div>
            {freeTables.length === 0
              ? <div style={{fontSize:11, color:'var(--fog)', marginBottom:8}}>No hay mesas libres.</div>
              : (
                <div style={{display:'flex', flexWrap:'wrap', gap:6, marginBottom:10, maxHeight:120, overflowY:'auto'}}>
                  {freeTables.map(n => {
                    const on = joinSel.includes(n);
                    return (
                      <span key={n} onClick={() => setJoinSel(sel => on ? sel.filter(x => x !== n) : (sel.length >= 10 ? sel : [...sel, n]))} style={{
                        minWidth:38, textAlign:'center', fontSize:12, fontWeight:800, padding:'6px 8px', borderRadius:8, cursor:'pointer',
                        border:`1px solid ${on ? 'var(--amber)' : 'var(--line2)'}`,
                        background: on ? 'rgba(217,119,6,.16)' : 'var(--ink2)', color: on ? 'var(--amber)' : 'var(--mist)',
                      }}>{n}</span>
                    );
                  })}
                </div>
              )}
            <div style={{display:'flex', gap:8}}>
              <button onClick={() => setShowJoin(false)} disabled={joinBusy} style={{
                flex:1, padding:'8px', borderRadius:8, border:'1px solid var(--line2)', background:'var(--ink2)',
                color:'var(--mist)', fontSize:12, fontWeight:800, cursor:'pointer',
              }}>Cancelar</button>
              <button
                disabled={joinBusy || joinSel.length === 0}
                onClick={async () => {
                  setJoinBusy(true);
                  const ok = await onJoin(joinSel);
                  setJoinBusy(false);
                  if (ok) setShowJoin(false);
                }}
                style={{
                  flex:2, padding:'8px', borderRadius:8, border:'none', fontSize:12, fontWeight:800,
                  background:'linear-gradient(135deg, #D97706, #B45309)', color:'#fff',
                  cursor: (joinBusy || joinSel.length === 0) ? 'not-allowed' : 'pointer',
                  opacity: (joinBusy || joinSel.length === 0) ? .6 : 1,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:6,
                }}
              >{joinBusy ? <Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> : <Link2 size={13}/>} Unir {joinSel.length ? `(${joinSel.length})` : ''}</button>
            </div>
          </div>
        )}

        <div className="sheet-body">
          {items.length === 0 ? (
            <div className="cart-empty">
              <ShoppingCart size={44} strokeWidth={1.5} style={{opacity:.5,marginBottom:12}} />
              <p>Agrega productos desde el menú</p>
            </div>
          ) : items.map(it => (
            <div key={lineIdFromLine(it)} className="cart-item">
              <div className="ci-left">
                <div className="ci-qty-controls">
                  <div className="ci-btn minus" onClick={()=>onQty(lineIdFromLine(it),-1)}>−</div>
                  <div className="ci-qty">{it.qty}</div>
                  <div className="ci-btn plus"  onClick={()=>onQty(lineIdFromLine(it),+1)}>+</div>
                </div>
              </div>
              <div className="ci-info">
                <div className="ci-name">
                  {it.name}
                  {isModification && (it.qty - (it.sentQty||0)) > 0 && (
                    <span style={{
                      marginLeft:6, fontSize:9, fontWeight:800, color:'#f5a623',
                      border:'1px solid rgba(245,166,35,0.5)', borderRadius:20,
                      padding:'1px 6px', verticalAlign:'middle',
                    }}>
                      +{it.qty - (it.sentQty||0)} NUEVO
                    </span>
                  )}
                </div>
                {/* Portion pill */}
                <div className="ci-portion">
                  <Ruler size={11} style={{verticalAlign:-1,marginRight:2}} />{it.portionTag}
                  {it.qty > 1 && <span style={{color:'var(--mist)',fontWeight:400}}>× {it.qty}</span>}
                </div>
                {/* Equivalence detail */}
                <span className="ci-portion-desc">{it.equivalence}</span>
                {/* Note */}
                {it.note ? (
                  <div className="ci-note-btn" onClick={()=>setNoteTarget(it)}>
                    <NotebookPen size={11} style={{verticalAlign:-1,marginRight:3}} /> {it.note}
                  </div>
                ) : (
                  <div className="ci-note-btn" onClick={()=>setNoteTarget(it)}>
                    + Añadir nota
                  </div>
                )}
              </div>
              <div className="ci-price">{fmtS(it.price*it.qty)}</div>
            </div>
          ))}
        </div>

        <div className="sheet-foot">
          {/* Envases descartables para llevar (precio fijo; no usan stock) */}
          {packaging && items.length > 0 && (packaging.enabled || packaging.count > 0) && (
            <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 2px 10px',marginBottom:6,borderBottom:'1px dashed var(--line2)'}}>
              <ShoppingBag size={16} style={{color:'var(--amber)',flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:800,color:'var(--snow)'}}>Envases para llevar</div>
                <div style={{fontSize:10.5,color:'var(--fog)'}}>
                  {fmtS(packaging.unit)} c/u{packaging.count > 0 ? ` · ${fmtS(packaging.total)}` : ''}
                </div>
              </div>
              <div className="ci-qty-controls">
                <div className="ci-btn minus" onClick={()=>{ if (packaging.count > 0) packaging.onChange(-1); }}
                  style={packaging.count <= 0 ? {opacity:.4,pointerEvents:'none'} : undefined}>−</div>
                <div className="ci-qty">{packaging.count}</div>
                <div className="ci-btn plus" onClick={()=>{ if (packaging.enabled && packaging.count < PACKAGING_MAX) packaging.onChange(1); }}
                  style={(!packaging.enabled || packaging.count >= PACKAGING_MAX) ? {opacity:.4,pointerEvents:'none'} : undefined}>+</div>
              </div>
            </div>
          )}
          {descTotal > 0 && (
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, fontWeight:800, color:'#16A34A', marginBottom:6 }}>
              <span>{descuento.label}</span><span>−{fmtS(descTotal)}</span>
            </div>
          )}
          <div className="total-row">
            <div>
              <div className="total-label">Total</div>
              <div className="total-items">{items.reduce((s,i)=>s+i.qty,0)} ítems{packaging && packaging.count > 0 && items.length ? ` + ${packaging.count} envase${packaging.count !== 1 ? 's' : ''}` : ''} · IGV incl.</div>
            </div>
            <div className="total-amount">{fmt(total)}</div>
          </div>
          {!cajaAbierta && items.length > 0 && (
            <div className="caja-cerrada-banner" style={{display:'flex',alignItems:'center',gap:6}}>
              <Lock size={13} style={{flexShrink:0}} /> Caja Cerrada — para enviar el pedido a cocina se requiere abrir la caja
            </div>
          )}
          {items.length > 0 && (
            <div className="foot-actions">
              <button
                className="btn-kitchen"
                onClick={()=>{ if (cajaAbierta && !nothingPendingToSend) setShowComanda(true); }}
                disabled={!cajaAbierta || nothingPendingToSend}
                style={(!cajaAbierta || nothingPendingToSend) ? {opacity:.5, cursor:'not-allowed'} : undefined}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                {!cajaAbierta ? 'Caja Cerrada'
                  : nothingPendingToSend ? 'Sin ítems nuevos'
                  : isModification ? `Enviar Ronda ${nextRoundN} (+${pendingCount})`
                  : 'Ver y Enviar Cocina'}
              </button>
              <button className="btn-ticket" onClick={onPrintTicket}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              </button>
            </div>
          )}
          {items.length > 0 && (
            <button className="btn-close-table" onClick={onCloseTable} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
              <Check size={15}/> Cerrar Mesa {mesa}
            </button>
          )}
        </div>
      </div>

      {/* Note modal */}
      {noteTarget && (
        <NoteModal
          item={noteTarget}
          onSave={note=>{ onNote(lineIdFromLine(noteTarget), note); setNoteTarget(null); }}
          onClose={()=>setNoteTarget(null)}
        />
      )}

      {/* Comanda preview */}
      {showComanda && (
        <ComandaModal
          mesa={mesa} items={isModification ? pendingItems : items} waiter={waiter} zone={zone}
          btConnected={btConnected}
          isModification={isModification}
          roundN={nextRoundN}
          packagingCount={packaging ? packaging.count : 0}
          onSend={()=>{ setShowComanda(false); onSendKitchen(); }}
          onClose={()=>setShowComanda(false)}
        />
      )}
    </>
  );
}

/* ══════════════════════════════════════════════
   SCREEN: MESAS
══════════════════════════════════════════════ */
function MesasScreen({tables,waiter,onSelectTable,selectedTable,orderStatuses}) {
  const occupied = tables.filter(t=>t.occupied).length;
  const mine = tables.filter(t=>t.waiterId===waiter.id).length;
  const myTotal = tables.filter(t=>t.waiterId===waiter.id).reduce((s,t)=>s+t.items.reduce((ss,i)=>ss+i.price*i.qty,0),0);

  const getZone = tableId => {
    for(const z of ZONES) if(z.tables.includes(tableId)) return z.name;
    return 'General';
  };

  // Resuelve info del mesero desde el estado de la mesa (soporta meseros externos vía Realtime)
  const waiterInfoOf = t => {
    if (!t.occupied) return null;
    if (t.waiterName) return { name: t.waiterName, color: t.waiterColor || '#f5a623' };
    const local = WAITERS.find(w => w.id === t.waiterId);
    return local ? { name: local.name, color: local.color } : null;
  };

  return (
    <div className="screen anim-fadeUp">
      {/* Waiter stats bar */}
      <div className="waiter-bar">
        <div className="waiter-bar-avatar" style={{background:waiter.bg,color:waiter.color}}>
          {waiter.initial}
        </div>
        <div className="waiter-bar-info">
          <div className="waiter-bar-name">{waiter.name}</div>
          <div className="waiter-bar-status">
            <span className="live-dot"/>
            {mine} mesa{mine!==1?'s':''} a mi cargo · {occupied}/{tables.length} ocupadas
          </div>
        </div>
        <div className="stat-pill">
          <div className="stat-pill-val">{fmt(myTotal)}</div>
          <div className="stat-pill-lbl">Mi turno</div>
        </div>
      </div>

      {/* Zones */}
      {ZONES.map(zone => (
        <div key={zone.name}>
          <div className="zone-label">{zone.name} · {zone.tables.length} mesas</div>
          <div className="tables-grid">
            {zone.tables.map(tid => {
              const t = tables.find(x=>x.id===tid);
              // Una mesa recién agregada por el admin puede figurar en la distribución un
              // instante antes de estar en el estado local — se omite ese render, no se rompe.
              if (!t) return null;
              const isSelected = selectedTable===tid;
              const isMine = t.waiterId===waiter.id;
              // Unir mesas: esta mesa está unida a otra / o tiene mesas unidas
              const joinedChildren = tables.filter(x => x.joinedTo === tid).map(x => x.id);
              if (t.joinedTo) {
                const pt = tables.find(x => x.id === t.joinedTo);
                const pMine = pt && pt.waiterId === waiter.id;
                return (
                  <div key={tid} className={`tbl ${pMine ? 'mine' : 'occupied'}`} onClick={()=>onSelectTable(tid)} style={{borderStyle:'dashed'}}>
                    <div className="tbl-num">{tid}</div>
                    <div className={`tbl-status ${pMine ? 'mine' : 'busy'}`} style={{display:'flex',alignItems:'center',gap:3}}>
                      <Link2 size={11}/> Con Mesa {t.joinedTo}
                    </div>
                    <div className="tbl-detail" style={{color:'var(--mist)'}}>Cuenta en Mesa {t.joinedTo}</div>
                  </div>
                );
              }
              const tw = waiterInfoOf(t);
              const tTotal = tableGrandTotal(t);
              const tItems = t.items.reduce((s,i)=>s+i.qty,0);
              // Urgencia por tiempo: warn ≥25min, alert ≥45min (solo mis mesas)
              const elMin = isMine && t.occupied && t.openAt ? Math.floor((Date.now()-t.openAt)/60000) : 0;
              const urgCls = elMin>=45?'alert-time':elMin>=25?'warn-time':'';
              // Estado del pedido en cocina
              const ordId = t.supabaseOrderId;
              const ordSt = ordId ? (orderStatuses[ordId]||null) : null;
              return (
                <div
                  key={tid}
                  className={`tbl ${t.occupied?(isMine?'mine':'occupied'):''} ${isSelected?'selected':''} ${urgCls}`}
                  onClick={()=>onSelectTable(tid)}
                >
                  {t.occupied && tw && (
                    <div className="tbl-waiter-dot" style={{background:tw.color}} title={tw.name}/>
                  )}
                  <div className="tbl-num">{tid}</div>
                  <div className={`tbl-status ${t.occupied?(isMine?'mine':'busy'):'free'}`}>
                    {t.occupied ? (isMine ? '● Mía' : `● ${tw?.name || 'Ocupada'}`) : '○ Libre'}
                  </div>
                  {joinedChildren.length > 0 && (
                    <div className="tbl-detail" style={{display:'flex',alignItems:'center',gap:3,fontWeight:800}}>
                      <Link2 size={11}/> + Mesa {joinedChildren.join(', ')}
                    </div>
                  )}
                  {t.occupied && (
                    <>
                      {isMine
                        ? <div className="tbl-detail">{tItems} ítem{tItems!==1?'s':''} · {elapsed(t.openAt)}</div>
                        : <div className="tbl-detail" style={{color:'var(--mist)'}}>En atención</div>
                      }
                      {isMine && <div className="tbl-price">{fmtS(tTotal)}</div>}
                      {/* Badge de estado del pedido en cocina */}
                      {isMine && ordSt && (ordSt==='preparing'||ordSt==='ready') && (
                        <div className="ord-status-badge" style={{
                          background: ordSt==='ready'?'rgba(46,204,113,0.2)':'rgba(255,107,53,0.2)',
                          color:      ordSt==='ready'?'var(--emerald)':'var(--flame)',
                          border:     `1px solid ${ordSt==='ready'?'rgba(46,204,113,0.3)':'rgba(255,107,53,0.3)'}`,
                          display:'flex', alignItems:'center', gap:3,
                        }}>
                          {ordSt==='ready' ? <><CheckCircle2 size={11}/> LISTO</> : <><Flame size={11}/> PREP.</>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{height:80}}/>
    </div>
  );
}

/* ══════════════════════════════════════════════
   SCREEN: MENÚ
══════════════════════════════════════════════ */
/* Combina el catálogo estático (con las anulaciones de precio/imagen/
   disponible/oculto que edita el admin en Stock) con el catálogo dinámico
   (platos/bebidas creados desde AdminDashboard → Stock → "Agregar plato").
   Función única: la usan el menú Y el escáner de pedidos del cliente, así
   ambos ven exactamente los mismos productos, precios y disponibilidad. */
function combineMenu(invMap, customItems) {
  const im = invMap || {};
  const staticItems = MENU
    .map(m=>{
      const ov = im[m.id];
      if (ov && ov.hidden) return null; // "eliminado" desde Stock
      return ov
        ? { ...m, price: ov.price ?? m.price, img: ov.img || m.img, available: ov.available !== false, stock: ov.stock ?? null }
        : { ...m, available: true, stock: null };
    })
    .filter(Boolean);

  const custom = (customItems || []).map(ci => ({
    id: ci.id, cat: ci.cat, name: ci.name, price: ci.price,
    img: ci.img || IMG_PLACEHOLDER, portionTag: null, portionDesc: ci.description || '',
    available: ci.available !== false,
    stock: ci.stock ?? null,
    variants: Array.isArray(ci.variants) ? ci.variants : [],
  }));

  return [...staticItems, ...custom];
}

function MenuScreen({selectedTable,tables,waiter,onAddItem,invMap,customItems,onScanOrder}) {
  const [cat,setCat] = useState('Todos');
  const [q,setQ] = useState('');
  const [sizeFor,setSizeFor] = useState(null); // plato con tamaños esperando que se elija uno

  const allItems = useMemo(()=>combineMenu(invMap, customItems),[invMap,customItems]);

  const CATS = useMemo(()=>['Todos', ...new Set(allItems.map(i=>i.cat))],[allItems]);

  useEffect(()=>{ if(!CATS.includes(cat)) setCat('Todos'); },[CATS,cat]);

  const filtered = useMemo(()=>
    allItems.filter(m=>(cat==='Todos'||m.cat===cat)&&(!q||m.name.toLowerCase().includes(q.toLowerCase())))
  ,[allItems,cat,q]);

  if(!selectedTable) {
    return (
      <div className="screen anim-fadeUp" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,padding:30}}>
        <Armchair size={52} strokeWidth={1.5} style={{opacity:.3}} />
        <div style={{fontSize:14,color:'var(--fog)',textAlign:'center'}}>Selecciona una mesa en la pestaña<br/><strong style={{color:'var(--amber)'}}>Mesas</strong> para agregar productos</div>
      </div>
    );
  }

  const zone = ZONES.find(z=>z.tables.includes(selectedTable))?.name || 'General';

  return (
    <div className="screen anim-fadeUp" style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>
      {/* Selected table bar */}
      <div style={{
        background:'var(--ink2)',borderBottom:'1px solid var(--line)',
        padding:'8px 12px',display:'flex',alignItems:'center',gap:10,flexShrink:0
      }}>
        <div style={{
          background:'linear-gradient(135deg,var(--amber3),var(--amber))',
          color:'#000',fontFamily:'var(--display)',fontSize:13,
          padding:'4px 12px',borderRadius:20,letterSpacing:'.5px'
        }}>Mesa {selectedTable}</div>
        <div style={{fontSize:11,color:'var(--mist)',flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{zone} · {waiter.name}</div>
        {onScanOrder && (
          <button
            onClick={onScanOrder}
            title="Escanear el QR del pedido del cliente (carta digital)"
            style={{
              display:'inline-flex',alignItems:'center',gap:5,flexShrink:0,
              padding:'5px 10px',borderRadius:20,cursor:'pointer',
              border:'1px solid var(--amber)',background:'rgba(245,158,11,.1)',
              color:'var(--amber3)',fontSize:11,fontWeight:800,
            }}
          ><ScanLine size={14}/> Escanear</button>
        )}
        <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--amber)',fontWeight:700,flexShrink:0}}>
          {fmt((tables.find(t=>t.id===selectedTable)?.items||[]).reduce((s,i)=>s+i.price*i.qty,0))}
        </div>
      </div>

      {/* Search */}
      <div className="search-wrap" style={{paddingTop:8}}>
        <div className="search-bar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input placeholder="Buscar producto..." value={q} onChange={e=>setQ(e.target.value)}/>
          {q && <span style={{color:'var(--fog)',cursor:'pointer'}} onClick={()=>setQ('')}>×</span>}
        </div>
      </div>

      {/* Categories */}
      <div className="cats-scroll">
        {CATS.map(c=>(
          <div key={c} className={`cat-chip ${cat===c?'active':''}`} onClick={()=>setCat(c)}>
            {(() => {
              const Icon = c==='Brasas' ? Flame : c==='Fast Food' ? Sandwich : c==='Bebidas' ? CupSoda : c==='Tragos' ? Martini : UtensilsCrossed;
              return <Icon size={14} strokeWidth={2.25} style={{verticalAlign:'-2px', marginRight:4}} />;
            })()} {c}
          </div>
        ))}
      </div>

      {/* Items */}
      <div style={{flex:1,overflowY:'auto'}}>
        {filtered.length === 0 ? (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,padding:'50px 20px'}}>
            <UtensilsCrossed size={52} strokeWidth={1.5} style={{opacity:.3}} />
            <div style={{fontSize:14,color:'var(--fog)',textAlign:'center'}}>
              {q || cat!=='Todos'
                ? <>Sin resultados para esta búsqueda</>
                : <>Aún no hay platos en el catálogo<br/><span style={{fontSize:12}}>Agrégalos desde el panel admin → Stock → "Agregar plato"</span></>
              }
            </div>
          </div>
        ) : (
        <div className="menu-list">
          {filtered.map(item=>{
            const disabled = item.available === false;
            return (
              <div
                key={item.id}
                className={`menu-item${disabled ? ' menu-item-disabled' : ''}`}
                onClick={()=>{
                  if (disabled) return;
                  if (hasVariants(item)) setSizeFor(item);        // elegir Fuente P./M./G.
                  else onAddItem(applyVariant(item, null));
                }}
              >
                <div className="mi-emoji-wrap">
                  <img
                    src={item.img || IMG_PLACEHOLDER} alt={item.name} onError={imgFallback}
                    loading="lazy" decoding="async"
                    style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:11, filter: disabled ? 'grayscale(75%)' : 'none', opacity: disabled ? .55 : 1}}
                  />
                  {item.portionTag && <div className="mi-portion-tag">{item.portionTag}</div>}
                  {disabled && <div className="mi-agotado-badge">AGOTADO</div>}
                </div>
                <div className="mi-info">
                  <div className="mi-name">{item.name}</div>
                  {item.portionDesc && <div className="mi-portion-desc">{item.portionDesc}</div>}
                  <div className="mi-cat">{item.cat}</div>
                </div>
                <div className="mi-right">
                  <div className="mi-price">
                    {hasVariants(item) && <span style={{fontSize:10,fontWeight:700,color:'var(--fog)'}}>desde </span>}
                    {fmt(hasVariants(item) ? minVariantPrice(item.variants, item.price) : item.price)}
                  </div>
                  <div className="mi-add">{disabled ? <X size={16} strokeWidth={3}/> : <Plus size={18} strokeWidth={3}/>}</div>
                </div>
              </div>
            );
          })}
          <div style={{height:80}}/>
        </div>
        )}
      </div>

      {sizeFor && (
        <SizePickerSheet
          item={sizeFor}
          onClose={()=>setSizeFor(null)}
          onPick={v=>{ onAddItem(applyVariant(sizeFor, v)); setSizeFor(null); }}
        />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   SELECTOR DE TAMAÑO (Fuente P. / M. / G.)
══════════════════════════════════════════════ */
function SizePickerSheet({ item, onPick, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position:'fixed', inset:0, zIndex:930, display:'flex', alignItems:'flex-end', justifyContent:'center',
      background:'rgba(0,0,0,.6)', animation:'fadeIn .15s ease',
    }}>
      <div onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Tamaño de ${item.name}`} style={{
        width:'100%', maxWidth:480, background:'var(--ink2)', borderTop:'1px solid var(--line2)',
        borderRadius:'18px 18px 0 0', padding:'16px 16px calc(16px + env(safe-area-inset-bottom))',
      }}>
        <div style={{fontSize:16,fontWeight:800,color:'var(--snow)'}}>{item.name}</div>
        <div style={{fontSize:12,color:'var(--fog)',margin:'2px 0 12px'}}>Elige el tamaño</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {item.variants.map(v => (
            <button key={v.key} onClick={()=>onPick(v)} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between', gap:10,
              padding:'14px 16px', borderRadius:12, cursor:'pointer',
              border:'1px solid var(--line2)', background:'var(--ink3)', color:'var(--snow)',
              fontSize:15, fontWeight:700,
            }}>
              <span>{v.label}</span>
              <span style={{color:'var(--amber)'}}>{fmt(v.price)}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{
          marginTop:10, width:'100%', padding:'12px', borderRadius:12, cursor:'pointer',
          border:'1px solid var(--line2)', background:'transparent', color:'var(--fog)', fontSize:13, fontWeight:700,
        }}>Cancelar</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   SCREEN: STATUS (mis mesas activas)
══════════════════════════════════════════════ */
function StatusScreen({tables, waiter, ventasTurno, onGoToTable}) {
  const allOcc = tables.filter(t=>t.occupied);
  const mine   = allOcc.filter(t=>t.waiterId===waiter.id);
  const others = allOcc.filter(t=>t.waiterId!==waiter.id);
  const myTotal= mine.reduce((s,t)=>s+t.items.reduce((ss,i)=>ss+i.price*i.qty,0),0);

  const waiterOf = wid => WAITERS.find(w=>w.id===wid);
  const getZone  = tid => ZONES.find(z=>z.tables.includes(tid))?.name || 'General';

  // Métricas del turno — derivadas del estado elevado en App (sin fetch propio)
  const turnoTotalVentas    = (ventasTurno||[]).reduce((s,v) => s + (v.total||0), 0);
  const turnoMesasAtendidas = new Set((ventasTurno||[]).map(v => v.mesa_nro)).size;
  const turnoEfectivo       = (ventasTurno||[]).filter(v=>v.metodo_pago==='efectivo').reduce((s,v)=>s+(v.total||0),0);
  const turnoYape           = (ventasTurno||[]).filter(v=>v.metodo_pago==='yape').reduce((s,v)=>s+(v.total||0),0);

  return (
    <div className="screen anim-fadeUp">
      <div className="status-screen">

        {/* ── Panel de turno personal ── */}
        <div style={{
          background:'linear-gradient(135deg,rgba(245,166,35,.10),rgba(245,166,35,.03))',
          border:'1px solid rgba(245,166,35,.25)', borderRadius:'var(--r)',
          padding:'12px 14px', marginBottom:10,
        }}>
          <div style={{fontSize:9,fontWeight:800,letterSpacing:2,color:'var(--amber)',
            textTransform:'uppercase',marginBottom:8}}>
            Mi turno actual
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6}}>
            <div style={{textAlign:'center',background:'var(--ink3)',borderRadius:'var(--r2)',padding:'8px 4px'}}>
              <div style={{fontFamily:'var(--mono)',fontSize:22,fontWeight:700,color:'var(--amber)',lineHeight:1}}>
                {turnoMesasAtendidas}
              </div>
              <div style={{fontSize:8,color:'var(--fog)',textTransform:'uppercase',letterSpacing:1,marginTop:3}}>
                Mesas atendidas
              </div>
            </div>
            <div style={{textAlign:'center',background:'var(--ink3)',borderRadius:'var(--r2)',padding:'8px 4px'}}>
              <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:'var(--amber)',lineHeight:1,marginTop:5}}>
                {fmt(turnoTotalVentas)}
              </div>
              <div style={{fontSize:8,color:'var(--fog)',textTransform:'uppercase',letterSpacing:1,marginTop:3}}>
                Ventas turno
              </div>
            </div>
            <div style={{textAlign:'center',background:'var(--ink3)',borderRadius:'var(--r2)',padding:'8px 4px'}}>
              <div style={{fontFamily:'var(--mono)',fontSize:22,fontWeight:700,color:'var(--amber)',lineHeight:1}}>
                {mine.length}
              </div>
              <div style={{fontSize:8,color:'var(--fog)',textTransform:'uppercase',letterSpacing:1,marginTop:3}}>
                Mesas abiertas
              </div>
            </div>
          </div>
          {/* Desglose por método de pago */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginTop:6}}>
            <div style={{
              display:'flex',alignItems:'center',gap:7,
              background:'rgba(46,204,113,.08)',border:'1px solid rgba(46,204,113,.2)',
              borderRadius:8,padding:'6px 10px',
            }}>
              <Banknote size={14} color="#2ecc71" />
              <div>
                <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'var(--emerald)'}}>
                  {fmt(turnoEfectivo)}
                </div>
                <div style={{fontSize:8,color:'var(--fog)',letterSpacing:1}}>EFECTIVO</div>
              </div>
            </div>
            <div style={{
              display:'flex',alignItems:'center',gap:7,
              background:'rgba(116,46,255,.08)',border:'1px solid rgba(116,46,255,.2)',
              borderRadius:8,padding:'6px 10px',
            }}>
              <Smartphone size={14} color="#742eff" />
              <div>
                <div style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'#742eff'}}>
                  {fmt(turnoYape)}
                </div>
                <div style={{fontSize:8,color:'var(--fog)',letterSpacing:1}}>YAPE</div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats del salón */}
        <div className="status-grid">
          <div className="status-card">
            <div className="status-card-val amber">{mine.length}</div>
            <div className="status-card-lbl">Mis mesas</div>
          </div>
          <div className="status-card">
            <div className="status-card-val amber">{fmt(myTotal)}</div>
            <div className="status-card-lbl">Consumo activo</div>
          </div>
          <div className="status-card">
            <div className="status-card-val crimson">{allOcc.length}</div>
            <div className="status-card-lbl">Salón ocupado</div>
          </div>
          <div className="status-card">
            <div className="status-card-val emerald">{30-allOcc.length}</div>
            <div className="status-card-lbl">Mesas libres</div>
          </div>
        </div>

        {/* My tables */}
        {mine.length > 0 && (
          <>
            <div className="zone-label" style={{marginLeft:0}}>Mis Mesas Activas</div>
            <div className="active-table-list" style={{marginBottom:16}}>
              {mine.map(t=>{
                const tTotal = tableGrandTotal(t);
                const tItems = t.items.reduce((s,i)=>s+i.qty,0);
                return (
                  <div key={t.id} className="active-table-card mine" onClick={()=>onGoToTable(t.id)}>
                    <div className="atc-num">{t.id}</div>
                    <div className="atc-info">
                      <div className="atc-name">Mesa {t.id} — {getZone(t.id)}</div>
                      <div className="atc-detail">{tItems} ítem{tItems!==1?'s':''} · abierta hace {elapsed(t.openAt)}</div>
                    </div>
                    <div className="atc-total">{fmt(tTotal)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {mine.length === 0 && (
          <div style={{textAlign:'center',padding:'30px 20px',color:'var(--fog)',fontSize:12}}>
            <Armchair size={36} strokeWidth={1.5} style={{marginBottom:8,opacity:.4}} />
            Sin mesas activas a tu cargo
          </div>
        )}

        {/* Others */}
        {others.length > 0 && (
          <>
            <div className="zone-label" style={{marginLeft:0}}>Otros Meseros</div>
            <div className="active-table-list">
              {others.map(t=>{
                const tw = waiterOf(t.waiterId);
                const tTotal = tableGrandTotal(t);
                const tItems = t.items.reduce((s,i)=>s+i.qty,0);
                return (
                  <div key={t.id} className="active-table-card" onClick={()=>onGoToTable(t.id)}>
                    <div className="atc-num" style={{color:tw?.color||'var(--mist)'}}>{t.id}</div>
                    <div className="atc-info">
                      <div className="atc-name">Mesa {t.id} <span style={{color:tw?.color,fontSize:11}}>· {tw?.name}</span></div>
                      <div className="atc-detail">{tItems} ítems · {elapsed(t.openAt)}</div>
                    </div>
                    <div className="atc-total">{fmt(tTotal)}</div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div style={{height:20}}/>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ACCESS DENIED MODAL
   Se muestra cuando el mesero intenta cerrar
   una mesa que no le pertenece.
══════════════════════════════════════════════ */
function AccessDeniedModal({mesa, owner, onClose}) {
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, zIndex:910,
        display:'flex', alignItems:'center', justifyContent:'center', padding:20,
        background:'rgba(0,0,0,.82)', backdropFilter:'blur(6px)',
        WebkitBackdropFilter:'blur(6px)',
        animation:'fadeIn .2s ease',
      }}
    >
      <div
        onClick={e=>e.stopPropagation()}
        style={{
          background:'var(--ink2)',
          border:'1px solid rgba(230,57,70,0.45)',
          borderRadius:20, padding:'30px 24px',
          width:'100%', maxWidth:320, textAlign:'center',
          animation:'scaleIn .25s var(--ease)',
        }}
      >
        <Ban size={50} strokeWidth={1.5} color="var(--crimson)" style={{marginBottom:12}} />
        <div style={{fontFamily:'var(--display)',fontSize:22,color:'var(--crimson)',
          marginBottom:6,letterSpacing:1}}>
          Acceso Denegado
        </div>
        <div style={{fontSize:14,color:'var(--snow)',marginBottom:12,fontWeight:700}}>
          Mesa {mesa}
        </div>
        <div style={{
          fontSize:12, color:'var(--mist)', lineHeight:1.7,
          background:'rgba(230,57,70,0.07)',
          border:'1px solid rgba(230,57,70,0.18)',
          borderRadius:10, padding:'12px 14px', marginBottom:22,
        }}>
          Esta mesa está siendo atendida por<br/>
          <strong style={{color:'var(--snow)',fontSize:14}}>{owner}</strong>.<br/>
          Solo el mesero responsable puede cerrarla.
        </div>
        <button
          onClick={onClose}
          style={{
            width:'100%', padding:'13px', borderRadius:10, border:'none',
            background:'linear-gradient(135deg,var(--crimson2),var(--crimson))',
            color:'#fff', fontWeight:800, fontSize:14, cursor:'pointer',
            boxShadow:'0 4px 16px rgba(230,57,70,0.3)',
          }}
        >
          Entendido
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ESCANEAR PEDIDO — QR generado por el cliente en la carta digital
   ══════════════════════════════════════════════
   El QR solo trae "qué producto y cuántos" (src/utils/orderQr.js). Los
   nombres, precios y disponibilidad salen de `catalog` (combineMenu, lo
   mismo que ve el menú): un QR viejo o fabricado no puede cambiar un
   precio ni agregar algo que no exista o esté agotado. Nada entra al
   carrito sin que el mesero confirme la vista previa, y entra por la misma
   lógica que tocar un plato (handleAddScanned en App): rondas, envío a
   cocina, caja cerrada y cobro funcionan exactamente igual que siempre.
   La cámara se apaga SIEMPRE al cerrar, al leer un pedido o si algo falla. */
const SCAN_OLD_MS = 3 * 60 * 60 * 1000; // pedido generado hace más de 3 h → aviso

function ScanOrderModal({ mesa, table, waiter, catalog, onConfirm, onClose }) {
  const [phase, setPhase]   = useState('camera'); // camera | preview | error
  const [error, setError]   = useState('');
  const [hint, setHint]     = useState('');
  const [result, setResult] = useState(null);     // decodeOrderQr ok
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const rafRef    = useRef(0);
  const fileRef   = useRef(null);
  const aliveRef  = useRef(true);
  const jsQRRef   = useRef(null);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const st = streamRef.current;
    streamRef.current = null;
    if (st) st.getTracks().forEach(t => { try { t.stop(); } catch (_) {} });
    if (videoRef.current) { try { videoRef.current.srcObject = null; } catch (_) {} }
  }, []);

  // El lector de QR se descarga solo al abrir el escáner (no pesa en la app)
  const loadDecoder = useCallback(async () => {
    if (!jsQRRef.current) {
      const mod = await import('jsqr');
      jsQRRef.current = mod.default || mod;
    }
    return jsQRRef.current;
  }, []);

  // Texto leído → vista previa, o aviso sin cerrar la cámara si no es válido
  const handleText = useCallback(text => {
    const r = decodeOrderQr(text);
    if (!r.ok) {
      setHint(r.reason === 'not-order'
        ? 'Ese código no es un pedido de la carta digital.'
        : 'No se pudo leer el pedido. Acerca o aleja un poco el celular.');
      return false;
    }
    stopCamera();
    setHint('');
    setResult(r);
    setPhase('preview');
    return true;
  }, [stopCamera]);

  // Cámara en vivo: se abre en la fase "camera" y se cierra al salir de ella
  useEffect(() => {
    aliveRef.current = true;
    if (phase !== 'camera') return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError(window.isSecureContext === false
          ? 'La cámara solo funciona con conexión segura (https). Abre la app desde el enlace publicado, o usa "Usar foto".'
          : 'Este navegador no permite usar la cámara. Usa la opción "Usar foto".');
        setPhase('error');
        return;
      }
      try {
        const jsQR = await loadDecoder();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled || !aliveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) { stopCamera(); return; }
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play().catch(() => {});

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        let last = 0;
        const tick = ts => {
          if (cancelled || !streamRef.current) return;
          rafRef.current = requestAnimationFrame(tick);
          if (ts - last < 140) return; // ~7 lecturas/s: fluido sin calentar el celular
          last = ts;
          const vw = video.videoWidth, vh = video.videoHeight;
          if (!vw || !vh || !ctx) return;
          const scale = Math.min(1, 720 / Math.max(vw, vh));
          const w = Math.round(vw * scale), h = Math.round(vh * scale);
          if (canvas.width !== w) canvas.width = w;
          if (canvas.height !== h) canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          let code = null;
          try { code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); }
          catch (_) { code = null; }
          if (code && code.data) handleText(code.data);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        if (cancelled) return;
        stopCamera();
        const name = e && e.name;
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador (ícono junto a la dirección) o usa "Usar foto".'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No se encontró una cámara en este dispositivo. Usa "Usar foto".'
              : name === 'NotReadableError'
                ? 'La cámara está siendo usada por otra app. Ciérrala e inténtalo de nuevo.'
                : 'No se pudo abrir la cámara. Usa "Usar foto".'
        );
        setPhase('error');
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [phase, loadDecoder, handleText, stopCamera]);

  // Al desmontar el modal (por cualquier vía) la cámara queda apagada
  useEffect(() => () => { aliveRef.current = false; stopCamera(); }, [stopCamera]);

  // Respaldo: leer el QR desde una foto (si la cámara en vivo no está disponible)
  const handleFile = async e => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let url = null;
    try {
      const jsQR = await loadDecoder();
      url = URL.createObjectURL(file);
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, 1200 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
      if (!code || !code.data) { setHint('No se encontró un código QR en la foto. Intenta con otra más nítida.'); return; }
      handleText(code.data);
    } catch (_) {
      setHint('No se pudo leer la foto. Intenta de nuevo.');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  };

  const retry = () => { setResult(null); setHint(''); setError(''); setPhase('camera'); };
  const close = () => { stopCamera(); onClose(); };

  // Vista previa: cruza el QR con el catálogo vigente del mesero
  const preview = useMemo(() => {
    if (!result) return null;
    const byId = new Map((catalog || []).map(p => [String(p.id), p]));
    const rows = result.lines.map(l => {
      const key = l.v ? `${l.id}~${l.v}` : String(l.id);
      const base = byId.get(String(l.id));
      if (!base) return { key, qty: l.qty, status: 'missing' };
      // Tamaño: el PRECIO sale siempre del catálogo, nunca del QR
      let prod;
      if (hasVariants(base)) {
        const v = findVariant(base, l.v);
        if (!v) return { key, qty: l.qty, prod: base, status: 'size' };   // tamaño ya no existe / QR antiguo
        prod = applyVariant(base, v);
      } else {
        prod = applyVariant(base, null);   // producto de precio único (se ignora un tamaño viejo)
      }
      if (prod.available === false) return { key, qty: l.qty, prod, status: 'out' };
      return { key, qty: l.qty, prod, status: 'ok' };
    });
    const ok = rows.filter(r => r.status === 'ok');
    return {
      rows, ok,
      units: ok.reduce((s, r) => s + r.qty, 0),
      total: ok.reduce((s, r) => s + (Number(r.prod.price) || 0) * r.qty, 0),
      old: !!result.createdAt && Date.now() - result.createdAt > SCAN_OLD_MS,
    };
  }, [result, catalog]);

  const otherOwner = table && table.occupied && waiter && table.waiterId && table.waiterId !== waiter.id
    ? (table.waiterName || 'otro mesero') : null;

  const btn = (bg, color, border) => ({
    flex:1, padding:'13px', borderRadius:12, border: border || 'none', background:bg, color,
    fontWeight:800, fontSize:14, cursor:'pointer', display:'inline-flex', alignItems:'center', justifyContent:'center', gap:6,
  });
  const canAdd = !!(preview && preview.ok.length);

  return (
    <div onClick={close} style={{
      position:'fixed', inset:0, zIndex:920, display:'flex', alignItems:'center', justifyContent:'center',
      padding:16, background:'rgba(0,0,0,.82)', backdropFilter:'blur(6px)', WebkitBackdropFilter:'blur(6px)',
      animation:'fadeIn .2s ease',
    }}>
      <div onClick={e=>e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Escanear pedido" style={{
        background:'var(--ink2)', border:'1px solid var(--line2)', borderRadius:20,
        width:'100%', maxWidth:400, maxHeight:'92vh', display:'flex', flexDirection:'column', overflow:'hidden',
        animation:'scaleIn .25s var(--ease)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 16px',borderBottom:'1px solid var(--line)'}}>
          <ScanLine size={20} color="var(--amber2)"/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:'var(--display)',fontSize:20,letterSpacing:1,color:'var(--snow)',lineHeight:1}}>Escanear pedido</div>
            <div style={{fontSize:11,color:'var(--fog)',marginTop:2}}>Mesa {mesa} · QR de la carta digital del cliente</div>
          </div>
          <button onClick={close} aria-label="Cerrar" style={{background:'none',border:'none',cursor:'pointer',color:'var(--fog)',display:'grid',placeItems:'center',padding:4}}><X size={20}/></button>
        </div>

        <div style={{overflowY:'auto',flex:1}}>
          {phase === 'camera' && (
            <div style={{padding:16}}>
              <div style={{position:'relative',width:'100%',aspectRatio:'1',borderRadius:16,overflow:'hidden',background:'#000'}}>
                <video ref={videoRef} playsInline muted style={{width:'100%',height:'100%',objectFit:'cover'}}/>
                <div style={{position:'absolute',inset:'14%',border:'3px solid rgba(245,158,11,.95)',borderRadius:18,boxShadow:'0 0 0 9999px rgba(0,0,0,.35)'}}/>
              </div>
              <div style={{fontSize:12.5,color:'var(--mist)',textAlign:'center',marginTop:12,lineHeight:1.5}}>
                Apunta al código QR que el cliente muestra en <strong>"Mostrar al mesero"</strong>.
              </div>
              {hint && <div style={{fontSize:12,color:'var(--crimson2)',textAlign:'center',marginTop:8}}>{hint}</div>}
            </div>
          )}

          {phase === 'error' && (
            <div style={{padding:'26px 20px',textAlign:'center'}}>
              <CameraOff size={44} strokeWidth={1.5} color="var(--fog)" style={{marginBottom:10}}/>
              <div style={{fontSize:13,color:'var(--mist)',lineHeight:1.6}}>{error}</div>
              {hint && <div style={{fontSize:12,color:'var(--crimson2)',marginTop:8}}>{hint}</div>}
            </div>
          )}

          {phase === 'preview' && preview && (
            <div style={{padding:'12px 16px 4px'}}>
              {preview.old && (
                <div style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12,color:'var(--amber3)',background:'rgba(245,158,11,.1)',border:'1px solid rgba(245,158,11,.3)',borderRadius:10,padding:'8px 10px',marginBottom:10}}>
                  <AlertTriangle size={14} style={{flexShrink:0,marginTop:1}}/> Este pedido se generó hace más de 3 horas. Confírmalo con el cliente.
                </div>
              )}
              {otherOwner && (
                <div style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:12,color:'var(--crimson2)',background:'rgba(239,68,68,.08)',border:'1px solid rgba(239,68,68,.25)',borderRadius:10,padding:'8px 10px',marginBottom:10}}>
                  <AlertTriangle size={14} style={{flexShrink:0,marginTop:1}}/> La Mesa {mesa} está a cargo de {otherOwner}. Verifica que sea la mesa correcta.
                </div>
              )}
              {preview.rows.map(r => (
                <div key={r.key} style={{display:'flex',alignItems:'center',gap:10,padding:'10px 0',borderBottom:'1px solid var(--line)',opacity:r.status==='ok'?1:.6}}>
                  <div style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--amber2)',minWidth:30}}>{r.qty}×</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13.5,fontWeight:700,color:'var(--snow)',overflowWrap:'anywhere'}}>
                      {r.prod ? r.prod.name : 'Producto que ya no existe'}
                    </div>
                    {r.status === 'out' && <div style={{fontSize:11,color:'var(--crimson2)',fontWeight:700}}>Agotado · no se agregará</div>}
                    {r.status === 'missing' && <div style={{fontSize:11,color:'var(--crimson2)',fontWeight:700}}>Fue retirado de la carta · no se agregará</div>}
                    {r.status === 'size' && <div style={{fontSize:11,color:'var(--crimson2)',fontWeight:700}}>Tamaño no disponible · agrégalo a mano eligiendo el tamaño</div>}
                  </div>
                  {r.status === 'ok' && (
                    <div style={{fontFamily:'var(--mono)',fontSize:12.5,color:'var(--mist)',whiteSpace:'nowrap'}}>{fmt((Number(r.prod.price)||0) * r.qty)}</div>
                  )}
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'12px 0 6px'}}>
                <span style={{fontSize:13,fontWeight:700,color:'var(--mist)'}}>{preview.units} {preview.units===1?'producto':'productos'} a agregar</span>
                <span style={{fontFamily:'var(--mono)',fontSize:17,fontWeight:800,color:'var(--amber2)'}}>{fmt(preview.total)}</span>
              </div>
              <div style={{fontSize:11,color:'var(--fog)',paddingBottom:8,lineHeight:1.5}}>
                Precios actuales de la carta. Se agregan al carrito de la Mesa {mesa}; luego lo envías a cocina como siempre.
              </div>
            </div>
          )}
        </div>

        <div style={{display:'flex',gap:8,padding:'12px 16px calc(12px + env(safe-area-inset-bottom))',borderTop:'1px solid var(--line)'}}>
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{display:'none'}}/>
          {phase === 'preview' ? (
            <>
              <button onClick={retry} style={btn('transparent','var(--snow)','1px solid var(--line2)')}><ScanLine size={16}/> Otro</button>
              <button
                onClick={() => { if (canAdd) onConfirm(mesa, preview.ok.map(r => ({ prod: r.prod, qty: r.qty }))); }}
                disabled={!canAdd}
                style={{...btn('linear-gradient(135deg,var(--amber2),var(--amber))','#fff'), opacity: canAdd ? 1 : .5, flex:2}}
              ><Check size={16}/> Agregar al carrito</button>
            </>
          ) : (
            <>
              <button onClick={() => fileRef.current && fileRef.current.click()} style={btn('transparent','var(--snow)','1px solid var(--line2)')}><ImagePlus size={16}/> Usar foto</button>
              {phase === 'error'
                ? <button onClick={retry} style={btn('linear-gradient(135deg,var(--amber2),var(--amber))','#fff')}><RotateCw size={16}/> Reintentar</button>
                : <button onClick={close} style={btn('transparent','var(--fog)','1px solid var(--line2)')}>Cancelar</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   PAYMENT MODAL — Efectivo / Yape
══════════════════════════════════════════════ */
// onConfirm recibe: un string (pago simple, igual que siempre) o
// { mixto:true, legs:[{metodo,monto}] } (pago dividido — ver PAYMENT_METHODS_M
// y migracion-pago-mixto.sql arriba).
function PaymentModal({mesa, items, waiter, zone, onConfirm, onClose, packaging = null, descuento = null}) {
  const [method,  setMethod]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [split,   setSplit]   = useState(false);
  const [legAmounts, setLegAmounts] = useState({});
  const [splitError, setSplitError] = useState('');
  const packTotal = packaging && packaging.count > 0 ? packaging.total : 0;
  const descTotal = descuento && descuento.monto > 0 ? descuento.monto : 0;
  const total = Math.round((itemsTotal(items) + packTotal - descTotal) * 100) / 100;

  const legs = Object.entries(legAmounts)
    .filter(([, v]) => v !== '' && v != null)
    .map(([metodo, monto]) => ({ metodo, monto: Number(monto) }));
  const splitSum   = legs.reduce((s, l) => s + (Number(l.monto) || 0), 0);
  const splitCheck = legs.length ? validateBreakdownM(legs, total) : { ok: false, message: '' };

  const toggleSplit = () => { setSplit(s => !s); setMethod(null); setSplitError(''); };

  const handleConfirm = async () => {
    if (split) {
      const check = validateBreakdownM(legs, total);
      if (!check.ok) { setSplitError(check.message); return; }
      setLoading(true);
      await onConfirm({ mixto: true, legs: check.legs });
      setLoading(false);
      return;
    }
    if (!method) return;
    setLoading(true);
    await onConfirm(method);
    setLoading(false);
  };

  const yapeColor  = '#742eff';
  const biz        = useBiz(); // número/titular/QR de Yape — se editan en Ajustes del admin
  const cashColor  = '#2ecc71';

  return (
    <div className="ticket-modal" onClick={onClose}>
      <div className="ticket-box" onClick={e => e.stopPropagation()} style={{maxWidth:320}}>

        {/* Header */}
        <div style={{fontFamily:'var(--display)',fontSize:22,color:'var(--amber)',marginBottom:2,display:'flex',alignItems:'center',gap:7}}>
          <CreditCard size={19}/> Cobrar Mesa {mesa}
        </div>
        <div style={{fontSize:11,color:'var(--mist)',marginBottom:16}}>
          {zone} · {waiter.name}
        </div>

        {/* Total */}
        <div style={{
          background:'rgba(245,166,35,0.08)', border:'1px solid rgba(245,166,35,0.2)',
          borderRadius:10, padding:'10px 14px', marginBottom:18,
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <span style={{fontSize:11,color:'var(--mist)',fontWeight:700,letterSpacing:1}}>
            TOTAL A COBRAR
            {packTotal > 0 && <span style={{display:'block',fontSize:10,letterSpacing:0,marginTop:2}}>Incluye {packaging.count} envase{packaging.count !== 1 ? 's' : ''}: S/ {packTotal.toFixed(2)}</span>}
            {descTotal > 0 && <span style={{display:'block',fontSize:10,letterSpacing:0,marginTop:2,color:'var(--emerald)'}}>{descuento.label}: −S/ {descTotal.toFixed(2)}</span>}
          </span>
          <span style={{fontFamily:'var(--display)',fontSize:26,color:'var(--amber)',lineHeight:1}}>
            S/ {total.toFixed(2)}
          </span>
        </div>

        {/* Selección de método */}
        {!split && (
          <>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:1.5,color:'var(--fog)',marginBottom:10,textTransform:'uppercase'}}>
              Método de pago
            </div>
            <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap'}}>
              {PAYMENT_METHODS_M.map(m => (
                <div
                  key={m.key}
                  onClick={() => setMethod(m.key)}
                  style={{
                    flex:'1 1 40%', padding:'14px 8px', borderRadius:12, cursor:'pointer', textAlign:'center',
                    border:`2px solid ${method===m.key ? m.color : 'var(--line2)'}`,
                    background: method===m.key ? m.color + '1a' : 'var(--ink3)',
                    transition:'all .2s',
                  }}>
                  {(() => { const MIcon = PAYMENT_ICON_SVG[m.key]; return <MIcon size={28} strokeWidth={1.75} color={method===m.key ? m.color : 'var(--fog)'} />; })()}
                  <div style={{fontWeight:800,fontSize:13,marginTop:6,
                    color: method===m.key ? m.color : 'var(--snow)'}}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <button
          onClick={toggleSplit}
          style={{
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            width:'100%', padding:'9px 0', marginBottom:16, borderRadius:10,
            border:`1px solid ${split ? 'var(--amber)' : 'var(--line2)'}`,
            background: split ? 'rgba(245,166,35,0.1)' : 'transparent',
            color: split ? 'var(--amber)' : 'var(--mist)', fontSize:12, fontWeight:700, cursor:'pointer',
          }}
        >{split ? <><X size={14}/> Cancelar pago dividido</> : <><Split size={14}/> Dividir pago entre varios métodos</>}</button>

        {split && (
          <div style={{marginBottom:16}}>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              {PAYMENT_METHODS_M.map(m => (
                <div key={m.key} style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{width:90,fontSize:12,fontWeight:700,color:'var(--snow)',display:'flex',alignItems:'center',gap:4}}>
                    {(() => { const MIcon = PAYMENT_ICON_SVG[m.key]; return <MIcon size={14} strokeWidth={2} />; })()} {m.label}
                  </span>
                  <span style={{color:'var(--fog)',fontSize:12}}>S/</span>
                  <input
                    type="number" min="0" step="0.10" inputMode="decimal"
                    value={legAmounts[m.key] ?? ''}
                    onChange={e => { setLegAmounts(prev => ({...prev, [m.key]: e.target.value})); setSplitError(''); }}
                    placeholder="0.00"
                    style={{
                      flex:1, background:'var(--ink3)', border:'1px solid var(--line2)', borderRadius:8,
                      padding:'7px 10px', color:'var(--snow)', fontSize:13, outline:'none', boxSizing:'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{
              display:'flex', justifyContent:'space-between', marginTop:10, padding:'8px 12px',
              borderRadius:8, fontSize:12, fontWeight:700,
              background: splitCheck.ok ? 'rgba(46,204,113,0.1)' : 'var(--ink3)',
              color: splitCheck.ok ? cashColor : 'var(--mist)',
            }}>
              <span>Suma: S/ {splitSum.toFixed(2)}</span>
              <span>Total: S/ {total.toFixed(2)}</span>
            </div>
            {(splitError || (legs.length > 0 && !splitCheck.ok)) && (
              <div style={{marginTop:8,fontSize:11,color:'var(--crimson)',display:'flex',alignItems:'center',gap:4}}><AlertTriangle size={12}/> {splitError || splitCheck.message}</div>
            )}
          </div>
        )}

        {/* Detalle Yape */}
        {!split && method === 'yape' && (
          <div style={{
            background:'rgba(116,46,255,0.08)', border:'1px solid rgba(116,46,255,0.3)',
            borderRadius:12, padding:16, marginBottom:16, textAlign:'center',
            animation:'scaleIn .22s var(--ease)',
          }}>
            {/* QR real subido por el admin (Ajustes → Datos del Negocio y Yape);
                si aún no hay uno cargado se mantiene el dibujo de relleno de siempre. */}
            {biz.yapeQrUrl ? (
              <div style={{
                width:210, height:210, maxWidth:'100%', margin:'0 auto 12px',
                background:'#fff', borderRadius:10, padding:8,
                display:'flex', alignItems:'center', justifyContent:'center',
                boxShadow:'0 4px 20px rgba(116,46,255,0.25)',
              }}>
                <img
                  src={biz.yapeQrUrl} alt="QR de Yape" onError={imgFallback}
                  style={{maxWidth:'100%', maxHeight:'100%', objectFit:'contain'}}
                />
              </div>
            ) : (
            <div style={{
              width:150, height:150, margin:'0 auto 12px',
              background:'#fff', borderRadius:10, padding:8,
              display:'flex', alignItems:'center', justifyContent:'center',
              boxShadow:'0 4px 20px rgba(116,46,255,0.25)',
            }}>
              <svg viewBox="0 0 100 100" width="134" height="134" xmlns="http://www.w3.org/2000/svg">
                {/* QR placeholder pattern */}
                <rect width="100" height="100" fill="white"/>
                <rect x="5"  y="5"  width="35" height="35" rx="3" fill="none" stroke="#742eff" strokeWidth="4"/>
                <rect x="13" y="13" width="19" height="19" rx="1" fill="#742eff"/>
                <rect x="60" y="5"  width="35" height="35" rx="3" fill="none" stroke="#742eff" strokeWidth="4"/>
                <rect x="68" y="13" width="19" height="19" rx="1" fill="#742eff"/>
                <rect x="5"  y="60" width="35" height="35" rx="3" fill="none" stroke="#742eff" strokeWidth="4"/>
                <rect x="13" y="68" width="19" height="19" rx="1" fill="#742eff"/>
                <rect x="60" y="60" width="8"  height="8"  fill="#742eff"/>
                <rect x="72" y="60" width="8"  height="8"  fill="#742eff"/>
                <rect x="84" y="60" width="8"  height="8"  fill="#742eff"/>
                <rect x="60" y="72" width="8"  height="8"  fill="#742eff"/>
                <rect x="84" y="72" width="8"  height="8"  fill="#742eff"/>
                <rect x="60" y="84" width="8"  height="8"  fill="#742eff"/>
                <rect x="72" y="84" width="8"  height="8"  fill="#742eff"/>
                <rect x="84" y="84" width="8"  height="8"  fill="#742eff"/>
                <rect x="44" y="5"  width="8"  height="8"  fill="#742eff"/>
                <rect x="44" y="17" width="8"  height="8"  fill="#742eff"/>
                <rect x="44" y="29" width="8"  height="8"  fill="#742eff"/>
                <rect x="5"  y="44" width="8"  height="8"  fill="#742eff"/>
                <rect x="17" y="44" width="8"  height="8"  fill="#742eff"/>
                <rect x="29" y="44" width="8"  height="8"  fill="#742eff"/>
                <rect x="44" y="44" width="8"  height="8"  fill="#742eff"/>
                <rect x="56" y="44" width="8"  height="8"  fill="#742eff"/>
              </svg>
            </div>
            )}
            <div style={{fontSize:11,color:'var(--fog)',letterSpacing:2,textTransform:'uppercase',marginBottom:6}}>
              Escanea con Yape
            </div>
            {biz.yapeNumero && (
              <div style={{fontFamily:'var(--mono)',fontSize:22,color:yapeColor,fontWeight:800,letterSpacing:2,display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
                <Smartphone size={18}/> {biz.yapeNumero}
              </div>
            )}
            {biz.yapeTitular && (
              <div style={{fontSize:12,color:'var(--mist)',marginTop:4}}>
                Titular: <strong style={{color:'var(--snow)'}}>{biz.yapeTitular}</strong>
              </div>
            )}
            <div style={{
              marginTop:12, fontFamily:'var(--display)', fontSize:28, color:'var(--amber)',
              letterSpacing:1,
            }}>
              S/ {total.toFixed(2)}
            </div>
          </div>
        )}

        {/* Botón confirmar */}
        {(split ? legs.length > 0 : !!method) && (
          <button
            onClick={handleConfirm}
            disabled={loading || (split && !splitCheck.ok)}
            style={{
              width:'100%', padding:'13px 0', borderRadius:10, border:'none',
              fontWeight:800, fontSize:14,
              cursor: (loading || (split && !splitCheck.ok)) ? 'not-allowed' : 'pointer',
              marginBottom:8, transition:'all .2s',
              opacity: loading ? .7 : (split && !splitCheck.ok) ? .5 : 1,
              background: split
                ? 'linear-gradient(135deg, #f5a623, #d9810f)'
                : method === 'yape'
                  ? `linear-gradient(135deg, ${yapeColor}, #9b59b6)`
                  : `linear-gradient(135deg, ${cashColor}, #27ae60)`,
              color: '#fff',
              display:'flex', alignItems:'center', justifyContent:'center', gap:7,
            }}>
            {loading
              ? <><Loader2 size={16} style={{animation:'spin .8s linear infinite'}}/> Procesando...</>
              : split
                ? <><Check size={16}/> Confirmar pago dividido (S/ {splitSum.toFixed(2)})</>
                : method === 'yape'
                  ? <><Check size={16}/> Pago por Yape realizado con éxito</>
                  : method === 'efectivo'
                    ? <><Check size={16}/> Confirmar pago en Efectivo</>
                    : <><Check size={16}/> Confirmar pago en {PAYMENT_METHODS_M.find(m => m.key === method)?.label}</>
            }
          </button>
        )}

        <button className="cm-btn secondary" onClick={onClose}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   PANEL DE IMPRESORAS — 1 o más, por estación
   ══════════════════════════════════════════════
   Cada impresora se empareja por Bluetooth (igual que siempre) y se le
   puede asignar una o más categorías del menú (ej. "Tragos" → Barra). La
   que esté marcada ★ predeterminada recibe todo lo que ninguna otra
   reclame. Con 1 sola impresora (el caso de siempre) no hace falta tocar
   nada aquí — sigue recibiendo todo, exactamente como antes.
══════════════════════════════════════════════ */
// Contenido del panel de impresoras — se usa en el modal (botón BT de la
// cabecera) y en la pestaña Ajustes. Mismo registro (PrinterRegistry), así
// que cualquier cambio en un lugar se ve en el otro al instante.
function PrintersPanel({ categories }) {
  usePrintersVersion(); // re-renderiza cuando cambia cualquier impresora
  const [newLabel, setNewLabel] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [auto, setAuto] = useState(btAutoReconnectEnabled());
  const printers = PrinterRegistry.list();

  // Impresoras de red (las registra el administrador en Ajustes)
  const anyRed = printers.some(p => p.kind === 'red');
  const [net, setNet] = useState({ loading: false, list: null, error: '' });
  const [agentOnline, setAgentOnline] = useState(null);
  const [testMsg, setTestMsg] = useState({});
  const loadNet = useCallback(async () => {
    setNet(n => ({ ...n, loading: true, error: '' }));
    try {
      const list = await fetchNetPrinters();
      setNet({ loading: false, list, error: '' });
    } catch (e) {
      const m = String(e?.message || '');
      setNet({ loading: false, list: [], error: /impresoras_red|does not exist|PGRST205/i.test(m)
        ? 'La impresión por red aún no está activada (migracion-impresion-red.sql).'
        : 'No se pudo cargar la lista (revisa internet).' });
    }
    setAgentOnline(await fetchAgentOnline());
  }, []);
  useEffect(() => { if (anyRed && net.list === null && !net.loading) loadNet(); }, [anyRed, net.list, net.loading, loadNet]);

  async function testNet(p) {
    setTestMsg(m => ({ ...m, [p.id]: 'Enviando…' }));
    const line = '-'.repeat(Math.max(16, (p.cols || 48) - 2));
    const txt = `\x1B\x61\x01\x1D\x21\x01PRUEBA DE IMPRESION\x1D\x21\x00\n${line}\nImpresora: ${p.label}\nTiketera: ${p.netName || '-'}\n${new Date().toLocaleString('es-PE')}\n${line}\x1B\x61\x00\n`;
    try {
      await p.print(txt, 'prueba');
      setTestMsg(m => ({ ...m, [p.id]: '✓ Enviada. Debe salir en unos segundos.' }));
    } catch (e) {
      setTestMsg(m => ({ ...m, [p.id]: '✗ ' + (e?.message || 'No se pudo enviar') }));
    }
  }

  async function run(id, fn) {
    setBusyId(id);
    try { await fn(); } catch (_) { /* el estado de la impresora ya muestra el error */ }
    finally { setBusyId(null); }
  }

  async function handleAdd() {
    const label = newLabel.trim() || `Impresora ${printers.length + 1}`;
    const slot = PrinterRegistry.addSlot(label);
    setNewLabel('');
    await run(slot.id, () => PrinterRegistry.connectSlot(slot.id, () => {}));
  }

  function toggleCategory(printerId, cat) {
    const p = printers.find(x => x.id === printerId);
    if (!p) return;
    const has = p.categories.includes(cat);
    PrinterRegistry.setCategories(printerId, has ? p.categories.filter(c => c !== cat) : [...p.categories, cat]);
  }

  function toggleAuto() {
    const next = !auto;
    setAuto(next);
    setBtAutoReconnect(next);
    if (next) PrinterRegistry.reconnectAllSilent().catch(() => {});
  }

  function btnStyle(kind, busy) {
    const base = {
      padding:'8px 12px', borderRadius:8, fontSize:12, fontWeight:800,
      cursor: busy ? 'not-allowed' : 'pointer',
      display:'flex', alignItems:'center', justifyContent:'center', gap:6,
    };
    if (kind === 'danger')  return { ...base, flex:1, border:'none', background:'rgba(220,38,38,.14)', color:'#DC2626' };
    if (kind === 'primary') return { ...base, flex:1, border:'none', background:'linear-gradient(135deg, #D97706, #B45309)', color:'#fff' };
    return { ...base, border:'1px solid var(--line2)', background:'var(--ink2)', color:'var(--mist)' };
  }

  return (
    <>
      <div style={{fontSize:11,color:'var(--mist)',marginBottom:12,lineHeight:1.5}}>
        Elige tu impresora una sola vez: queda recordada en este celular y se reconecta sola al
        abrir la app, al volver a ella o al cerrar turno. Cada impresora puede encargarse de una o
        más categorías del menú (ej. "Tragos" → Barra); la marcada ★ predeterminada recibe todo lo demás.
      </div>

      {/* Reconexión automática */}
      <div
        onClick={toggleAuto}
        style={{
          display:'flex', alignItems:'center', gap:10, padding:'10px 12px', marginBottom:12,
          background:'var(--ink3)', border:'1px solid var(--line2)', borderRadius:12, cursor:'pointer',
        }}
      >
        <div style={{flex:1}}>
          <div style={{fontSize:13, fontWeight:700, color:'var(--snow)'}}>Reconectar automáticamente</div>
          <div style={{fontSize:10, color:'var(--fog)', marginTop:2, lineHeight:1.4}}>
            {btCanSilentReconnect()
              ? 'Sin buscarla de nuevo, cada vez que abras la app.'
              : 'Este navegador no permite reconectar en silencio: toca "Reconectar" y elige tu impresora (aparece sola en la lista).'}
          </div>
        </div>
        <div style={{
          width:42, height:24, borderRadius:12, flexShrink:0, position:'relative', transition:'all .2s',
          background: auto ? 'var(--emerald)' : 'var(--line2)',
        }}>
          <div style={{
            position:'absolute', top:3, left: auto ? 21 : 3, width:18, height:18, borderRadius:'50%',
            background:'#fff', transition:'left .2s',
          }}/>
        </div>
      </div>

        {printers.map(p => (
          <div key={p.id} style={{
            background:'var(--ink3)', border:`1px solid ${p.connected?'rgba(22,163,74,.45)':'var(--line2)'}`,
            borderRadius:12, padding:'12px 12px', marginBottom:10,
          }}>
            <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
              <input
                value={p.label}
                onChange={e => PrinterRegistry.rename(p.id, e.target.value)}
                style={{
                  flex:1, background:'transparent', border:'none', outline:'none',
                  color:'var(--snow)', fontSize:14, fontWeight:700,
                }}
              />
              <button
                onClick={() => PrinterRegistry.setDefault(p.id)}
                title={p.isDefault ? 'Predeterminada' : 'Marcar como predeterminada'}
                style={{
                  width:26, height:26, borderRadius:8, border:'1px solid var(--line2)',
                  background: p.isDefault ? 'rgba(217,119,6,.18)' : 'var(--ink2)',
                  color: p.isDefault ? 'var(--amber)' : 'var(--fog)', cursor:'pointer',
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}
              ><Star size={14} fill={p.isDefault ? 'currentColor' : 'none'} /></button>
            </div>

            {/* Tipo de impresora */}
            <div style={{display:'flex', gap:6, marginBottom:10}}>
              {[{ k:'bt', label:'Bluetooth', Icon: Bluetooth }, { k:'red', label:'Red (Wi-Fi)', Icon: Wifi }].map(({ k, label, Icon }) => {
                const on = (p.kind || 'bt') === k;
                return (
                  <button key={k}
                    onClick={() => {
                      if (on) return;
                      if (k === 'red' && p.deviceId && !window.confirm(`Se dejará de usar "${p.deviceName || 'la impresora Bluetooth'}" en esta impresora. ¿Continuar?`)) return;
                      PrinterRegistry.setKind(p.id, k);
                    }}
                    style={{
                      flex:1, padding:'7px 8px', borderRadius:8, fontSize:11, fontWeight:800, cursor:'pointer',
                      display:'flex', alignItems:'center', justifyContent:'center', gap:5,
                      border:`1px solid ${on ? 'var(--amber)' : 'var(--line2)'}`,
                      background: on ? 'rgba(217,119,6,.14)' : 'var(--ink2)',
                      color: on ? 'var(--amber)' : 'var(--fog)',
                    }}
                  ><Icon size={13}/> {label}</button>
                );
              })}
            </div>

            <div style={{display:'flex', flexWrap:'wrap', gap:6, marginBottom:10}}>
              {categories.length === 0 && (
                <span style={{fontSize:10,color:'var(--ghost)'}}>Sin categorías en el menú todavía</span>
              )}
              {categories.map(cat => {
                const active = p.categories.includes(cat);
                return (
                  <span
                    key={cat}
                    onClick={() => toggleCategory(p.id, cat)}
                    style={{
                      fontSize:10, fontWeight:700, padding:'4px 9px', borderRadius:12, cursor:'pointer',
                      border:`1px solid ${active?'var(--amber)':'var(--line2)'}`,
                      background: active ? 'rgba(217,119,6,.14)' : 'transparent',
                      color: active ? 'var(--amber)' : 'var(--fog)',
                    }}
                  >{cat}</span>
                );
              })}
            </div>

            {p.kind === 'red' ? (
              <div>
                <select
                  value={p.netId || ''}
                  onChange={e => {
                    const sel = (net.list || []).find(x => x.id === e.target.value) || null;
                    PrinterRegistry.setNet(p.id, sel);
                  }}
                  style={{
                    width:'100%', marginBottom:8, background:'var(--ink2)', border:'1px solid var(--line2)', borderRadius:8,
                    padding:'9px 10px', color:'var(--snow)', fontSize:13, outline:'none',
                  }}
                >
                  <option value="">{net.loading ? 'Cargando…' : '— Elige la tiketera de red —'}</option>
                  {(net.list || []).map(x => <option key={x.id} value={x.id}>{x.nombre} · {x.ancho_cols === 32 ? '58 mm' : '80 mm'}</option>)}
                  {p.netId && net.list && !net.list.some(x => x.id === p.netId) && (
                    <option value={p.netId}>{p.netName || 'Impresora'} (ya no disponible)</option>
                  )}
                </select>
                <div style={{fontSize:10.5, lineHeight:1.45, marginBottom:8, color: net.error ? '#DC2626' : 'var(--fog)'}}>
                  {net.error || (
                    p.netId && net.list && !net.list.some(x => x.id === p.netId)
                      ? <span style={{color:'#DC2626'}}>Esta tiketera fue quitada o desactivada por el administrador: elige otra.</span>
                      : <>Agente de impresión: {agentOnline === null ? 'estado desconocido' : agentOnline
                          ? <strong style={{color:'var(--emerald)'}}>en línea</strong>
                          : <strong style={{color:'#DC2626'}}>sin conexión — los tickets esperarán en cola hasta que se encienda</strong>}</>
                  )}
                </div>
                {testMsg[p.id] && <div style={{fontSize:10.5, color: testMsg[p.id].startsWith('✗') ? '#DC2626' : 'var(--emerald)', marginBottom:8}}>{testMsg[p.id]}</div>}
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  <button onClick={() => testNet(p)} disabled={!p.netId} style={btnStyle('primary', !p.netId)}>
                    <Printer size={14}/> Imprimir prueba
                  </button>
                  <button onClick={loadNet} disabled={net.loading} style={btnStyle('ghost', net.loading)} title="Actualizar lista y estado del agente">
                    <RotateCw size={14}/>
                  </button>
                  {printers.length > 1 && (
                    <button
                      onClick={() => { if (window.confirm(`¿Quitar "${p.label}"?`)) PrinterRegistry.removeSlot(p.id); }}
                      title="Quitar impresora"
                      style={{
                        width:34, height:34, borderRadius:8, border:'1px solid var(--line2)',
                        background:'var(--ink2)', color:'#DC2626', cursor:'pointer',
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}
                    ><Trash2 size={14}/></button>
                  )}
                </div>
              </div>
            ) : (<>
            {/* Impresora recordada + estado */}
            <div style={{fontSize:10.5, color: p.connected ? 'var(--emerald)' : 'var(--fog)', marginBottom:8, lineHeight:1.4}}>
              {p.deviceId
                ? <>Recordada: <strong style={{color:'var(--snow)'}}>{p.deviceName || 'Impresora'}</strong>{' · '}{p.connected ? 'Conectada' : (p.message || 'Desconectada')}</>
                : (p.message || 'Sin impresora elegida todavía')}
            </div>

            <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
              {p.connected ? (
                <button onClick={() => PrinterRegistry.disconnectSlot(p.id)} disabled={busyId === p.id} style={btnStyle('danger', busyId === p.id)}>
                  <Check size={14}/> Conectada — Desconectar
                </button>
              ) : p.deviceId ? (
                <>
                  <button onClick={() => run(p.id, () => PrinterRegistry.reconnectSlot(p.id))} disabled={busyId === p.id} style={btnStyle('primary', busyId === p.id)}>
                    {busyId === p.id ? <><Loader2 size={14} style={{animation:'spin .8s linear infinite'}}/> Conectando…</> : <><Bluetooth size={14}/> Reconectar</>}
                  </button>
                  <button onClick={() => run(p.id, () => PrinterRegistry.connectSlot(p.id, () => {}))} disabled={busyId === p.id} style={btnStyle('ghost', busyId === p.id)} title="Elegir otra impresora">
                    Cambiar
                  </button>
                </>
              ) : (
                <button onClick={() => run(p.id, () => PrinterRegistry.connectSlot(p.id, () => {}))} disabled={busyId === p.id} style={btnStyle('primary', busyId === p.id)}>
                  {busyId === p.id ? <><Loader2 size={14} style={{animation:'spin .8s linear infinite'}}/> Conectando…</> : <><Bluetooth size={14}/> Buscar y conectar</>}
                </button>
              )}
              {p.deviceId && (
                <button
                  onClick={() => { if (window.confirm(`¿Olvidar "${p.deviceName || 'la impresora'}"? Ya no se reconectará sola.`)) PrinterRegistry.forgetSlot(p.id); }}
                  title="Olvidar impresora recordada"
                  style={btnStyle('ghost', false)}
                >Olvidar</button>
              )}
              {printers.length > 1 && (
                <button
                  onClick={() => { if (window.confirm(`¿Quitar "${p.label}"?`)) PrinterRegistry.removeSlot(p.id); }}
                  title="Quitar impresora"
                  style={{
                    width:34, height:34, borderRadius:8, border:'1px solid var(--line2)',
                    background:'var(--ink2)', color:'#DC2626', cursor:'pointer',
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}
                ><Trash2 size={14}/></button>
              )}
            </div>
            </>)}
          </div>
        ))}

        <div style={{display:'flex', gap:8, marginTop:4, marginBottom:14}}>
          <input
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            placeholder="Ej: Barra"
            maxLength={24}
            style={{
              flex:1, background:'var(--ink3)', border:'1px solid var(--line2)', borderRadius:8,
              padding:'9px 10px', color:'var(--snow)', fontSize:13, outline:'none',
            }}
          />
          <button
            onClick={handleAdd}
            disabled={busyId !== null}
            style={{
              padding:'9px 14px', borderRadius:8, fontSize:12, fontWeight:800,
              background:'var(--ink3)', border:'1px solid var(--amber)', color:'var(--amber)',
              cursor: busyId !== null ? 'not-allowed' : 'pointer', whiteSpace:'nowrap',
              display:'flex', alignItems:'center', gap:6,
            }}
          ><PlusCircle size={14}/> Agregar y emparejar</button>
        </div>

    </>
  );
}

function PrintersModal({ categories, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, zIndex:920,
        display:'flex', alignItems:'center', justifyContent:'center', padding:16,
        background:'rgba(0,0,0,.82)', backdropFilter:'blur(6px)', WebkitBackdropFilter:'blur(6px)',
        animation:'fadeIn .2s ease',
      }}
    >
      <div
        onClick={e=>e.stopPropagation()}
        style={{
          background:'var(--ink2)', border:'1px solid var(--line2)', borderRadius:18,
          padding:'22px 18px', width:'100%', maxWidth:420, maxHeight:'85vh', overflowY:'auto',
          animation:'scaleIn .25s var(--ease)',
        }}
      >
        <div style={{fontFamily:'var(--display)',fontSize:19,color:'var(--amber)',marginBottom:4,display:'flex',alignItems:'center',gap:7}}><Printer size={18}/> Impresoras</div>
        <PrintersPanel categories={categories} />
        <button className="cm-btn secondary" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   AJUSTES — configuración de este celular (impresoras Bluetooth)
   La configuración se guarda en el dispositivo, no en el perfil: cerrar
   turno o cambiar de mesero NO la borra.
══════════════════════════════════════════════ */
function AjustesScreen({ categories }) {
  return (
    <div className="screen anim-fadeUp" style={{padding:'14px 14px 90px'}}>
      <div style={{fontFamily:'var(--display)',fontSize:20,color:'var(--amber)',marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
        <Printer size={18}/> Ajustes · Etiquetera / Impresora
      </div>
      <div style={{background:'var(--ink2)', border:'1px solid var(--line2)', borderRadius:16, padding:'16px 14px'}}>
        <PrintersPanel categories={categories} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   TICKET MODAL
══════════════════════════════════════════════ */
function TicketModal({mesa,items,waiter,zone,btConnected,cols,onPrint,onClose,packaging=null,descuento=null}) {
  const ticket = buildTicketStr(mesa, items, waiter.name, zone, cols, packaging, descuento);
  return (
    <div className="ticket-modal" onClick={onClose}>
      <div className="ticket-box" onClick={e=>e.stopPropagation()}>
        <div style={{fontFamily:'var(--display)',fontSize:20,color:'var(--amber)',marginBottom:3,display:'flex',alignItems:'center',gap:7}}>
          <Printer size={18}/> Pre-cuenta
        </div>
        <div style={{fontSize:11,color:'var(--mist)',marginBottom:14}}>Mesa {mesa} · {zone}</div>
        <div className="ticket-paper">{ticket}</div>
        <button className="cm-btn confirm" onClick={()=>onPrint(ticket)} style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
          {btConnected ? <><Printer size={16}/> Imprimir vía Bluetooth</> : <><Check size={16}/> Listo</>}
        </button>
        <button className="cm-btn secondary" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   SUCCESS FLASH
══════════════════════════════════════════════ */
function SuccessFlash({msg,onDone}) {
  useEffect(()=>{ const t=setTimeout(onDone,1800); return()=>clearTimeout(t); },[]);
  return (
    <div className="success-overlay" onClick={onDone}>
      <div className="success-check"><Check size={40} color="#fff" strokeWidth={3}/></div>
      <div className="success-title">Enviado</div>
      <div className="success-sub">{msg}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   SCREEN: TURNO — Reporte personal del mesero
   ventasTurno y turnoStart vienen de App (estado
   elevado) para garantizar persistencia entre tabs.
══════════════════════════════════════════════ */
function TurnoScreen({ waiter, ventasTurno, setVentasTurno, turnoStart, setTurnoStart, onLogout }) {
  // Estado UI local (no afecta datos del turno)
  const [cerrandoTurno, setCerrandoTurno] = useState(false);
  const [showPinModal,  setShowPinModal]  = useState(false);
  const [pinInput,      setPinInput]      = useState('');
  const [pinError,      setPinError]      = useState('');
  const [showReporte,   setShowReporte]   = useState(false);

  // Los datos del turno llegan como prop — no se necesita fetch aquí
  const ventas   = ventasTurno || [];

  // Abre el modal de PIN — no ejecuta nada hasta verificar credenciales
  function abrirModalCierreTurno() {
    if (cerrandoTurno) return;
    setPinInput('');
    setPinError('');
    setShowPinModal(true);
  }

  // Confirma el cierre de turno con PIN — validado contra el PIN INDIVIDUAL
  // de ESTE mesero (waiter.id), no un PIN compartido: así un mesero no
  // puede cerrar el turno de otro adivinando/compartiendo un PIN genérico.
  async function confirmarCierreTurno() {
    setPinError('');
    setCerrandoTurno(true);
    let ok = false;
    try {
      ok = await verifyMeseroPinOrFallback(waiter.id, pinInput);
    } catch (e) {
      setPinError(e?.message === 'PIN_LOCKED'
        ? 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo.'
        : 'No se pudo verificar el PIN. Revisa tu conexión e inténtalo de nuevo.');
      setCerrandoTurno(false);
      return;
    }
    if (!ok) {
      setPinError('PIN incorrecto. Acceso denegado.');
      setCerrandoTurno(false);
      return;
    }
    setShowPinModal(false);
    // Bitácora — cierra la sesión abierta de este mesero (best-effort)
    logMeseroSesionFin(waiter.id).catch(()=>{});
    // Vaciar historial visualmente antes de que la página recargue
    setVentasTurno([]);
    try {
      await onLogout(); // libera mesas + limpia storage + recarga página
    } catch(e) {
      console.error('[CerrarTurno] Error inesperado:', e?.message || e);
      setCerrandoTurno(false);
    }
  }

  const total    = ventas.reduce((s,v) => s + (v.total||0), 0);
  const efectivo = ventas.filter(v => v.metodo_pago === 'efectivo');
  const yape     = ventas.filter(v => v.metodo_pago === 'yape');
  const totEfect = efectivo.reduce((s,v) => s + (v.total||0), 0);
  const totYape  = yape.reduce((s,v) => s + (v.total||0), 0);
  const fechaHoy = new Date().toLocaleDateString('es-PE',{weekday:'long',day:'numeric',month:'long'});
  const turnoEs0 = turnoStart.getHours() === 0 && turnoStart.getMinutes() === 0;
  const turnoHora = turnoStart.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});

  return (
    <div className="screen anim-fadeUp">
      <div style={{padding:'12px 14px 0'}}>

        {/* Header identidad del mesero */}
        <div style={{
          background:'linear-gradient(135deg,rgba(245,166,35,.12),rgba(245,166,35,.04))',
          border:'1px solid rgba(245,166,35,.25)', borderRadius:'var(--r)',
          padding:'14px 16px', marginBottom:14,
          display:'flex', alignItems:'center', gap:12,
        }}>
          <div style={{
            width:46, height:46, borderRadius:'50%',
            background:waiter.bg, color:waiter.color,
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:20, fontWeight:700, flexShrink:0,
          }}>{waiter.initial}</div>
          <div style={{flex:1}}>
            <div style={{fontFamily:'var(--display)',fontSize:17,color:'var(--amber)',letterSpacing:1}}>
              {waiter.name}
            </div>
            <div style={{fontSize:10,color:'var(--mist)',marginTop:2}}>
              Reporte de Turno · {fechaHoy}
            </div>
            <div style={{fontSize:10,color:'var(--fog)',marginTop:1}}>
              Turno desde: {turnoEs0 ? 'Inicio del día' : turnoHora}
            </div>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{fontFamily:'var(--mono)',fontSize:24,color:'var(--amber)',fontWeight:700,lineHeight:1}}>
              {fmt(total)}
            </div>
            <div style={{fontSize:9,color:'var(--fog)',marginTop:3,letterSpacing:1}}>
              {ventas.length} VENTA{ventas.length!==1?'S':''}
            </div>
          </div>
        </div>

        {/* Resumen por método de pago */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:12}}>
          <div className="status-card" style={{borderLeft:'3px solid var(--emerald)'}}>
            <div className="status-card-val emerald">{fmt(totEfect)}</div>
            <div className="status-card-lbl"><Banknote size={11} style={{verticalAlign:-2}} /> Efectivo · {efectivo.length} vta{efectivo.length!==1?'s':''}</div>
          </div>
          <div className="status-card" style={{borderLeft:'3px solid #742eff'}}>
            <div className="status-card-val" style={{color:'#742eff'}}>{fmt(totYape)}</div>
            <div className="status-card-lbl"><Smartphone size={11} style={{verticalAlign:-2}} /> Yape · {yape.length} vta{yape.length!==1?'s':''}</div>
          </div>
        </div>

        {/* Botones de acción del turno */}
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          {/* Generar Reporte */}
          <button
            onClick={() => setShowReporte(true)}
            disabled={cerrandoTurno}
            style={{
              flex:1, padding:'10px 16px', borderRadius:'var(--r2)',
              fontWeight:800, fontSize:12,
              cursor: cerrandoTurno ? 'not-allowed' : 'pointer', transition:'all .2s',
              border: '1px solid rgba(245,166,35,.4)',
              background: 'rgba(245,166,35,.10)',
              color: 'var(--amber)', opacity: cerrandoTurno ? 0.6 : 1,
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            }}
          >
            <BarChart3 size={14}/> Generar Reporte
          </button>
          {/* Cerrar Turno */}
          <button
            onClick={abrirModalCierreTurno}
            disabled={cerrandoTurno}
            style={{
              flex:1, padding:'10px 16px', borderRadius:'var(--r2)',
              fontWeight:800, fontSize:12,
              cursor: cerrandoTurno ? 'not-allowed' : 'pointer', transition:'all .2s',
              border: '1px solid rgba(230,57,70,.4)',
              background: cerrandoTurno ? 'rgba(230,57,70,.08)' : 'rgba(230,57,70,.12)',
              color: '#e63946', opacity: cerrandoTurno ? 0.6 : 1,
              display:'flex', alignItems:'center', justifyContent:'center', gap:6,
            }}
          >
            {cerrandoTurno ? <><Loader2 size={14} style={{animation:'spin .8s linear infinite'}}/> Cerrando turno...</> : <><RotateCw size={14}/> Cerrar Turno</>}
          </button>
        </div>

        {/* ── Modal: Reporte de Turno ─────────────────────────────── */}
        {showReporte && (() => {
          // Un pago dividido queda en `ventas_meseros` como una fila por método (nunca
          // 'mixto' ahí — ver handlePayment), así que sumar por metodo_pago ya reparte
          // bien un cobro mixto sin ningún caso especial. Solo se muestra la línea de
          // un método si el mesero tuvo al menos una venta con él (Tarjeta/Plin no
          // aparecen en un turno que solo cobró Efectivo/Yape, como antes).
          const totalesPorMetodo = PAYMENT_METHODS_M
            .map(m => ({ ...m, total: ventas.filter(v=>v.metodo_pago===m.key).reduce((s,v)=>s+(v.total||0),0) }))
            .filter(m => m.total > 0 || m.key === 'efectivo' || m.key === 'yape');
          const totEfectRpt = totalesPorMetodo.find(m=>m.key==='efectivo')?.total || 0;
          const totYapeRpt  = totalesPorMetodo.find(m=>m.key==='yape')?.total || 0;
          const totalRpt    = ventas.reduce((s,v)=>s+(v.total||0),0);
          const fechaRpt    = new Date().toLocaleDateString('es-PE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
          const horaRpt     = new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
          const turnoHoraRpt = turnoEs0 ? 'Inicio del día' : turnoHora;
          const mesasUnicas  = new Set(ventas.map(v=>v.mesa_nro)).size;

          const textoReporte = [
            '═══════════════════════════════',
            `    ${(BIZ.nombre || '').toUpperCase()}`,
            '    REPORTE DE TURNO — MESERO',
            '═══════════════════════════════',
            `Mesero : ${waiter.name}`,
            `Fecha  : ${fechaRpt}`,
            `Turno  : ${turnoHoraRpt} → ${horaRpt}`,
            '───────────────────────────────',
            `Ventas totales   : ${ventas.length}`,
            `Mesas atendidas  : ${mesasUnicas}`,
            '───────────────────────────────',
            ...totalesPorMetodo.map(m => `${m.label.padEnd(10)}: S/ ${m.total.toFixed(2)}`),
            '───────────────────────────────',
            `TOTAL     : S/ ${totalRpt.toFixed(2)}`,
            '═══════════════════════════════',
            'DETALLE DE VENTAS:',
            ...ventas.map((v,i) => {
              const h = new Date(v.fecha_hora).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
              const met = (PAYMENT_METHODS_M.find(m=>m.key===v.metodo_pago)?.label || 'Efect').slice(0,5);
              return `${String(i+1).padStart(2,'0')}. Mesa ${v.mesa_nro} ${met.padEnd(5)} S/${(v.total||0).toFixed(2).padStart(7)} ${h}`;
            }),
            '═══════════════════════════════',
          ].join('\n');

          const copiarReporte = () => {
            if (navigator.clipboard) {
              navigator.clipboard.writeText(textoReporte).catch(()=>{});
            }
          };
          const compartirReporte = () => {
            if (navigator.share) {
              navigator.share({ title: `Reporte Turno — ${waiter.name}`, text: textoReporte }).catch(()=>{});
            } else { copiarReporte(); }
          };

          return (
            <div
              onClick={() => setShowReporte(false)}
              style={{
                position:'fixed',inset:0,zIndex:910,
                background:'rgba(6,8,9,0.90)',backdropFilter:'blur(6px)',
                WebkitBackdropFilter:'blur(6px)',
                display:'flex',alignItems:'center',justifyContent:'center',padding:20,
                animation:'fadeIn .2s ease',
              }}
            >
              <div
                onClick={e=>e.stopPropagation()}
                style={{
                  background:'var(--ink2)',border:'1px solid rgba(245,166,35,.35)',
                  borderRadius:20,width:'100%',maxWidth:360,
                  maxHeight:'88vh',overflow:'hidden',display:'flex',flexDirection:'column',
                  animation:'scaleIn .25s var(--ease)',
                }}
              >
                {/* Header */}
                <div style={{
                  background:'linear-gradient(160deg,rgba(245,166,35,.18) 0%,rgba(245,166,35,.06) 100%)',
                  padding:'18px 20px 14px',borderBottom:'1px solid rgba(245,166,35,.2)',flexShrink:0,
                }}>
                  <div style={{fontFamily:'var(--display)',fontSize:20,color:'var(--amber)',letterSpacing:1,display:'flex',alignItems:'center',gap:7}}>
                    <BarChart3 size={18}/> Reporte de Turno
                  </div>
                  <div style={{fontSize:11,color:'var(--mist)',marginTop:3}}>
                    {waiter.name} · {fechaRpt}
                  </div>
                </div>

                {/* KPIs */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:6,padding:'12px 16px 8px',flexShrink:0}}>
                  <div style={{textAlign:'center',background:'var(--ink3)',borderRadius:8,padding:'8px 4px'}}>
                    <div style={{fontFamily:'var(--mono)',fontSize:20,fontWeight:700,color:'var(--amber)'}}>{ventas.length}</div>
                    <div style={{fontSize:8,color:'var(--fog)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>Ventas</div>
                  </div>
                  <div style={{textAlign:'center',background:'var(--ink3)',borderRadius:8,padding:'8px 4px'}}>
                    <div style={{fontFamily:'var(--mono)',fontSize:20,fontWeight:700,color:'var(--amber)'}}>{mesasUnicas}</div>
                    <div style={{fontSize:8,color:'var(--fog)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>Mesas</div>
                  </div>
                  <div style={{textAlign:'center',background:'rgba(245,166,35,.12)',borderRadius:8,padding:'8px 4px',border:'1px solid rgba(245,166,35,.2)'}}>
                    <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:'var(--amber)',marginTop:3}}>
                      S/{totalRpt.toFixed(0)}
                    </div>
                    <div style={{fontSize:8,color:'var(--fog)',textTransform:'uppercase',letterSpacing:.8,marginTop:2}}>Total</div>
                  </div>
                </div>

                {/* Desglose métodos */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,padding:'0 16px 10px',flexShrink:0}}>
                  <div style={{
                    display:'flex',alignItems:'center',gap:8,
                    background:'rgba(46,204,113,.08)',border:'1px solid rgba(46,204,113,.2)',
                    borderRadius:8,padding:'8px 10px',
                  }}>
                    <Banknote size={16} color="#2ecc71" />
                    <div>
                      <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:'var(--emerald)'}}>
                        S/ {totEfectRpt.toFixed(2)}
                      </div>
                      <div style={{fontSize:8,color:'var(--fog)',letterSpacing:1}}>EFECTIVO</div>
                    </div>
                  </div>
                  <div style={{
                    display:'flex',alignItems:'center',gap:8,
                    background:'rgba(116,46,255,.08)',border:'1px solid rgba(116,46,255,.2)',
                    borderRadius:8,padding:'8px 10px',
                  }}>
                    <Smartphone size={16} color="#742eff" />
                    <div>
                      <div style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:'#742eff'}}>
                        S/ {totYapeRpt.toFixed(2)}
                      </div>
                      <div style={{fontSize:8,color:'var(--fog)',letterSpacing:1}}>YAPE</div>
                    </div>
                  </div>
                </div>

                {/* Ticket de texto */}
                <div style={{flex:1,overflowY:'auto',padding:'0 16px 10px'}}>
                  <pre style={{
                    background:'#fff',color:'#111',
                    fontFamily:"'Courier New',monospace",fontSize:9.5,
                    lineHeight:1.65,padding:'10px 12px',borderRadius:8,
                    whiteSpace:'pre',margin:0,
                  }}>{textoReporte}</pre>
                </div>

                {/* Botones acción */}
                <div style={{display:'flex',gap:8,padding:'10px 16px 16px',flexShrink:0,borderTop:'1px solid var(--line)'}}>
                  <button
                    onClick={compartirReporte}
                    style={{
                      flex:1,padding:'11px',borderRadius:'var(--r2)',border:'none',
                      background:'linear-gradient(135deg,var(--amber),var(--amber2))',
                      color:'#000',fontWeight:800,fontSize:12,cursor:'pointer',
                      display:'flex',alignItems:'center',justifyContent:'center',gap:6,
                    }}
                  >
                    {navigator.share ? <><Share2 size={14}/> Compartir</> : <><Copy size={14}/> Copiar</>}
                  </button>
                  <button
                    onClick={() => setShowReporte(false)}
                    style={{
                      flex:1,padding:'11px',borderRadius:'var(--r2)',
                      border:'1px solid var(--line2)',
                      background:'transparent',color:'var(--fog)',
                      fontWeight:700,fontSize:12,cursor:'pointer',
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Modal de confirmación con PIN */}
        {showPinModal && (
          <div
            onClick={() => setShowPinModal(false)}
            style={{
              position:'fixed', inset:0, zIndex:900,
              background:'rgba(6,8,9,0.88)', backdropFilter:'blur(6px)',
              WebkitBackdropFilter:'blur(6px)',
              display:'flex', alignItems:'center', justifyContent:'center', padding:20,
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                background:'var(--ink2)', border:'1px solid rgba(230,57,70,.45)',
                borderRadius:20, width:'100%', maxWidth:320, overflow:'hidden',
              }}
            >
              {/* Header */}
              <div style={{
                background:'linear-gradient(160deg,#3d0f0f 0%,#5c1a1a 100%)',
                padding:'22px 20px 18px', textAlign:'center',
              }}>
                <div style={{display:'flex',justifyContent:'center',marginBottom:10}}><KeyRound size={40} color="#fff"/></div>
                <div style={{
                  fontFamily:'var(--display)', fontSize:13, letterSpacing:3,
                  color:'#e63946', textTransform:'uppercase',
                }}>
                  Cerrar Turno
                </div>
              </div>

              {/* Cuerpo */}
              <div style={{padding:'18px 20px 20px'}}>
                <div style={{
                  fontSize:12, color:'var(--mist)', textAlign:'center',
                  marginBottom:16, lineHeight:1.6,
                }}>
                  Esta acción cerrará el turno, borrará el historial de ventas y liberará todas tus mesas.
                  El siguiente turno comenzará desde cero. Ingresa tu PIN para confirmar.
                </div>

                <form autoComplete="off" onSubmit={e=>{e.preventDefault();confirmarCierreTurno();}}>
                  <input
                    type="password"
                    maxLength={4}
                    inputMode="numeric"
                    placeholder="• • • •"
                    value={pinInput}
                    autoFocus
                    autoComplete="new-password"
                    autoCorrect="off"
                    autoCapitalize="off"
                    onChange={e => { setPinInput(e.target.value); setPinError(''); }}
                    style={{
                      width:'100%', boxSizing:'border-box',
                      background: pinError ? 'rgba(220,38,38,.08)' : 'var(--ink3)',
                      border: `1px solid ${pinError ? '#DC2626' : 'var(--line2)'}`,
                      borderRadius:10, padding:'12px 14px',
                      color:'var(--snow)', fontSize:20, outline:'none',
                      textAlign:'center', letterSpacing:6,
                      fontFamily:'var(--mono)', marginBottom:8,
                    }}
                  />
                  {pinError && (
                    <div style={{
                      fontSize:11, color:'#e63946', textAlign:'center',
                      background:'rgba(230,57,70,.1)', border:'1px solid rgba(230,57,70,.2)',
                      borderRadius:8, padding:'7px 10px', marginBottom:8,
                    }}>
                      <AlertTriangle size={12} style={{verticalAlign:-2,marginRight:4}}/> {pinError}
                    </div>
                  )}
                  <button
                    type="submit"
                    disabled={cerrandoTurno}
                    style={{
                      width:'100%', padding:'13px', borderRadius:12,
                      background:'linear-gradient(135deg,#b91c1c,#e63946)',
                      border:'none', color:'#fff',
                      fontWeight:900, fontSize:14, cursor: cerrandoTurno ? 'wait' : 'pointer',
                      letterSpacing:.3, marginBottom:8, opacity: cerrandoTurno ? 0.75 : 1,
                      display:'flex', alignItems:'center', justifyContent:'center', gap:7,
                    }}
                  >
                    {cerrandoTurno ? <><Loader2 size={15} style={{animation:'spin .8s linear infinite'}}/> Verificando…</> : <><Check size={15}/> Confirmar Cierre de Turno</>}
                  </button>
                  <button
                    type="button"
                    disabled={cerrandoTurno}
                    onClick={() => setShowPinModal(false)}
                    style={{
                      width:'100%', padding:'11px',
                      background:'transparent', border:'1px solid var(--line2)',
                      borderRadius:12, color:'var(--fog)',
                      fontWeight:700, fontSize:12, cursor: cerrandoTurno ? 'not-allowed' : 'pointer',
                      opacity: cerrandoTurno ? 0.6 : 1,
                    }}
                  >
                    Cancelar
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Lista de ventas — datos en tiempo real desde estado App */}
        {ventas.length === 0 ? (
          <div style={{textAlign:'center',padding:'40px 20px',color:'var(--fog)'}}>
            <BarChart3 size={44} strokeWidth={1.5} style={{opacity:.25,marginBottom:10}} />
            <div style={{fontSize:13,fontWeight:600}}>Sin ventas en este turno</div>
            <div style={{fontSize:11,marginTop:5,color:'var(--ghost)'}}>
              Aquí aparecen las mesas que cobres durante el turno actual
            </div>
          </div>
        ) : (
          <>
            <div style={{fontSize:9,fontWeight:700,color:'var(--fog)',letterSpacing:1.5,marginBottom:8}}>
              HISTORIAL DEL TURNO
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              {ventas.map((v,i) => {
                const isEfect = v.metodo_pago === 'efectivo';
                const hora = new Date(v.fecha_hora).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
                const productList = (v.items||[]).map(it=>`${it.qty}× ${it.name}`).join(', ');
                return (
                  <div key={v.id||i} style={{
                    background:'var(--ink2)', border:'1px solid var(--line)',
                    borderLeft:`3px solid ${isEfect?'var(--emerald)':'#742eff'}`,
                    borderRadius:10, padding:'10px 12px',
                    display:'flex', alignItems:'center', gap:10,
                  }}>
                    <div style={{
                      width:34,height:34,borderRadius:8,flexShrink:0,
                      background:isEfect?'rgba(46,204,113,.12)':'rgba(116,46,255,.12)',
                      display:'flex',alignItems:'center',justifyContent:'center',
                    }}>{isEfect ? <Banknote size={16} color="#2ecc71" /> : <Smartphone size={16} color="#742eff" />}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:'var(--snow)'}}>
                        Mesa {v.mesa_nro} · {v.zona||'General'}
                      </div>
                      <div style={{
                        fontSize:10,color:'var(--mist)',marginTop:2,
                        overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                      }}>{productList||'Sin detalle'}</div>
                    </div>
                    <div style={{textAlign:'right',flexShrink:0}}>
                      <div style={{fontFamily:'var(--mono)',fontSize:14,color:'var(--amber)',fontWeight:700}}>
                        {fmt(v.total)}
                      </div>
                      <div style={{fontSize:9,color:'var(--fog)',marginTop:2}}>{hora}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div style={{height:80}}/>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   PERSISTENCIA — localStorage
   Guarda el carrito y el mesero entre sesiones
   para que el mesero no pierda pedidos activos.
══════════════════════════════════════════════ */
// v3 — bumped para invalidar cachés sin waiter-tag de versiones anteriores
const CART_KEY       = 'antojitos_cart_v3';
const WAITER_KEY     = 'antojitos_waiter_v1';
const CART_OWNER_KEY = 'antojitos_cart_owner'; // identifica qué mesero es dueño del carrito
const CART_TTL       = 24 * 60 * 60 * 1000;   // 24 h — descarta datos más viejos

/* loadSavedCart(waiterId)
   Rechaza el carrito si pertenece a otro mesero (protección en dispositivo compartido).
   Si no hay waiterId (nadie logueado) siempre devuelve mesas vacías para evitar
   cargar datos huérfanos de sesiones anteriores. */
const loadSavedCart = (waiterId) => {
  try {
    if (!waiterId) return mkTables(); // sin sesión → nunca cargar carrito ajeno
    const ownerRaw = localStorage.getItem(CART_OWNER_KEY);
    if (ownerRaw) {
      try {
        const owner = JSON.parse(ownerRaw);
        if (owner.waiterId && owner.waiterId !== waiterId) return mkTables();
      } catch(_) {}
    }
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return mkTables();
    const saved = JSON.parse(raw);
    const cutoff = Date.now() - CART_TTL;
    return mkTables().map(t => {
      const s = saved.find(x => x.id === t.id);
      if (!s || !s.occupied || (s.openAt && s.openAt < cutoff)) return t;
      return { ...t, ...s };
    });
  } catch(e) { return mkTables(); }
};

/* persistCart(tables, waiterId)
   Etiqueta el carrito con el ID del mesero activo para evitar
   que otro mesero lo lea al iniciar sesión en el mismo dispositivo. */
const persistCart = (tables, waiterId) => {
  try {
    const active = tables.filter(t => t.occupied || (t.items && t.items.length > 0));
    localStorage.setItem(CART_KEY, JSON.stringify(active));
    if (waiterId) {
      localStorage.setItem(CART_OWNER_KEY, JSON.stringify({ waiterId, ts: Date.now() }));
    }
  } catch(e) {}
};

const loadSavedWaiter = () => {
  try { const r = localStorage.getItem(WAITER_KEY); return r ? JSON.parse(r) : null; }
  catch(e) { return null; }
};

const persistWaiter = w => {
  try {
    if (w) localStorage.setItem(WAITER_KEY, JSON.stringify(w));
    else   localStorage.removeItem(WAITER_KEY);
  } catch(e) {}
};

/* ══════════════════════════════════════════════
   RECOVERY — Recupera pedidos activos desde Supabase
   Usada al reingresar si localStorage fue borrado o
   la sesión anterior terminó de forma abrupta.
   Devuelve un mapa { numero_mesa → { orderId, items } }
══════════════════════════════════════════════ */
async function recoverActiveOrders(waiterId) {
  try {
    // Solo pedidos de las últimas 24h con estado activo para evitar recuperar
    // pedidos de turnos anteriores que nunca fueron marcados como pagados.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    let { data, error } = await _supabase
      .from('orders')
      .select('id, table_number, items, zone, status, rounds, created_at')
      .eq('waiter_id', waiterId)
      .in('status', ['pending', 'preparing', 'ready'])
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });

    if (error && /rounds/i.test(error.message || '')) {
      // Migración de la columna `rounds` aún no aplicada — reintenta sin ella
      // para no romper la recuperación de pedidos activos.
      ({ data, error } = await _supabase
        .from('orders')
        .select('id, table_number, items, zone, status, created_at')
        .eq('waiter_id', waiterId)
        .in('status', ['pending', 'preparing', 'ready'])
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false }));
    }

    if (error || !data || !data.length) return {};

    // Deduplicar por mesa — nos quedamos con el pedido más reciente de cada mesa
    const byTable = {};
    data.forEach(ord => {
      const tbl = ord.table_number;
      if (!byTable[tbl]) {
        byTable[tbl] = {
          orderId: ord.id,
          items:   Array.isArray(ord.items) ? ord.items : [],
          rounds:  Array.isArray(ord.rounds) ? ord.rounds : [],
        };
      }
    });
    return byTable;
  } catch(e) {
    console.warn('recoverActiveOrders:', e);
    return {};
  }
}

/* ══════════════════════════════════════════════
   AVISOS "PEDIDO LISTO" YA ACEPTADOS — una sola vez por pedido
   ══════════════════════════════════════════════
   Antes, al volver a la app (o al salir y entrar al perfil), se volvían a
   pedir TODOS los pedidos en estado "listo" y se mostraban otra vez,
   aunque el mesero ya los hubiera aceptado. Ahora cada aviso aceptado se
   guarda en este celular (localStorage, por mesero) y no se repite.
   La firma incluye la cantidad de rondas del pedido: si después se envía
   una ronda NUEVA a cocina y vuelve a quedar lista, ese aviso sí llega
   (es un recojo distinto). Se borran solos los registros de más de 3 días.
   Esta clave NO se borra al cerrar turno (a propósito).
══════════════════════════════════════════════ */
const ALERT_ACK_LS_KEY = 'antojitos_avisos_listo_vistos_v1';
const ALERT_ACK_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const _alertShownThisSession = new Set(); // evita repetir campana por eventos duplicados

function kitchenAlertSig(ord) {
  const n = Array.isArray(ord?.rounds) ? ord.rounds.length : 0;
  return `${ord?.id}#${n}`;
}
function _loadAlertAcks() {
  try {
    const o = JSON.parse(localStorage.getItem(ALERT_ACK_LS_KEY) || '{}');
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch (_) { return {}; }
}
function isKitchenAlertAcked(waiterId, sig) {
  if (!waiterId || !sig) return false;
  return !!_loadAlertAcks()[`${waiterId}|${sig}`];
}
function ackKitchenAlert(waiterId, sig) {
  if (!waiterId || !sig) return;
  const acks = _loadAlertAcks();
  const cutoff = Date.now() - ALERT_ACK_TTL_MS;
  Object.keys(acks).forEach(k => { if (!(acks[k] > cutoff)) delete acks[k]; });
  acks[`${waiterId}|${sig}`] = Date.now();
  try { localStorage.setItem(ALERT_ACK_LS_KEY, JSON.stringify(acks)); } catch (_) {}
}
// true = este aviso debe mostrarse (no aceptado antes ni ya mostrado en esta sesión).
// Lo marca como mostrado en la sesión para que eventos repetidos no vuelvan a sonar.
function claimKitchenAlert(waiterId, sig) {
  const key = `${waiterId}|${sig}`;
  if (_alertShownThisSession.has(key) || isKitchenAlertAcked(waiterId, sig)) return false;
  _alertShownThisSession.add(key);
  return true;
}

/* ══════════════════════════════════════════════
   KITCHEN READY ALERT — Modal premium de notificación
══════════════════════════════════════════════ */
function KitchenReadyAlert({ alert, onDismiss }) {
  const SECS = 20;
  const [remaining, setRemaining] = useState(SECS);
  // Siempre la versión MÁS RECIENTE de onDismiss (antes el temporizador usaba
  // la del primer render y, con dos avisos seguidos, cerraba el equivocado).
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const doneRef = useRef(false);

  useEffect(() => {
    const tick = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  // Al llegar a 0 se cierra UNA sola vez (fuera del setState: sin efectos
  // secundarios dentro de la función de actualización).
  useEffect(() => {
    if (remaining === 0 && !doneRef.current) {
      doneRef.current = true;
      dismissRef.current();
    }
  }, [remaining]);

  const items = alert.items || [];

  return (
    /* Backdrop — click fuera cierra */
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 850,
        background: 'rgba(6,8,9,0.87)',
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px',
        animation: 'kaBgIn .28s ease forwards',
      }}
    >
      {/* Card */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--ink2)',
          border: '1px solid rgba(46,204,113,0.45)',
          borderRadius: 22,
          width: '100%', maxWidth: 350,
          overflow: 'hidden',
          animation: 'kaCardIn .4s var(--ease) forwards, kaPulse 2.5s ease-in-out 0.5s infinite',
        }}
      >
        {/* ── Header verde con campana animada ── */}
        <div style={{
          background: 'linear-gradient(160deg, #0f3d22 0%, #1a5c35 100%)',
          padding: '26px 24px 20px',
          textAlign: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {/* Anillos de onda expandiéndose */}
          {[0, 0.55, 1.1].map((delay, i) => (
            <div key={i} style={{
              position: 'absolute', top: '50%', left: '50%',
              width: 56, height: 56,
              borderRadius: '50%',
              border: '1.5px solid rgba(46,204,113,0.55)',
              animation: `kaRing 2.2s ease-out ${delay}s infinite`,
              pointerEvents: 'none',
            }}/>
          ))}

          {/* Campana */}
          <div style={{
            display: 'inline-flex',
            position: 'relative', zIndex: 1,
            animation: 'kaBell 0.75s ease-in-out 0.35s 2',
            filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.5))',
          }}>
            <Bell size={52} color="var(--emerald, #2ecc71)" strokeWidth={1.75} />
          </div>

          {/* Subtítulo header */}
          <div style={{
            fontFamily: 'var(--mono)', fontSize: 10,
            letterSpacing: 3, color: 'rgba(46,204,113,0.7)',
            marginTop: 12, textTransform: 'uppercase',
            position: 'relative', zIndex: 1,
          }}>
            La cocina avisa
          </div>
        </div>

        {/* ── Cuerpo del modal ── */}
        <div style={{ padding: '18px 20px 0' }}>

          {/* Título */}
          <div style={{
            fontFamily: 'var(--display)', fontSize: 13,
            letterSpacing: 3, color: 'var(--emerald)',
            textAlign: 'center', textTransform: 'uppercase',
          }}>
            ¡Pedido Listo!
          </div>

          {/* Número de mesa / nombre de cliente según zona */}
          {alert.zone === 'Para Llevar' ? (
            <div style={{ textAlign: 'center', margin: '6px 0 14px', lineHeight: 1 }}>
              <div style={{ display:'flex', justifyContent:'center', marginBottom: 6 }}><ShoppingBag size={40} /></div>
              <div style={{
                fontFamily: 'var(--display)', fontSize: 32,
                color: 'var(--snow)', lineHeight: 1.2,
                textShadow: '0 0 30px rgba(46,204,113,0.35)', padding: '0 12px',
              }}>
                {alert.customerName || 'Para Llevar'}
              </div>
              <div style={{ fontSize: 9, letterSpacing: 4, color: 'var(--fog)', marginTop: 6, textTransform: 'uppercase' }}>
                PEDIDO PARA LLEVAR
              </div>
            </div>
          ) : alert.zone === 'Delivery' || alert.zone === 'Recojo en Local' ? (
            <div style={{ textAlign: 'center', margin: '6px 0 14px', lineHeight: 1 }}>
              <div style={{ display:'flex', justifyContent:'center', marginBottom: 6 }}>
                {alert.zone === 'Delivery' ? <Bike size={40}/> : <Store size={40}/>}
              </div>
              <div style={{
                fontFamily: 'var(--display)', fontSize: 28,
                color: 'var(--snow)', lineHeight: 1.2,
                textShadow: '0 0 30px rgba(46,204,113,0.35)', padding: '0 12px',
              }}>
                {alert.customerName || alert.zone}
              </div>
              <div style={{ fontSize: 9, letterSpacing: 4, color: 'var(--fog)', marginTop: 6, textTransform: 'uppercase' }}>
                {alert.zone.toUpperCase()}
              </div>
            </div>
          ) : (
            <>
              <div style={{ textAlign: 'center', margin: '6px 0 2px', lineHeight: 1 }}>
                <div style={{
                  fontFamily: 'var(--display)', fontSize: 104,
                  color: 'var(--snow)', lineHeight: 1,
                  textShadow: '0 0 50px rgba(46,204,113,0.35)',
                }}>
                  {String(alert.mesa).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 9, letterSpacing: 4, color: 'var(--fog)', marginTop: -2, textTransform: 'uppercase' }}>
                  MESA
                </div>
              </div>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--mist)', marginBottom: 14, display:'flex', alignItems:'center', justifyContent:'center', gap:4 }}>
                <MapPin size={12}/> {alert.zone}
              </div>
            </>
          )}

          {/* Preview de ítems (máx 3) */}
          {items.length > 0 && (
            <div style={{
              background: 'var(--ink3)',
              border: '1px solid var(--line2)',
              borderRadius: 10,
              padding: '10px 12px',
              marginBottom: 14,
            }}>
              {items.slice(0, 3).map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  paddingTop: i > 0 ? 6 : 0,
                  borderTop: i > 0 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <div style={{
                    minWidth: 24, height: 24, borderRadius: 5,
                    background: 'var(--ink4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 900, color: 'var(--amber)', flexShrink: 0,
                  }}>
                    {item.qty || 1}
                  </div>
                  <div style={{
                    fontSize: 12, fontWeight: 600, color: 'var(--snow)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {item.name || '?'}
                  </div>
                </div>
              ))}
              {items.length > 3 && (
                <div style={{
                  fontSize: 10, color: 'var(--fog)', marginTop: 6,
                  paddingTop: 5, borderTop: '1px solid rgba(255,255,255,0.04)',
                }}>
                  +{items.length - 3} ítem{items.length - 3 !== 1 ? 's' : ''} más...
                </div>
              )}
            </div>
          )}

          {/* CTA — botón principal */}
          <button
            onClick={onDismiss}
            style={{
              width: '100%', padding: '15px 20px',
              background: 'linear-gradient(135deg, #1e8449, #27ae60)',
              border: '1px solid rgba(46,204,113,0.4)',
              borderRadius: 12, color: '#fff',
              fontSize: 15, fontWeight: 900, letterSpacing: 0.4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              cursor: 'pointer', marginBottom: 14,
              boxShadow: '0 6px 24px rgba(46,204,113,0.3)',
              transition: 'all .18s',
            }}
          >
            <Check size={17}/> Entendido — Ir a Recoger
          </button>
        </div>

        {/* ── Barra de cuenta regresiva ── */}
        <div style={{ height: 3, background: 'var(--line)', overflow: 'hidden' }}>
          <div style={{
            height: '100%',
            background: 'var(--emerald)',
            transformOrigin: 'left',
            animation: `kaBar ${SECS}s linear forwards`,
          }}/>
        </div>

        {/* Segundos restantes */}
        <div style={{
          textAlign: 'center', padding: '6px 0 10px',
          fontFamily: 'var(--mono)', fontSize: 10,
          color: 'var(--fog)', letterSpacing: 1,
        }}>
          Cierra en {remaining}s · Toca fuera para cerrar
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   TURNO HELPERS — nivel módulo
   Usados tanto en App como en TurnoScreen
══════════════════════════════════════════════ */

/**
 * Calcula el timestamp de inicio del turno activo para un mesero.
 * Prioridad: marcador de nuevo turno → clave anclada → medianoche de hoy.
 * Nota: CONSUME y borra 'antojitos_nuevo_turno_ts' si existe (se usa 1 sola vez).
 */
function computeTurnoStart(waiterId) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  if (!waiterId) return hoy;
  const TURNO_KEY = `turno_start_${waiterId}`;
  try {
    const nuevoTs = localStorage.getItem('antojitos_nuevo_turno_ts');
    if (nuevoTs) {
      const d = new Date(nuevoTs);
      localStorage.removeItem('antojitos_nuevo_turno_ts');
      if (!isNaN(d.getTime()) && d >= hoy) {
        localStorage.setItem(TURNO_KEY, d.toISOString());
        return d;
      }
    }
  } catch(_) {}
  try {
    const saved = localStorage.getItem(TURNO_KEY);
    if (saved) { const d = new Date(saved); if (!isNaN(d.getTime()) && d >= hoy) return d; }
  } catch(_) {}
  return hoy;
}

/* ══════════════════════════════════════════════
   ROOT APP
══════════════════════════════════════════════ */
function App() {
  const bizInfo = useBiz(); // nombre del negocio para topbar/footer (Ajustes del admin)
  const [splash,setSplash]         = useState(true);
  // Lazy init: recupera el mesero y carrito desde localStorage.
  // El carrito se carga DESPUÉS de conocer el mesero para rechazar datos de otro usuario.
  const [waiter,setWaiter]         = useState(loadSavedWaiter);
  const [page,setPage]             = useState('mesas');
  const [tables,setTables]         = useState(() => loadSavedCart(loadSavedWaiter()?.id));
  // Perfiles de mesero y distribución de mesas en vivo (los crea el admin en Ajustes).
  // Los componentes leen WAITERS/ZONES al renderizar; estos hooks fuerzan el re-render de App.
  const waitersVersion = useWaitersVersion();
  const layoutVersion  = useMesasLayoutVersion();
  const [selectedTable,setSelectedTable] = useState(null);
  const [showCart,setShowCart]             = useState(false);
  const [showTicket,setShowTicket]         = useState(false);
  const [showPayment,setShowPayment]       = useState(false);
  const [showSuccess,setShowSuccess]       = useState(null);
  // WiFi printer UI eliminado — solo Bluetooth + ventana web como fallback
  const [toasts,setToasts]         = useState([]);
  usePrintersVersion(); // re-renderiza el topbar/modales cuando cambia el registro de impresoras
  const [showPrinters, setShowPrinters] = useState(false);
  const [showCliente, setShowCliente]   = useState(false);
  const [kitchenAlerts,setKitchenAlerts] = useState([]);
  const [accessDenied,setAccessDenied]   = useState(null); // {mesa, owner}
  const [showScan,setShowScan]           = useState(false); // escáner del QR de pedido del cliente
  const [orderStatuses, setOrderStatuses] = useState({}); // orderId → status
  const [notifStatus,   setNotifStatus]   = useState(() => 'Notification' in window ? Notification.permission : 'unsupported');
  const [darkMode,      setDarkMode]      = useState(() => localStorage.getItem('antojitos_theme') === 'dark');

  // ── Estado de Turno — elevado a App para persistir entre cambios de tab ──
  const [ventasTurno,   setVentasTurno]   = useState([]);
  const [turnoStart,    setTurnoStart]    = useState(() => computeTurnoStart(loadSavedWaiter()?.id));

  const waiterRef = useRef(waiter); // ref estable para closures asíncronos (visibilitychange, SW)
  const tablesRef = useRef(tables);
  // Envases descartables: configuración y guardado diferido por mesa
  const packCfg = usePackCfg();
  const packTimersRef = useRef({});

  /* ── Toast ─────────────────── */
  const toast = useCallback((msg,type='info')=>{
    const id = Date.now()+Math.random();
    setToasts(p=>[...p.slice(-3),{id,msg,type}]);
    setTimeout(()=>setToasts(p=>p.filter(t=>t.id!==id)),3500);
  },[]);
  const removeToast = id=>setToasts(p=>p.filter(t=>t.id!==id));

  /* ── Dark Mode Toggle ──────────────────────────────────────────────── */
  const toggleDark = useCallback(()=>{
    document.documentElement.classList.add('color-theme-in-transition');
    setDarkMode(prev=>{
      const next = !prev;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      localStorage.setItem('antojitos_theme', next ? 'dark' : 'light');
      return next;
    });
    setTimeout(()=>document.documentElement.classList.remove('color-theme-in-transition'), 450);
  },[]);

  /* ── Handler para activar/verificar notificaciones del SO ── */
  const handleNotifRequest = useCallback(async () => {
    if (!('Notification' in window)) { toast('Notificaciones no disponibles en este navegador', 'err'); return; }
    if (Notification.permission === 'granted') { toast('🔔 Notificaciones ya activas — recibirás alertas en segundo plano', 'info'); return; }
    if (Notification.permission === 'denied')  { toast('🔕 Notificaciones bloqueadas — actívalas en Ajustes → Sitio → Notificaciones', 'err'); return; }
    try {
      const perm = await Notification.requestPermission();
      setNotifStatus(perm);
      if (perm === 'granted') toast('🔔 Notificaciones activadas — recibirás alertas aunque estés en otra app', 'ok');
      else toast('🔕 Notificaciones bloqueadas — actívalas en los ajustes del navegador', 'err');
    } catch(e) { toast('Error al solicitar notificaciones: ' + e.message, 'err'); }
  }, [toast]);

  /* ── Persistencia del carrito + sync refs ── */
  useEffect(() => { persistCart(tables, waiter?.id); tablesRef.current = tables; }, [tables, waiter]);
  useEffect(() => { waiterRef.current = waiter; }, [waiter]);

  /* ── Turno: fetch inicial + suscripción Realtime SIEMPRE ACTIVA ──────────
     Se monta al login y permanece activo independientemente del tab visible.
     Esto garantiza que cada cobro se captura aunque el tab Turno esté cerrado. */
  useEffect(() => {
    if (!waiter) { setVentasTurno([]); return; }

    let mounted = true;
    const ts = turnoStart;

    // Carga inicial
    _supabase
      .from('ventas_meseros')
      .select('*')
      .eq('mesero_id', waiter.id)
      .gte('fecha_hora', ts.toISOString())
      .order('fecha_hora', { ascending: false })
      .then(({ data, error }) => {
        if (!mounted) return;
        if (error) console.warn('[Turno] fetch inicial:', error.message);
        else setVentasTurno(data || []);
      });

    // Suscripción única para todo el turno
    const ch = _supabase
      .channel(`app-turno-${waiter.id}-${ts.getTime()}`)
      .on('postgres_changes',
        // Filtro en el SERVIDOR: Supabase solo envía a este teléfono las ventas
        // de ESTE mesero (antes llegaban las de todos y se descartaban aquí —
        // tráfico/egress desperdiciado por cada cobro de cada mesero).
        { event: 'INSERT', schema: 'public', table: 'ventas_meseros', filter: `mesero_id=eq.${waiter.id}` },
        payload => {
          if (!mounted || payload.new?.mesero_id !== waiter.id) return;
          const ventaTime = new Date(payload.new.fecha_hora || Date.now());
          if (ventaTime < ts) return;

          setVentasTurno(prev => {
            // Eliminar entrada optimista correspondiente (misma mesa, mismo
            // método, ±30 s). Compara también metodo_pago — necesario desde el
            // pago dividido: una sola mesa puede insertar varias filas casi
            // simultáneas (una por método) y sin este campo la primera en
            // llegar borraría de golpe las demás entradas optimistas antes de
            // que su contraparte real llegara (parpadeo del total del turno).
            const DEDUP = 30_000;
            const filtered = prev.filter(v => !(
              v._opt === true &&
              v.mesa_nro === payload.new.mesa_nro &&
              v.metodo_pago === payload.new.metodo_pago &&
              Math.abs(new Date(v.fecha_hora) - ventaTime) < DEDUP
            ));
            // Evitar duplicado si ya existe el ID real de Supabase
            if (filtered.some(v => v.id === payload.new.id)) return filtered;
            return [payload.new, ...filtered];
          });
        }
      )
      .subscribe();

    return () => { mounted = false; _supabase.removeChannel(ch); };
  }, [waiter?.id, turnoStart.getTime()]);

  /* ── Limpieza al cerrar sesión (chip u otro camino) ──
     Cuando el mesero sale, resetear mesas en memoria y borrar el carrito del
     localStorage para que la próxima sesión arranque siempre desde cero.
     Los pedidos enviados a cocina se recuperarán desde Supabase al re-ingresar. */
  useEffect(() => {
    if (!waiter) {
      setTables(mkTables());
      try {
        localStorage.removeItem(CART_KEY);
        localStorage.removeItem(CART_OWNER_KEY);
      } catch(_) {}
    }
  }, [waiter]);

  /* ── Inventario en vivo — precio, imagen y disponibilidad que edita el
     Admin en Stock (AdminDashboard → Stock) se reflejan aquí al instante,
     sin recargar la app. invMap: { [menuId]: {available, price, img, stock} }.
     Envuelto en try/catch: si Supabase no responde o la tabla no existe aún,
     la app sigue funcionando con los precios/imágenes por defecto del menú. */
  const [invMap, setInvMap] = useState({});
  useEffect(() => {
    let mounted = true;

    // Postgres puede omitir del payload columnas grandes (TOAST, como la
    // imagen en base64 de img_url) que no cambiaron en ESE update puntual
    // (p.ej. marcar "agotado" solo cambia `available`). Por eso solo se
    // incluyen aquí las claves que realmente vienen en `r`, y se hace merge
    // sobre el valor previo — nunca se reemplaza el plato entero, para no
    // borrar la imagen del estado local aunque en la base siga intacta.
    const applyRow = (r) => {
      if (!r || r.menu_id == null) return;
      const partial = {};
      if ('available' in r) partial.available = r.available ?? true;
      if ('price'     in r) partial.price     = r.price != null ? Number(r.price) : null;
      if ('img_url'   in r) partial.img       = r.img_url || null;
      if ('stock'     in r) partial.stock     = r.stock ?? null;
      if ('hidden'    in r) partial.hidden    = r.hidden ?? false;
      setInvMap(prev => ({
        ...prev,
        [r.menu_id]: { ...(prev[r.menu_id] || {}), ...partial },
      }));
    };

    (async () => {
      try {
        const { data, error } = await _supabase.from('inventory').select('*');
        if (!mounted || error || !data) return;
        const map = {};
        data.forEach(r => {
          if (r.menu_id == null) return;
          map[r.menu_id] = {
            available: r.available ?? true,
            price:     r.price != null ? Number(r.price) : null,
            img:       r.img_url || null,
            stock:     r.stock ?? null,
            hidden:    r.hidden ?? false,
          };
        });
        setInvMap(map);
      } catch (e) {
        console.warn('[Inventory] fetch inicial falló:', e?.message);
      }
    })();

    let ch;
    try {
      ch = _supabase
        .channel(`app-inventory-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, payload => {
          try { applyRow(payload.new); } catch (e) { console.warn('[Inventory] realtime:', e?.message); }
        })
        .subscribe();
    } catch (e) {
      console.warn('[Inventory] suscripción realtime falló:', e?.message);
    }

    return () => { mounted = false; if (ch) _supabase.removeChannel(ch); };
  }, []);

  /* ── Catálogo dinámico — platos/bebidas creados desde AdminDashboard →
     Stock → "Agregar plato". Aparecen en su categoría automáticamente y se
     actualizan/eliminan en vivo. Envuelto en try/catch: si la tabla
     menu_items aún no existe, el mesero simplemente no ve platos nuevos
     (el menú de los 17 platos originales sigue funcionando igual). */
  const [customItems, setCustomItems] = useState([]);
  // Categorías reales del menú — para asignarlas a una impresora en el panel de Impresoras
  const printerCats = useMemo(() => [...new Set(customItems.map(ci => ci.cat).filter(Boolean))], [customItems]);
  const mapMenuItemRow = (r) => ({
    id: r.id, cat: r.cat, name: r.name, price: Number(r.price) || 0,
    img: r.img_url || null, description: r.description || null,
    available: r.available ?? true,
    stock: r.stock ?? null, // null = sin límite (∞)
    variants: normalizeVariants(r.variants), // tamaños (Fuente P./M./G.) — [] = precio único
  });
  // Versión parcial para eventos UPDATE — mismo motivo que applyRow arriba:
  // no reemplazar el plato completo para no perder img_url si Postgres omitió
  // esa columna del payload por ser TOAST y no haber cambiado en ese update.
  const mapMenuItemRowPartial = (r) => {
    const out = { id: r.id };
    if ('cat'         in r) out.cat         = r.cat;
    if ('name'        in r) out.name        = r.name;
    if ('price'       in r) out.price       = Number(r.price) || 0;
    if ('img_url'     in r) out.img         = r.img_url || null;
    if ('description' in r) out.description = r.description || null;
    if ('available'   in r) out.available   = r.available ?? true;
    if ('stock'       in r) out.stock       = r.stock ?? null;
    if ('variants'    in r) out.variants    = normalizeVariants(r.variants);
    return out;
  };
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data, error } = await _supabase.from('menu_items').select('*');
        if (!mounted || error || !data) return;
        setCustomItems(data.map(mapMenuItemRow));
      } catch (e) {
        console.warn('[MenuItems] fetch inicial falló:', e?.message);
      }
    })();

    let ch;
    try {
      ch = _supabase
        .channel(`app-menu-items-${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'menu_items' }, payload => {
          try {
            const item = mapMenuItemRow(payload.new);
            setCustomItems(prev => prev.find(i => i.id === item.id) ? prev : [...prev, item]);
          } catch (e) { console.warn('[MenuItems] realtime insert:', e?.message); }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'menu_items' }, payload => {
          try {
            const partial = mapMenuItemRowPartial(payload.new);
            setCustomItems(prev => prev.map(i => i.id === partial.id ? { ...i, ...partial } : i));
          } catch (e) { console.warn('[MenuItems] realtime update:', e?.message); }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'menu_items' }, payload => {
          try {
            const oldId = payload.old && payload.old.id;
            if (oldId) setCustomItems(prev => prev.filter(i => i.id !== oldId));
          } catch (e) { console.warn('[MenuItems] realtime delete:', e?.message); }
        })
        .subscribe();
    } catch (e) {
      console.warn('[MenuItems] suscripción realtime falló:', e?.message);
    }

    return () => { mounted = false; if (ch) _supabase.removeChannel(ch); };
  }, []);

  /* ── Estado global de Caja — abierta/cerrada, compartido con AdminDashboard
     → Caja. Arma el carrito SIEMPRE está permitido; solo bloquea el botón
     "Enviar a Cocina" cuando la caja está cerrada. Por defecto cajaAbierta
     = true: si la tabla `caja_estado` aún no existe (migración pendiente) o
     Supabase no responde, no se bloquea nada — comportamiento previo intacto. */
  const [cajaAbierta, setCajaAbierta] = useState(true);
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data, error } = await _supabase.from('caja_estado').select('*').eq('id', 1).maybeSingle();
        if (!mounted || error || !data) return;
        setCajaAbierta(!!data.is_open);
      } catch (e) {
        console.warn('[Caja] fetch inicial falló:', e?.message);
      }
    })();

    let ch;
    try {
      ch = _supabase
        .channel(`app-caja-estado-${Date.now()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'caja_estado' }, payload => {
          try { if (payload.new) setCajaAbierta(!!payload.new.is_open); }
          catch (e) { console.warn('[Caja] realtime:', e?.message); }
        })
        .subscribe();
    } catch (e) {
      console.warn('[Caja] suscripción realtime falló:', e?.message);
    }

    return () => { mounted = false; if (ch) _supabase.removeChannel(ch); };
  }, []);

  /* ── Datos del negocio (nombre, RUC/DNI, Yape + QR) — los edita el admin en
     Ajustes. Carga inicial + cambios en vivo. Envuelto en try/catch como el
     resto de lecturas opcionales: si la tabla `negocio_config` aún no existe
     (migración pendiente) o Supabase no responde, BIZ conserva sus valores por
     defecto/locales y todo imprime como siempre. */
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data, error } = await _supabase.from('negocio_config').select('*').eq('id', 1).maybeSingle();
        if (!mounted || error || !data) return;
        applyBizRow(data);
      } catch (e) {
        console.warn('[Negocio] fetch inicial falló:', e?.message);
      }
    })();

    let ch;
    try {
      ch = _supabase
        .channel(`app-negocio-config-${Date.now()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'negocio_config' }, payload => {
          try { applyBizRow(payload.new); }
          catch (e) { console.warn('[Negocio] realtime:', e?.message); }
        })
        .subscribe();
    } catch (e) {
      console.warn('[Negocio] suscripción realtime falló:', e?.message);
    }

    return () => { mounted = false; if (ch) _supabase.removeChannel(ch); };
  }, []);

  /* ── Mesas nuevas: el estado local (carritos por mesa) se ajusta a la distribución vigente.
     Agrega la entrada de cada mesa nueva; una mesa que ya no existe solo se conserva si
     tiene un pedido en curso (nunca se pierde un carrito). Si nada cambió, no toca nada. */
  useEffect(() => {
    setTables(prev => {
      const byId = new Map(prev.map(t => [t.id, t]));
      const next = TABLE_LAYOUT.map(({ n }) => byId.get(n) || mkTable(n));
      prev.forEach(t => {
        if (!TABLE_LAYOUT.some(x => x.n === t.id) && (t.occupied || (t.items && t.items.length))) next.push(t);
      });
      const same = next.length === prev.length && next.every((t, i) => t === prev[i]);
      return same ? prev : next;
    });
  }, [layoutVersion]);

  /* ── Perfiles de meseros (tabla `meseros`) y distribución de mesas (tabla `mesas`) —
     los crea el admin en AdminDashboard → Ajustes. Carga inicial + cambios en vivo.
     Cada tabla va en su PROPIO canal: si una migración no se corrió y una tabla no
     está disponible, no arrastra a la otra. Todo envuelto en try/catch como el resto
     de lecturas opcionales — si falla, WAITERS/ZONES conservan sus valores por defecto
     o de la copia local y la app funciona como siempre. Al volver a la pestaña se
     vuelve a leer (Realtime no reenvía lo que pasó con el teléfono bloqueado). */
  useEffect(() => {
    let mounted = true;

    const loadWaiters = async () => {
      try {
        const { data, error } = await _supabase.from('meseros').select('*').order('sort_order').order('created_at');
        if (!mounted || error || !data) return;
        applyWaiterRows(data);
      } catch (e) { console.warn('[Meseros] fetch falló:', e?.message); }
    };
    const loadLayout = async () => {
      try {
        let res = await _supabase.from('mesas').select('numero_mesa, zona').order('numero_mesa');
        // Si aún no existe la columna `zona` (migración pendiente) se lee solo el número
        if (res.error) res = await _supabase.from('mesas').select('numero_mesa').order('numero_mesa');
        if (!mounted || res.error || !res.data) return;
        applyMesasRows(res.data);
      } catch (e) { console.warn('[Mesas] fetch de distribución falló:', e?.message); }
    };
    loadWaiters();
    loadLayout();

    const chans = [];
    try {
      chans.push(_supabase
        .channel(`app-meseros-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'meseros' }, () => loadWaiters())
        .subscribe());
    } catch (e) { console.warn('[Meseros] suscripción realtime falló:', e?.message); }
    try {
      chans.push(_supabase
        .channel(`app-mesas-layout-${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mesas' }, () => loadLayout())
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'mesas' }, () => loadLayout())
        .subscribe());
    } catch (e) { console.warn('[Mesas] suscripción realtime falló:', e?.message); }

    // Throttle: el mesero bloquea/desbloquea el teléfono decenas de veces por
    // turno y cada vez se releían ambas tablas. Perfiles y distribución de
    // mesas casi nunca cambian (y Realtime los trae en vivo), así que basta
    // con releer como máximo cada 2 minutos.
    let lastVisibleLoad = Date.now();
    const onVisible = () => {
      if (document.hidden) return;
      if (Date.now() - lastVisibleLoad < 120_000) return;
      lastVisibleLoad = Date.now();
      loadWaiters(); loadLayout();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisible);
      chans.forEach(c => { try { _supabase.removeChannel(c); } catch (_) {} });
    };
  }, []);

  /* ── Mi perfil cambió en Ajustes (nombre / color): la sesión abierta se actualiza sola.
     La sesión guarda una COPIA del perfil tomada al iniciar turno; sin esto, un mesero
     con el turno abierto seguiría escribiendo el nombre viejo en sus mesas, tickets y
     ventas hasta volver a entrar. Se enlaza por id (el nombre puede cambiar). Al cambiar
     el objeto `waiter`, el efecto de sincronización de mesas de abajo se vuelve a ejecutar
     y re-adopta mis mesas con el nombre nuevo. El admin no permite renombrar a un mesero
     con mesas abiertas, así que aquí no hay mesas que reasignar. */
  useEffect(() => {
    if (!waiter) return;
    const f = WAITERS.find(w => w.id === waiter.id);
    if (!f || (f.name === waiter.name && f.color === waiter.color && f.initial === waiter.initial)) return;
    const nw = { ...waiter, name: f.name, color: f.color, bg: f.bg, initial: f.initial };
    setWaiter(nw);
    persistWaiter(nw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitersVersion]);

  /* ── Supabase Realtime — sincronización de mesas entre meseros ── */
  useEffect(() => {
    let cancelled = false;

    /* Carga inicial + recuperación de pedidos activos */
    const syncMesas = async () => {
      try {
        const { data } = await _supabase.from('mesas').select('*').order('numero_mesa');
        if (cancelled || !data) return;

        setTables(prev => prev.map(t => {
          const m = data.find(r => r.numero_mesa === t.id);
          if (!m) return t;
          if (m.estado === 'libre') {
            if (t.waiterId && waiter && t.waiterId === waiter.id && !t.joinedTo) return t;
            return { ...t, occupied: false, waiterId: null, waiterName: null, waiterColor: null, ...(t.joinedTo ? { items: [], rounds: [], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, openAt: null, joinedTo: null } : {}) };
          }
          if (m.estado === 'ocupada') {
            const isMine = waiter && m.mesero_nombre === waiter.name;
            if (isMine) {
              /* CRITICAL FIX: restaurar waiterId real para que handleCloseTable
                 funcione correctamente tras recargar la página o volver a iniciar
                 sesión. Sin esto, waiterId queda como 'ext-Nombre' (string) en lugar
                 del id numérico del mesero, bloqueando el cierre de mesa. */
              return {
                ...t,
                waiterId:    waiter.id,
                waiterName:  waiter.name,
                waiterColor: waiter.color,
                occupied:    true,
              };
            }
            return {
              ...t, occupied: true,
              waiterId:    m.mesero_nombre ? `ext-${m.mesero_nombre}` : t.waiterId,
              waiterName:  m.mesero_nombre || null,
              waiterColor: m.mesero_color  || null,
            };
          }
          return t;
        }));
        setTables(prev => applyMesaJoins(prev, data));

        /* Recuperar ítems desde Supabase si el carrito local está vacío.
           Ocurre cuando el mesero regresa después de que el navegador limpió
           el localStorage, o tras un cierre accidental de la pestaña. */
        if (waiter) {
          const myMesas = data.filter(
            m => m.estado === 'ocupada' && m.mesero_nombre === waiter.name
          );
          if (myMesas.length > 0) {
            const recovered = await recoverActiveOrders(waiter.id);
            if (cancelled || !Object.keys(recovered).length) return;
            setTables(prev => prev.map(t => {
              const rec = recovered[t.id];
              if (!rec) return t;
              // Si ya hay ítems locales, sólo sincronizar el orderId si falta,
              // y rellenar `rounds` desde Supabase si el localStorage es de una
              // sesión previa a esta función (no traía historial de rondas).
              if (t.items && t.items.length > 0) {
                const needsOrderId = !t.supabaseOrderId;
                const needsRounds  = (!t.rounds || !t.rounds.length) && rec.rounds && rec.rounds.length;
                if (!needsOrderId && !needsRounds) return t;
                return {
                  ...t,
                  supabaseOrderId: t.supabaseOrderId || rec.orderId,
                  rounds:          needsRounds ? rec.rounds : (t.rounds || []),
                };
              }
              // Carrito vacío → restaurar ítems, rondas y orderId desde Supabase
              return {
                ...t,
                items:           rec.items,
                rounds:          rec.rounds || [],
                supabaseOrderId: rec.orderId,
                occupied:        true,
                waiterId:        waiter.id,
              };
            }));

            // Fetch del estado actual de los pedidos recuperados (badge en tarjeta de mesa)
            const orderIds = Object.values(recovered).map(r => r.orderId).filter(Boolean);
            if (orderIds.length && !cancelled) {
              fetchOrdersPackaging(orderIds).then(pm => {
                if (cancelled || !Object.keys(pm).length) return;
                setTables(prev => prev.map(t => {
                  const r = t.supabaseOrderId && pm[t.supabaseOrderId];
                  // Solo si no hay un cambio local sin guardar
                  if (!r || clampPackaging(t.packaging) !== clampPackaging(t.packagingSaved)) return t;
                  return { ...t, packaging: r.count, packagingSaved: r.count, packagingUnit: r.unit };
                }));
              });
              _supabase.from('orders').select('id, status').in('id', orderIds)
                .then(({ data: oData }) => {
                  if (!oData || cancelled) return;
                  const map = {};
                  oData.forEach(o => { map[o.id] = o.status; });
                  setOrderStatuses(prev => ({ ...prev, ...map }));
                }).catch(() => {});
            }
          }
        }
      } catch(err) {
        console.warn('mesas-load:', err);
      }
    };

    syncMesas();

    // Suscripción Realtime — cambios de otros meseros
    const channel = _supabase
      .channel('mesas-sync-mesero')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mesas' }, payload => {
        if (!payload.new) return;
        const { numero_mesa, estado, mesero_nombre, mesero_color } = payload.new;
        const unidaA = Number.isInteger(payload.new.unida_a) ? payload.new.unida_a : null;
        setTables(prev => prev.map(t => {
          if (t.id !== numero_mesa) return t;
          if (estado === 'libre') {
            // Si es MI mesa, no la libero por Realtime (handlePayment ya actualizó local)
            // — salvo que fuera una mesa UNIDA (no tiene pedido propio).
            if (waiter && t.waiterId === waiter.id && !t.joinedTo) return t;
            return { ...t, occupied: false, waiterId: null, waiterName: null, waiterColor: null, items: [], rounds: [], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, openAt: null, joinedTo: null };
          }
          if (estado === 'ocupada') {
            const isMine = waiter && mesero_nombre === waiter.name;
            if (isMine) {
              // Mesa unida a una mía (p. ej. desde mi otro celular): marcarla como mía
              if (unidaA && !t.occupied) return { ...t, occupied: true, waiterId: waiter.id, waiterName: waiter.name, waiterColor: waiter.color };
              return t; // No sobreescribir mi propio estado local
            }
            return {
              ...t, occupied: true,
              waiterId:    mesero_nombre ? `ext-${mesero_nombre}` : t.waiterId,
              waiterName:  mesero_nombre || null,
              waiterColor: mesero_color  || null,
            };
          }
          return t;
        }));
        setTables(prev => applyMesaJoins(prev, [{ numero_mesa, unida_a: unidaA }]));
      })
      .subscribe();

    return () => { cancelled = true; _supabase.removeChannel(channel); };
  }, [waiter, layoutVersion]); // Se re-ejecuta cuando el mesero inicia sesión o cambia la distribución de mesas

  /* ── Kitchen Realtime — notifica al mesero cuando su pedido está listo ── */
  useEffect(() => {
    if (!waiter) return;
    const ch = _supabase
      .channel(`orders-ready-${waiter.id}`)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `waiter_id=eq.${waiter.id}` },
        payload => {
          const ord = payload.new;
          if (!ord) return;

          // Estado del pedido (badge de la tarjeta de mesa). Antes vivía en un
          // canal aparte (`ord-status-…`) con el MISMO filtro: cada cambio de un
          // pedido viajaba dos veces al teléfono. Ahora llega una sola vez.
          setOrderStatuses(prev => ({ ...prev, [ord.id]: ord.status }));

          // Anulado por el administrador: liberar la mesa en este celular
          if (ord.status === 'anulado') {
            setTables(prev => prev.map(t => t.supabaseOrderId === ord.id
              ? { ...t, items: [], rounds: [], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, occupied: false, waiterId: null, waiterName: null, waiterColor: null, openAt: null, supabaseOrderId: null }
              : t));
            setKitchenAlerts(prev => prev.filter(a => a.orderId !== ord.id));
            toast(`🚫 Mesa ${ord.table_number} — pedido anulado por administración`, 'err');
            return;
          }

          // Sincroniza SIEMPRE el historial de rondas de la mesa (independiente
          // del estado agregado) para que el indicativo "Ronda 1 Lista / Ronda 2
          // pendiente" del carrito se actualice en vivo según avanza cocina.
          // Nunca se toca `items` aquí — el carrito local es la fuente de verdad
          // mientras el mesero sigue agregando productos aún no enviados.
          if (Array.isArray(ord.rounds)) {
            setTables(prev => prev.map(t => {
              if (t.id !== ord.table_number || t.supabaseOrderId !== ord.id) return t;
              const prevRounds = t.rounds || [];
              const justReady = ord.rounds.filter(r => {
                const before = prevRounds.find(p => p.n === r.n);
                return r.status === 'listo' && before && before.status !== 'listo';
              });
              // Si el pedido completo AÚN no está listo (quedan más rondas en
              // curso), solo un aviso liviano — la campana completa se reserva
              // para cuando TODA la mesa está lista (más abajo).
              if (justReady.length && ord.status !== 'ready') {
                justReady.forEach(r => toast(`✅ Mesa ${ord.table_number} — Ronda ${r.n} lista para servir`, 'ok'));
              }
              return { ...t, rounds: ord.rounds };
            }));
          }

          if (ord.status !== 'ready') return;
          // Ya aceptado antes (o ya avisado en esta sesión) → no repetir
          const sig = kitchenAlertSig(ord);
          if (!claimKitchenAlert(waiter.id, sig)) return;
          playKitchenBell();
          speakKitchenReady(ord.table_number, waiter?.name);
          setKitchenAlerts(prev => [
            ...prev.filter(a => a.orderId !== ord.id),
            {
              id: Date.now(), orderId: ord.id, sig,
              mesa: ord.table_number, zone: ord.zone || 'General',
              items: Array.isArray(ord.items) ? ord.items : [],
              total: ord.total || 0,
            },
          ]);
          toast(`🔔 Mesa ${ord.table_number} — ¡Tu pedido está listo! Ve a recogerlo.`, 'ok');

          // ── Web Notification — funciona con la pestaña en segundo plano ──
          if ('Notification' in window && Notification.permission === 'granted') {
            const previewItems = Array.isArray(ord.items)
              ? ord.items.slice(0,3).map(i=>`${i.qty||1}× ${i.name}`).join(' · ')
              : '';
            try {
              const n = new Notification(`🔔 Mesa ${ord.table_number} — Pedido listo`, {
                body: previewItems || `${waiter.name}: el pedido está listo para servir.`,
                icon: 'img/logo/logo.png',
                tag : `kitchen-ready-${ord.id}`,
                renotify: true,
                requireInteraction: true,
                silent: false,
              });
              n.onclick = () => { window.focus(); n.close(); };
            } catch(_) {}
          }

          // ── Enviar al SW para notificación nativa (pantalla bloqueada / segundo plano) ──
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
              if (reg?.active) reg.active.postMessage({
                type: 'KITCHEN_READY',
                mesa: ord.table_number, zone: ord.zone || 'General',
                waiterName: waiter?.name, orderId: ord.id, sig,
                items: Array.isArray(ord.items) ? ord.items.slice(0,3) : [],
              });
            }).catch(() => {});
          }
        }
      )
      // ── Para Llevar: sin waiter_id, escucha por zona ──
      // Notifica cuando el cocinero marca kitchen_status='ready' (no cuando se paga)
      // Filtro en el SERVIDOR (kitchen_status=ready): antes este binding no
      // tenía filtro y CADA cambio de CUALQUIER pedido (de todos los meseros,
      // cocina y caja) llegaba completo a cada teléfono solo para descartarse
      // aquí. Ahora solo llegan los pedidos que cocina marcó como listos.
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'kitchen_status=eq.ready' },
        payload => {
          const ord = payload.new;
          if (!ord || ord.kitchen_status !== 'ready' || ord.zone !== 'Para Llevar') return;
          const sig = kitchenAlertSig(ord);
          if (!claimKitchenAlert(waiter.id, sig)) return; // ya aceptado / ya avisado
          let info = {};
          try { info = JSON.parse(ord.notes || '{}'); } catch(_) {}
          const customerName = info.customerName || 'Cliente';
          playKitchenBell();
          speakTakeawayReady(customerName);
          setKitchenAlerts(prev => [
            ...prev.filter(a => a.orderId !== ord.id),
            {
              id: Date.now(), orderId: ord.id, sig,
              mesa: 0, zone: 'Para Llevar',
              customerName,
              items: Array.isArray(ord.items) ? ord.items : [],
              total: ord.total || 0,
            },
          ]);
          toast(`🥡 ${customerName} — ¡Pedido Para Llevar listo! Favor de recoger y entregar.`, 'ok');
          if ('Notification' in window && Notification.permission === 'granted') {
            const previewItems = Array.isArray(ord.items)
              ? ord.items.slice(0,3).map(i=>`${i.qty||1}× ${i.name}`).join(' · ')
              : '';
            try {
              const n = new Notification(`🥡 ${customerName} — Para Llevar listo`, {
                body: previewItems || `El pedido para llevar de ${customerName} está listo.`,
                icon: 'img/logo/logo.png',
                tag : `takeaway-ready-${ord.id}`,
                renotify: true,
                requireInteraction: true,
                silent: false,
              });
              n.onclick = () => { window.focus(); n.close(); };
            } catch(_) {}
          }
          // ── SW: notificación nativa para Para Llevar (pantalla bloqueada) ──
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
              if (reg?.active) reg.active.postMessage({
                type: 'KITCHEN_READY',
                mesa: 0, zone: 'Para Llevar',
                customerName, waiterName: waiter?.name, orderId: ord.id, sig,
                items: Array.isArray(ord.items) ? ord.items.slice(0,3) : [],
              });
            }).catch(() => {});
          }
        }
      )
      // ── Delivery / Recojo en Local: notifica cuando el cocinero marca 'Listo' ──
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: 'kitchen_status=eq.ready' },
        payload => {
          const ord = payload.new;
          if (!ord || ord.kitchen_status !== 'ready') return;
          if (!['Delivery', 'Recojo en Local'].includes(ord.zone)) return;
          const sig = kitchenAlertSig(ord);
          if (!claimKitchenAlert(waiter.id, sig)) return; // ya aceptado / ya avisado
          let info = {};
          try { info = JSON.parse(ord.notes || '{}'); } catch(_) {}
          const customerName = info.customerName || 'Cliente';
          const zoneIcon     = ord.zone === 'Delivery' ? '🛵' : '🏪';
          playKitchenBell();
          speakExternalReady(customerName, ord.zone);
          setKitchenAlerts(prev => [
            ...prev.filter(a => a.orderId !== ord.id),
            {
              id: Date.now(), orderId: ord.id, sig,
              mesa: 0, zone: ord.zone,
              customerName,
              items: Array.isArray(ord.items) ? ord.items : [],
              total: ord.total || 0,
            },
          ]);
          toast(`${zoneIcon} ${customerName} — ¡${ord.zone} listo! Favor de entregar.`, 'ok');
          if ('Notification' in window && Notification.permission === 'granted') {
            const previewItems = Array.isArray(ord.items)
              ? ord.items.slice(0,3).map(i=>`${i.qty||1}× ${i.name}`).join(' · ')
              : '';
            try {
              const n = new Notification(`${zoneIcon} ${customerName} — ${ord.zone} listo`, {
                body: previewItems || `El pedido de ${ord.zone} para ${customerName} está listo para entregar.`,
                icon: 'img/logo/logo.png',
                tag : `external-ready-${ord.id}`,
                renotify: true,
                requireInteraction: true,
                silent: false,
              });
              n.onclick = () => { window.focus(); n.close(); };
            } catch(_) {}
          }
          // ── SW: notificación nativa para Delivery/Recojo (pantalla bloqueada) ──
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.then(reg => {
              if (reg?.active) reg.active.postMessage({
                type: 'KITCHEN_READY',
                mesa: 0, zone: ord.zone,
                customerName, waiterName: waiter?.name, orderId: ord.id, sig,
                items: Array.isArray(ord.items) ? ord.items.slice(0,3) : [],
              });
            }).catch(() => {});
          }
        }
      )
      .subscribe();
    return () => _supabase.removeChannel(ch);
  }, [waiter, toast]);

  /* ── Sincroniza notifStatus cuando el mesero inicia sesión ── */
  useEffect(() => {
    if (waiter && 'Notification' in window) setNotifStatus(Notification.permission);
  }, [waiter]);

  /* ── Cambios de estado de los pedidos del mesero: se manejan en el canal
     `orders-ready-…` de arriba (mismo filtro waiter_id) — un solo canal. ── */

  /* ── Visibilidad: re-sync completo al volver a la pestaña ───────────────────────
     Corrige el estado obsoleto cuando el WebSocket de Supabase se interrumpió en
     segundo plano (pantalla bloqueada, otra app, otra pestaña). Tres pasos:
       1. Re-sync de estados de mesas vía REST (independiente del WS)
       2. Re-fetch de estados de pedidos activos
       3. Detección de pedidos "ready" que el mesero perdió mientras estaba fuera
  ── */
  useEffect(() => {
    if (!waiter) return;

    // Throttle: un re-sync completo son 3 consultas. Si el teléfono se
    // desbloquea varias veces seguidas no hace falta repetirlo cada vez —
    // como máximo una vez cada 20 s (Realtime cubre lo que pasa en medio).
    let lastResync = 0;
    const handleVisibility = async () => {
      if (document.visibilityState !== 'visible') return;

      // Paso 0 — Sincronizar permisos de notificación
      if ('Notification' in window) setNotifStatus(Notification.permission);

      if (Date.now() - lastResync < 20_000) return;
      lastResync = Date.now();

      const w = waiterRef.current;
      if (!w) return;

      try {
        // Paso 1 — Re-sync completo de mesas (cubre eventos WS perdidos en segundo plano)
        const { data: mesasData } = await _supabase.from('mesas').select('*').order('numero_mesa');
        if (mesasData) {
          setTables(prev => prev.map(t => {
            const m = mesasData.find(r => r.numero_mesa === t.id);
            if (!m) return t;
            if (m.estado === 'libre') {
              // Nunca liberar una mesa que yo tenga con ítems activos
              if (t.waiterId === w.id && t.items?.length > 0) return t;
              return { ...t, occupied: false, waiterId: null, waiterName: null, waiterColor: null, items: [], rounds: [], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, openAt: null, supabaseOrderId: null, joinedTo: null };
            }
            if (m.estado === 'ocupada') {
              const isMine = m.mesero_nombre === w.name;
              if (isMine) return { ...t, waiterId: w.id, waiterName: w.name, waiterColor: w.color, occupied: true };
              // Mesa de otro mesero — no sobreescribir si es mía localmente
              if (t.waiterId === w.id) return t;
              return { ...t, occupied: true, waiterId: m.mesero_nombre ? `ext-${m.mesero_nombre}` : t.waiterId, waiterName: m.mesero_nombre || null, waiterColor: m.mesero_color || null };
            }
            return t;
          }));
          setTables(prev => applyMesaJoins(prev, mesasData));
        }

        // Paso 2 — Re-fetch de estados de pedidos del mesero
        const myOrderIds = tablesRef.current
          .filter(t => t.waiterId === w.id && t.supabaseOrderId)
          .map(t => t.supabaseOrderId).filter(Boolean);
        if (myOrderIds.length) {
          const { data: ordData } = await _supabase.from('orders').select('id, status').in('id', myOrderIds);
          fetchOrdersDescuento(myOrderIds).then(dm => {
            if (!Object.keys(dm).length) return;
            setTables(prev => prev.map(t => {
              if (!t.supabaseOrderId || !(t.supabaseOrderId in dm)) return t;
              return sameDesc(t.descuento || null, dm[t.supabaseOrderId]) ? t : { ...t, descuento: dm[t.supabaseOrderId] };
            }));
          });
          fetchOrdersPackaging(myOrderIds).then(pm => {
            if (!Object.keys(pm).length) return;
            setTables(prev => prev.map(t => {
              const r = t.supabaseOrderId && pm[t.supabaseOrderId];
              if (!r || clampPackaging(t.packaging) !== clampPackaging(t.packagingSaved)) return t;
              if (r.count === clampPackaging(t.packaging) && r.unit === (t.packagingUnit ?? null)) return t;
              return { ...t, packaging: r.count, packagingSaved: r.count, packagingUnit: r.unit };
            }));
          });
          if (ordData) {
            const map = {};
            ordData.forEach(o => { map[o.id] = o.status; });
            setOrderStatuses(prev => ({ ...prev, ...map }));
            // Pedidos anulados mientras el mesero estaba fuera: liberar sus mesas
            const anulados = new Set(ordData.filter(o => o.status === 'anulado').map(o => o.id));
            if (anulados.size) {
              setTables(prev => prev.map(t => anulados.has(t.supabaseOrderId)
                ? { ...t, items: [], rounds: [], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, occupied: false, waiterId: null, waiterName: null, waiterColor: null, openAt: null, supabaseOrderId: null }
                : t));
              setKitchenAlerts(prev => prev.filter(a => !anulados.has(a.orderId)));
              toast(`🚫 ${anulados.size === 1 ? 'Un pedido fue anulado' : `${anulados.size} pedidos fueron anulados`} por administración`, 'err');
            }
          }
        }

        // Paso 3 — Detectar pedidos "ready" que se perdieron mientras el WS estaba inactivo
        // Se pide `rounds` para calcular la misma firma que Realtime; si la
        // columna aún no existe, se reintenta sin ella (firma = pedido#0).
        let { data: readyOrders, error: readyErr } = await _supabase
          .from('orders')
          .select('id, table_number, zone, items, total, notes, rounds')
          .eq('waiter_id', w.id)
          .eq('status', 'ready');
        if (readyErr && /rounds/i.test(readyErr.message || '')) {
          ({ data: readyOrders } = await _supabase
            .from('orders')
            .select('id, table_number, zone, items, total, notes')
            .eq('waiter_id', w.id)
            .eq('status', 'ready'));
        }
        // Solo los que el mesero NO aceptó todavía (ni se avisaron en esta sesión)
        const pendingReady = (readyOrders || []).filter(ord => claimKitchenAlert(w.id, kitchenAlertSig(ord)));
        if (pendingReady.length) {
          playKitchenBell();
          setKitchenAlerts(prev => {
            const existingIds = new Set(prev.map(a => a.orderId));
            const missed = pendingReady.filter(ord => !existingIds.has(ord.id));
            if (!missed.length) return prev;
            return [
              ...prev,
              ...missed.map(ord => ({
                id:      Date.now() + Math.random(),
                orderId: ord.id,
                sig:     kitchenAlertSig(ord),
                mesa:    ord.table_number,
                zone:    ord.zone || 'General',
                items:   Array.isArray(ord.items) ? ord.items : [],
                total:   ord.total || 0,
              })),
            ];
          });
        }
      } catch(e) {
        console.warn('[visibilitychange] error de sincronización:', e);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [waiter]);

  /* ── Derived ───────────────── */
  const currentTable = useMemo(()=>tables.find(t=>t.id===selectedTable),[tables,selectedTable]);
  const cartCount    = useMemo(()=>(currentTable?.items||[]).reduce((s,i)=>s+i.qty,0),[currentTable]);
  const zone         = useMemo(()=>ZONES.find(z=>selectedTable&&z.tables.includes(selectedTable))?.name||'General',[selectedTable]);
  const occupiedCount= useMemo(()=>tables.filter(t=>t.occupied).length,[tables]);

  /* ── Select table ────────────── */
  const handleSelectTable = tid0 => {
    let tid = tid0;
    const t0 = tables.find(x=>x.id===tid0);
    if (t0 && t0.joinedTo && tables.some(x => x.id === t0.joinedTo)) {
      tid = t0.joinedTo;
      toast(`Mesa ${tid0} unida a la Mesa ${tid}`, 'info');
    }
    setSelectedTable(tid);
    const t = tables.find(x=>x.id===tid);
    if (!t) return;
    if(t.occupied && t.waiterId !== waiter.id) {
      const name = t.waiterName || WAITERS.find(w=>w.id===t.waiterId)?.name || 'otro mesero';
      toast(`Mesa ${tid} · atendida por ${name}`,'info');
    }
    setPage('menu');
  };

  /* ── Límite por stock ───────────
     No permite pedir más unidades de las que hay en Stock (solo productos
     con stock controlado; los "sin límite (∞)" no se tocan). Se compara
     contra lo PENDIENTE de enviar (qty − sentQty): lo ya enviado a cocina
     ya fue descontado del stock en la base de datos por cada ronda. El
     stock se lee del catálogo en vivo, no de la copia guardada en el carrito. */
  const liveCatalog = useMemo(()=>combineMenu(invMap, customItems),[invMap,customItems]);
  const stockLimitOf = id => {
    const p = liveCatalog.find(x => String(x.id) === String(id));
    return p && p.stock !== null && p.stock !== undefined ? Number(p.stock) : null;
  };
  // Pendiente de enviar de un PRODUCTO, sumando todos sus tamaños
  // (Fuente M. + Fuente G. del mismo plato comparten stock).
  const pendingOf = (items, productId) => (items || []).reduce((s, x) =>
    String(x.id) === String(productId) ? s + Math.max(0, x.qty - (x.sentQty || 0)) : s, 0);
  const stockMsg = (name, limit) => limit > 0 ? `⚠ Solo quedan ${limit} de ${name} en stock` : `⚠ ${name} sin stock`;

  /* ── Add item ─────────────────── */
  const handleAddItem = prod => {
    if(!selectedTable) { toast('Selecciona una mesa primero','err'); return; }
    // Defensa extra — MenuScreen ya bloquea el click de platos agotados,
    // pero esto evita que un plato agotado se agregue por cualquier otra vía
    // (funciona igual para platos del menú estático y platos nuevos custom,
    // porque MenuScreen ya combina ambos con su .available correcto).
    if (prod.available === false) { toast('⚠ Este plato está agotado', 'err'); return; }
    // Un producto con tamaños solo entra con un tamaño elegido (precio correcto)
    if (hasVariants(prod) && !prod.variantKey) { toast('Elige el tamaño del plato', 'err'); return; }
    const key = lineIdFromLine(prod);
    const limit = stockLimitOf(prod.id);
    if (limit !== null && pendingOf(currentTable?.items, prod.id) + 1 > limit) { toast(stockMsg(prod.baseName || prod.name, limit), 'err'); return; }
    setTables(prev=>prev.map(t=>{
      if(t.id!==selectedTable) return t;
      if (limit !== null && pendingOf(t.items, prod.id) + 1 > limit) return t;
      const ex = t.items.find(i=>lineIdFromLine(i)===key);
      // sentQty=0 en ítems nuevos — marca que aún no se enviaron a cocina.
      // Al incrementar un ítem ya existente, sentQty NO se toca: la diferencia
      // (qty - sentQty) queda como "pendiente" y es lo único que se reenviará
      // en la próxima comanda (ver handleSendKitchen).
      const items = ex
        ? t.items.map(i=>lineIdFromLine(i)===key?{...i,qty:i.qty+1}:i)
        : [...t.items, {...prod, lineId:key, qty:1, note:'', sentQty:0}];
      const fresh = !(t.items || []).length && !t.supabaseOrderId;
      return {...t, items, occupied:true, waiterId:waiter.id, openAt:t.openAt||Date.now(),
        ...(fresh ? { packaging: 0, packagingUnit: null, packagingSaved: 0 } : {})};
    }));
    toast(`🍽️ ${prod.name}${prod.portionTag ? ' — ' + prod.portionTag : ''}`,'ok');
  };

  /* ── Pedido escaneado (QR de la carta digital) ─────────────
     MISMA lógica que handleAddItem, aplicada a varias unidades a la vez:
     ítem existente → suma qty (sentQty intacto: lo nuevo queda "pendiente"
     para la próxima ronda); ítem nuevo → entra con sentQty:0. Los productos
     llegan ya resueltos contra el catálogo vigente (ScanOrderModal) y aquí
     se revalida que sigan disponibles. `mesa` debe coincidir con la mesa
     seleccionada: nunca se agrega a una mesa distinta de la que se ve. */
  const handleAddScanned = (mesa, entries) => {
    setShowScan(false);
    if (!selectedTable || mesa !== selectedTable) { toast('La mesa cambió — vuelve a escanear', 'err'); return; }
    const available = (entries || []).filter(e => e && e.prod && e.prod.available !== false && Number.isInteger(e.qty) && e.qty > 0);
    if (!available.length) { toast('⚠ No hay productos disponibles para agregar', 'err'); return; }
    // Recorta cada producto a lo que queda en Stock (acumulando si el mismo
    // producto viene en varias líneas del QR).
    const used = {};
    const trimmed = [];
    const valid = available.map(e => {
      const limit = stockLimitOf(e.prod.id);
      if (limit === null) return e;
      const key = String(e.prod.id);
      const room = Math.max(0, limit - pendingOf(currentTable?.items, e.prod.id) - (used[key] || 0));
      const qty = Math.min(e.qty, room);
      used[key] = (used[key] || 0) + qty;
      if (qty < e.qty) trimmed.push(e.prod.name);
      return { ...e, qty };
    }).filter(e => e.qty > 0);
    if (trimmed.length) toast(`⚠ Stock insuficiente: ${[...new Set(trimmed)].join(', ')} — se agregó solo lo disponible`, 'err');
    if (!valid.length) return;
    setTables(prev=>prev.map(t=>{
      if(t.id!==selectedTable) return t;
      let items = t.items;
      for (const { prod, qty } of valid) {
        const key = lineIdFromLine(prod);
        const ex = items.find(i=>lineIdFromLine(i)===key);
        items = ex
          ? items.map(i=>lineIdFromLine(i)===key?{...i,qty:i.qty+qty}:i)
          : [...items, {...prod, lineId:key, qty, note:'', sentQty:0}];
      }
      const fresh = !(t.items || []).length && !t.supabaseOrderId;
      return {...t, items, occupied:true, waiterId:waiter.id, openAt:t.openAt||Date.now(),
        ...(fresh ? { packaging: 0, packagingUnit: null, packagingSaved: 0 } : {})};
    }));
    const units = valid.reduce((s,e)=>s+e.qty,0);
    toast(`📲 ${units} ${units===1?'producto agregado':'productos agregados'} a la Mesa ${mesa} desde la carta`,'ok');
  };

  /* ── Qty ──────────────────────── */
  const handleQty = (itemId,d) => {
    // itemId = clave de la línea (producto + tamaño); el stock es del producto
    const line = (currentTable?.items || []).find(i => lineIdFromLine(i) === itemId);
    if (d > 0 && line?.cortesia) { toast('La cortesía del premio es de 1 unidad', 'info'); return; }
    const productId = line ? line.id : itemId;
    const limit = d > 0 ? stockLimitOf(productId) : null;
    if (limit !== null && pendingOf(currentTable?.items, productId) + d > limit) {
      toast(stockMsg(line?.baseName || line?.name || 'este producto', limit), 'err');
      return;
    }
    // Si al quitar se baja de lo YA ENVIADO a cocina, esas unidades vuelven
    // al stock (cliente canceló algo ya pedido). Solo para pedidos guardados.
    if (d < 0) {
      const it = line;
      const orderId = currentTable?.supabaseOrderId;
      if (it && orderId) {
        const sent = Math.min(it.sentQty || 0, it.qty);
        const unsent = Math.max(0, Math.min(sent, it.qty + d));
        const back = sent - unsent;
        if (back > 0) {
          returnItemStock(orderId, it.id, back).then(n => {
            if (n > 0) toast(`↩ ${n} ${it.name} devuelto${n === 1 ? '' : 's'} al stock`, 'info');
          });
          // El pedido guardado refleja al momento lo que quedó enviado
          // (mismo cálculo que el setTables de abajo).
          const after = (currentTable.items || []).map(i => {
            if (lineIdFromLine(i) !== itemId) return i;
            const newQty = i.qty + d;
            return { ...i, qty: newQty, sentQty: Math.min(i.sentQty || 0, newQty) };
          }).filter(i => i.qty > 0);
          syncSentOrderItems(orderId, after);
        }
      }
    }
    setTables(prev=>prev.map(t=>{
      if(t.id!==selectedTable) return t;
      if (limit !== null && pendingOf(t.items, productId) + d > limit) return t;
      const items = t.items.map(i=>{
        if(lineIdFromLine(i)!==itemId) return i;
        const newQty = i.qty+d;
        // Si la cantidad baja por debajo de lo ya enviado a cocina, sentQty
        // se recorta al nuevo tope — nunca puede quedar "enviado" más de lo
        // que hay en el carrito.
        return {...i, qty:newQty, sentQty:Math.min(i.sentQty||0, newQty)};
      }).filter(i=>i.qty>0);
      // Sin platos (y sin pedido guardado) no quedan envases pendientes
      const clearPack = !items.length && !t.supabaseOrderId ? { packaging: 0, packagingUnit: null, packagingSaved: 0 } : {};
      return {...t, items, occupied:items.length>0, ...clearPack};
    }));
  };

  /* ── Envases para llevar ─────────
     +/− en el carrito. Si el pedido ya está en cocina, se guarda solo
     (700 ms después del último toque) para que cocina y caja lo vean. */
  const savePackagingNow = async tableId => {
    const t = tablesRef.current.find(x => x.id === tableId);
    if (!t || !t.supabaseOrderId) return true;
    const pk = tablePack(t);
    if (pk.count === (t.packagingSaved || 0)) return true;
    try {
      const saved = await setOrderPackaging(t.supabaseOrderId, pk.count);
      setTables(prev => prev.map(x => x.id !== tableId ? x : {
        ...x,
        packagingSaved: clampPackaging(saved.packaging_count),
        packagingUnit: saved.packaging_unit != null ? Number(saved.packaging_unit) : x.packagingUnit,
      }));
      return true;
    } catch (e) {
      const m = String(e?.message || '');
      toast(/PACKAGING_DISABLED/.test(m)
        ? 'Los envases están desactivados en Ajustes del admin'
        : `No se guardaron los envases (${m || 'sin conexión'}). Se reintentará al enviar o cobrar.`, 'err');
      return false;
    }
  };
  const handlePackaging = delta => {
    const tableId = selectedTable;
    const t = tables.find(x => x.id === tableId);
    if (!t || !(t.items || []).length) return;
    if (delta > 0 && !packCfg?.enabled) { toast('La opción de envases está desactivada', 'err'); return; }
    const cur  = clampPackaging(t.packaging);
    const next = clampPackaging(cur + delta);
    if (next === cur) return;
    // Precio congelado: el del primer envase de este pedido
    const unit = t.packagingUnit != null ? Number(t.packagingUnit) : (packCfg?.unit ?? 0);
    setTables(prev => prev.map(x => x.id !== tableId ? x : {
      ...x, packaging: next,
      packagingUnit: next > 0 || x.supabaseOrderId ? unit : null,
    }));
    if (t.supabaseOrderId) {
      clearTimeout(packTimersRef.current[tableId]);
      packTimersRef.current[tableId] = setTimeout(() => { savePackagingNow(tableId); }, 700);
    }
  };

  /* ── Cupón de descuento (migracion-descuentos-cupones.sql) ── */
  const cuponBusyRef = useRef(false);
  const handleCupon = async () => {
    const tableId = selectedTable;
    const t = tables.find(x => x.id === tableId);
    if (!t?.supabaseOrderId || cuponBusyRef.current) return;
    const code = window.prompt('Código del cupón:');
    if (code === null) return;
    const c = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{3,20}$/.test(c)) { toast('Cupón no válido', 'err'); return; }
    cuponBusyRef.current = true;
    try {
      const { data, error } = await _supabase.rpc('aplicar_cupon', { p_order: t.supabaseOrderId, p_codigo: c });
      if (error) throw error;
      const desc = { pct: data.tipo === 'pct' ? Number(data.valor) : 0, fijo: data.tipo === 'monto' ? Number(data.valor) : 0, label: `Cupón ${data.codigo}` };
      setTables(prev => prev.map(x => x.id !== tableId ? x : { ...x, descuento: desc }));
      toast(`🎟 Cupón ${data.codigo} aplicado`, 'ok');
    } catch (e) {
      const m = String(e?.message || '');
      toast(/aplicar_cupon|PGRST202|could not find/i.test(m) ? 'Los cupones aún no están activados' : crmErrorMessage(e), 'err');
    } finally { cuponBusyRef.current = false; }
  };
  const handleQuitarCupon = async () => {
    const tableId = selectedTable;
    const t = tables.find(x => x.id === tableId);
    if (!t?.supabaseOrderId || cuponBusyRef.current) return;
    if (!window.confirm('¿Quitar el descuento de esta mesa?')) return;
    cuponBusyRef.current = true;
    try {
      const { error } = await _supabase.rpc('quitar_descuento', { p_order: t.supabaseOrderId });
      if (error) throw error;
      setTables(prev => prev.map(x => x.id !== tableId ? x : { ...x, descuento: null }));
    } catch (e) { toast(crmErrorMessage(e), 'err'); }
    finally { cuponBusyRef.current = false; }
  };

  /* ── Cliente de la mesa (CRM, opcional) ── */
  const handleSetCliente = async (c, opts = {}) => {
    const tableId = selectedTable;
    const t = tables.find(x => x.id === tableId);
    if (!t) return;
    const prevId = t.cliente?.id || null;
    setTables(prev => prev.map(x => x.id !== tableId ? x : { ...x, cliente: c || null }));
    if (opts.silent) return;
    // Pedido ya enviado: se liga (o desliga) en el servidor
    if (t.supabaseOrderId && (c?.id || null) !== prevId) {
      try {
        await crmRpc('crm_vincular_pedido', { p_order: t.supabaseOrderId, p_cliente: c?.id || null });
      } catch (e) {
        toast(crmErrorMessage(e), 'err');
        setTables(prev => prev.map(x => x.id !== tableId ? x : { ...x, cliente: t.cliente || null }));
        return;
      }
    }
    if (c) toast(`👤 ${c.nombre} ligado a la Mesa ${tableId}`, 'ok');
  };
  const handleCanjePremio = async prod => {
    const tableId = selectedTable;
    const t = tables.find(x => x.id === tableId);
    if (!t?.cliente?.id) return;
    if (!t.supabaseOrderId) { toast('Envía primero el pedido a cocina', 'err'); return; }
    const limit = stockLimitOf(prod.id);
    if (limit !== null && pendingOf(t.items, prod.id) + 1 > limit) { toast(stockMsg(prod.name, limit), 'err'); return; }
    try {
      await crmRpc('crm_canjear_premio', { p_cliente: t.cliente.id, p_order: t.supabaseOrderId, p_producto: prod.name, p_por: waiter?.name || null });
    } catch (e) { toast(crmErrorMessage(e), 'err'); return; }
    const key = `${prod.id}::cortesia`;
    setTables(prev => prev.map(x => {
      if (x.id !== tableId) return x;
      if ((x.items || []).some(i => lineIdFromLine(i) === key)) return x;
      return {
        ...x,
        items: [...x.items, { ...prod, lineId: key, variantKey: null, variantLabel: null, name: `${prod.name} (Cortesía)`, price: 0, qty: 1, note: '', sentQty: 0, cortesia: true }],
        cliente: x.cliente ? { ...x.cliente, stats: x.cliente.stats ? { ...x.cliente.stats, premio_disponible: false } : null } : null,
      };
    }));
    toast(`🎁 ${prod.name} agregado como cortesía. Envía la ronda a cocina.`, 'ok');
  };

  /* ── Note ─────────────────────── */
  const handleNote = (itemId,note) => {
    setTables(prev=>prev.map(t=>{
      if(t.id!==selectedTable) return t;
      return {...t, items:t.items.map(i=>lineIdFromLine(i)===itemId?{...i,note}:i)};
    }));
  };

  /* ── Marca ítems como enviados a cocina en el estado local y guarda
     la ronda recién enviada en el historial de la mesa. sentQty se
     iguala a qty (para que la próxima diferencia se calcule desde ahí)
     y `round` se añade al arreglo `rounds` que alimenta el indicativo
     visual de "Ronda 1 Lista / Ronda 2 pendiente" en el carrito. */
  const appendRoundLocally = (tid, round) => {
    setTables(prev => prev.map(t => t.id !== tid ? t : {
      ...t,
      items:  t.items.map(i => ({ ...i, sentQty: i.qty })),
      rounds: [...(t.rounds || []), round],
    }));
  };

  const cleanRoundItems = items => items.map(i => ({
    id: i.id, name: i.name, price: i.price,
    qty: i.qty, note: i.note || '', portionTag: i.portionTag,
    lineId: lineIdFromLine(i), variantKey: i.variantKey || null, variantLabel: i.variantLabel || null,
    ...(i.cortesia ? { cortesia: true } : {}),
  }));

  /* ── Send kitchen ──────────────── */
  const handleSendKitchenInner = async () => {
    // Armar el carrito (agregar/quitar productos) siempre está permitido;
    // solo se bloquea el envío a cocina mientras la caja está cerrada.
    // Defensa extra — el botón ya queda deshabilitado, esto cubre
    // cualquier otra vía de invocación (p.ej. el modal de comanda).
    if (!cajaAbierta) { toast('🔒 Caja Cerrada — se requiere abrir la caja para enviar a cocina', 'err'); return; }
    const items      = currentTable?.items || [];
    if(!items.length) { toast('Carrito vacío','err'); return; }
    const zone       = ZONES.find(z=>z.tables.includes(selectedTable))?.name || 'General';
    const existingId = currentTable?.supabaseOrderId;

    if (existingId) {
      // ── AMPLIACIÓN/ADICIONAL de un pedido ya enviado ──────────────
      // Solo se envía a cocina la DIFERENCIA (qty - sentQty) de cada ítem —
      // nunca se reenvía lo que el cocinero ya está preparando o ya preparó.
      // Esto se permite SIEMPRE que la cuenta siga abierta, incluso si
      // rondas anteriores ya fueron marcadas "Listas" por el cocinero.
      const pending = items
        .map(i => ({ ...i, qty: i.qty - (i.sentQty || 0) }))
        .filter(i => i.qty > 0);

      if (!pending.length) {
        toast('No hay ítems nuevos para enviar a cocina', 'info');
        return;
      }

      // El número de ronda es PROVISIONAL aquí — modifyOrderInSupabase lo
      // recalcula contra el historial real en Supabase (nunca contra el
      // estado local, que puede estar desactualizado si la pestaña estuvo
      // en segundo plano) y devuelve la ronda ya confirmada con su `n` real.
      const provisionalRound = {
        items: cleanRoundItems(pending),
        status: 'pendiente',
        sentAt: new Date().toISOString(),
        startedAt: null,
        readyAt: null,
      };

      let confirmedRound, prevStatus;
      try {
        const result = await modifyOrderInSupabase(existingId, items, provisionalRound);
        confirmedRound = result.round;
        prevStatus = result.prevStatus;
        // Descuento de stock de esta ronda — en segundo plano, no frena el envío
        deductRoundStock(existingId, confirmedRound && confirmedRound.n).then(agotados => {
          if (agotados.length) toast(`⚠ Se agotó: ${agotados.join(', ')}`, 'info');
        });
        const statusLabel = prevStatus === 'preparing' ? 'en preparación'
          : prevStatus === 'ready' ? 'lista'
          : 'pendiente';
        toast(`✏️ Ronda ${confirmedRound.n} enviada (pedido estaba ${statusLabel}) — Cocina notificada`, 'ok');
        // Imprime SOLO los ítems nuevos de esta ronda — no el pedido completo.
        // Se reparte por estación (Cocina/Barra/...) según la categoría de cada ítem.
        clearTimeout(packTimersRef.current[selectedTable]);
        await savePackagingNow(selectedTable);
        printComandaToStations({ mesa: selectedTable, items: pending, waiter, zone, isModification: true, roundN: confirmedRound.n, packaging: tablePack(currentTable).count, aviso: currentTable?.cliente?.stats?.aviso || null });
      } catch(e) {
        toast(e.message, 'err');
        return;
      }
      // Sincroniza el estado local con el historial confirmado por el
      // servidor (por si el local estaba desactualizado, esto lo corrige).
      setTables(prev => prev.map(t => t.id !== selectedTable ? t : {
        ...t,
        items:  t.items.map(i => ({ ...i, sentQty: i.qty })),
        rounds: [...(t.rounds || []).filter(r => r.n !== confirmedRound.n), confirmedRound]
          .sort((a,b) => a.n - b.n),
      }));
      setShowCart(false);
      setShowSuccess(`Ronda ${confirmedRound.n} · Mesa ${selectedTable} enviada a cocina`);
      return;
    }

    // ── NUEVO pedido (primera vez) — Ronda 1 ─────────────────────
    const round1 = {
      n: 1,
      items: cleanRoundItems(items),
      status: 'pendiente',
      sentAt: new Date().toISOString(),
      startedAt: null,
      readyAt: null,
    };
    // 1) GUARDAR primero. Solo si la base de datos lo confirma se imprime la
    //    comanda. Antes se imprimía primero y el guardado iba en segundo plano:
    //    si fallaba (sin internet), cocina tenía el papel pero el pedido no
    //    existía en el sistema (no se cobraba ni descontaba stock).
    let orderId = null;
    try {
      orderId = await saveOrderToSupabase(selectedTable, items, waiter, zone, round1, tablePack(currentTable), currentTable?.cliente?.id || null);
    } catch (e) {
      if (e && e.message === 'MESA_UNIDA') {
        toast(`Mesa ${selectedTable} está unida a la Mesa ${e.principal}: agrega el pedido en esa mesa. No se envió ni se imprimió nada.`, 'err');
        setTables(prev => applyMesaJoins(prev, [{ numero_mesa: selectedTable, unida_a: e.principal }]));
        return;
      }
      if (e && e.message === 'MESA_OCUPADA') {
        // Otro envío ya abrió esta mesa (otro mesero, u otro celular del mismo)
        let open = null;
        try { open = await fetchOpenOrderForTable(selectedTable); } catch (_) { /* sin datos: solo se avisa */ }
        if (open && open.waiter_id === waiter.id) {
          adoptOpenOrder(open);
          toast(`Mesa ${selectedTable}: se recuperó tu pedido abierto. Pulsa "Enviar" otra vez para mandar lo nuevo como otra ronda.`, 'info');
        } else {
          toast(`Mesa ${selectedTable} ya tiene un pedido abierto${open && open.waiter_name ? ' de ' + open.waiter_name : ''}. No se envió ni se imprimió nada.`, 'err');
        }
        return;
      }
      console.warn('Supabase:', e?.message);
    }
    if (!orderId) {
      toast('No se pudo enviar a cocina (revisa la conexión). No se imprimió nada: inténtalo de nuevo.', 'err');
      return;
    }

    // 2) Confirmado: se registra la ronda, se imprime y se marca la mesa
    appendRoundLocally(selectedTable, round1);
    const sentPack = tablePack(currentTable).count;
    setTables(prev => prev.map(t =>
      t.id === selectedTable ? { ...t, supabaseOrderId: orderId, packagingSaved: sentPack } : t
    ));
    // Reparte la comanda por estación (Cocina/Barra/...) según la categoría de cada ítem.
    printComandaToStations({ mesa: selectedTable, items, waiter, zone, isModification: false, roundN: 1, packaging: sentPack, aviso: currentTable?.cliente?.stats?.aviso || null });
    // Descuento de stock de la Ronda 1 — en segundo plano, no frena nada
    deductRoundStock(orderId, 1).then(agotados => {
      if (agotados.length) toast(`⚠ Se agotó: ${agotados.join(', ')}`, 'info');
    });
    updateMesaEstado(selectedTable, 'ocupada', { mesero_nombre: waiter.name, mesero_color: waiter.color }).catch(() => {});

    setShowCart(false);
    setShowSuccess(`Comanda Mesa ${selectedTable} enviada a cocina`);
  };

  /* Un solo envío a la vez: un doble toque en "Enviar" no crea dos pedidos
     ni dos rondas (el segundo toque se ignora mientras el primero termina). */
  const sendingRef = useRef(false);
  const handleSendKitchen = async () => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try { await handleSendKitchenInner(); }
    finally { sendingRef.current = false; }
  };

  /* La mesa ya tenía un pedido abierto de ESTE mesero (p. ej. desde otro
     celular): se toma ese pedido con todo lo ya enviado (marcado como
     enviado) y se le suma lo que este carrito tenía sin enviar. Así el cobro
     incluye TODO y no se duplica nada. */
  const adoptOpenOrder = open => {
    const remote = (Array.isArray(open.items) ? open.items : [])
      .map(i => { const q = Math.max(0, Number(i.qty) || 0); return { ...i, note: i.note || '', qty: q, sentQty: q, lineId: lineIdFromLine(i) }; })
      .filter(i => i.qty > 0);
    setTables(prev => prev.map(t => {
      if (t.id !== selectedTable) return t;
      const merged = remote.map(r => ({ ...r }));
      for (const l of (t.items || [])) {
        const unsent = Math.max(0, (l.qty || 0) - (l.sentQty || 0));
        if (!unsent) continue;
        const ex = merged.find(m => lineIdFromLine(m) === lineIdFromLine(l));
        if (ex) ex.qty += unsent;
        else merged.push({ ...l, qty: unsent, sentQty: 0 });
      }
      return {
        ...t, items: merged,
        rounds: Array.isArray(open.rounds) ? open.rounds : (t.rounds || []),
        supabaseOrderId: open.id, occupied: true, waiterId: waiter.id,
      };
    }));
  };

  /* ── Print ticket ────────────── */
  const handlePrintTicket = async text => {
    // La pre-cuenta no se reparte por estación — siempre va a la impresora predeterminada.
    const printer = PrinterRegistry.getDefault();
    // Cadena de impresión: Bluetooth → Ventana del navegador (fallback)
    if (printer.connected) {
      try {
        await printer.print(text, 'precuenta', waiter?.name);
        toast(printer.kind === 'red' ? 'Pre-cuenta enviada a la impresora de red' : 'Pre-cuenta impresa (BT)','ok');
      } catch(e) {
        toast(`${printer.kind === 'red' ? (e?.message || 'Impresora de red') : 'BT error'} — abriendo ventana`,'err');
        printTextWeb(text, 'Pre-cuenta');
      }
    } else {
      printTextWeb(text, 'Pre-cuenta');
      toast('Pre-cuenta lista para imprimir','info');
    }
    setShowTicket(false);
  };

  /* ── Close table — verifica propiedad antes de abrir el cobro ── */
  const handleCloseTable = () => {
    const t = tables.find(x => x.id === selectedTable);
    // Bloquear si la mesa pertenece a otro mesero
    if (t && t.waiterId && t.waiterId !== waiter.id) {
      const ownerName = t.waiterName
        || WAITERS.find(w => w.id === t.waiterId)?.name
        || 'otro compañero';
      setShowCart(false);
      setAccessDenied({ mesa: selectedTable, owner: ownerName });
      return;
    }
    setShowCart(false);
    setShowPayment(true);
  };

  /* ── Payment confirm ───────────────────
     methodOrSplit: string (pago simple, igual que siempre) o
     { mixto:true, legs:[{metodo,monto}] } (pago dividido). Un pago dividido
     se guarda en `orders` como UN registro (payment_method:'mixto' +
     payment_breakdown) pero en `ventas_meseros` como UNA FILA POR MÉTODO —
     así el reporte de turno y el panel Personal, que ya suman por
     metodo_pago, no necesitan ningún cambio para contar bien un cobro
     dividido. */
  const handlePayment = async (methodOrSplit) => {
    const items   = currentTable?.items || [];
    const pack    = tablePack(currentTable);
    // Envases: se manda la cantidad final si hay (o hubo) envases en el pedido
    const packForDb = (pack.count > 0 || (currentTable?.packagingSaved || 0) > 0) ? pack.count : null;
    if (currentTable) clearTimeout(packTimersRef.current[currentTable.id]);
    const total   = tableGrandTotal(currentTable);
    const orderId = currentTable?.supabaseOrderId;
    const zona    = ZONES.find(z=>z.tables.includes(selectedTable))?.name || 'General';
    const isSplit = methodOrSplit && typeof methodOrSplit === 'object';
    // Revalida por si el total cambió entre que se abrió el modal y se confirmó.
    const legs    = isSplit ? validateBreakdownM(methodOrSplit.legs, total).legs : null;
    if (isSplit && !legs) { toast('⚠ El desglose del pago ya no coincide con el total — vuelve a intentar', 'err'); return; }
    const method  = isSplit ? 'mixto' : methodOrSplit;

    try {
      // 1. Marcar el pedido como pagado en Supabase
      if (orderId) {
        await updateOrderPayment(orderId, method, isSplit ? legs : null, items, packForDb).catch(e => console.warn('Supabase pay:', e));
      }

      // 2. Liberar mesa en Supabase — esto dispara el Realtime del panel admin
      await updateMesaEstado(selectedTable, 'libre', {
        mesero_nombre: null,
        mesero_color:  null,
      });

      // 3. Registrar venta(s) personal(es) del mesero (no bloqueante) — una
      // fila por cada método si el pago fue dividido, una sola si fue simple.
      if (isSplit) {
        legs.forEach(leg => {
          saveVentaMesero(waiter.id, waiter.name, selectedTable, leg.monto, leg.metodo, zona, items)
            .catch(e => console.warn('saveVentaMesero (mixto):', e.message));
        });
      } else {
        saveVentaMesero(waiter.id, waiter.name, selectedTable, total, method, zona, items)
          .catch(e => console.warn('saveVentaMesero:', e.message));
      }

    } catch(e) {
      console.warn('handlePayment Supabase error:', e.message);
      // Aunque falle Supabase, liberamos localmente para no bloquear la operación
    }

    // 3b. Update optimista del turno — refleja la venta en el estado local
    // inmediatamente, sin esperar confirmación de Supabase. Si la suscripción
    // Realtime recibe el/los INSERT reales, reemplazará estas entradas (_opt:true).
    const ahoraISO = new Date().toISOString();
    const itemsSnap = items.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty }));
    const legsParaOptimista = isSplit ? legs : [{ metodo: method, monto: total }];
    setVentasTurno(prev => [
      ...legsParaOptimista.map((leg, idx) => ({
        id:            `opt_${Date.now()}_${idx}`,
        _opt:          true, // marcador para que el dedup del Realtime lo reemplace
        mesero_id:     waiter.id,
        mesero_nombre: waiter.name,
        mesa_nro:      selectedTable,
        total:         parseFloat(Number(leg.monto).toFixed(2)),
        metodo_pago:   leg.metodo,
        zona:          zona,
        fecha_hora:    ahoraISO,
        items:         itemsSnap,
      })),
      ...prev,
    ]);

    // 4. Liberar mesa en estado local (optimistic — siempre ejecuta)
    //    junto con sus mesas unidas (en la BD las libera el trigger).
    setTables(prev => prev.map(t =>
      t.id === selectedTable || t.joinedTo === selectedTable
        ? { ...t, items:[], rounds:[], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, occupied:false, waiterId:null, waiterName:null, waiterColor:null, openAt:null, supabaseOrderId:null, joinedTo:null }
        : t
    ));
    // Limpiar el badge de estado del pedido cerrado
    if (orderId) setOrderStatuses(prev => { const n={...prev}; delete n[orderId]; return n; });

    const label = isSplit
      ? legs.map(l => `${PAYMENT_METHODS_M.find(m => m.key === l.metodo)?.label || l.metodo} S/${l.monto.toFixed(2)}`).join(' + ')
      : `${PAYMENT_METHODS_M.find(m => m.key === method)?.label || 'Efectivo'} ${PAYMENT_METHODS_M.find(m => m.key === method)?.icon || '💵'}`;
    toast(`Mesa ${selectedTable} cerrada · ${fmt(total)} · ${label}`, 'ok');
    setShowPayment(false);
    setSelectedTable(null);
    setPage('mesas');
  };

  /* ── Unir / separar mesas ───── */
  const joinBusyRef = useRef(false);
  const handleJoinTables = async mesasSel => {
    if (joinBusyRef.current || !selectedTable || !mesasSel?.length) return false;
    joinBusyRef.current = true;
    const principal = selectedTable;
    try {
      const { data, error } = await _supabase.rpc('unir_mesas', { p_principal: principal, p_mesas: mesasSel });
      if (error) { toast(joinErrorMessage(error), 'err'); return false; }
      const unidas = Array.isArray(data) ? data : mesasSel;
      setTables(prev => prev.map(t => unidas.includes(t.id)
        ? { ...t, occupied: true, waiterId: waiter.id, waiterName: waiter.name, waiterColor: waiter.color, joinedTo: principal, items: [], rounds: [], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, supabaseOrderId: null }
        : t));
      toast(`Mesa ${unidas.join(', ')} unida${unidas.length > 1 ? 's' : ''} a la Mesa ${principal}`, 'ok');
      return true;
    } catch (e) {
      toast(joinErrorMessage(e), 'err');
      return false;
    } finally {
      joinBusyRef.current = false;
    }
  };
  const handleUnjoinTables = async (mesa = null) => {
    if (joinBusyRef.current || !selectedTable) return;
    joinBusyRef.current = true;
    const principal = selectedTable;
    try {
      const { error } = await _supabase.rpc('separar_mesas', { p_principal: principal, p_mesa: mesa });
      if (error) { toast(joinErrorMessage(error), 'err'); return; }
      setTables(prev => prev.map(t => t.joinedTo === principal && (mesa === null || t.id === mesa)
        ? { ...t, occupied: false, waiterId: null, waiterName: null, waiterColor: null, joinedTo: null, items: [], rounds: [], packaging: 0, packagingUnit: null, packagingSaved: 0, cliente: null, descuento: null, openAt: null, supabaseOrderId: null }
        : t));
      toast(mesa ? `Mesa ${mesa} separada` : `Mesas separadas de la Mesa ${principal}`, 'ok');
    } catch (e) {
      toast(joinErrorMessage(e), 'err');
    } finally {
      joinBusyRef.current = false;
    }
  };

  /* ── Impresoras (abre el panel de 1 o más impresoras Bluetooth) ── */
  const handleOpenPrinters = () => setShowPrinters(true);

  /* ── GoToTable from status ───── */
  const handleGoToTable = tid => { setSelectedTable(tid); setPage('menu'); };

  /* ── Cerrar Turno: liberar mesas propias + limpiar sesión + recargar página ── */
  const handleLogoutWaiter = useCallback(async () => {
    // Paso 1 — Liberar en Supabase todas las mesas propias del mesero
    try {
      const myTables = tables.filter(t => t.waiterId === waiter.id && t.occupied);
      await Promise.all(myTables.map(t =>
        updateMesaEstado(t.id, 'libre', { mesero_nombre: null, mesero_color: null })
          .catch(e => console.warn('[CerrarTurno] liberarMesa:', e))
      ));
    } catch(e) {
      console.warn('[CerrarTurno] error liberando mesas:', e);
    }

    // Paso 2 — Detener polling del SW antes de limpiar el storage
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then(reg => reg.active?.postMessage({ type: 'CLEAR_WAITER' }))
          .catch(() => {});
      }
    } catch(_) {}

    // Paso 3 — Limpieza selectiva: solo claves del mesero.
    // NO usar localStorage.clear() — destruiría la sesión de cocina.html
    // si ambas páginas están abiertas en el mismo navegador/dispositivo.
    try {
      [
        'antojitos_waiter_v1',
        'antojitos_cart_v3',
        'antojitos_cart_owner',
        'antojitos_net_printer',
        waiter?.id ? `turno_start_${waiter.id}` : null,
      ].forEach(k => { if (k) try { localStorage.removeItem(k); } catch(_) {} });
      sessionStorage.clear();
      // CRÍTICO: grabar el timestamp exacto del cierre DESPUÉS de la limpieza.
      // getInitialTurnoStart() lo consume en la próxima sesión para que el nuevo
      // turno arranque desde AHORA y no desde medianoche (evita mostrar ventas antiguas).
      localStorage.setItem('antojitos_nuevo_turno_ts', new Date().toISOString());
    } catch(_) {}

    // Paso 3 — Recarga absoluta: destruye todo el estado React en memoria.
    // Al recargar sin datos en localStorage (salvo el marcador de nuevo turno),
    // la app renderiza <Login> directamente → turno completamente limpio.
    window.location.replace(window.location.href);
  }, [waiter, tables]);

  if(splash) return <Splash onDone={()=>setSplash(false)}/>;
  if(!waiter) return <Login onLogin={w=>{
    setWaiter(w);
    persistWaiter(w);
    // Bitácora — registra el inicio de turno (best-effort, no bloquea el login)
    logMeseroSesionInicio(w).catch(()=>{});
    // Inicializar turno para este mesero (consume marcador 'nuevo_turno' si existe)
    const ts = computeTurnoStart(w.id);
    setTurnoStart(ts);
    setVentasTurno([]);
    // Comunicar al SW quién es el mesero activo para que pueda hacer polling en segundo plano
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.active?.postMessage({
          type:        'SET_WAITER',
          waiterId:    w.id,
          waiterName:  w.name,
          supabaseUrl: SUPABASE_URL,
          supabaseKey: SUPABASE_KEY,
        });
      }).catch(() => {});
    }
  }}/>;

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column',position:'relative',zIndex:1}}>
      <Toasts list={toasts} remove={removeToast}/>

      {/* KITCHEN READY ALERT */}
      {kitchenAlerts.length > 0 && (
        <KitchenReadyAlert
          key={kitchenAlerts[0].orderId}   // cada aviso con su propio temporizador (1 aviso por pedido en la cola)
          alert={kitchenAlerts[0]}
          onDismiss={() => {
            // Guardar como aceptado en este celular: no vuelve a aparecer
            // aunque se salga del perfil, se cierre turno o se recargue la app.
            const current = kitchenAlerts[0];
            if (!current) return;
            if (current) ackKitchenAlert(waiter?.id, current.sig || `${current.orderId}#0`);
            // Avisar al SW que la alerta fue vista: no repetir la notificación nativa
            const ordId = kitchenAlerts[0]?.orderId;
            if (ordId && 'serviceWorker' in navigator) {
              navigator.serviceWorker.ready
                .then(reg => reg.active?.postMessage({ type: 'ORDER_ACK', orderId: ordId, sig: current?.sig || `${ordId}#0` }))
                .catch(() => {});
            }
            // Se quita ESTE aviso por su id (no "el primero de la cola"):
            // un doble toque o un aviso anulado a la vez no borra otro.
            setKitchenAlerts(p => p.filter(a => a.orderId !== current.orderId));
          }}
        />
      )}

      {/* SUCCESS */}
      {showSuccess && <SuccessFlash msg={showSuccess} onDone={()=>setShowSuccess(null)}/>}

      {/* ACCESS DENIED */}
      {accessDenied && (
        <AccessDeniedModal
          mesa={accessDenied.mesa}
          owner={accessDenied.owner}
          onClose={()=>setAccessDenied(null)}
        />
      )}

      {/* ESCANEAR PEDIDO (QR de la carta digital del cliente) */}
      {showScan && selectedTable && (
        <ScanOrderModal
          mesa={selectedTable}
          table={currentTable}
          waiter={waiter}
          catalog={combineMenu(invMap, customItems)}
          onConfirm={handleAddScanned}
          onClose={() => setShowScan(false)}
        />
      )}

      {/* PAYMENT MODAL */}
      {showPayment && currentTable && (
        <PaymentModal
          mesa={selectedTable}
          items={currentTable.items}
          waiter={waiter}
          zone={ZONES.find(z=>z.tables.includes(selectedTable))?.name || 'General'}
          onConfirm={handlePayment}
          onClose={()=>setShowPayment(false)}
          packaging={tablePack(currentTable)}
          descuento={tableDiscount(currentTable)}
        />
      )}

      {/* TICKET MODAL */}
      {showTicket && currentTable && (
        <TicketModal
          mesa={selectedTable}
          items={currentTable.items}
          waiter={waiter}
          zone={zone}
          btConnected={PrinterRegistry.getDefault().connected}
          cols={PrinterRegistry.getDefault().cols}
          onPrint={handlePrintTicket}
          onClose={()=>setShowTicket(false)}
          packaging={tablePack(currentTable)}
          descuento={tableDiscount(currentTable)}
        />
      )}

      {/* CLIENTE DE LA MESA */}
      {showCliente && currentTable && (
        <ClienteModal
          cliente={currentTable.cliente || null}
          hasOrder={!!currentTable.supabaseOrderId}
          catalog={liveCatalog}
          waiterName={waiter?.name}
          onSet={handleSetCliente}
          onCanjear={handleCanjePremio}
          onClose={() => setShowCliente(false)}
        />
      )}

      {/* IMPRESORAS */}
      {showPrinters && (
        <PrintersModal
          categories={printerCats}
          onClose={() => setShowPrinters(false)}
        />
      )}

      {/* CART SHEET */}
      {showCart && currentTable && (
        <CartSheet
          mesa={selectedTable}
          items={currentTable.items}
          rounds={currentTable.rounds || []}
          waiter={waiter}
          zone={zone}
          btConnected={PrinterRegistry.anyConnected()}
          existingOrderId={currentTable.supabaseOrderId}
          onClose={()=>setShowCart(false)}
          onQty={handleQty}
          onNote={handleNote}
          onSendKitchen={handleSendKitchen}
          onPrintTicket={()=>{ setShowCart(false); setShowTicket(true); }}
          onCloseTable={handleCloseTable}
          cajaAbierta={cajaAbierta}
          joinedTables={tables.filter(t => t.joinedTo === selectedTable).map(t => t.id)}
          freeTables={tables.filter(t => t.id !== selectedTable && !t.occupied && !t.joinedTo && !(t.items || []).length).map(t => t.id)}
          onJoin={currentTable.waiterId === waiter.id ? handleJoinTables : null}
          onUnjoin={handleUnjoinTables}
          cliente={currentTable.cliente || null}
          onOpenCliente={_crmAvailable ? () => setShowCliente(true) : null}
          descuento={tableDiscount(currentTable).monto > 0 ? tableDiscount(currentTable) : null}
          onCupon={handleCupon}
          onQuitarCupon={handleQuitarCupon}
          packaging={(packCfg || clampPackaging(currentTable.packaging) > 0) ? {
            ...tablePack(currentTable),
            unit: tablePack(currentTable).count > 0 ? tablePack(currentTable).unit : (currentTable.packagingUnit != null ? Number(currentTable.packagingUnit) : (packCfg?.unit ?? 0)),
            enabled: !!packCfg?.enabled,
            onChange: handlePackaging,
          } : null}
        />
      )}

      {/* ── TOPBAR ── */}
      <div className="topbar">
        <div className="tb-brand">
          <div className="tb-titles">
            <div className="tb-name" title={bizName(bizInfo)}>{bizName(bizInfo).toUpperCase()}</div>
            <div className="tb-sub">{['App Mesero Pro', bizCity(bizInfo)].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="tb-right">
          <Clock/>
          {selectedTable && (
            <div className="mesa-badge">Mesa {selectedTable}</div>
          )}

          {/* Chip de notificaciones — indica si las alertas en segundo plano están activas */}
          {'Notification' in window && (
            <div
              className={`notif-chip ${notifStatus==='granted'?'active':notifStatus==='denied'?'denied':''}`}
              onClick={handleNotifRequest}
              title={notifStatus==='granted'?'Notificaciones activas':notifStatus==='denied'?'Notificaciones bloqueadas — toca para ver cómo activarlas':'Toca para activar alertas en segundo plano'}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                {notifStatus==='denied' && <line x1="2" y1="2" x2="22" y2="22"/>}
              </svg>
              {notifStatus==='granted'?'ON':notifStatus==='denied'?'OFF':'?'}
            </div>
          )}

          {/* Botón Impresoras — abre el panel de 1 o más impresoras Bluetooth */}
          <div
            className={`bt-chip ${PrinterRegistry.anyConnected()?'on':''}`}
            onClick={handleOpenPrinters}
            title="Impresoras Bluetooth"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/></svg>
            {(() => {
              const list = PrinterRegistry.list();
              const n = list.filter(p => p.connected).length;
              const tag = list.every(p => p.kind === 'red') ? 'RED' : list.some(p => p.kind === 'red') ? 'IMP' : 'BT';
              return list.length > 1 ? `${tag} ${n}/${list.length}` : (n ? `${tag} ✓` : tag);
            })()}
          </div>

          {/* Botón Modo Oscuro */}
          <button
            onClick={toggleDark}
            title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            style={{
              background:'var(--ink3)', border:'1px solid var(--line2)',
              borderRadius:'50%', width:34, height:34, minHeight:'unset',
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', transition:'all .18s',
              color:'var(--snow)', flexShrink:0,
            }}
          >{darkMode ? <Moon size={16}/> : <Sun size={16}/>}</button>

          {/* Waiter chip — tap to change */}
          <div className="waiter-chip" onClick={()=>{ setWaiter(null); persistWaiter(null); }}>
            <div className="waiter-chip-avatar" style={{background:waiter.bg,color:waiter.color}}>{waiter.initial}</div>
            <div className="waiter-chip-name">{waiter.name}</div>
          </div>
        </div>
      </div>

      {/* ── NAV TABS ── */}
      <div className="nav-tabs">
        {[
          {id:'mesas',label:'Mesas',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,badge:occupiedCount||null},
          {id:'menu',label:'Menú',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,badge:null},
          {id:'status',label:'Estado',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,badge:tables.filter(t=>t.waiterId===waiter.id&&t.occupied).length||null},
          {id:'turno',label:'Turno',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M6 7h4M6 11h8M6 15h2"/></svg>,badge:null},
          {id:'ajustes',label:'Ajustes',icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,badge:PrinterRegistry.list().some(p => p.deviceId && !p.connected) ? '!' : null},
        ].map(t=>(
          <div key={t.id} className={`nav-tab ${page===t.id?'active':''}`} onClick={()=>setPage(t.id)}>
            {t.badge!=null && (t.badge==='!' || t.badge>0) && <div className="tab-badge">{t.badge}</div>}
            {t.icon}
            {t.label}
          </div>
        ))}
      </div>

      {/* ── SCREENS ── */}
      <div className="screen-wrap">
        {page==='mesas' && (
          <MesasScreen
            tables={tables} waiter={waiter}
            onSelectTable={handleSelectTable}
            selectedTable={selectedTable}
            orderStatuses={orderStatuses}
          />
        )}
        {page==='menu' && (
          <MenuScreen
            selectedTable={selectedTable}
            tables={tables}
            waiter={waiter}
            onAddItem={handleAddItem}
            invMap={invMap}
            customItems={customItems}
            onScanOrder={() => setShowScan(true)}
          />
        )}
        {page==='status' && (
          <StatusScreen
            tables={tables} waiter={waiter}
            ventasTurno={ventasTurno}
            onGoToTable={handleGoToTable}
          />
        )}
        {page==='turno' && (
          <TurnoScreen
            waiter={waiter}
            ventasTurno={ventasTurno}
            setVentasTurno={setVentasTurno}
            turnoStart={turnoStart}
            setTurnoStart={setTurnoStart}
            onLogout={handleLogoutWaiter}
          />
        )}
        {page==='ajustes' && (
          <AjustesScreen categories={printerCats} />
        )}
      </div>

      {/* ── CART FAB ── */}
      {selectedTable && (cartCount > 0 || (currentTable?.occupied && currentTable?.waiterId === waiter?.id)) && (
        <div className="cart-fab" onClick={()=>setShowCart(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          <div className="fab-badge">{cartCount}</div>
        </div>
      )}

      {/* ── FOOTER ── */}
      <div className="app-footer">
        <span className="footer-brand" style={{display:'flex',alignItems:'center',gap:5}}>
          <img src="img/logo/logo.png" alt="" style={{width:16,height:16,objectFit:'contain',borderRadius:'50%'}}/>
          {bizName(bizInfo)}
        </span>
        {' · '}{[bizAddress(bizInfo), 'App Mesero Pro', `${TABLE_LAYOUT.length} Mesas`].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary label="Error en la App del Mesero">
    <App/>
  </ErrorBoundary>
);

/* ── PWA manifest inline (antes en un <script> HTML separado, después del
   cierre del bloque babel — se fusiona aquí porque ahora todo vive en un
   solo módulo, sin cambiar ninguna línea de la lógica) ── */
const manifest = {
  name:"Antojitos al Paso — Mesero v20",
  short_name:"Antojitos Mesero",
  description:"Módulo Mesero v20 Pro · 30 Mesas · Catacaos",
  start_url:"./",display:"standalone",
  background_color:"#080809",theme_color:"#060809",
  orientation:"portrait",
  icons:[
    {src:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23080809'/%3E%3Ctext y='.9em' font-size='80'%3E%F0%9F%8D%97%3C/text%3E%3C/svg%3E",sizes:"192x192",type:"image/svg+xml"},
    {src:"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%23080809'/%3E%3Ctext y='.9em' font-size='80'%3E%F0%9F%8D%97%3C/text%3E%3C/svg%3E",sizes:"512x512",type:"image/svg+xml"},
  ]
};
const blob=new Blob([JSON.stringify(manifest)],{type:'application/json'});
const link=document.createElement('link');
link.rel='manifest';link.href=URL.createObjectURL(blob);
document.head.appendChild(link);

// Service Worker v23 — cache offline + notificaciones nativas + polling REST en segundo plano
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw-mesero.js', { scope: '/mesero.html' })
    .then(async reg => {
      console.log('[SW] Registrado · scope:', reg.scope);
      // PeriodicBackgroundSync — despierta el SW cada 15 min aunque la pestaña esté cerrada
      // Requiere PWA instalada y permiso de Background Sync (Chrome/Android)
      if ('periodicSync' in reg) {
        try {
          await reg.periodicSync.register('antojitos-kitchen-poll', { minInterval: 15 * 60 * 1000 });
          console.log('[SW] PeriodicBackgroundSync registrado');
        } catch(e) {
          console.info('[SW] PeriodicSync no disponible:', e.message);
        }
      }
    })
    .catch(err => { console.warn('[SW] Error de registro:', err.message); });
}
