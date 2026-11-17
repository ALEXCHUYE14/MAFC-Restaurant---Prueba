// sw-mesero.js — Service Worker v26 · App del Mesero
// Notificaciones nativas (pantalla bloqueada / segundo plano) + caché offline básico.
//
// Restaurado: se había borrado por accidente junto con un cambio de imágenes
// (commit b4e2e28) y la app lo seguía registrando → error en consola y sin
// notificaciones con la pantalla bloqueada.
//
// Mejora respecto a la versión anterior: los avisos YA VISTOS se recuerdan de
// forma PERMANENTE (Cache Storage), no solo en memoria. Antes, cada vez que el
// navegador reiniciaba el Service Worker se olvidaba de ellos y volvía a
// mostrar en la pantalla bloqueada pedidos que el mesero ya había aceptado.
// Se usa la misma firma que la app (pedido#rondas): si se envía una ronda
// NUEVA y vuelve a quedar lista, ese aviso sí llega.

const CACHE       = 'antojitos-mesero-v26';
const STATE_CACHE = 'antojitos-mesero-state';
const STATE_KEY   = '/__sw_avisos_vistos__';
const POLL_MS     = 28000;                       // cadencia del sondeo en segundo plano
const STATE_TTL   = 3 * 24 * 60 * 60 * 1000;     // olvida avisos de más de 3 días

// ── Estado ───────────────────────────────────────────────────────────────────
let _waiterCfg = null;   // { waiterId, waiterName, supabaseUrl, supabaseKey }
let _pollTimer = null;
let _seen      = null;   // { [firma]: timestamp } — cargado desde Cache Storage

async function loadSeen() {
  if (_seen) return _seen;
  try {
    const c = await caches.open(STATE_CACHE);
    const r = await c.match(STATE_KEY);
    _seen = r ? (await r.json()) || {} : {};
  } catch (_) { _seen = {}; }
  return _seen;
}
async function markSeen(sig) {
  if (!sig) return;
  const seen = await loadSeen();
  const cutoff = Date.now() - STATE_TTL;
  Object.keys(seen).forEach(k => { if (!(seen[k] > cutoff)) delete seen[k]; });
  seen[sig] = Date.now();
  try {
    const c = await caches.open(STATE_CACHE);
    await c.put(STATE_KEY, new Response(JSON.stringify(seen), { headers: { 'Content-Type': 'application/json' } }));
  } catch (_) { /* almacenamiento lleno/bloqueado: no es crítico */ }
}
async function wasSeen(sig) {
  const seen = await loadSeen();
  return !!seen[sig];
}
const sigOf = (orderId, rounds) => `${orderId}#${Array.isArray(rounds) ? rounds.length : 0}`;

// ════════════════════════════════════════════════════════════════════════════
// CICLO DE VIDA
// ════════════════════════════════════════════════════════════════════════════
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== STATE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Mismo origen → primero la RED (siempre la versión nueva si hay internet);
// la copia guardada solo se usa sin conexión. Fuentes de Google → caché.
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;  // Supabase y demás: sin tocar
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});

