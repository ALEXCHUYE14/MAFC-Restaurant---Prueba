import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info }
const COLORS = {
  success: { border: 'rgba(22,163,74,.35)',  bg: '#F0FDF4',  text: '#15803D' },
  error:   { border: 'rgba(220,38,38,.35)',  bg: '#FEF2F2',  text: '#B91C1C' },
  warning: { border: 'rgba(217,119,6,.35)',  bg: '#FFFBEB',  text: '#92400E' },
  info:    { border: 'rgba(37,99,235,.35)',  bg: '#EFF6FF',  text: '#1D4ED8' },
}

function Toast({ id, message, type = 'info', onDismiss }) {
  const c = COLORS[type] || COLORS.info
  const Icon = ICONS[type] || ICONS.info
  return (
    <div
      className="toast-enter"
      onClick={() => onDismiss(id)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
        background: c.bg, border: `1px solid ${c.border}`,
        borderRadius: 'var(--r2)', padding: '10px 14px',
        maxWidth: 320, minWidth: 240,
        boxShadow: '0 4px 16px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06)',
      }}
    >
      <Icon size={16} color={c.text} style={{flexShrink:0}}/>
      <span style={{ fontSize: 13, color: '#1E293B', flex: 1, lineHeight: 1.4 }}>{message}</span>
      <X size={13} color={c.text} style={{flexShrink:0}}/>
    </div>
  )
}

export default function ToastContainer({ toasts, onDismiss }) {
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 16, zIndex: 99999,
      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
      pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{ pointerEvents: 'all' }}>
          <Toast {...t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}
