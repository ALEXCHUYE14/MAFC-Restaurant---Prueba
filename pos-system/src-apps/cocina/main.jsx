/* ══════════════════════════════════════════════════════════════════
   cocina.html — ahora servido vía el build de Vite en vez de
   Babel-Standalone transpilando en el navegador en cada carga.
   ══════════════════════════════════════════════════════════════════
   Todo lo que sigue después de este preámbulo es EXACTAMENTE el mismo
   código que corría inline en public/cocina.html — se extrajo línea
   por línea, sin reescribir nada, para no arriesgar ningún cambio de
   comportamiento en el panel del que depende cocina todos los días.
   Los únicos cambios reales están en este preámbulo:
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
  LogOut, AlertTriangle, Siren, Flame, CheckCircle2, PlusCircle, Phone,
  Moon, Sun, ClipboardList, PartyPopper, Sunrise, Check,
  Bike, Store, ShoppingBag, Sparkles,
} from 'lucide-react'

const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ══════════════════════════════════════════════
   ERROR BOUNDARY — nunca dejar la pantalla en negro
   ══════════════════════════════════════════════
   Este archivo no tenía NINGÚN Error Boundary — cualquier excepción
   sin capturar durante el render (de una sola tarjeta de pedido, de
   un dato inesperado) tumbaba TODO el árbol de React y dejaba solo
   el fondo oscuro de <body> visible. En modo oscuro eso se ve
   exactamente como una pantalla negra.
   Dos capas:
   - Una alrededor de <App/> (ver el mount al final del archivo) — si
     algo se rompe fuera de las tarjetas de pedido, se ve un aviso con
     el error real y un botón para recargar, nunca una pantalla vacía.
   - Una POR TARJETA de pedido (ver el .map() de OrderCard) — si UN
     pedido puntual revienta al renderizar, esa tarjeta se reemplaza
     por un aviso de error y el resto del tablero — los demás pedidos
     reales — sigue funcionando con normalidad. */
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
          padding: 16, margin: this.props.compact ? 0 : 10, borderRadius: 12,
          background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
          color: '#DC2626', fontSize: 12, lineHeight: 1.6,
        }}>
          <strong>⚠️ {this.props.label || 'Algo salió mal'}</strong>
          <div style={{ marginTop: 6, fontFamily: 'var(--mono)', fontSize: 10.5, opacity: .85, wordBreak: 'break-word' }}>
            {String((this.state.error && this.state.error.message) || this.state.error)}
          </div>
          <button
            onClick={() => this.props.onReload ? this.props.onReload() : this.setState({ error: null })}
            style={{ marginTop: 10, padding: '6px 14px', borderRadius: 8, border: 'none', background: '#DC2626', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}
          >{this.props.onReload ? 'Recargar página' : 'Reintentar'}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ══════════════════════════════════════════════
   SUPABASE CLIENT
══════════════════════════════════════════════ */
const _supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY,
  {
    // cocina.html NUNCA usa sesiones de Supabase Auth — el login del panel
    // es propio (usuario/contraseña contra credenciales fijas, más abajo),
    // toda operación real pasa siempre con la misma anon key. Sin esto,
    // el cliente de todos modos levanta internamente un GoTrueClient que
    // coordina pestañas vía navigator.locks sobre "sb-...-auth-token" —
    // si el panel queda abierto en más de una pestaña/ventana a la vez,
    // ese lock puede ser "robado" entre pestañas y cualquier request
    // (incluso un simple update de pedidos, como al Cerrar Sesión) falla
    // con "Lock ... was released because another request stole it".
    // Desactivar sesión/autorefresh apaga ese mecanismo por completo —
    // no hay nada que coordinar entre pestañas si no hay sesión que
    // persistir. Cero impacto funcional: no cambia ninguna consulta.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }
);

/* ══════════════════════════════════════════════
   NEGOCIO — nombre y dirección (los edita el admin en Ajustes)
   ══════════════════════════════════════════════
   Fila única `negocio_config` (lectura pública). Solo se piden las dos
   columnas que usa cocina (nunca el QR, que puede ser pesado). Arranca con
   la copia local que comparten admin/mesero en este mismo dominio (misma
   clave) o con el valor por defecto: si la tabla no existe o Supabase no
   responde, la pantalla se ve como siempre. Una sola carga + Realtime por
   pestaña (startKitchenBizSync es idempotente). */
const BIZ_LS_KEY       = 'antojitos_negocio_cfg_v1';
const BIZ_DEFAULT_NAME = 'Antojitos al Paso';
function readBizCache() {
  try {
    const c = JSON.parse(localStorage.getItem(BIZ_LS_KEY) || 'null');
    return c && typeof c === 'object' ? c : {};
  } catch (_) { return {}; }
}
let KBIZ = (() => {
  const c = readBizCache();
  return {
    nombre:    String(c.nombre || '').trim() || BIZ_DEFAULT_NAME,
    direccion: String(c.direccion || '').trim(),
  };
})();
const _kbizListeners = new Set();
function applyKitchenBizRow(r) {
  if (!r) return;
  const next = { ...KBIZ };
  if ('nombre'    in r) next.nombre    = String(r.nombre || '').trim() || BIZ_DEFAULT_NAME;
  if ('direccion' in r) next.direccion = String(r.direccion || '').trim();
  if (next.nombre === KBIZ.nombre && next.direccion === KBIZ.direccion) return;
  KBIZ = next;
  // Mezcla con la copia existente: el admin guarda ahí también RUC/Yape/QR
  // y cocina no debe borrarlos.
  try { localStorage.setItem(BIZ_LS_KEY, JSON.stringify({ ...readBizCache(), ...next })); } catch (_) {}
  _kbizListeners.forEach(fn => { try { fn(KBIZ); } catch (_) {} });
}
let _kbizStarted = false;
function startKitchenBizSync() {
  if (_kbizStarted) return;
  _kbizStarted = true;
  _supabase.from('negocio_config').select('nombre, direccion').eq('id', 1).maybeSingle()
    .then(({ data, error }) => { if (!error && data) applyKitchenBizRow(data); })
    .catch(e => console.warn('[Negocio] fetch falló:', e?.message));
  try {
    _supabase
      .channel('cocina-negocio-config')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'negocio_config' },
        payload => { try { applyKitchenBizRow(payload.new); } catch (_) {} })
      .subscribe();
  } catch (e) { console.warn('[Negocio] realtime falló:', e?.message); }
}
function useKitchenBiz() {
  const [b, setB] = useState(KBIZ);
  useEffect(() => {
    startKitchenBizSync();
    _kbizListeners.add(setB);
    setB(KBIZ);
    return () => { _kbizListeners.delete(setB); };
  }, []);
  return b;
}
// Misma regla que businessLocality() en src/services/businessConfig.js:
// "Jr. Zepita #349 - Catacaos, Piura" → ciudad "Catacaos"; sin " - " ni coma → ''.
function kitchenBizCity(b) {
  const dir = String((b && b.direccion) || '').trim();
  if (!dir) return '';
  const parts = dir.split(/\s+[-–—]\s+/);
  const loc = parts.length > 1
    ? parts[parts.length - 1]
    : (dir.indexOf(',') >= 0 ? dir.slice(dir.indexOf(',') + 1) : '');
  return loc.split(',')[0].trim();
}

// ¿El error indica que la función RPC aún no existe (migración pendiente)?
// En ese caso se usa el método anterior — el panel nunca se rompe por esto.
function isMissingRpc(error) {
  const msg = String((error && (error.message || error.details)) || '');
  return !!error && (error.code === 'PGRST202' || error.code === '42883' ||
    /could not find the function|function .* does not exist/i.test(msg));
}

/* ══════════════════════════════════════════════
   AUTH — credenciales de acceso al panel cocina
══════════════════════════════════════════════ */
const AUTH_KEY      = 'antojitos_kitchen_auth_v1';

/* El usuario y la clave de cocina YA NO están escritos aquí: se verifican en
   el servidor (migracion-clave-cocina.sql → verify_cocina_login), donde la
   clave se guarda cifrada y el admin la cambia desde Ajustes. 5 intentos
   fallidos bloquean el acceso 5 minutos.
   Respaldo SOLO mientras esa migración no se haya ejecutado: se compara una
   huella SHA-256 de las credenciales de siempre (no la clave en texto). En
   cuanto existe la función del servidor, este respaldo nunca se usa. */
const LEGACY_LOGIN_SHA256 = '5bfcc175dc0cadaf2d413e2c970b45b47ef938b8bf44ff48fb87fddba0374535';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// true/false · lanza 'LOGIN_LOCKED' (demasiados intentos) o 'LOGIN_CHECK_FAILED' (sin conexión)
async function verifyKitchenLogin(usuario, clave) {
  const { data, error } = await _supabase.rpc('verify_cocina_login', { p_usuario: usuario, p_clave: clave });
  if (!error) return data === true;
  if (/LOGIN_LOCKED/.test(String(error.message || ''))) throw new Error('LOGIN_LOCKED');
  if (isMissingRpc(error)) {
    // Migración pendiente → respaldo con la huella de las credenciales de siempre
    try {
      return (await sha256Hex(`${usuario.trim().toLowerCase()}:${clave}`)) === LEGACY_LOGIN_SHA256;
    } catch (_) {
      throw new Error('LOGIN_CHECK_FAILED');
    }
  }
  console.warn('[Cocina] No se pudo verificar el acceso:', error.message);
  throw new Error('LOGIN_CHECK_FAILED');
}

function isKitchenAuthed() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw).ok === true : false;
  } catch(_) { return false; }
}
function setKitchenAuthed(val) {
  try {
    if (val) localStorage.setItem(AUTH_KEY, JSON.stringify({ ok: true }));
    else      localStorage.removeItem(AUTH_KEY);
  } catch(_) {}
}

/* ══════════════════════════════════════════════
   SESSION — localStorage para filtro de sesión
══════════════════════════════════════════════ */
const SESSION_KEY = 'antojitos_kitchen_session_start';

function getSessionStart() {
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    const d = new Date(stored);
    if (!isNaN(d.getTime())) return stored;
  }
  return resetSessionToToday();
}

function resetSessionToToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const iso = today.toISOString();
  localStorage.setItem(SESSION_KEY, iso);
  return iso;
}

function isNewCalendarDay(sessionStart) {
  const s = new Date(sessionStart);
  s.setHours(0, 0, 0, 0);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return s.getTime() < t.getTime();
}

/* ══════════════════════════════════════════════
   AUDIO — Web Audio API
══════════════════════════════════════════════ */
function playReadyBell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [{freq:1047,start:0.00,dur:1.3},{freq:1319,start:0.18,dur:1.1},{freq:1568,start:0.36,dur:1.0}]
      .forEach(({freq,start,dur}) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.55, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
        osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + dur);
      });
  } catch(e) {}
}

function playNewOrderChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[660,0],[880,0.12]].forEach(([freq,start]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'triangle'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.45, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.5);
      osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + 0.5);
    });
  } catch(e) {}
}

function playModifiedChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[440,0],[554,0.11],[440,0.22],[554,0.33]].forEach(([freq,start]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'square'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.22, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.15);
      osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + 0.15);
    });
  } catch(e) {}
}

function playNewDayChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [{freq:523,start:0},{freq:659,start:0.15},{freq:784,start:0.30},{freq:1047,start:0.45}]
      .forEach(({freq,start}) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.type = 'sine'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.4, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.9);
        osc.start(ctx.currentTime + start); osc.stop(ctx.currentTime + start + 0.9);
      });
  } catch(e) {}
}

/* ══════════════════════════════════════════════
   TEXT-TO-SPEECH
══════════════════════════════════════════════ */
const EXTERNAL_ZONES = ['Para Llevar', 'Delivery', 'Recojo en Local'];

function speakReadyOrder(ord) {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const zone = typeof ord === 'object' ? ord?.zone : null;
    const mesa = typeof ord === 'object' ? ord?.table_number : ord;
    let text;
    if (EXTERNAL_ZONES.includes(zone)) {
      let info = {};
      try { info = JSON.parse(ord?.notes || '{}'); } catch(_) {}
      const name = info.customerName;
      text = name
        ? `¡Pedido de ${name} listo! Puede pasar a recoger su pedido.`
        : `¡Pedido ${zone} listo! Puede pasar a recoger.`;
    } else {
      text = `¡Pedido de la mesa ${mesa} listo! Mesero, puede recoger.`;
    }
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'es-ES'; utt.rate = 0.88; utt.pitch = 1.05; utt.volume = 1;
    window.speechSynthesis.speak(utt);
  } catch(e) {}
}

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */
const nowT = () => new Date().toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' });

const elapsedMins = dateStr => !dateStr ? 0 : Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);

