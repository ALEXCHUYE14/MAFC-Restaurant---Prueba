import { Component } from 'react'
import { reportError } from '@/services/monitoring'
import { AlertTriangle } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   ErrorBoundary — red de contención ante errores de render.
   ══════════════════════════════════════════════════════════════════
   Antes de esto, una excepción en CUALQUIER componente (Caja, Stock,
   Pedidos...) tumbaba TODO el AdminDashboard a una pantalla blanca en
   medio de un turno, sin mensaje y sin forma de recuperarse sin recargar
   (y sin garantía de que recargar no perdiera el contexto de lo que se
   estaba haciendo).

   Uso:
     <ErrorBoundary label="Caja">
       <CashierPanel />
     </ErrorBoundary>

   - `label` (opcional): nombre del panel, se muestra en el mensaje y en
     el log de consola para ubicar rápido qué se rompió.
   - `fallback` (opcional): render-prop `(error, reset) => ReactNode` para
     una pantalla de error a medida. Si no se pasa, usa la genérica de
     abajo (estilo Enterprise Light, coherente con el resto del panel).
   - Solo atrapa errores de RENDER (React), no errores async sueltos
     (fetch, setTimeout) — esos ya se manejan con try/catch + toast en
     cada función, como en el resto del código.
   - IMPORTANTE: nunca reemplaza el manejo de errores existente (los
     try/catch de Supabase, los toasts de éxito/error) — es la última
     línea de defensa para lo que se escape de ahí.
══════════════════════════════════════════════════════════════════ */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Log detallado para diagnóstico — no se pierde el stack ni el
    // componente exacto que falló, aunque la UI ya muestre el fallback.
    console.error(`[ErrorBoundary${this.props.label ? ' · ' + this.props.label : ''}]`, error, info?.componentStack)
    // Reporta a Sentry si está configurado — no-op si no (ver monitoring.js)
    reportError(error, { label: this.props.label, componentStack: info?.componentStack })
  }

  reset = () => {
    this.setState({ error: null })
    if (this.props.onReset) {
      try { this.props.onReset() } catch (_) {}
    }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset)
    }

    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 14, padding: '48px 24px', textAlign: 'center', minHeight: 280,
        fontFamily: "'Outfit', sans-serif",
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlertTriangle size={26} color="#DC2626" strokeWidth={1.75}/>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
            {this.props.label ? `Algo falló en ${this.props.label}` : 'Algo salió mal en esta sección'}
          </div>
          <div style={{ fontSize: 13, color: '#475569', marginTop: 6, maxWidth: 360 }}>
            Tus datos están a salvo — el error quedó solo en esta parte de la pantalla.
            Puedes intentar de nuevo o recargar la página si el problema continúa.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={this.reset}
            style={{
              padding: '9px 18px', borderRadius: 9, border: 'none', cursor: 'pointer',
              background: '#2563EB', color: '#fff', fontWeight: 700, fontSize: 13,
            }}
          >
            Reintentar
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '9px 18px', borderRadius: 9, cursor: 'pointer',
              background: '#fff', color: '#0F172A', fontWeight: 700, fontSize: 13,
              border: '1px solid #E2E8F0',
            }}
          >
            Recargar página
          </button>
        </div>
        {import.meta.env?.DEV && (
          <pre style={{
            marginTop: 8, maxWidth: 520, overflow: 'auto', textAlign: 'left',
            fontSize: 11, color: '#B91C1C', background: '#FEF2F2',
            border: '1px solid #FECACA', borderRadius: 8, padding: 10,
          }}>
            {String(error?.stack || error?.message || error)}
          </pre>
        )}
      </div>
    )
  }
}
