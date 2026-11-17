import { useEffect } from 'react'
import {
  usePrinter, isBluetoothSupported, connectPrinter, tryAutoReconnect,
  disconnectPrinter, setPaperWidth,
} from '@/services/btPrinter'
import { AlertTriangle, Bluetooth } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   AJUSTES → IMPRESORA BLUETOOTH
   ══════════════════════════════════════════════════════════════════
   Conecta la impresora térmica por Bluetooth (Web Bluetooth) para que los
   tickets del panel admin salgan directo por ahí, con el nombre y RUC/DNI
   configurados arriba. Sin conexión, los tickets siguen saliendo por la
   ventana de impresión del navegador como siempre (ver utils/print.js).

   Nota honesta de la plataforma: el navegador solo permite ELEGIR la
   impresora con un clic del usuario. Después queda recordada; al abrir
   Ajustes/el panel se reconecta sola si el navegador lo permite, y si no,
   basta pulsar "Conectar" una vez.
══════════════════════════════════════════════════════════════════ */

const STATUS_UI = {
  idle:         { color: 'var(--fog)', label: 'Sin impresora' },
  searching:    { color: '#D97706',    label: 'Conectando…' },
  connected:    { color: '#16A34A',    label: '● Conectada' },
  disconnected: { color: '#D97706',    label: 'Desconectada' },
  error:        { color: '#DC2626',    label: 'Error' },
}

export default function PrinterSettings() {
  const printer = usePrinter()
  const supported = isBluetoothSupported()
  const ui = STATUS_UI[printer.status] || STATUS_UI.idle
  const busy = printer.status === 'searching'

  // Si hay una impresora recordada y no está conectada, intenta reconectar en silencio.
  useEffect(() => {
    if (printer.remembered && printer.status !== 'connected') tryAutoReconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const btn = (primary) => ({
    padding: '8px 16px', borderRadius: 20, fontSize: 12, fontWeight: 800,
    cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? .6 : 1, whiteSpace: 'nowrap',
    border: primary ? 'none' : '1px solid var(--line2)',
    background: primary ? 'var(--amber)' : 'var(--ink3)',
    color: primary ? '#fff' : 'var(--snow)',
  })

  return (
    <div>
      {!supported && (
        <div style={{
          marginBottom: 12, padding: '9px 12px', borderRadius: 8, fontSize: 11, lineHeight: 1.5,
          background: 'rgba(217,119,6,.10)', border: '1px solid rgba(217,119,6,.3)', color: '#D97706',
          display: 'flex', gap: 6,
        }}>
          <AlertTriangle size={13} style={{flexShrink:0, marginTop: 1}}/>
          <span>Este navegador no soporta Bluetooth Web. Usa Chrome o Edge en Windows/Android
          (no funciona en Firefox ni en Safari). Mientras tanto los tickets salen por la ventana de impresión.</span>
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        flexWrap: 'wrap', padding: '4px 0 12px',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>
            {printer.deviceName || 'Ninguna impresora vinculada'}
          </div>
          <div style={{ fontSize: 11, marginTop: 2, color: ui.color, fontWeight: 700 }}>
            {ui.label}
            {printer.message && printer.status !== 'connected' ? ` · ${printer.message}` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {printer.status !== 'connected' && printer.remembered && (
            <button disabled={!supported || busy} onClick={() => tryAutoReconnect()} style={{...btn(true), display:'flex', alignItems:'center', gap:6}}>
              <Bluetooth size={13}/> Reconectar
            </button>
          )}
          {printer.status !== 'connected' && (
            // Elegir la impresora SIEMPRE tiene que ser directo desde un clic (regla de Web Bluetooth)
            <button disabled={!supported || busy} onClick={() => connectPrinter()} style={{...btn(!printer.remembered), display:'flex', alignItems:'center', gap:6}}>
              {printer.remembered ? 'Elegir otra impresora' : <><Bluetooth size={13}/> Conectar impresora</>}
            </button>
          )}
          {printer.status === 'connected' && (
            <button onClick={() => disconnectPrinter()} style={btn(false)}>Desconectar</button>
          )}
          {printer.remembered && (
            <button
              onClick={() => { if (window.confirm('¿Olvidar esta impresora? Tendrás que elegirla de nuevo.')) disconnectPrinter({ forget: true }) }}
              style={btn(false)}
            >Olvidar</button>
          )}
        </div>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid var(--line)',
      }}>
        <div style={{ flex: 1, minWidth: 180, paddingRight: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>Ancho del papel</div>
          <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 2 }}>
            Define cuántas columnas usa el ticket por Bluetooth. “Automático” lo deduce del nombre de la impresora.
          </div>
        </div>
        <select
          id="cfg-paper" value={printer.paper}
          onChange={e => setPaperWidth(e.target.value)}
          style={{
            background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8,
            padding: '8px 10px', color: 'var(--snow)', fontSize: 12, outline: 'none',
          }}
        >
          <option value="auto">Automático</option>
          <option value="58">58 mm (32 columnas)</option>
          <option value="80">80 mm (48 columnas)</option>
        </select>
      </div>
    </div>
  )
}
