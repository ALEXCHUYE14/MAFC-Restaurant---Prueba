/**
 * agente-impresion.js — Agente de impresión por red (Wi-Fi / LAN)
 * =================================================================
 * Corre en UNA PC (o mini-PC / laptop) del local, conectada a la misma red
 * que las tiketeras. Revisa cada 1.5 s la cola de impresión en Supabase
 * (la llenan los celulares de los meseros) y envía cada ticket a su
 * impresora por la red (TCP, puerto 9100).
 *
 *  · Si una tiketera está apagada, el ticket se reintenta (hasta 5 veces)
 *    y queda marcado como error en Ajustes → Impresoras de red.
 *  · Si se cae internet o la PC se apaga, los tickets esperan en la cola y
 *    se imprimen al volver (los de más de 6 horas ya no se imprimen).
 *  · Solo imprime en IPs de red LOCAL (192.168.x.x, 10.x.x.x, 172.16-31.x.x).
 *
 * REQUISITOS: Node.js 18 o superior (sin instalar nada más).
 *
 * CONFIGURACIÓN: copiar "config.ejemplo.json" como "config.json" y llenar:
 *   supabaseUrl  → la URL del proyecto (https://xxxx.supabase.co)
 *   anonKey      → la "publishable key" (sb_publishable_...) o la anon key legada
 *   token        → el token del agente (Panel admin → Ajustes →
 *                  Impresoras de red → "Generar token del agente")
 *   equipo       → (opcional) nombre de esta PC, se ve en Ajustes
 *
 * USO:  node agente-impresion.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const net  = require('net');
const os   = require('os');

/* ── Configuración ─────────────────────────────────────────────── */
function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { fail(`config.json no es un JSON válido: ${e.message}`); }
  }
  const c = {
    supabaseUrl: String(process.env.SUPABASE_URL || cfg.supabaseUrl || '').trim().replace(/\/+$/, ''),
    anonKey:     String(process.env.SUPABASE_ANON_KEY || cfg.anonKey || '').trim(),
    token:       String(process.env.PRINT_AGENT_TOKEN || cfg.token || '').trim(),
    equipo:      String(cfg.equipo || os.hostname() || 'PC').trim().slice(0, 60),
  };
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(c.supabaseUrl)) fail('Falta "supabaseUrl" (debe empezar con https://).');
  if (/^sb_secret_/i.test(c.anonKey)) fail('"anonKey" es una clave SECRETA — usa la publishable key (sb_publishable_...).');
  if (c.anonKey.length < 20) fail('Falta "anonKey" (clave anon/public de Supabase).');
  if (!/^[0-9a-f]{48}$/i.test(c.token)) fail('Falta "token" o no es válido (48 caracteres, se genera en Ajustes → Impresoras de red).');
  return c;
}
function fail(msg) {
  console.error('\n  ✗ ' + msg + '\n    Revisa el archivo config.json (ver config.ejemplo.json).\n');
  process.exit(1);
}

const CFG = loadConfig();
const POLL_MS        = 1500;
const TCP_TIMEOUT_MS = 8000;
const MAX_BYTES      = 64 * 1024;

const hora = () => new Date().toLocaleTimeString('es-PE');
const log  = (...a) => console.log(`[${hora()}]`, ...a);