const elapsedStr = dateStr => {
  const m = elapsedMins(dateStr);
  if (m < 1)  return '<1m';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m/60)}h ${m%60}m`;
};

const timeStr = dateStr => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' });
};

const dateLabel = iso => {
  const d = new Date(iso);
  return d.toLocaleDateString('es-PE', { weekday:'long', day:'numeric', month:'long' });
};

const todayLong = () => {
  const d = new Date();
  return d.toLocaleDateString('es-PE', { weekday:'short', day:'numeric', month:'short' }).toUpperCase();
};

function getUrgency(order) {
  if (!order.created_at) return 'normal';
  const isExt     = EXTERNAL_ZONES.includes(order.zone);
  const kitState  = isExt ? (order.kitchen_status || 'pending') : order.status;
  if (kitState === 'ready') return 'normal';
  // Pedidos de mesa CON rondas: la urgencia se mide desde que se envió la
  // ronda activa más antigua, no desde `created_at` del pedido — así una
  // mesa que llevaba horas abierta y recién amplía su pedido no aparece
  // como "urgente" por un tiempo que no corresponde a lo recién enviado.
  let sinceISO = order.created_at;
  if (!isExt && Array.isArray(order.rounds) && order.rounds.length > 0) {
    const active = order.rounds.filter(r => r.status !== 'listo');
    if (active.length) {
      sinceISO = active.reduce((oldest, r) =>
        (!oldest || new Date(r.sentAt) < new Date(oldest)) ? r.sentAt : oldest, null) || order.created_at;
    }
  }
  const mins = elapsedMins(sinceISO);
  if (kitState === 'pending') {
    if (mins >= 20) return 'critical';
    if (mins >= 10) return 'warning';
  }
  if (kitState === 'preparing') {
    if (mins >= 25) return 'critical';
    if (mins >= 15) return 'warning';
  }
  return 'normal';
}

/* ══════════════════════════════════════════════
   STATUS CONFIG
══════════════════════════════════════════════ */
const STATUS = {
  pending:   { label:'PENDIENTE',  color:'#D97706', bg:'rgba(245,158,11,0.07)',  border:'rgba(245,158,11,0.22)',  dot:'#F59E0B' },
  preparing: { label:'PREPARANDO', color:'#1D4ED8', bg:'rgba(37,99,235,0.07)',   border:'rgba(37,99,235,0.22)',   dot:'#3B82F6' },
  ready:     { label:'LISTO ✓',   color:'#047857', bg:'rgba(16,185,129,0.07)',  border:'rgba(16,185,129,0.22)',  dot:'#10B981' },
};

const isPaid = s => s && (s.startsWith('Pagado') || s === 'paid' || s === 'served' || s === 'archivado');

/* ══════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════ */
function Clock() {
  const [t, setT] = useState(nowT());
  useEffect(() => { const id = setInterval(() => setT(nowT()), 15000); return () => clearInterval(id); }, []);
  return (
    <span style={{
      fontFamily:'var(--mono)', fontSize:12, color:'var(--snow)',
      background:'var(--ink3)', border:'1px solid var(--line2)',
      padding:'5px 10px', borderRadius:20, fontWeight:700,
    }}>{t}</span>
  );
}

/* ══════════════════════════════════════════════
   TOASTS
══════════════════════════════════════════════ */
function Toasts({ list, remove }) {
  return (
    <div style={{
      position:'fixed', top:14, left:'50%', transform:'translateX(-50%)',
      zIndex:900, display:'flex', flexDirection:'column', gap:6,
      alignItems:'center', pointerEvents:'none',
    }}>
      {list.map(t => (
        <div key={t.id} onClick={() => remove(t.id)} style={{
          background:'#FFFFFF',
          border:`1px solid ${t.type==='ok'?'rgba(16,185,129,.3)':t.type==='err'?'rgba(239,68,68,.3)':'rgba(245,158,11,.3)'}`,
          borderRadius:30, padding:'9px 20px',
          fontSize:13, fontWeight:700,
          boxShadow:'0 4px 20px rgba(0,0,0,0.10)',
          animation:'slideDown .22s var(--ease)',
          whiteSpace:'nowrap', pointerEvents:'all', cursor:'pointer',
          color:t.type==='ok'?'#047857':t.type==='err'?'#DC2626':'#D97706',
          maxWidth:'90vw', overflow:'hidden', textOverflow:'ellipsis',
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════
   LOGOUT CONFIRM MODAL
   Confirma y ejecuta el archivado + cierre de sesión
══════════════════════════════════════════════ */
function LogoutConfirmModal({ onConfirm, onCancel, loading, stats }) {
  return (
    <div
      style={{
        position:'fixed', inset:0, background:'rgba(15,23,42,0.55)',
        zIndex:800, display:'flex', alignItems:'center', justifyContent:'center',
        padding:16, backdropFilter:'blur(8px)',
      }}
      onClick={e => e.target === e.currentTarget && !loading && onCancel()}
    >
      <div style={{
        background:'#FFFFFF', border:'1px solid rgba(239,68,68,0.18)',
        borderRadius:22, width:'100%', maxWidth:400,
        animation:'modalIn .25s var(--ease)',
        overflow:'hidden',
        boxShadow:'0 24px 64px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{
          background:'linear-gradient(135deg,rgba(239,68,68,0.06),rgba(220,38,38,0.03))',
          borderBottom:'1px solid rgba(239,68,68,0.15)',
          padding:'24px 24px 18px', textAlign:'center',
        }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:10 }}><LogOut size={40} color="#DC2626" strokeWidth={1.75}/></div>
          <div style={{ fontFamily:'var(--display)', fontSize:24, color:'#DC2626', letterSpacing:2 }}>
            CERRAR SESIÓN
          </div>
          <div style={{ fontSize:12, color:'var(--fog)', marginTop:5, lineHeight:1.5 }}>
            Se archivará todo el historial de pedidos<br/>y la pantalla de cocina quedará en blanco.
          </div>
        </div>

        {/* Stats rápido */}
        <div style={{ padding:'18px 24px' }}>
          {stats && (
            <div style={{
              display:'grid', gridTemplateColumns:'1fr 1fr 1fr',
              gap:8, marginBottom:16,
            }}>
              {[
                { label:'Total pedidos', value: stats.total,     color:'var(--mist)'   },
                { label:'Completados',   value: stats.completed, color:'var(--emerald)' },
                { label:'Activos',       value: stats.active,    color: stats.active > 0 ? 'var(--crimson)' : 'var(--fog)' },
              ].map(s => (
                <div key={s.label} style={{
                  background:'var(--ink3)', borderRadius:10,
                  border:`1px solid ${s.label==='Activos' && s.value > 0 ? 'rgba(239,68,68,.3)' : 'var(--line)'}`,
                  padding:'12px 6px', textAlign:'center',
                }}>
                  <div style={{ fontFamily:'var(--mono)', fontSize:24, fontWeight:700, color:s.color, lineHeight:1 }}>
                    {s.value}
                  </div>
                  <div style={{ fontSize:9, color:'var(--fog)', marginTop:4, letterSpacing:.5 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Aviso */}
          <div style={{
            background:'rgba(239,68,68,0.05)', border:'1px solid rgba(239,68,68,0.18)',
            borderRadius:10, padding:'12px 14px',
            display:'flex', alignItems:'flex-start', gap:10, marginBottom:4,
          }}>
            <AlertTriangle size={16} style={{flexShrink:0, marginTop:1}} color="#DC2626"/>
            <div style={{ fontSize:12, color:'var(--fog)', lineHeight:1.6 }}>
              Esta acción marcará todos los pedidos como <strong style={{color:'var(--snow)'}}>archivados</strong> en la base de datos.
              Los registros de ventas de los meseros se conservan intactos.
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ padding:'0 24px 24px', display:'flex', gap:10 }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              flex:1, padding:'13px', background:'var(--ink3)',
              border:'1px solid var(--line2)', borderRadius:12,
              color:'var(--mist)', fontSize:14, fontWeight:700,
              opacity: loading ? 0.5 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              flex:2, padding:'13px', borderRadius:12,
              background: loading
                ? 'rgba(239,68,68,0.08)'
                : 'linear-gradient(135deg,#B91C1C,#DC2626)',
              border: loading ? '1px solid rgba(239,68,68,0.35)' : 'none',
              color: loading ? '#DC2626' : '#fff',
              fontSize:14, fontWeight:800,
              display:'flex', alignItems:'center', justifyContent:'center', gap:8,
              transition:'all .2s', opacity: loading ? 0.7 : 1,
              boxShadow: loading ? 'none' : '0 4px 16px rgba(220,38,38,.25)',
            }}
          >
            {loading ? (
              <><span className="spinner" style={{width:14,height:14,borderWidth:2,borderTopColor:'#DC2626'}}/> Archivando...</>
            ) : (
              <><LogOut size={16}/> Confirmar Cierre</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   URGENCY BANNER
══════════════════════════════════════════════ */
function UrgencyBanner({ orders, onFocus }) {
  const critical = orders.filter(o => getUrgency(o) === 'critical');
  const warning  = orders.filter(o => getUrgency(o) === 'warning');
  if (!critical.length && !warning.length) return null;

  const mesas = [...new Set(critical.map(o => o.table_number))].join(', ');
  const isCrit = critical.length > 0;

  return (
    <div
      onClick={onFocus}
      style={{
        background: isCrit ? 'rgba(239,68,68,0.07)' : 'rgba(245,158,11,0.06)',
        border: `1px solid ${isCrit ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.28)'}`,
        borderRadius:0,
        padding:'9px 16px',
        display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
        cursor:'pointer', flexShrink:0,
        animation:'bannerIn .3s var(--ease)',
        borderLeft:'none', borderRight:'none',
      }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ display:'inline-flex', animation: isCrit ? 'blink 1s infinite' : 'none' }}>
          {isCrit ? <Siren size={18} color="#DC2626"/> : <AlertTriangle size={18} color="#D97706"/>}
        </span>
        <div>
          <div style={{ fontSize:12, fontWeight:800, color: isCrit ? '#DC2626' : '#D97706' }}>
            {isCrit
              ? `${critical.length} pedido${critical.length>1?'s':''} con más de 20 min sin preparar`
              : `${warning.length} pedido${warning.length>1?'s':''} demorado${warning.length>1?'s':''}`
            }
          </div>
          {isCrit && mesas && (
            <div style={{ fontSize:10, color:'var(--fog)', marginTop:2 }}>
              Mesa{critical.length>1?'s':''}: {mesas}
            </div>
          )}
        </div>
      </div>
      <div style={{
        fontSize:10, fontWeight:700, color: isCrit ? '#DC2626' : '#D97706',
        background: isCrit ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
        padding:'4px 10px', borderRadius:20,
        border: `1px solid ${isCrit ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
      }}>
        VER →
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   ORDER CARD (activos — con sistema de urgencia)
══════════════════════════════════════════════ */
function OrderCard({ order, onAction, onRoundAction, isNew, isModified }) {
  const isExt      = EXTERNAL_ZONES.includes(order.zone);
  // Para pedidos externos: el estado de cocina vive en kitchen_status
  const kitchenState = isExt ? (order.kitchen_status || 'pending') : order.status;
  const cfg      = STATUS[kitchenState] || STATUS.pending;
  const allItems = Array.isArray(order.items) ? order.items : [];
  // Pedidos de mesa (mesero.html) traen `rounds` — el historial de cada
  // envío a cocina con su propio estado. Esto permite que una mesa siga
  // ampliando su pedido de forma ILIMITADA (incluso con rondas anteriores
  // ya "Listas") sin que cocina vuelva a ver los ítems ya despachados.
  // Pedidos externos (Delivery/Recojo/Para Llevar) no usan rondas — un
  // solo envío — y se muestran exactamente como antes.
  const hasRounds     = !isExt && Array.isArray(order.rounds) && order.rounds.length > 0;
  const activeRounds  = hasRounds ? order.rounds.filter(r => r.status !== 'listo') : [];
  const doneRounds    = hasRounds ? order.rounds.filter(r => r.status === 'listo') : [];
  // Fallback: sin `rounds` (migración pendiente, o pedido legado) o sin
  // ninguna ronda activa (caso raro) → se muestra el pedido completo,
  // comportamiento idéntico al de antes de esta función.
  const items    = allItems; // ítems completos — usado como fallback y para conteos/totales
  const urgency  = getUrgency(order);
  const [acting,   setActing]   = useState(false);
  const [actingRounds, setActingRounds] = useState(() => new Set());
  const [elapsed_, setElapsed_] = useState(elapsedStr(order.created_at));
  const [mins_,    setMins_]    = useState(elapsedMins(order.created_at));

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed_(elapsedStr(order.created_at));
      setMins_(elapsedMins(order.created_at));
    }, 30000);
    return () => clearInterval(id);
  }, [order.created_at]);

  const handleAction = async newStatus => {
    setActing(true);
    await onAction(order.id, newStatus, order);
    setActing(false);
  };

  // Avanza el estado de UNA ronda específica (no todo el pedido) — permite
  // que "Empezar Preparación"/"Marcar Lista" de la Ronda 1 no bloquee ni
  // se confunda con una Ronda 2 que llegó después.
  const handleRoundAction = async (roundN, newStatus) => {
    setActingRounds(prev => new Set(prev).add(roundN));
    await onRoundAction(order.id, roundN, newStatus, order);
    setActingRounds(prev => { const s = new Set(prev); s.delete(roundN); return s; });
  };

  const urgBorder = urgency === 'critical' ? 'rgba(239,68,68,0.65)'
    : urgency === 'warning' ? 'rgba(245,158,11,0.55)'
    : cfg.border;

  const urgAnim = urgency === 'critical' ? 'urgCrit 2s ease-in-out infinite'
    : urgency === 'warning' ? 'urgWarn 2.5s ease-in-out infinite'
    : isNew ? 'newCard 2s ease-out forwards'
    : 'none';

  const elapsedPct = Math.min(100, (mins_ / (kitchenState === 'pending' ? 20 : 25)) * 100);
  const elapsedColor = urgency === 'critical' ? '#EF4444'
    : urgency === 'warning' ? '#F59E0B'
    : order.status === 'preparing' ? '#3B82F6' : '#10B981';

  return (
    <div style={{
      background:'#FFFFFF',
      border:`1px solid ${urgBorder}`,
      borderRadius:'var(--r)',
      overflow:'hidden',
      display:'flex', flexDirection:'column',
      animation:`fadeUp .38s var(--ease) forwards`,
      boxShadow: urgency !== 'normal'
        ? `0 0 0 1px ${urgBorder}, 0 4px 20px rgba(0,0,0,0.08)`
        : '0 2px 12px rgba(0,0,0,0.06)',
      animationName: isNew && urgency === 'normal' ? 'fadeUp, newCard' : 'fadeUp',
      animationDuration: '0.38s, 2s',
    }}>

      {/* Urgency badge */}
      {urgency !== 'normal' && (
        <div style={{
          background: urgency === 'critical' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
          borderBottom: `1px solid ${urgency === 'critical' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
          padding:'5px 14px',
          display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
          <div style={{
            fontSize:10, fontWeight:800, letterSpacing:1.5,
            color: urgency === 'critical' ? '#DC2626' : '#D97706',
            display:'flex', alignItems:'center', gap:6,
          }}>
            <span style={{ display:'inline-flex', animation:'blink 1s infinite' }}>
              {urgency === 'critical' ? <Siren size={14} color="#DC2626"/> : <AlertTriangle size={14} color="#D97706"/>}
            </span>
            {urgency === 'critical' ? 'URGENTE — MÁS DE 20 MIN' : 'DEMORADO — MÁS DE 10 MIN'}
          </div>
          <div style={{ fontFamily:'var(--mono)', fontSize:11, fontWeight:700, color: urgency === 'critical' ? '#DC2626' : '#D97706' }}>
            {elapsed_}
          </div>
        </div>
      )}

      {/* ── Badge: pedido modificado ── */}
      {isModified && (
        <div style={{
          background:'rgba(245,158,11,0.10)',
          borderBottom:'2px solid rgba(245,158,11,0.40)',
          padding:'7px 14px',
          display:'flex', alignItems:'center', gap:9,
          animation:'urgWarn 1.4s ease-in-out infinite',
        }}>
          <span style={{ display:'inline-flex', animation:'blink 0.9s infinite' }}><PlusCircle size={15} color="#D97706"/></span>
          <div style={{ fontSize:11, fontWeight:800, color:'#D97706', letterSpacing:1, textTransform:'uppercase' }}>
            {hasRounds
              ? `Ampliación — Ronda ${order.rounds[order.rounds.length-1].n} — Solo lo nuevo abajo`
              : 'Pedido modificado — Revisa los cambios'}
          </div>
        </div>
      )}
      {!isModified && (
        <div style={{
          background:'rgba(16,185,129,0.08)',
          borderBottom:'1px solid rgba(16,185,129,0.25)',
          padding:'5px 14px',
          fontSize:10, fontWeight:800, color:'#047857', letterSpacing:1, textTransform:'uppercase',
          display:'flex', alignItems:'center', gap:4,
        }}>
          <Sparkles size={11}/> Nueva Comanda{hasRounds ? ' — Ronda 1' : ''}
        </div>
      )}

      {/* ── Header: mesa / cliente externo + estado ── */}
      {(() => {
        const isExt = EXTERNAL_ZONES.includes(order.zone);
        let extInfo = {};
        if (isExt) { try { extInfo = JSON.parse(order.notes || '{}'); } catch(_) {} }
        const urgColor = urgency === 'critical' ? '#DC2626' : urgency === 'warning' ? '#D97706' : cfg.color;
        const ZoneIcon  = order.zone === 'Para Llevar' ? ShoppingBag : order.zone === 'Delivery' ? Bike : Store;
        const zoneColor = order.zone === 'Delivery' ? '#1D4ED8' : order.zone === 'Para Llevar' ? '#7C3AED' : '#9333EA';
        return (
      <div style={{
        background: cfg.bg,
        borderBottom:`1px solid ${cfg.border}`,
        padding:'12px 14px',
        display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {isExt ? (
            <>
              <ZoneIcon size={34} strokeWidth={1.5} style={{opacity:.9, flexShrink:0}} color={zoneColor}/>
              <div>
                <div style={{ fontSize:9, color:'var(--fog)', letterSpacing:1.5, textTransform:'uppercase' }}>{order.zone}</div>
                <div style={{ fontSize:16, fontWeight:800, color: urgency!=='normal' ? urgColor : zoneColor, marginTop:2, lineHeight:1.2 }}>
                  {extInfo.customerName || '—'}
                </div>
                {extInfo.phone && (
                  <div style={{ fontSize:10, color:'var(--mist)', marginTop:2, display:'flex', alignItems:'center', gap:3 }}><Phone size={10}/> {extInfo.phone}</div>
                )}
              </div>
            </>
          ) : (
            <>
              <div style={{
                fontFamily:'var(--display)', fontSize:46,
                color: urgColor, lineHeight:1,
                textShadow:`0 0 24px ${urgency !== 'normal' ? (urgency==='critical'?'#EF444430':'#F59E0B30') : cfg.dot+'30'}`,
              }}>
                {String(order.table_number).padStart(2,'0')}
              </div>
              <div>
                <div style={{ fontSize:9, color:'var(--fog)', letterSpacing:1.5, textTransform:'uppercase' }}>Mesa</div>
                <div style={{ fontSize:11, color:'var(--mist)', marginTop:1 }}>{order.zone || 'General'}</div>
              </div>
            </>
          )}
        </div>

        <div style={{ textAlign:'right' }}>
          <div style={{
            display:'inline-flex', alignItems:'center', gap:5,
            fontSize:10, fontWeight:800, letterSpacing:1,
            color:cfg.color, padding:'4px 10px', borderRadius:20,
            border:`1px solid ${cfg.border}`, background:'#FFFFFF',
          }}>
            <div style={{
              width:6, height:6, borderRadius:'50%', background:cfg.dot,
              animation: kitchenState === 'preparing' ? 'blink 1.5s ease-in-out infinite' : 'none',
            }}/>
            {cfg.label}
          </div>
          {/* Envases descartables para llevar (migracion-envases.sql) */}
          {Number(order.packaging_count) > 0 && (
            <div style={{ marginTop:6 }}>
              <span style={{
                display:'inline-block', fontSize:11, fontWeight:900, letterSpacing:.5, color:'#fff',
                background:'#7C3AED', padding:'3px 9px', borderRadius:6,
              }}>
                PARA LLEVAR · {Math.min(99, Math.floor(Number(order.packaging_count)))} ENVASE{Number(order.packaging_count) !== 1 ? 'S' : ''}
              </span>
            </div>
          )}
          {urgency === 'normal' && (
            <div style={{
              fontFamily:'var(--mono)', fontSize:11, color:'var(--fog)',
              marginTop:6, display:'flex', alignItems:'center', gap:4, justifyContent:'flex-end',
            }}>
              ⏱ {elapsed_} · {timeStr(order.created_at)}
            </div>
          )}
        </div>
      </div>
        );
      })()}

      {/* Barra de tiempo transcurrido */}
      <div style={{ height:3, background:'var(--line)', position:'relative', overflow:'hidden' }}>
        <div style={{
          position:'absolute', left:0, top:0, bottom:0,
          width:`${elapsedPct}%`,
          background:`linear-gradient(90deg, ${elapsedColor}66, ${elapsedColor})`,
          transition:'width 1s ease',
          borderRadius:'0 2px 2px 0',
        }}/>
      </div>

      {/* ── Mesero ── */}
      <div style={{
        padding:'8px 14px',
        borderBottom:'1px solid var(--line)',
        display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{
            width:30, height:30, borderRadius:'50%',
            background:'var(--ink4)', border:'1px solid var(--line2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:13, fontWeight:900, color:'var(--amber)',
          }}>
            {(order.waiter_name||'?')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize:12, fontWeight:700, color:'var(--snow)' }}>
              {order.waiter_name || 'Mesero'}
            </div>
            <div style={{ fontSize:10, color:'var(--fog)' }}>
              {/* Cuenta/total siempre del pedido COMPLETO (histórico + nuevo),
                  aunque abajo solo se listen los ítems pendientes de esta ronda. */}
              {allItems.reduce((s,i) => s+(i.qty||1), 0)} ítem{allItems.reduce((s,i)=>s+(i.qty||1),0)!==1?'s':''} en total
              {' · '}<span style={{ fontFamily:'var(--mono)', color:'var(--amber)' }}>
                S/ {(order.total||0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
        <div style={{ fontFamily:'var(--mono)', fontSize:10, color:'var(--ghost)' }}>
          #{String(order.id).slice(-4).toUpperCase()}
        </div>
      </div>

      {hasRounds ? (
        <>
          {/* ── Tira de rondas completadas — historial colapsado, no bloquea el tablero ── */}
          {doneRounds.length > 0 && (
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, padding:'8px 14px', borderBottom:'1px solid var(--line)' }}>
              {doneRounds.map(r => (
                <span key={r.n} style={{
                  fontSize:10, fontWeight:800, color:'#047857',
                  background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.25)',
                  borderRadius:20, padding:'2px 9px',
                  display:'inline-flex', alignItems:'center', gap:3,
                }}>
                  <Check size={10}/> Ronda {r.n}
                </span>
              ))}
            </div>
          )}

          {/* ── Rondas ACTIVAS — cada una con sus propios ítems y botón ── */}
          {activeRounds.length === 0 ? (
            <div style={{ padding:'16px 14px', textAlign:'center', fontSize:12, color:'var(--fog)' }}>
              Todas las rondas de esta mesa están listas.
            </div>
          ) : activeRounds.map(round => {
            const rActing = actingRounds.has(round.n);
            const rItems  = Array.isArray(round.items) ? round.items : [];
            // Ronda 1 = pedido original de la mesa (ya se anuncia con el
            // banner "🆕 Nueva Comanda" de arriba). Ronda 2+ = un ADICIONAL
            // sobre una mesa que ya tenía algo en curso/despachado — esto
            // necesita el tratamiento visual llamativo que pide el cocinero
            // para no confundirlo con lo que ya está preparando/listo.
            const isAddon = round.n > 1;
            return (
              <div key={round.n} style={isAddon ? {
                borderBottom:'1px solid var(--line)',
                margin:'8px 10px', borderRadius:10,
                border:'2px solid #F59E0B',
                animation:'newBatchGlow 1.6s ease-in-out infinite',
                overflow:'hidden',
              } : { borderBottom:'1px solid var(--line)' }}>
                {isAddon && (
                  <div style={{
                    padding:'8px 14px', textAlign:'center',
                    animation:'newBatchBg 1.6s ease-in-out infinite',
                  }}>
                    <div style={{ fontSize:13, fontWeight:900, color:'#7C2D12', letterSpacing:.5, display:'flex', alignItems:'center', gap:5 }}>
                      <PlusCircle size={13}/> NUEVO PEDIDO / ADICIONAL — RONDA {round.n}
                    </div>
                    <div style={{ fontSize:10, fontWeight:800, color:'#92400E', marginTop:2, display:'flex', alignItems:'center', gap:4 }}>
                      <AlertTriangle size={11}/> ¡ATENCIÓN: SOLO PREPARAR ESTOS PLATOS! Lo demás ya fue notificado.
                    </div>
                  </div>
                )}
                <div style={{
                  padding:'6px 14px', fontSize:10, fontWeight:800, letterSpacing:1,
                  color: round.status === 'en_cocina' ? '#1D4ED8' : '#D97706',
                  background: round.status === 'en_cocina' ? 'rgba(37,99,235,0.06)' : 'rgba(245,158,11,0.06)',
                  textTransform:'uppercase',
                }}>
                  RONDA {round.n} · {round.status === 'en_cocina' ? 'En preparación' : 'Pendiente'}
                </div>
                {rItems.map((item, i) => (
                  <div key={i} style={{
                    display:'flex', alignItems:'flex-start', gap:10,
                    padding:'9px 14px',
                    borderBottom: i < rItems.length-1 ? '1px solid var(--line)' : 'none',
                    background: isAddon
                      ? (i % 2 === 0 ? 'rgba(245,158,11,0.05)' : 'rgba(245,158,11,0.10)')
                      : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.025)'),
                  }}>
                    <div style={{
                      minWidth:32, height:32, borderRadius:8,
                      background:'var(--ink3)', border:'1px solid var(--line)',
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:15, fontWeight:900, color:'var(--amber)', flexShrink:0,
                    }}>
                      {item.qty||1}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:14, fontWeight:700, color:'var(--snow)', lineHeight:1.3, wordBreak:'break-word', display:'flex', alignItems:'center', flexWrap:'wrap', gap:6 }}>
                        {item.name||'?'}
                        {isAddon && (
                          <span style={{
                            fontSize:9, fontWeight:900, color:'#7C2D12',
                            background:'#FCD34D', border:'1px solid #D97706',
                            borderRadius:20, padding:'1px 7px', letterSpacing:.5,
                            animation:'newTagPop .4s ease-out',
                          }}>
                            ¡NUEVO!
                          </span>
                        )}
                      </div>
                      {item.portionTag && (
                        <div style={{ fontSize:10, color:'var(--amber)', marginTop:2, fontWeight:700, letterSpacing:.5 }}>
                          {item.portionTag}
                        </div>
                      )}
                      {item.note && (
                        <div style={{
                          fontSize:12, color:'#DC2626', marginTop:4, fontWeight:700,
                          background:'rgba(239,68,68,0.07)', padding:'3px 8px',
                          borderRadius:4, borderLeft:'2px solid #EF4444',
                        }}>
                          <AlertTriangle size={11} style={{verticalAlign:-1,marginRight:3}}/>{item.note}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div style={{ padding:'10px 14px' }}>
                  {round.status === 'pendiente' && (
                    <button
                      onClick={() => handleRoundAction(round.n, 'en_cocina')}
                      disabled={rActing}
                      style={{
                        width:'100%', padding:'11px 14px',
                        background: rActing ? '#FEF3C7' : '#F59E0B',
                        border: rActing ? '1px solid rgba(245,158,11,0.3)' : 'none',
                        borderRadius:'var(--r2)',
                        color: rActing ? '#D97706' : '#FFFFFF',
                        fontSize:13, fontWeight:800,
                        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                        transition:'all .2s', opacity: rActing ? 0.7 : 1,
                        boxShadow: rActing ? 'none' : '0 2px 8px rgba(245,158,11,0.35)',
                      }}
                    >
                      {rActing ? <span className="spinner" style={{width:14,height:14,borderWidth:2}}/> : <Flame size={14}/>}
                      Empezar Preparación — Ronda {round.n}
                    </button>
                  )}
                  {round.status === 'en_cocina' && (
                    <button
                      onClick={() => handleRoundAction(round.n, 'listo')}
                      disabled={rActing}
                      style={{
                        width:'100%', padding:'11px 14px',
                        background: rActing ? '#D1FAE5' : '#10B981',
                        border: rActing ? '1px solid rgba(16,185,129,0.3)' : 'none',
                        borderRadius:'var(--r2)',
                        color: rActing ? '#047857' : '#FFFFFF',
                        fontSize:13, fontWeight:800,
                        display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                        transition:'all .2s', opacity: rActing ? 0.7 : 1,
                        boxShadow: rActing ? 'none' : '0 2px 8px rgba(16,185,129,0.40)',
                        animation: rActing ? 'none' : 'pulseBtn 2s ease-in-out infinite',
                      }}
                    >
                      {rActing ? <span className="spinner" style={{width:14,height:14,borderWidth:2}}/> : <CheckCircle2 size={14}/>}
                      Marcar Lista — Ronda {round.n}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </>
      ) : (
        <>
          {/* ── Items (pedido sin `rounds` — legado o migración pendiente) ── */}
          <div style={{ flex:1 }}>
            {items.map((item, i) => (
              <div key={i} style={{
                display:'flex', alignItems:'flex-start', gap:10,
                padding:'9px 14px',
                borderBottom: i < items.length-1 ? '1px solid var(--line)' : 'none',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.025)',
              }}>
                <div style={{
                  minWidth:32, height:32, borderRadius:8,
                  background:'var(--ink3)', border:'1px solid var(--line)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:15, fontWeight:900, color:'var(--amber)', flexShrink:0,
                }}>
                  {item.qty||1}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--snow)', lineHeight:1.3, wordBreak:'break-word' }}>
                    {item.name||'?'}
                  </div>
                  {item.portionTag && (
                    <div style={{ fontSize:10, color:'var(--amber)', marginTop:2, fontWeight:700, letterSpacing:.5 }}>
                      {item.portionTag}
                    </div>
                  )}
                  {item.note && (
                    <div style={{
                      fontSize:12, color:'#DC2626', marginTop:4, fontWeight:700,
                      background:'rgba(239,68,68,0.07)', padding:'3px 8px',
                      borderRadius:4, borderLeft:'2px solid #EF4444',
                    }}>
                      <AlertTriangle size={11} style={{verticalAlign:-1,marginRight:3}}/>{item.note}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Action buttons (todo el pedido a la vez) ── */}
          <div style={{ padding:'12px 14px', borderTop:'1px solid var(--line)' }}>
            {kitchenState === 'pending' && (
              <button
                onClick={() => handleAction('preparing')}
                disabled={acting}
                style={{
                  width:'100%', padding:'13px 16px',
                  background: acting ? '#FEF3C7' : '#F59E0B',
                  border: acting ? '1px solid rgba(245,158,11,0.3)' : 'none',
                  borderRadius:'var(--r2)',
                  color: acting ? '#D97706' : '#FFFFFF',
                  fontSize:14, fontWeight:800,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                  transition:'all .2s', opacity: acting ? 0.7 : 1,
                  boxShadow: acting ? 'none' : '0 2px 8px rgba(245,158,11,0.35)',
                }}
              >
                {acting ? <span className="spinner" style={{width:16,height:16,borderWidth:2}}/> : <Flame size={16}/>}
                Empezar Preparación
              </button>
            )}

            {kitchenState === 'preparing' && (
              <button
                onClick={() => handleAction('ready')}
                disabled={acting}
                style={{
                  width:'100%', padding:'13px 16px',
                  background: acting ? '#D1FAE5' : '#10B981',
                  border: acting ? '1px solid rgba(16,185,129,0.3)' : 'none',
                  borderRadius:'var(--r2)',
                  color: acting ? '#047857' : '#FFFFFF',
                  fontSize:14, fontWeight:800,
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                  transition:'all .2s', opacity: acting ? 0.7 : 1,
                  boxShadow: acting ? 'none' : '0 2px 8px rgba(16,185,129,0.40)',
                  animation: acting ? 'none' : 'pulseBtn 2s ease-in-out infinite',
                }}
              >
                {acting ? <span className="spinner" style={{width:16,height:16,borderWidth:2}}/> : <CheckCircle2 size={16}/>}
                {isExt ? 'Listo / Avisar al cliente' : 'Marcar como Listo'}
              </button>
            )}

            {kitchenState === 'ready' && (
              <div style={{
                width:'100%', padding:'11px 16px',
                background:'rgba(16,185,129,0.07)',
                border:'1px solid rgba(16,185,129,0.22)',
                borderRadius:'var(--r2)', color:'#047857',
                fontSize:13, fontWeight:700, textAlign:'center',
                display:'flex', alignItems:'center', justifyContent:'center', gap:6,
              }}>
                <CheckCircle2 size={14}/> {isExt ? 'Cliente notificado — Listo para entrega' : 'Notificado al mesero — Esperando recogida'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════
   COMPLETED CARD (historial)
══════════════════════════════════════════════ */
function CompletedCard({ order }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const method = order.status?.replace('Pagado - ','') || 'Completado';

  return (
    <div style={{
      background:'#FAFAFA',
      border:'1px solid var(--line)',
      borderRadius:'var(--r)',
      overflow:'hidden',
      opacity:.88,
      animation:'fadeUp .3s var(--ease)',
    }}>
      <div style={{
        padding:'10px 14px',
        borderBottom:'1px solid var(--line)',
        display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{
            fontFamily:'var(--display)', fontSize:32, color:'var(--ghost)',
            lineHeight:1,
          }}>
            {String(order.table_number).padStart(2,'0')}
          </div>
          <div>
            <div style={{ fontSize:11, color:'var(--mist)', fontWeight:600 }}>Mesa · {order.waiter_name||'Mesero'}</div>
            <div style={{ fontSize:10, color:'var(--fog)' }}>{timeStr(order.created_at)} → {timeStr(order.updated_at)}</div>
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{
            fontSize:10, fontWeight:700, color:'#047857',
            background:'rgba(16,185,129,0.08)', padding:'3px 9px', borderRadius:20,
            border:'1px solid rgba(16,185,129,0.22)',
            display:'flex', alignItems:'center', gap:4,
          }}>
            <Check size={10}/> {method}
          </div>
          <div style={{ fontFamily:'var(--mono)', fontSize:12, color:'var(--amber)', marginTop:5 }}>
            S/ {(order.total||0).toFixed(2)}
          </div>
        </div>
      </div>
      <div style={{ padding:'8px 14px', display:'flex', flexWrap:'wrap', gap:6 }}>
        {items.slice(0,6).map((item,i) => (
          <span key={i} style={{
            fontSize:11, color:'var(--fog)', background:'#FFFFFF',
            border:'1px solid var(--line)', borderRadius:6,
            padding:'3px 8px',
          }}>
            {item.qty>1?`${item.qty}× `:''}{item.name}
          </span>
        ))}
        {items.length > 6 && (
          <span style={{ fontSize:11, color:'var(--fog)' }}>+{items.length-6} más</span>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   NEW DAY BANNER (aviso automático de nuevo día)
══════════════════════════════════════════════ */
function NewCalendarDayBanner({ onStartNewDay, onDismiss }) {
  return (
    <div style={{
      background:'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(249,115,22,0.05))',
      border:'1px solid rgba(245,158,11,0.3)',
      borderRadius:0, borderLeft:'none', borderRight:'none',
      padding:'10px 16px', flexShrink:0,
      display:'flex', alignItems:'center', justifyContent:'space-between', gap:12,
      animation:'bannerIn .4s var(--ease)',
    }}>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <Sunrise size={20} color="#D97706"/>
        <div>
          <div style={{ fontSize:13, fontWeight:800, color:'#D97706' }}>
            ¡Es un nuevo día! La sesión es del día anterior.
          </div>
          <div style={{ fontSize:11, color:'var(--fog)' }}>
            Reinicia la vista para mostrar solo pedidos de hoy.
          </div>
        </div>
      </div>
      <div style={{ display:'flex', gap:8, flexShrink:0 }}>
        <button
          onClick={onDismiss}
          style={{
            padding:'6px 12px', background:'transparent',
            border:'1px solid var(--line2)', borderRadius:8,
            color:'var(--fog)', fontSize:12, fontWeight:700,
          }}
        >
          Ignorar
        </button>
        <button
          onClick={onStartNewDay}
          style={{
            padding:'6px 14px',
            background:'linear-gradient(135deg, rgba(245,158,11,0.18), rgba(249,115,22,0.12))',
            border:'1px solid rgba(245,158,11,0.45)', borderRadius:8,
            color:'var(--amber)', fontSize:12, fontWeight:800,
            animation:'pulseNew 2s ease-in-out infinite',
          }}
        >
          Comenzar Nuevo Día →
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   KITCHEN LOGIN — Estilos (mismo sistema que el login del admin:
   paleta del logo · tipografía Archivo · logo a tamaño completo)
══════════════════════════════════════════════ */
const KX_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&display=swap');

.kx-root {
  --carbon:   #34332E;   /* letras del logo */
  --carbon-2: #1F1E1B;
  --oro:      #B78C31;   /* llama del logo */
  --oro-txt:  #7E5A14;
  --papel:    #F9F8F4;   /* fondo del logo */
  --blanco:   #FFFFFF;
  --piedra:   #6A675F;
  --borde:    #D9D6CE;
  --error:    #A8321F;

  display: flex;
  /* La app bloquea el scroll global (html/body/#root overflow:hidden),
     así que el login se desplaza por sí mismo: en pantallas bajas o
     con el teclado abierto nunca queda nada cortado. */
  height: 100vh; height: 100dvh;
  overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  font-family: 'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--carbon);
  background: var(--blanco);
  -webkit-font-smoothing: antialiased;
  /* Por encima del degradado decorativo de cocina.html (body::before),
     que es del panel de pedidos y no debe teñir el login. */
  position: relative; z-index: 1;
}

/* ── Marca ── */
.kx-brand {
  flex: 0 0 50%;
  background: var(--papel);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 48px 40px 40px;
  position: relative;
}
.kx-logo {
  width: min(92%, 600px); height: auto;
  mix-blend-mode: multiply;
  -webkit-mask-image: radial-gradient(closest-side at 50% 50%, #000 58%, transparent 86%);
          mask-image: radial-gradient(closest-side at 50% 50%, #000 58%, transparent 86%);
  animation: kx-in .9s cubic-bezier(.2,.7,.2,1) both;
}
@keyframes kx-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }

.kx-brand-caption {
  position: absolute; left: 40px; right: 40px; bottom: 36px;
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap;
}
.kx-brand-role, .kx-brand-place { margin: 0; font-size: 14px; line-height: 1.4; }
.kx-brand-role  { font-weight: 600; color: var(--carbon); }
.kx-brand-place { color: var(--piedra); }

/* ── Formulario ── */
.kx-main {
  flex: 1 1 50%;
  display: flex; align-items: center;
  padding: 48px clamp(24px, 6vw, 96px);
  border-left: 1px solid #ECEAE4;
}
.kx-form-wrap { width: 100%; max-width: 380px; }

.kx-title {
  margin: 0 0 10px;
  font-size: clamp(34px, 3.4vw, 44px); line-height: 1.05;
  font-weight: 760; font-stretch: 118%; font-variation-settings: 'wdth' 118;
  letter-spacing: -0.02em;
  color: var(--carbon);
}
.kx-lead { margin: 0 0 32px; font-size: 15.5px; line-height: 1.55; color: var(--piedra); max-width: 34ch; }

.kx-note {
  display: flex; align-items: center; gap: 10px;
  margin: -12px 0 24px; padding: 11px 14px;
  background: #FBF6EA; border: 1px solid #EAD9AE; border-radius: 10px;
  font-size: 14px; color: #5C4410;
}

.kx-form { width: 100%; }
.kx-group { margin-bottom: 20px; }
.kx-label { display: block; margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--carbon); }

.kx-input {
  display: block; width: 100%; box-sizing: border-box;
  height: 50px; padding: 0 14px;
  background: var(--blanco);
  border: 1px solid var(--borde); border-radius: 10px;
  font: 400 16px/1.2 'Archivo', system-ui, sans-serif;   /* 16px: evita el zoom automático de iOS */
  color: var(--carbon);
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.kx-input::placeholder { color: #A29E94; }
.kx-input:hover:not(:disabled) { border-color: #B9B5AB; }
.kx-input:focus { border-color: var(--oro); box-shadow: 0 0 0 3px rgba(183,140,49,.25); }
.kx-input:disabled { background: #FAFAF8; color: var(--piedra); }
.kx-input.is-invalid { border-color: var(--error); }
.kx-input.is-invalid:focus { box-shadow: 0 0 0 3px rgba(168,50,31,.18); }

.kx-pass { position: relative; }
.kx-input-pass { padding-right: 52px; }
.kx-eye {
  position: absolute; top: 50%; right: 5px; transform: translateY(-50%);
  width: 40px; height: 40px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; color: var(--piedra);
  transition: background .15s, color .15s;
}
.kx-eye:hover { background: #F1EFEA; color: var(--carbon); }
.kx-eye:focus-visible { outline: 2px solid var(--oro); outline-offset: 0; }

.kx-hint { margin: 8px 0 0; font-size: 13.5px; color: var(--oro-txt); font-weight: 500; }

.kx-error {
  display: flex; align-items: flex-start; gap: 9px;
  margin: 0 0 18px; font-size: 14px; line-height: 1.45; color: var(--error);
}
.kx-error svg { flex-shrink: 0; margin-top: 1px; }

.kx-btn {
  width: 100%; height: 52px; margin-top: 4px;
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--carbon); color: #FFFFFF;
  border: none; border-radius: 10px; cursor: pointer;
  font: 600 16px 'Archivo', system-ui, sans-serif; letter-spacing: .005em;
  transition: background .15s, transform .1s;
}
.kx-btn:hover:not(:disabled) { background: var(--carbon-2); }
.kx-btn:active:not(:disabled) { transform: translateY(1px); }
.kx-btn:focus-visible { outline: 3px solid var(--oro); outline-offset: 3px; }
.kx-btn:disabled { cursor: progress; opacity: .85; }
.kx-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.3); border-top-color: #E3C27A;
  animation: kx-spin .7s linear infinite;
}
@keyframes kx-spin { to { transform: rotate(360deg); } }

.kx-foot { margin: 40px 0 0; font-size: 13px; color: #8C887F; }

/* ── Tablet ── */
@media (max-width: 1023px) and (min-width: 769px) {
  .kx-brand { flex-basis: 44%; }
  .kx-brand-caption { left: 28px; right: 28px; }
}

/* ── Celular: la marca pasa a una franja superior ── */
/* La franja del logo CRECE para ocupar el espacio libre de arriba: el
   formulario baja y queda a la altura del pulgar, sin hueco vacío abajo.
   En pantallas bajas (o con el teclado abierto en Android) la franja se
   encoge a su tamaño mínimo y la página simplemente se desplaza. */
@media (max-width: 768px) {
  .kx-root { flex-direction: column; }
  .kx-brand {
    flex: 1 0 auto;
    flex-direction: column; justify-content: center; align-items: center; gap: 10px;
    padding: max(28px, env(safe-area-inset-top)) 16px 24px;
    border-bottom: 1px solid #ECEAE4;
    text-align: center;
  }
  .kx-logo { width: min(52vw, 220px); margin: -8px 0 -4px; }
  .kx-brand-caption { position: static; flex-direction: column; align-items: center; gap: 2px; }
  .kx-main {
    flex: 0 0 auto; align-items: flex-start; border-left: none;
    padding: 28px 16px max(32px, calc(env(safe-area-inset-bottom) + 20px));
  }
  .kx-form-wrap { max-width: 440px; margin: 0 auto; }
  .kx-lead { margin-bottom: 24px; }
  .kx-foot { margin-top: 28px; }
}
/* Celulares muy bajos (p. ej. iPhone SE): logo más chico para que el
   formulario siga entrando casi completo sin desplazarse. */
@media (max-width: 768px) and (max-height: 700px) {
  .kx-logo { width: min(36vw, 140px); }
  .kx-brand { padding-top: max(18px, env(safe-area-inset-top)); padding-bottom: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .kx-logo { animation: none; }
  .kx-spinner { animation-duration: 1.6s; }
  .kx-input, .kx-btn, .kx-eye { transition: none; }
}
`;

/* ══════════════════════════════════════════════
   KITCHEN LOGIN — Componente
   La validación es la MISMA de siempre (usuario/clave de cocina,
   pausa de 450 ms, setKitchenAuthed + onSuccess). Solo cambia el diseño
   y se suman ayudas de uso: foco en el campo vacío, aviso de Bloq Mayús
   y de "sin conexión".
══════════════════════════════════════════════ */
function KitchenLogin({ onSuccess }) {
  const biz = useKitchenBiz(); // nombre y ciudad (Ajustes del admin)
  const city = kitchenBizCity(biz);
  const bizName = String((biz && biz.nombre) || '').trim();
  const [user,     setUser]     = useState('');
  const [pass,     setPass]     = useState('');
  const [err,      setErr]      = useState('');
  const [errField, setErrField] = useState(null); // 'user' | 'pass' | null
  const [loading,  setLoading]  = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [online,   setOnline]   = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  const userRef = useRef(null);
  const passRef = useRef(null);

  // Enfocar el usuario solo con mouse/teclado (en tablet/celular el
  // teclado taparía media pantalla apenas carga).
  useEffect(() => {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) userRef.current?.focus();
    } catch (_) { /* sin matchMedia: no se enfoca */ }
  }, []);

  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  const clearErr = () => { if (err) { setErr(''); setErrField(null); } };
  const detectCaps = e => { try { setCapsLock(!!(e.getModifierState && e.getModifierState('CapsLock'))); } catch (_) {} };

  const handleSubmit = async e => {
    e.preventDefault();
    if (loading) return;
    if (!user.trim()) { setErr('Escribe el usuario de cocina para continuar.'); setErrField('user'); userRef.current?.focus(); return; }
    if (!pass.trim()) { setErr('Escribe la contraseña para continuar.'); setErrField('pass'); passRef.current?.focus(); return; }
    setErr(''); setErrField(null);
    setLoading(true);
    let ok = false;
    try {
      ok = await verifyKitchenLogin(user.trim(), pass);
    } catch (ex) {
      setErr(ex?.message === 'LOGIN_LOCKED'
        ? 'Demasiados intentos fallidos. Espera 5 minutos e inténtalo de nuevo.'
        : 'No se pudo verificar el acceso. Revisa la conexión a internet e inténtalo de nuevo.');
      setLoading(false);
      return;
    }
    if (ok) {
      setKitchenAuthed(true);
      onSuccess();
      return; // el componente se desmonta: no tocar más su estado
    }
    setErr('Usuario o contraseña incorrectos. Revisa e inténtalo de nuevo.');
    setErrField('pass');
    setPass('');
    setLoading(false);
    setTimeout(() => { passRef.current?.focus(); }, 60);
  };

  return (
    <div className="kx-root">
      <style>{KX_CSS}</style>

      {/* ── Marca ── */}
      <aside className="kx-brand">
        <img
          className="kx-logo"
          src="/img/logo/logo.png"
          alt={bizName ? `Logo de ${bizName}` : 'Logo del restaurante'}
          width="1024" height="1024"
          decoding="async"
        />
        <div className="kx-brand-caption">
          <p className="kx-brand-role">Panel de cocina</p>
          {city && <p className="kx-brand-place">{city}</p>}
        </div>
      </aside>

      {/* ── Formulario ── */}
      <main className="kx-main">
        <div className="kx-form-wrap">
          <h1 className="kx-title">Comanda cocina</h1>
          <p className="kx-lead">Ingresa para recibir los pedidos y marcar cuándo están listos.</p>

          {!online && (
            <div className="kx-note" role="status">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>
              </svg>
              Sin conexión a internet. Los pedidos no llegarán hasta que vuelva la conexión.
            </div>
          )}

          <form onSubmit={handleSubmit} className="kx-form" autoComplete="off" noValidate aria-busy={loading}>
            <div className="kx-group">
              <label className="kx-label" htmlFor="kx-user">Usuario</label>
              <input
                ref={userRef}
                id="kx-user"
                className={`kx-input${errField === 'user' ? ' is-invalid' : ''}`}
                type="text"
                placeholder="Ingresa tu usuario"
                value={user}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={e => { setUser(e.target.value); clearErr(); }}
                aria-invalid={errField === 'user' || undefined}
                aria-describedby={err ? 'kx-error' : undefined}
                disabled={loading}
              />
            </div>

            <div className="kx-group">
              <label className="kx-label" htmlFor="kx-pass">Contraseña</label>
              <div className="kx-pass">
                <input
                  ref={passRef}
                  id="kx-pass"
                  className={`kx-input kx-input-pass${errField === 'pass' ? ' is-invalid' : ''}`}
                  type={showPass ? 'text' : 'password'}
                  placeholder="Tu contraseña"
                  value={pass}
                  autoComplete="new-password"
                  inputMode="numeric"
                  onChange={e => { setPass(e.target.value); clearErr(); }}
                  onKeyDown={detectCaps}
                  onKeyUp={detectCaps}
                  onBlur={() => setCapsLock(false)}
                  aria-invalid={errField === 'pass' || undefined}
                  aria-describedby={[err ? 'kx-error' : null, capsLock ? 'kx-caps' : null].filter(Boolean).join(' ') || undefined}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="kx-eye"
                  onClick={() => setShowPass(v => !v)}
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPass}
                  aria-controls="kx-pass"
                >
                  {showPass ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              {capsLock && <p id="kx-caps" className="kx-hint">Bloq Mayús está activado.</p>}
            </div>

            <div id="kx-error" aria-live="assertive">
              {err && (
                <p className="kx-error" role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>{err}</span>
                </p>
              )}
            </div>

            <button className="kx-btn" type="submit" disabled={loading}>
              {loading
                ? <><span className="kx-spinner" aria-hidden="true" /> Verificando…</>
                : 'Entrar a cocina'}
            </button>
          </form>

          <p className="kx-foot">© {new Date().getFullYear()}{bizName ? ` ${bizName}` : ''}</p>
        </div>
      </main>
    </div>
  );
}

/* ══════════════════════════════════════════════
   RESUMEN DE PRODUCCIÓN — platos iguales sumados
   ══════════════════════════════════════════════
   Suma la cantidad de cada plato PENDIENTE o EN PREPARACIÓN de todos los
   pedidos activos (mesas, para llevar, delivery, recojo), para cocinar en
   lote y luego despachar por mesa. Solo LEE los pedidos que la cocina ya
   tiene en pantalla: no consulta la base de datos, no abre conexiones
   nuevas y no cambia ningún estado. Se actualiza solo con cada cambio.
   Un mismo plato en distinto tamaño (Fuente M. / Fuente G.) se cuenta
   por separado: son preparaciones distintas.
══════════════════════════════════════════════ */
function productionSourceLabel(o) {
  if (!EXTERNAL_ZONES.includes(o.zone)) return `Mesa ${o.table_number}`;
  let name = '';
  try { name = String(JSON.parse(o.notes || '{}').customerName || '').trim(); } catch (_) {}
  const zone = o.zone === 'Para Llevar' ? 'Llevar' : o.zone === 'Recojo en Local' ? 'Recojo' : o.zone;
  return name ? `${zone}: ${name}` : zone;
}

function buildProductionSummary(orders) {
  const groups = new Map();
  const add = (o, it, state, sinceISO) => {
    if (!it || typeof it !== 'object') return;
    const qty = Math.max(0, Math.floor(Number(it.qty ?? it.quantity ?? 1)) || 0);
    if (!qty) return;
    const name = String(it.name || '?').trim();
    const key = `${it.lineId || it.id || ''}|${name.toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, { key, name, total: 0, pending: 0, cooking: 0, oldest: null, sources: new Map(), notes: [] });
    const g = groups.get(key);
    g.total += qty;
    if (state === 'cooking') g.cooking += qty; else g.pending += qty;
    if (sinceISO && (!g.oldest || new Date(sinceISO) < new Date(g.oldest))) g.oldest = sinceISO;
    const label = productionSourceLabel(o);
    g.sources.set(label, (g.sources.get(label) || 0) + qty);
    const note = String(it.note || it.notes || '').trim();
    if (note) g.notes.push(`${label}: ${note}`);
  };

  for (const o of orders || []) {
    // Salón cobrado sale de cocina; los externos se muestran hasta que cocina los marque listos
    if (!o || o.status === 'anulado' || (isPaid(o.status) && !EXTERNAL_ZONES.includes(o.zone))) continue;
    if (EXTERNAL_ZONES.includes(o.zone)) {
      const ks = o.kitchen_status || 'pending';
      if (ks !== 'pending' && ks !== 'preparing') continue;
      (Array.isArray(o.items) ? o.items : []).forEach(it => add(o, it, ks === 'preparing' ? 'cooking' : 'pending', o.created_at));
    } else if (Array.isArray(o.rounds) && o.rounds.length > 0) {
      for (const r of o.rounds) {
        if (!r || (r.status !== 'pendiente' && r.status !== 'en_cocina')) continue;
        (Array.isArray(r.items) ? r.items : []).forEach(it => add(o, it, r.status === 'en_cocina' ? 'cooking' : 'pending', r.sentAt || o.created_at));
      }
    } else if (o.status === 'pending' || o.status === 'preparing') {
      (Array.isArray(o.items) ? o.items : []).forEach(it => add(o, it, o.status === 'preparing' ? 'cooking' : 'pending', o.created_at));
    }
  }

  return [...groups.values()]
    .map(g => ({ ...g, sources: [...g.sources.entries()] }))
    .sort((a, b) => (b.total - a.total) || a.name.localeCompare(b.name, 'es'));
}

function ProductionSummary({ orders }) {
  // Reloj de 30 s solo para refrescar los "hace X min" (no consulta nada)
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const rows = useMemo(() => buildProductionSummary(orders), [orders]);
  const totalUnits = rows.reduce((s, r) => s + r.total, 0);

  if (!rows.length) {
    return (
      <div style={{ padding:'48px 20px', textAlign:'center', color:'var(--fog)' }}>
        <ClipboardList size={34} strokeWidth={1.5} style={{ opacity:.4, marginBottom:8 }}/>
        <div style={{ fontSize:14, fontWeight:700, color:'var(--snow)' }}>No hay platos por preparar</div>
        <div style={{ fontSize:12, marginTop:4 }}>Aquí se sumarán los platos iguales de todos los pedidos activos.</div>
      </div>
    );
  }

  return (
    <div style={{ padding:12 }}>
      <div style={{ fontSize:11, color:'var(--fog)', letterSpacing:1, fontWeight:700, margin:'0 2px 10px' }}>
        POR PREPARAR — {rows.length} plato{rows.length !== 1 ? 's' : ''} distinto{rows.length !== 1 ? 's' : ''} · {totalUnits} unidades
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:10 }}>
        {rows.map(r => {
          const mins = r.oldest ? elapsedMins(r.oldest) : 0;
          const urgent = mins >= 20, warn = mins >= 10;
          return (
            <div key={r.key} style={{
              background:'var(--ink2)', border:`1px solid ${urgent ? 'rgba(220,38,38,.45)' : 'var(--line)'}`,
              borderLeft:`4px solid ${urgent ? '#DC2626' : warn ? '#D97706' : '#2563EB'}`,
              borderRadius:12, padding:'12px 14px',
            }}>
              <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                <div style={{
                  minWidth:46, height:46, borderRadius:10, background:'var(--ink3)', border:'1px solid var(--line)',
                  display:'flex', alignItems:'center', justifyContent:'center',
                  fontFamily:'var(--mono)', fontSize:22, fontWeight:900, color:'var(--snow)',
                }}>{r.total}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:'var(--snow)', lineHeight:1.25, overflowWrap:'anywhere' }}>{r.name}</div>
                  <div style={{ fontSize:11, color:'var(--fog)', marginTop:3 }}>
                    {r.pending > 0 && <span style={{ color:'#D97706', fontWeight:700 }}>{r.pending} pendiente{r.pending !== 1 ? 's' : ''}</span>}
                    {r.pending > 0 && r.cooking > 0 && ' · '}
                    {r.cooking > 0 && <span style={{ color:'#1D4ED8', fontWeight:700 }}>{r.cooking} en preparación</span>}
                    {r.oldest && <span> · el más antiguo hace {mins} min</span>}
                  </div>
                </div>
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:10 }}>
                {r.sources.map(([label, q]) => (
                  <span key={label} style={{
                    fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:8,
                    background:'var(--ink3)', border:'1px solid var(--line)', color:'var(--mist)',
                  }}>{label} <span style={{ color:'var(--snow)' }}>×{q}</span></span>
                ))}
              </div>
              {r.notes.length > 0 && (
                <div style={{ marginTop:8, fontSize:11, color:'#B45309', fontWeight:700, lineHeight:1.5 }}>
                  {r.notes.map((n, i) => <div key={i}>★ {n}</div>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:10.5, color:'var(--fog)', marginTop:12, lineHeight:1.5 }}>
        Solo es una vista de apoyo: cada pedido se sigue marcando "En preparación" y "Listo" desde la pestaña Activos, como siempre.
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   KITCHEN APP — COMPONENTE PRINCIPAL
══════════════════════════════════════════════ */
function KitchenApp({ onLogout }) {
  const biz = useKitchenBiz(); // nombre del negocio del pie de página (Ajustes del admin)
  const [sessionStart,     setSessionStartState] = useState(() => getSessionStart());
  const [orders,           setOrders]            = useState([]);
  const [completedOrders,  setCompletedOrders]   = useState([]);
  const [completedCount,   setCompletedCount]    = useState(0);
  const [loading,          setLoading]           = useState(true);
  const [historyLoading,   setHistoryLoading]    = useState(false);
  const [toasts,           setToasts]            = useState([]);
  const [filter,           setFilter]            = useState('active');
  const [connStatus,       setConnStatus]        = useState('connecting');
  const [newOrderIds,      setNewOrderIds]       = useState(new Set());
  const [showLogoutModal,  setShowLogoutModal]   = useState(false);
  const [logoutStats,      setLogoutStats]       = useState(null);
  const [logoutLoading,    setLogoutLoading]     = useState(false);
  const [showCalDayBanner, setShowCalDayBanner]  = useState(() => isNewCalendarDay(getSessionStart()));
  const [modifiedOrderIds, setModifiedOrderIds]  = useState(() => new Set());
  const [darkMode,         setDarkMode]          = useState(() => localStorage.getItem('antojitos_theme') === 'dark');

  /* ── Toast helper ── */
  const toast = useCallback((msg, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p.slice(-4), { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 5000);
  }, []);
  const removeToast = id => setToasts(p => p.filter(t => t.id !== id));

  /* ── Dark Mode Toggle ── */
  const toggleDark = useCallback(() => {
    document.documentElement.classList.add('color-theme-in-transition');
    setDarkMode(prev => {
      const next = !prev;
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
      localStorage.setItem('antojitos_theme', next ? 'dark' : 'light');
      return next;
    });
    setTimeout(() => document.documentElement.classList.remove('color-theme-in-transition'), 450);
  }, []);

  /* ── Load active orders (filtered by session) ── */
  const loadOrders = useCallback(async (session) => {
    const sess = session || sessionStart;
    try {
      const { data, error } = await _supabase
        .from('orders')
        .select('*')
        .gte('created_at', sess)
        .neq('status', 'archivado')
        .neq('status', 'anulado')
        .neq('status', 'served')
        .order('created_at', { ascending: true });
      if (error) throw error;
      // Externos (Para Llevar, Delivery, Recojo): visibles hasta que el cocinero marque "Listo",
      // independientemente de si ya fueron cobrados en caja.
      // Salón: visibles hasta que el mesero cobre o se archive.
      const visible = (data || []).filter(o => {
        if (EXTERNAL_ZONES.includes(o.zone)) {
          return o.kitchen_status !== 'ready';
        }
        return !isPaid(o.status);
      });
      setOrders(visible);
    } catch(e) {
      toast('Error cargando pedidos: ' + (e.message||e), 'err');
    } finally {
      setLoading(false);
    }
  }, [sessionStart, toast]);

  /* ── Load completed count ── */
  const loadCompletedCount = useCallback(async (session) => {
    const sess = session || sessionStart;
    try {
      const { count } = await _supabase
        .from('orders')
        .select('*', { count:'exact', head:true })
        .gte('created_at', sess)
        .or('status.ilike.Pagado%,status.eq.paid,status.eq.served,status.eq.archivado');
      setCompletedCount(count || 0);
    } catch(e) {}
  }, [sessionStart]);

  /* ── Load history (completed orders) ── */
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data } = await _supabase
        .from('orders')
        .select('*')
        .gte('created_at', sessionStart)
        .or('status.ilike.Pagado%,status.eq.paid,status.eq.served')
        .order('updated_at', { ascending: false })
        .limit(60);
      setCompletedOrders(data || []);
    } catch(e) {
      toast('Error cargando historial', 'err');
    } finally {
      setHistoryLoading(false);
    }
  }, [sessionStart, toast]);

  /* ── Abrir modal de cierre de sesión ── */
  const handleOpenLogout = useCallback(async () => {
    setShowLogoutModal(true);
    setLogoutStats(null);
    // Cargar resumen rápido de la sesión actual
    try {
      const { data } = await _supabase
        .from('orders')
        .select('id, status')
        .gte('created_at', sessionStart);
      const all       = data || [];
      const completed = all.filter(o => isPaid(o.status)).length;
      const active    = all.filter(o => ['pending','preparing','ready'].includes(o.status)).length;
      setLogoutStats({ total: all.length, completed, active });
    } catch(e) {
      setLogoutStats({ total: 0, completed: 0, active: 0 });
    }
  }, [sessionStart]);

  /* ── Confirmar cierre: archivar pedidos en Supabase + limpiar sesión ── */
  const handleLogoutConfirm = useCallback(async () => {
    setLogoutLoading(true);
    try {
      // 1. Archivar TODOS los pedidos no archivados en Supabase
      //    Esto limpia la vista de cocina en cualquier dispositivo que refresque.
      const { error } = await _supabase
        .from('orders')
        .update({ status: 'archivado', updated_at: new Date().toISOString() })
        .neq('status', 'archivado');
      if (error) throw error;

      // 2. Limpiar localStorage de sesión y autenticación
      localStorage.removeItem(SESSION_KEY);
      setKitchenAuthed(false);

      // 3. Llamar al callback del componente padre para mostrar el Login
      onLogout();
    } catch(e) {
      toast('Error al cerrar sesión: ' + (e.message || e), 'err');
      setLogoutLoading(false);
      setShowLogoutModal(false);
    }
  }, [toast, onLogout]);

  /* ── Update order status ── */
  const handleAction = async (orderId, newStatus, ord) => {
    const mesa = typeof ord === 'object' ? ord?.table_number : ord;
    const zone  = typeof ord === 'object' ? ord?.zone        : null;
    const isExt = EXTERNAL_ZONES.includes(zone);
    try {
      // Pedidos externos: 'pending'→'preparing'→'ready' se mapea en kitchen_status
      // Pedidos de salón SIN `rounds` (legado, o migración pendiente): se mapea
      // en status como antes. Los pedidos de salón CON `rounds` usan
      // handleRoundAction en su lugar (no pasan por aquí).
      const updatePayload = isExt
        ? { kitchen_status: newStatus, is_modified: false, updated_at: new Date().toISOString() }
        : { status: newStatus, is_modified: false, updated_at: new Date().toISOString() };
      const { error } = await _supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId);
      if (error) throw error;
      setModifiedOrderIds(prev => { const s = new Set(prev); s.delete(orderId); return s; });
      if (newStatus === 'ready') {
        playReadyBell();
        speakReadyOrder(ord);
        if (isExt) {
          let info = {};
          try { info = JSON.parse(ord?.notes || '{}'); } catch(_) {}
          const name     = info.customerName;
          const zoneIcon = zone === 'Para Llevar' ? '🥡' : zone === 'Delivery' ? '🛵' : '🏪';
          const label    = name ? `${zoneIcon} ${name}` : `${zoneIcon} ${zone}`;
          const accion   = zone === 'Para Llevar' ? 'Avisar al cliente' : 'Para despacho';
          toast(`🔔 ${label} — ¡LISTO! ${accion}`, 'ok');
        } else {
          toast(`🔔 Mesa ${mesa} — ¡LISTO! Notificando al mesero...`, 'ok');
        }
      } else if (newStatus === 'preparing') {
        if (isExt) {
          let info = {};
          try { info = JSON.parse(ord?.notes || '{}'); } catch(_) {}
          const name = info.customerName;
          toast(`🔥 ${name ? name : zone} — En preparación`, 'info');
        } else {
          toast(`🔥 Mesa ${mesa} — En preparación`, 'info');
        }
      }
    } catch(e) {
      toast('Error al actualizar: ' + (e.message||e), 'err');
    }
  };

  /* ── Avanza el estado de UNA ronda de un pedido de mesa ─────────
     A diferencia de handleAction (todo el pedido), esto solo toca la
     ronda `roundN` dentro de `order.rounds` — así una mesa puede seguir
     ampliando su pedido (nuevas rondas) sin que avanzar una ronda vieja
     afecte a las demás, y sin volver a mostrar ítems ya despachados. */
  const handleRoundAction = async (orderId, roundN, newStatus, ord) => {
    const mesa   = ord?.table_number;
    let aggStatus;
    try {
      // Camino principal (migracion-rondas-atomicas.sql): la base de datos
      // cambia SOLO esta ronda, en un paso y con el pedido bloqueado. Antes se
      // guardaba la lista completa de rondas que había en pantalla: si el
      // mesero acababa de agregar otra ronda, se borraba. Ahora no puede pasar.
      const { data, error: rpcError } = await _supabase.rpc('set_order_round_status', {
        p_order_id: orderId, p_round_n: roundN, p_status: newStatus,
      });
      if (!rpcError && data) {
        aggStatus = data.status;
        // Refleja al instante lo guardado (Realtime confirmará igual)
        if (Array.isArray(data.rounds)) {
          setOrders(prev => prev.map(o => o.id === orderId ? { ...o, rounds: data.rounds, status: data.status, is_modified: false } : o));
        }
      } else if (rpcError && !isMissingRpc(rpcError)) {
        const m = String(rpcError.message || '');
        if (/ROUND_NOT_FOUND|ORDER_NOT_FOUND/.test(m)) throw new Error('El pedido o la ronda ya no existe. Se recargará la lista.');
        throw rpcError;
      } else {
        // Respaldo: método anterior (solo si la migración aún no se ejecutó)
        const rounds = Array.isArray(ord?.rounds) ? ord.rounds : [];
        const nowISO = new Date().toISOString();
        const updatedRounds = rounds.map(r => r.n !== roundN ? r : {
          ...r,
          status:    newStatus,
          startedAt: newStatus === 'en_cocina' ? (r.startedAt || nowISO) : r.startedAt,
          readyAt:   newStatus === 'listo'     ? nowISO                  : r.readyAt,
        });
        // Estado agregado del pedido — se recalcula desde TODAS las rondas para
        // que status/urgencia/badges (y AdminDashboard) sigan funcionando igual.
        aggStatus = updatedRounds.some(r => r.status === 'pendiente')  ? 'pending'
          : updatedRounds.some(r => r.status === 'en_cocina') ? 'preparing'
          : 'ready';
        const { error } = await _supabase
          .from('orders')
          .update({ rounds: updatedRounds, status: aggStatus, is_modified: false, updated_at: nowISO })
          .eq('id', orderId);
        if (error) throw error;
      }
      setModifiedOrderIds(prev => { const s = new Set(prev); s.delete(orderId); return s; });
      if (newStatus === 'listo') {
        playReadyBell();
        if (aggStatus === 'ready') {
          // Todas las rondas de la mesa están listas — aviso completo (voz incluida)
          speakReadyOrder(ord);
          toast(`🔔 Mesa ${mesa} — ¡Pedido completo LISTO! Notificando al mesero...`, 'ok');
        } else {
          // Aún quedan otras rondas en curso — aviso liviano, sin interrumpir con voz
          toast(`✅ Mesa ${mesa} — Ronda ${roundN} lista (hay más rondas en curso)`, 'ok');
        }
      } else if (newStatus === 'en_cocina') {
        toast(`🔥 Mesa ${mesa} — Ronda ${roundN} en preparación`, 'info');
      }
    } catch(e) {
      toast('Error al actualizar la ronda: ' + (e.message||e), 'err');
      // La lista local pudo quedar desactualizada — se relee del servidor
      loadOrders();
    }
  };

  /* ── Supabase Realtime ── */
  useEffect(() => {
    // Recarga REST (respaldo de Realtime). `lastLoad` permite espaciarla:
    // con el WebSocket conectado los cambios ya llegan en vivo y no hace
    // falta pedir la lista completa cada 90 s (cada recarga = 2 consultas
    // + logs + egress, todo el día, aunque la pantalla esté apagada).
    let lastLoad = Date.now();
    let rtOnline = false;
    let wasOffline = false;
    const reload = () => {
      lastLoad = Date.now();
      loadOrders();
      loadCompletedCount();
    };

    loadOrders();
    loadCompletedCount();

    const channel = _supabase
      .channel('cocina-realtime-v3')
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'orders' }, payload => {
        const o = payload.new;
        if (!o) return;
        // Externos: mostrar siempre hasta que kitchen_status='ready' (aunque ya estén cobrados)
        // Salón: ignorar si ya están pagados (flujo normal termina en mesero)
        if (EXTERNAL_ZONES.includes(o.zone)) {
          if (o.kitchen_status === 'ready') return;
        } else {
          if (isPaid(o.status)) return;
        }
        const oCreated = new Date(o.created_at);
        const sessDate = new Date(sessionStart);
        if (oCreated < sessDate) return;
        setOrders(prev => {
          if (prev.find(x => x.id === o.id)) return prev;
          return [...prev, o].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
        });
        setNewOrderIds(prev => {
          const s = new Set(prev); s.add(o.id);
          setTimeout(() => setNewOrderIds(p => { const n = new Set(p); n.delete(o.id); return n; }), 6000);
          return s;
        });
        playNewOrderChime();
        if (EXTERNAL_ZONES.includes(o.zone)) {
          let info = {};
          try { info = JSON.parse(o.notes || '{}'); } catch(_) {}
          const cn = info.customerName;
          const zIcon = o.zone === 'Para Llevar' ? '🥡' : o.zone === 'Delivery' ? '🛵' : '🏪';
          toast(`${zIcon} Nuevo: ${o.zone}${cn ? ' · ' + cn : ''}`, 'info');
        } else {
          toast(`🆕 Nuevo pedido: Mesa ${o.table_number} · ${o.waiter_name||'Mesero'}`, 'info');
        }
      })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'orders' }, payload => {
        const o = payload.new;
        if (!o) return;
        // Anulado por el administrador: sale de cocina (no cuenta como completado)
        if (o.status === 'anulado') {
          let existed = false;
          setOrders(prev => {
            existed = prev.some(x => x.id === o.id);
            return existed ? prev.filter(x => x.id !== o.id) : prev;
          });
          setModifiedOrderIds(prev => { if (!prev.has(o.id)) return prev; const s = new Set(prev); s.delete(o.id); return s; });
          const label = EXTERNAL_ZONES.includes(o.zone) ? o.zone : `Mesa ${o.table_number}`;
          toast(`🚫 ${label} — Pedido ANULADO por administración`, 'err');
          return;
        }
        const isExt = EXTERNAL_ZONES.includes(o.zone);
        if (isExt) {
          // Pedidos externos: desaparecen de cocina SOLO cuando kitchen_status='ready'
          if (o.kitchen_status === 'ready') {
            setOrders(prev => prev.filter(x => x.id !== o.id));
            setCompletedCount(prev => prev + 1);
            setCompletedOrders(prev => [o, ...prev].slice(0,60));
          } else {
            // Actualizar en lista (kitchen_status: pending→preparing, o pago desde caja)
            setOrders(prev => {
              const exists = prev.find(x => x.id === o.id);
              if (exists) return prev.map(x => x.id === o.id ? o : x);
              // Pedido externo aún no terminado: agregar si llegó vía UPDATE y no estaba en lista
              return [...prev, o].sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
            });
          }
        } else if (isPaid(o.status)) {
          // Pedidos de salón pagados: salir de cocina inmediatamente
          setOrders(prev => prev.filter(x => x.id !== o.id));
          setCompletedCount(prev => prev + 1);
          setCompletedOrders(prev => [o, ...prev].slice(0,60));
        } else {
          setOrders(prev => prev.map(x => x.id === o.id ? o : x));
          if (o.is_modified) {
            setModifiedOrderIds(prev => { const s = new Set(prev); s.add(o.id); return s; });
            playModifiedChime();
            toast(`✏️ Mesa ${o.table_number} — Pedido MODIFICADO por el mesero`, 'info');
          }
        }
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          setConnStatus('online');
          rtOnline = true;
          // Reconectó tras una caída: lo que pasó mientras tanto no llega por
          // Realtime — una sola recarga REST pone la pantalla al día.
          if (wasOffline) { wasOffline = false; reload(); }
        } else if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)) {
          setConnStatus('offline');
          rtOnline = false;
          wasOffline = true;
        } else {
          setConnStatus('connecting');
          rtOnline = false;
        }
      });

    // Respaldo periódico:
    //  · pantalla oculta/apagada → no consulta (al volver se recarga, abajo)
    //  · Realtime conectado      → como máximo cada 5 min
    //  · Realtime caído          → cada 90 s, como antes
    const refreshTimer = setInterval(() => {
      if (document.hidden) return;
      if (rtOnline && Date.now() - lastLoad < 300000) return;
      reload();
    }, 90000);

    // Al volver a la pestaña: el navegador puede haber pausado el WebSocket
    // mientras estaba oculta — recarga si pasaron más de 30 s.
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastLoad > 30000) reload();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      _supabase.removeChannel(channel);
      clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionStart]);

  /* ── Load history when tab selected ── */
  useEffect(() => {
    if (filter === 'history') loadHistory();
  }, [filter]);

  /* ── Derived counts ── */
  const getKitState = o => EXTERNAL_ZONES.includes(o.zone) ? (o.kitchen_status || 'pending') : o.status;
  const cnt = useMemo(() => ({
    pending:   orders.filter(o => getKitState(o) === 'pending').length,
    preparing: orders.filter(o => getKitState(o) === 'preparing').length,
    ready:     orders.filter(o => getKitState(o) === 'ready').length,
    total:     orders.length,
  }), [orders]);

  const displayOrders = useMemo(() => orders.filter(o => {
    const ks = getKitState(o);
    if (filter === 'active') return ks === 'pending' || ks === 'preparing';
    if (filter === 'ready')  return ks === 'ready';
    if (filter === 'history' || filter === 'resumen') return false;
    return true;
  }), [orders, filter]);

  const activeOrders   = useMemo(() => orders.filter(o => { const ks = getKitState(o); return ks === 'pending' || ks === 'preparing'; }), [orders]);

  /* ── Vibración táctil cuando un pedido se vuelve crítico ── */
  const prevCriticalIdsRef = useRef(new Set());
  useEffect(() => {
    const critIds = new Set(activeOrders.filter(o => getUrgency(o) === 'critical').map(o => o.id));
    const newlyCritical = [...critIds].filter(id => !prevCriticalIdsRef.current.has(id));
    if (newlyCritical.length && navigator.vibrate) {
      navigator.vibrate([400, 100, 400, 100, 800]);
    }
    prevCriticalIdsRef.current = critIds;
  }, [activeOrders]);

  const connColor      = connStatus === 'online' ? '#10B981' : connStatus === 'offline' ? '#EF4444' : '#F59E0B';
  const sessionLabel   = (() => {
    const d = new Date(sessionStart);
    return d.toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' });
  })();

  return (
    <div style={{
      height:'100%', display:'flex', flexDirection:'column',
      background:'var(--ink)', position:'relative', zIndex:1,
    }}>
      <Toasts list={toasts} remove={removeToast} />

      {showLogoutModal && (
        <LogoutConfirmModal
          stats={logoutStats}
          onConfirm={handleLogoutConfirm}
          onCancel={() => !logoutLoading && setShowLogoutModal(false)}
          loading={logoutLoading}
        />
      )}

      {/* ═══ TOPBAR ═══ */}
      <div style={{
        background:'var(--ink1)', borderBottom:'1px solid var(--line)',
        padding:'env(safe-area-inset-top, 0px) 12px 0', flexShrink:0,
        minHeight:'calc(56px + env(safe-area-inset-top, 0px))',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        position:'relative', zIndex:50,
        boxShadow:'0 1px 3px rgba(0,0,0,0.06)',
      }}>
        <div style={{
          position:'absolute', bottom:0, left:0, right:0, height:2,
          background:'linear-gradient(90deg,transparent,rgba(245,158,11,.35),rgba(16,185,129,.18),transparent)',
        }}/>

        {/* Left: Logo + title */}
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <img src="img/logo/logo.png" alt="Logo"
            style={{ width:36, height:36, borderRadius:'50%', objectFit:'contain' }}
            onError={e => { e.target.style.display='none'; }}
          />
          <div>
            <div style={{ fontFamily:'var(--display)', fontSize:17, color:'var(--amber)', letterSpacing:1, lineHeight:1 }}>
              PANEL COCINA
            </div>
            <div style={{ fontSize:9, color:'var(--fog)', letterSpacing:1.5, marginTop:1 }}>
              {todayLong()} · TURNO DESDE {sessionLabel}
            </div>
          </div>
        </div>

        {/* Right: controls */}
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <Clock />

          {/* Connection */}
          <div style={{
            display:'flex', alignItems:'center', gap:5,
            background:'var(--ink3)', border:`1px solid ${connColor}33`,
            borderRadius:20, padding:'5px 10px',
            fontSize:10, fontWeight:700, color:connColor,
          }}>
            <div style={{
              width:6, height:6, borderRadius:'50%', background:connColor,
              animation: connStatus !== 'online' ? 'blink 1s infinite' : 'none',
            }}/>
            <span style={{ display:'none' }}>{connStatus==='online'?'Online':connStatus==='offline'?'Offline':'...'}</span>
          </div>

          {/* Reload */}
          <button
            onClick={() => { setLoading(true); loadOrders(); loadCompletedCount(); }}
            title="Recargar pedidos"
            style={{
              background:'var(--ink3)', border:'1px solid var(--line2)',
              borderRadius:'50%', width:32, height:32,
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'var(--fog)', fontSize:17, transition:'all .18s',
            }}
          >⟳</button>

          {/* Botón Modo Oscuro */}
          <button
            onClick={toggleDark}
            title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            style={{
              background:'var(--ink3)', border:'1px solid var(--line2)',
              borderRadius:'50%', width:34, height:34,
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', transition:'all .18s',
              color:'var(--snow)', flexShrink:0,
            }}
          >{darkMode ? <Moon size={16}/> : <Sun size={16}/>}</button>

          {/* Cerrar Sesión */}
          <button
            onClick={handleOpenLogout}
            title="Cerrar sesión y limpiar cocina"
            style={{
              padding:'6px 13px',
              background:'var(--ink3)',
              border:'1px solid rgba(239,68,68,.35)',
              borderRadius:20,
              color:'#DC2626',
              fontSize:11, fontWeight:800, letterSpacing:.5,
              display:'flex', alignItems:'center', gap:6,
              transition:'all .2s',
            }}
          >
            <LogOut size={13}/>
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </div>

      {/* ═══ NUEVO DÍA DETECTADO — sugiere cerrar sesión ═══ */}
      {showCalDayBanner && (
        <NewCalendarDayBanner
          onStartNewDay={handleOpenLogout}
          onDismiss={() => setShowCalDayBanner(false)}
        />
      )}

      {/* ═══ URGENCY BANNER ═══ */}
      <UrgencyBanner
        orders={activeOrders}
        onFocus={() => setFilter('active')}
      />

      {/* ═══ STATS BAR ═══ */}
      <div style={{
        background:'var(--ink1)', borderBottom:'1px solid var(--line)',
        display:'grid', gridTemplateColumns:'repeat(4, 1fr)',
        flexShrink:0,
      }}>
        {[
          { key:'pending',   label:'PENDIENTES', count:cnt.pending,        color:'#D97706' },
          { key:'preparing', label:'EN COCINA',  count:cnt.preparing,      color:'#1D4ED8' },
          { key:'ready',     label:'LISTOS',     count:cnt.ready,          color:'#047857' },
          { key:'done',      label:'HOY',        count:completedCount,     color:'var(--fog)' },
        ].map((s,i) => (
          <div key={s.key} style={{
            padding:'8px 6px', textAlign:'center',
            borderRight: i < 3 ? '1px solid var(--line)' : 'none',
          }}>
            <div style={{
              fontFamily:'var(--mono)', fontSize:20, fontWeight:700,
              color: s.count > 0 ? s.color : 'var(--ghost)',
              lineHeight:1,
            }}>
              {s.count}
            </div>
            <div style={{ fontSize:8, color:'var(--fog)', letterSpacing:1.2, marginTop:3 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ FILTER TABS ═══ */}
      <div style={{
        background:'var(--ink1)', borderBottom:'1px solid var(--line)',
        display:'flex', flexShrink:0,
      }}>
        {[
          { key:'active',  label:'ACTIVOS',   badge: cnt.pending + cnt.preparing, color:'var(--amber)'   },
          { key:'ready',   label:'LISTOS',    badge: cnt.ready,                   color:'var(--emerald)' },
          { key:'resumen', label:'RESUMEN',   badge: 0,                           color:'#2563EB'        },
          { key:'history', label:'HISTORIAL', badge: completedCount,              color:'var(--fog)'     },
          { key:'all',     label:'TODOS',     badge: cnt.total,                   color:'var(--mist)'    },
        ].map(tab => (
          <div
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              flex:1, padding:'9px 4px', cursor:'pointer', textAlign:'center',
              transition:'all .18s',
              borderBottom: filter === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
              background: filter === tab.key ? 'rgba(0,0,0,0.025)' : 'transparent',
            }}
          >
            <div style={{ fontSize:9, color: filter===tab.key ? tab.color : 'var(--fog)', letterSpacing:1.2, fontWeight:700 }}>
              {tab.label}
              {tab.badge > 0 && (
                <span style={{
                  marginLeft:5, background:tab.color, color:'#FFFFFF', borderRadius:10,
                  padding:'1px 5px', fontSize:9, fontWeight:900,
                  opacity: filter===tab.key ? 1 : 0.75,
                }}>
                  {tab.badge}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ ORDERS AREA ═══ */}
      <div style={{ flex:1, overflowY:'auto', position:'relative', zIndex:1 }}>

        {/* Sticky critical badge — persiste visible al hacer scroll */}
        {filter !== 'history' && !loading && (() => {
          const n = activeOrders.filter(o => getUrgency(o) === 'critical').length;
          if (!n) return null;
          return (
            <div style={{
              position:'sticky', top:0, zIndex:10,
              background:'rgba(220,38,38,0.93)',
              backdropFilter:'blur(4px)',
              color:'#fff', padding:'5px 14px',
              display:'flex', alignItems:'center', gap:8,
              fontSize:11, fontWeight:800, letterSpacing:.5,
              borderBottom:'1px solid rgba(255,255,255,0.12)',
            }}>
              <span style={{ display:'inline-flex', animation:'blink 1s infinite' }}><Siren size={15}/></span>
              {n} pedido{n>1?'s':''} CRÍTICO{n>1?'S':''} — más de 20 min sin atender
            </div>
          );
        })()}

        {/* Resumen de producción (platos iguales sumados) */}
        {filter === 'resumen' ? (
          <ProductionSummary orders={orders} />
        ) : filter === 'history' ? (
          <div style={{ padding:12 }}>
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              marginBottom:10, padding:'0 2px',
            }}>
              <div style={{ fontSize:11, color:'var(--fog)', letterSpacing:1, fontWeight:700 }}>
                COMPLETADOS ESTA SESIÓN — {completedCount} pedidos
              </div>
              <button
                onClick={loadHistory}
                style={{
                  fontSize:11, color:'var(--fog)',
                  background:'var(--ink3)', border:'1px solid var(--line)',
                  borderRadius:8, padding:'4px 10px', fontWeight:700,
                }}
              >⟳ Actualizar</button>
            </div>
            {historyLoading ? (
              <div style={{ textAlign:'center', padding:'40px 0' }}>
                <span className="spinner" style={{width:28,height:28,borderWidth:3}}/>
              </div>
            ) : completedOrders.length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--fog)' }}>
                <ClipboardList size={48} strokeWidth={1.5} style={{marginBottom:12, opacity:.6}} />
                <div style={{ fontSize:14, fontWeight:700 }}>Sin pedidos completados aún</div>
                <div style={{ fontSize:12, marginTop:6, color:'var(--ghost)' }}>Los pedidos pagados aparecerán aquí</div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {completedOrders.map(o => <CompletedCard key={o.id} order={o} />)}
              </div>
            )}
          </div>
        ) : loading ? (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            height:'60%', flexDirection:'column', gap:16,
          }}>
            <span className="spinner" style={{width:32,height:32,borderWidth:3}}/>
            <div style={{ color:'var(--fog)', fontSize:12, letterSpacing:1 }}>Cargando pedidos...</div>
          </div>
        ) : displayOrders.length === 0 ? (
          <div style={{
            display:'flex', alignItems:'center', justifyContent:'center',
            height:'55%', flexDirection:'column', gap:12, padding:20,
          }}>
            {filter==='ready' && (
              <PartyPopper size={52} strokeWidth={1.5} color="var(--amber)"/>
            )}
            <div style={{ fontSize:16, fontWeight:800, color:'var(--mist)' }}>
              {filter==='active' ? 'Sin pedidos activos'
              : filter==='ready'  ? 'Sin pedidos listos'
              : 'No hay pedidos'}
            </div>
            <div style={{
              fontSize:12, color:'var(--fog)', textAlign:'center', lineHeight:1.7,
              maxWidth:260,
            }}>
              {filter==='active'
                ? <>Los nuevos pedidos aparecen aquí en tiempo real.<br/>Sesión desde las {sessionLabel}.</>
                : 'Los pedidos listos para servir aparecerán aquí.'
              }
            </div>
            {completedCount > 0 && filter === 'active' && (
              <div
                onClick={() => setFilter('history')}
                style={{
                  marginTop:8, padding:'8px 18px', cursor:'pointer',
                  background:'rgba(16,185,129,0.07)', border:'1px solid rgba(16,185,129,0.22)',
                  borderRadius:30, fontSize:12, fontWeight:700, color:'#047857',
                  display:'flex', alignItems:'center', gap:5,
                }}
              >
                <Check size={12}/> {completedCount} pedido{completedCount!==1?'s':''} completado{completedCount!==1?'s':''} hoy
              </div>
            )}
          </div>
        ) : (
          <div style={{
            padding:12,
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(min(310px, 100%), 1fr))',
            gap:12,
            alignItems:'start',
          }}>
            {displayOrders
              .sort((a,b) => {
                const ua = getUrgency(a), ub = getUrgency(b);
                const rank = {critical:0, warning:1, normal:2};
                return rank[ua] - rank[ub] || new Date(a.created_at) - new Date(b.created_at);
              })
              .map(order => (
                <ErrorBoundary key={order.id} compact label={`Pedido #${String(order.id).slice(-4).toUpperCase()} no se pudo mostrar`}>
                  <OrderCard
                    order={order}
                    onAction={handleAction}
                    onRoundAction={handleRoundAction}
                    isNew={newOrderIds.has(order.id)}
                    isModified={order.is_modified || modifiedOrderIds.has(order.id)}
                  />
                </ErrorBoundary>
              ))
            }
          </div>
        )}
      </div>

      {/* ═══ FOOTER ═══ */}
      <div style={{
        background:'var(--ink1)', borderTop:'1px solid var(--line)',
        padding:'5px 14px', flexShrink:0,
        display:'flex', alignItems:'center', justifyContent:'space-between',
        fontSize:9, color:'var(--ghost)',
      }}>
        <span>
          <span style={{color:'var(--amber)', fontWeight:700}}>{biz.nombre.toUpperCase()}</span>
          {' · '}Panel Cocina Pro · {new Date().getFullYear()}
        </span>
        <span style={{ letterSpacing:.5 }}>
          Sesión: {sessionLabel} · {cnt.total} activo{cnt.total!==1?'s':''} · {completedCount} completado{completedCount!==1?'s':''}
        </span>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   APP ROOT — auth guard
   Si no está autenticado → KitchenLogin
   Si está autenticado  → KitchenApp
══════════════════════════════════════════════ */
function App() {
  const [authed, setAuthed] = useState(isKitchenAuthed);

  const handleLogin  = () => setAuthed(true);
  const handleLogout = () => {
    // Auth ya se limpió dentro de handleLogoutConfirm;
    // aquí solo cambiamos el estado de React para volver al Login.
    setAuthed(false);
  };

  if (!authed) return <KitchenLogin onSuccess={handleLogin} />;
  return <KitchenApp onLogout={handleLogout} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary label="Error en el Panel de Cocina" onReload={() => window.location.reload()}>
    <App />
  </ErrorBoundary>
);