// ════════════════════════════════════════════════════════════════════════════
// MENSAJES DESDE LA APP
// ════════════════════════════════════════════════════════════════════════════
self.addEventListener('message', e => {
  const msg = e.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'SET_WAITER':      // el mesero inició sesión
      if (!msg.waiterId || !msg.supabaseUrl || !msg.supabaseKey) return;
      _waiterCfg = {
        waiterId:    String(msg.waiterId),
        waiterName:  msg.waiterName || '',
        supabaseUrl: String(msg.supabaseUrl).replace(/\/+$/, ''),
        supabaseKey: msg.supabaseKey,
      };
      startPolling();
      break;

    case 'CLEAR_WAITER':    // cerró sesión / turno
      _waiterCfg = null;
      stopPolling();
      break;

    case 'ORDER_ACK':       // el mesero aceptó el aviso en pantalla
      e.waitUntil(markSeen(msg.sig || (msg.orderId ? `${msg.orderId}#0` : null)));
      break;

    case 'KITCHEN_READY':   // la app recibió el aviso: mostrarlo con pantalla bloqueada
      e.waitUntil((async () => {
        const sig = msg.sig || (msg.orderId ? `${msg.orderId}#0` : null);
        await markSeen(sig);  // el sondeo no lo duplica
        await showKitchenNotification(msg);
      })());
      break;

    default:
      break;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// SONDEO EN SEGUNDO PLANO (por si la conexión en vivo de la app se cortó)
// ════════════════════════════════════════════════════════════════════════════
function startPolling() {
  if (_pollTimer) return;
  pollKitchenOrders();
  _pollTimer = setInterval(pollKitchenOrders, POLL_MS);
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

async function fetchReady(withRounds) {
  const { waiterId, supabaseUrl, supabaseKey } = _waiterCfg;
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const url = `${supabaseUrl}/rest/v1/orders` +
    `?waiter_id=eq.${encodeURIComponent(waiterId)}` +
    `&status=eq.ready` +
    `&created_at=gte.${encodeURIComponent(cutoff)}` +
    `&select=id,table_number,zone,items,notes${withRounds ? ',rounds' : ''}`;
  // Las publishable keys (sb_publishable_...) no son JWT: van solo en "apikey".
  // Las anon keys legadas (JWT) también se envían como Bearer.
  const headers = { apikey: supabaseKey };
  if (supabaseKey.startsWith('eyJ')) headers.Authorization = `Bearer ${supabaseKey}`;
  return fetch(url, { headers });
}

async function pollKitchenOrders() {
  if (!_waiterCfg) { stopPolling(); return; }
  try {
    let res = await fetchReady(true);
    if (!res.ok) res = await fetchReady(false);   // columna rounds aún no migrada
    if (!res.ok) return;
    const orders = await res.json();
    if (!Array.isArray(orders)) return;

    for (const ord of orders) {
      const sig = sigOf(ord.id, ord.rounds);
      if (await wasSeen(sig)) continue;
      await markSeen(sig);

      let customerName = null;
      try { customerName = JSON.parse(ord.notes || '{}').customerName || null; } catch (_) {}

      await showKitchenNotification({
        orderId: ord.id, mesa: ord.table_number, zone: ord.zone || 'General',
        waiterName: _waiterCfg && _waiterCfg.waiterName, customerName,
        items: Array.isArray(ord.items) ? ord.items.slice(0, 3) : [],
      }).catch(() => {});
    }
  } catch (_) {
    // sin conexión: el próximo ciclo reintenta
  }
}

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICACIÓN NATIVA
// ════════════════════════════════════════════════════════════════════════════
async function showKitchenNotification({ mesa, zone, waiterName, orderId, items, customerName }) {
  let title, body;
  const itemsPreview = Array.isArray(items) && items.length
    ? items.map(i => `${i.qty || 1}x ${i.name}`).join(', ')
    : null;

  if (zone === 'Para Llevar') {
    title = `🥡 ${customerName || 'Para Llevar'} — ¡Listo!`;
    body  = itemsPreview || 'El pedido para llevar está listo para entregar.';
  } else if (zone === 'Delivery' || zone === 'Recojo en Local') {
    const icon = zone === 'Delivery' ? '🛵' : '🏪';
    title = `${icon} ${customerName || zone} — ¡Listo!`;
    body  = itemsPreview || `Pedido de ${zone} listo para entregar.`;
  } else {
    const mesaStr = String(mesa || '?').padStart(2, '0');
    title = `🔔 Mesa ${mesaStr} — ¡Pedido Listo!`;
    body  = (waiterName ? `${waiterName}: ` : '') + (itemsPreview || 'El pedido está listo para servir.');
  }

  return self.registration.showNotification(title, {
    body,
    icon:  '/img/logo/logo.png',
    badge: '/img/logo/logo.png',
    tag:   `kitchen-${orderId}`,        // un solo aviso por pedido en la bandeja
    renotify: true,
    requireInteraction: true,
    vibrate: [500, 200, 500, 200, 800],
    data: { mesa, orderId, zone },
    actions: [{ action: 'dismiss', title: 'Entendido ✓' }],
  });
}

// Tocar la notificación → abre o enfoca la app del mesero
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('mesero') && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow('./mesero.html');
    })
  );
});

// Sincronización periódica (Chrome/Android con la app instalada)
self.addEventListener('periodicsync', e => {
  if (e.tag === 'antojitos-kitchen-poll') e.waitUntil(pollKitchenOrders());
});