/* ── Llamadas a Supabase (funciones RPC) ───────────────────────── */
async function rpc(fn, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${CFG.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: CFG.anonKey,
        // Publishable keys (sb_publishable_...) no son JWT: solo van en "apikey".
        ...(CFG.anonKey.startsWith('eyJ') ? { Authorization: `Bearer ${CFG.anonKey}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch (_) { /* texto plano */ }
      const err = new Error(String(msg).slice(0, 200));
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  } finally {
    clearTimeout(t);
  }
}

/* ── Seguridad: solo IPs de red local ──────────────────────────── */
function isPrivateIPv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some(n => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/* ── Envío por TCP 9100 (ESC/POS) ─────────────────────────────── */
// Igual que la impresión Bluetooth del mesero: ESC @ (inicializar),
// alinear a la izquierda, fuente A · cuerpo · 3 saltos + corte parcial.
const INIT = Buffer.from([0x1B, 0x40, 0x00, 0x1B, 0x61, 0x00, 0x1B, 0x4D, 0x00]);
const TAIL = Buffer.from([0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x41, 0x03]);

function sendTcp(ip, port, data) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done = false;
    const finish = err => {
      if (done) return;
      done = true;
      clearTimeout(hard);
      sock.destroy();
      err ? reject(err) : resolve();
    };
    // Tope total (conectar + enviar), por si la impresora no responde
    const hard = setTimeout(() => finish(new Error(`La impresora ${ip}:${port} no responde`)), TCP_TIMEOUT_MS);
    sock.on('error', e => finish(new Error(
      e.code === 'ECONNREFUSED' ? `La impresora ${ip}:${port} rechazó la conexión`
      : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? `No se encuentra la impresora ${ip} en la red`
      : `${e.code || 'Error'}: ${e.message}`)));
    sock.connect(port, ip, () => {
      // end() envía todo y cierra ordenadamente; se espera un instante a que
      // la impresora termine de leer antes de soltar la conexión.
      sock.end(data, () => setTimeout(() => finish(null), 300));
    });
  });
}

/* ── Procesar trabajos ─────────────────────────────────────────── */
async function printJob(job) {
  if (!isPrivateIPv4(job.ip)) throw new Error(`IP ${job.ip} no es de red local: no se imprime`);
  const port = Number(job.puerto) || 9100;
  if (port < 1 || port > 65535) throw new Error('Puerto inválido');
  const body = Buffer.from(String(job.contenido || ''), 'base64');
  if (!body.length) throw new Error('Ticket vacío');
  if (body.length > MAX_BYTES) throw new Error('Ticket demasiado grande');
  await sendTcp(job.ip, port, Buffer.concat([INIT, body, TAIL]));
}

async function report(id, ok, error) {
  // Si no se puede informar (internet caído), el trabajo queda "imprimiendo"
  // y Supabase lo devuelve a la cola a los 2 minutos.
  try { await rpc('print_agente_resultado', { p_token: CFG.token, p_id: id, p_ok: ok, p_error: error || null }); }
  catch (e) { log('  ! No se pudo informar el resultado:', e.message); }
}

// Los trabajos de una MISMA impresora se imprimen en orden, uno tras otro;
// impresoras distintas trabajan en paralelo.
async function processBatch(jobs) {
  const byPrinter = new Map();
  for (const j of jobs) {
    const k = `${j.ip}:${j.puerto}`;
    if (!byPrinter.has(k)) byPrinter.set(k, []);
    byPrinter.get(k).push(j);
  }
  await Promise.all([...byPrinter.entries()].map(async ([k, list]) => {
    for (const j of list) {
      try {
        await printJob(j);
        log(`  ✓ ${j.tipo} → ${k}`);
        await report(j.id, true);
      } catch (e) {
        log(`  ✗ ${j.tipo} → ${k}: ${e.message} (intento ${j.intentos})`);
        await report(j.id, false, e.message);
      }
    }
  }));
}

/* ── Bucle principal ───────────────────────────────────────────── */
let backoff = 0;
let lastCleanup = 0;
let wasOffline = false;

async function tick() {
  try {
    const jobs = await rpc('print_agente_tomar', { p_token: CFG.token, p_equipo: CFG.equipo, p_max: 10 });
    if (wasOffline) { log('✓ Conexión con el sistema recuperada'); wasOffline = false; }
    backoff = 0;
    if (Array.isArray(jobs) && jobs.length) await processBatch(jobs);

    if (Date.now() - lastCleanup > 60 * 60 * 1000) {
      lastCleanup = Date.now();
      rpc('print_agente_limpiar', { p_token: CFG.token }).catch(() => {});
    }
  } catch (e) {
    if (/AGENT_NOT_ALLOWED/.test(e.message)) {
      log('✗ Token rechazado. Genera uno nuevo en Ajustes → Impresoras de red y ponlo en config.json.');
      backoff = 60000;
    } else if (/print_agente_tomar|function .* does not exist|PGRST202/i.test(e.message)) {
      log('✗ Falta ejecutar migracion-impresion-red.sql en Supabase.');
      backoff = 60000;
    } else {
      if (!wasOffline) log('! Sin conexión con el sistema:', e.message, '— reintentando…');
      wasOffline = true;
      backoff = Math.min(30000, (backoff || 2000) * 2);
    }
  } finally {
    setTimeout(tick, backoff || POLL_MS);
  }
}

console.log('═══════════════════════════════════════════════');
console.log(' 🖨️  Agente de impresión por red');
console.log('═══════════════════════════════════════════════');
console.log(` Sistema : ${CFG.supabaseUrl}`);
console.log(` Equipo  : ${CFG.equipo}`);
console.log(' Deja esta ventana abierta mientras atiende el local.');
console.log('───────────────────────────────────────────────');
tick();

process.on('SIGINT', () => { console.log('\nAgente detenido.'); process.exit(0); });
