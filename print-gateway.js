/**
 * print-gateway.js — Gateway de impresión para Antojitos al Paso
 * =================================================================
 * Recibe peticiones HTTP POST desde mesero.html y reenvía los datos
 * ESC/POS a la impresora térmica de red vía TCP (puerto 9100).
 *
 * REQUISITOS:
 *   Node.js >= 14
 *   Sin dependencias externas (sólo módulos nativos: http, net)
 *
 * USO:
 *   node print-gateway.js
 *
 * CONFIGURACIÓN (variables de entorno o editar directamente):
 *   PRINTER_IP    — IP de la impresora en la red local (default: 192.168.1.200)
 *   PRINTER_PORT  — Puerto TCP de la impresora       (default: 9100)
 *   GATEWAY_PORT  — Puerto HTTP de este gateway       (default: 8008)
 *
 * EJEMPLO:
 *   PRINTER_IP=192.168.1.55 node print-gateway.js
 *
 * URL a configurar en mesero.html:
 *   http://<IP-de-esta-PC>:8008/print
 *   Ej: http://192.168.1.100:8008/print
 */

'use strict';

const http = require('http');
const net  = require('net');

/* ── Configuración ──────────────────────────────────── */
const PRINTER_IP   = process.env.PRINTER_IP   || '192.168.1.200';
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || '9100', 10);
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '8008', 10);
const TIMEOUT_MS   = 6000; // 6 s — timeout de conexión a la impresora

/* ── Headers CORS — necesario para peticiones desde el browser ── */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ── Envía buffer a la impresora por TCP ─────────────── */
function sendToPrinter(data) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let done   = false;

    const finish = (err) => {
      if (done) return;
      done = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };

    sock.setTimeout(TIMEOUT_MS);
    sock.connect(PRINTER_PORT, PRINTER_IP, () => {
      sock.write(data, (err) => {
        if (err) return finish(err);
        // Dar 300 ms para que la impresora procese antes de cerrar
        setTimeout(() => finish(null), 300);
      });
    });

    sock.on('timeout', () => finish(new Error(`Timeout conectando a ${PRINTER_IP}:${PRINTER_PORT}`)));
    sock.on('error',   (err) => finish(err));
  });
}

/* ── Servidor HTTP ──────────────────────────────────── */
const server = http.createServer((req, res) => {
  // Preflight CORS (petición OPTIONS del browser)
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // Sólo POST a /print
  if (req.method !== 'POST' || req.url !== '/print') {
    res.writeHead(404, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
    res.end('Not found — usa POST /print');
    return;
  }

  // Recoger el cuerpo (datos ESC/POS en binario)
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', async () => {
    const body = Buffer.concat(chunks);
    if (!body.length) {
      res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
      res.end('Cuerpo vacío');
      return;
    }

    console.log(`[${new Date().toLocaleTimeString('es-PE')}] Imprimiendo ${body.length} bytes → ${PRINTER_IP}:${PRINTER_PORT}`);

    try {
      await sendToPrinter(body);
      res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
      res.end('OK');
      console.log('  ✓ Impresión exitosa');
    } catch (err) {
      console.error('  ✗ Error de impresión:', err.message);
      res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'text/plain' });
      res.end('Error de impresora: ' + err.message);
    }
  });

  req.on('error', (err) => {
    console.error('Error en request:', err.message);
    if (!res.headersSent) {
      res.writeHead(500, CORS_HEADERS);
      res.end('Error interno');
    }
  });
});

server.listen(GATEWAY_PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════════');
  console.log(' 🖨️  Gateway de Impresión — Antojitos al Paso');
  console.log('═══════════════════════════════════════════');
  console.log(` Escuchando en  : http://0.0.0.0:${GATEWAY_PORT}`);
  console.log(` Impresora TCP  : ${PRINTER_IP}:${PRINTER_PORT}`);
  console.log('───────────────────────────────────────────');
  console.log(' URL para mesero.html:');
  console.log(` → http://<IP-DE-ESTA-PC>:${GATEWAY_PORT}/print`);
  console.log('═══════════════════════════════════════════');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Puerto ${GATEWAY_PORT} ya en uso. Cambia GATEWAY_PORT.`);
  } else {
    console.error('Error del servidor:', err.message);
  }
  process.exit(1);
});
