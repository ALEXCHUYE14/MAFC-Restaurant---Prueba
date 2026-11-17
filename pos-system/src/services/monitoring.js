import * as Sentry from '@sentry/react'

/* ══════════════════════════════════════════════════════════════════
   MONITORING — Sentry (opcional, no-op si no está configurado)
   ══════════════════════════════════════════════════════════════════
   Objetivo: enterarte de un error real de producción (AdminDashboard)
   antes de que un mesero/cajero te llame para avisarte.

   CONFIGURACIÓN (una sola vez, opcional):
     1. Crea una cuenta gratis en https://sentry.io (plan Developer
        gratuito alcanza de sobra para un solo local).
     2. Crea un proyecto "React" → copia el DSN que te da.
     3. En Vercel → Project Settings → Environment Variables, agrega:
          VITE_SENTRY_DSN = <tu DSN>
        (y lo mismo en un .env local si quieres probarlo en tu máquina).
     4. Vuelve a desplegar — listo, ya está reportando.

   Sin VITE_SENTRY_DSN configurado, initMonitoring() no hace NADA — la
   app funciona exactamente igual que antes, sin ningún error ni
   advertencia. Nunca es un requisito para que el sistema funcione.
══════════════════════════════════════════════════════════════════ */

let enabled = false

export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return // sin DSN configurado → no-op total, no rompe nada

  try {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      // Sample bajo — un solo local, no necesita tracing de performance
      // detallado, y así se mantiene dentro del plan gratuito.
      tracesSampleRate: 0.1,
      // No enviar nunca el PIN/contraseña si quedara en algún log de breadcrumb.
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === 'console' && /pin|password|contrase/i.test(breadcrumb.message || '')) {
          return null
        }
        return breadcrumb
      },
    })
    enabled = true
  } catch (e) {
    console.warn('[monitoring] Sentry no se pudo inicializar:', e.message)
  }
}

// Usado por ErrorBoundary — nunca lanza, siempre es seguro llamarlo
// aunque Sentry no esté configurado.
export function reportError(error, extra) {
  if (!enabled) return
  try { Sentry.captureException(error, { extra }) } catch (_) {}
}

// Identifica al admin logueado en los reportes de error (sin datos
// sensibles — solo lo que ya es público dentro de la propia app).
export function setMonitoringUser(user) {
  if (!enabled) return
  try {
    Sentry.setUser(user ? { id: user.uid || user.id, username: user.name, email: user.email } : null)
  } catch (_) {}
}
