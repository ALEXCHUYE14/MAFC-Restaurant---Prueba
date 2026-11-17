// ══════════════════════════════════════════════════════════════════
// MÉTODOS DE PAGO — compartido por los selectores de cobro del admin
// ══════════════════════════════════════════════════════════════════
// mesero.html tiene su PROPIA copia de estas mismas funciones (no puede
// importar de src/ — es un bundle de Vite independiente, ver
// src-apps/mesero/main.jsx) — mantener ambas en sync si se cambia algo aquí.
//
// 'tarjeta' y 'plin' YA eran valores válidos de payment_method en todo el
// sistema (tickets, PDF, caja, el selector de cobro de OrderCard en la
// pestaña Caja) — solo faltaban como botón en los modales de cobro del POS.
// Esto NO es una tabla nueva: payment_breakdown es una columna jsonb
// adicional en `orders`, nula para el 99% de pedidos (pago simple, igual
// que siempre) y con el desglose solo cuando el cobro fue dividido.

export const PAYMENT_METHODS = [
  { key: 'efectivo', icon: '💵', label: 'Efectivo', color: '#16A34A' },
  { key: 'tarjeta',  icon: '💳', label: 'Tarjeta',  color: '#2563EB' },
  { key: 'yape',     icon: '📱', label: 'Yape',     color: '#7C3AED' },
  { key: 'plin',     icon: '📱', label: 'Plin',     color: '#0EA5E9' },
]

const CENTS = v => Math.round((Number(v) || 0) * 100)

// ¿Las partes de un pago dividido suman EXACTO el total, al centavo? Validación
// estricta a propósito — ningún margen de tolerancia: si falta o sobra 1
// centavo, se rechaza (el servidor aplica esta misma regla sin excepción, ver
// el trigger check_payment_breakdown en migracion-pago-mixto.sql). Devuelve
// { ok, message } — nunca lanza, para usarse igual en la validación en vivo
// del formulario que en el envío final.
export function validateBreakdown(legs, total) {
  const clean = (legs || []).filter(l => l && l.metodo && Number(l.monto) > 0)
  if (clean.length === 0) return { ok: false, message: 'Ingresa al menos un monto' }
  if (clean.length === 1) return { ok: false, message: 'Un pago dividido necesita al menos 2 métodos — si es uno solo, no actives "Dividir pago"' }

  const usados = new Set(clean.map(l => l.metodo))
  if (usados.size !== clean.length) return { ok: false, message: 'No repitas el mismo método de pago en el desglose' }

  const suma = clean.reduce((s, l) => s + CENTS(l.monto), 0)
  const totalCents = CENTS(total)
  if (suma !== totalCents) {
    return {
      ok: false,
      message: suma < totalCents
        ? `Falta S/ ${((totalCents - suma) / 100).toFixed(2)} para completar el total`
        : `Te pasaste por S/ ${((suma - totalCents) / 100).toFixed(2)} del total`,
    }
  }
  return { ok: true, message: '', legs: clean }
}

// legs validados → { paymentMethod, paymentBreakdown } listos para guardar en
// `orders`. Un desglose de un único método (no debería llegar aquí, pero por
// si acaso) se guarda como pago simple — nunca como "mixto" de un solo pago.
export function buildOrderPaymentFields(legs) {
  if (!legs || legs.length < 2) {
    const only = legs?.[0]
    return { paymentMethod: only?.metodo || null, paymentBreakdown: null }
  }
  return {
    paymentMethod: 'mixto',
    paymentBreakdown: legs.map(l => ({ metodo: l.metodo, monto: Math.round(Number(l.monto) * 100) / 100 })),
  }
}

// 'efectivo' → 'Pagado - Efectivo' · 'mixto' → 'Pagado - Mixto' — la etiqueta de
// estado que ya usa todo el sistema (isPaid() en cocina/admin solo mira que
// empiece con 'Pagado', así que 'Mixto' queda reconocido como pagado sin
// tocar nada más).
export function buildPayStatus(method) {
  if (method === 'mixto') return 'Pagado - Mixto'
  const found = PAYMENT_METHODS.find(m => m.key === method)
  return `Pagado - ${found ? found.label : 'Efectivo'}`
}

// "Efectivo S/30.00 + Yape S/20.00" — para tickets, toasts y el reporte de turno.
export function summarizeBreakdown(legs) {
  const byKey = Object.fromEntries(PAYMENT_METHODS.map(m => [m.key, m.label]))
  return (legs || []).map(l => `${byKey[l.metodo] || l.metodo} S/${Number(l.monto).toFixed(2)}`).join(' + ')
}
