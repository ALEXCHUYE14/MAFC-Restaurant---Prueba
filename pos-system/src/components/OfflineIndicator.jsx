import { useOffline } from '@/context/OfflineContext'
import { WifiOff, RotateCw, Check, AlertTriangle } from 'lucide-react'

/**
 * OfflineIndicator — Banner fijo en la parte superior de la pantalla.
 *
 * Estados:
 *   offline   → rojo: "Sin conexión · N pedidos guardados"
 *   syncing   → ámbar: "Sincronizando N pedidos..."
 *   done      → verde: "Todo sincronizado ✓"   (desaparece en 4s)
 *   online    → invisible
 */
export default function OfflineIndicator() {
  const { isOnline, isSyncing, pendingCount, syncStatus } = useOffline()

  // No mostrar nada cuando está online y sin pendientes ni en proceso
  if (isOnline && !isSyncing && syncStatus === 'idle') return null

  let bg, border, color, Icon, text

  if (!isOnline) {
    bg     = 'rgba(220,38,38,0.12)'
    border = 'rgba(220,38,38,0.45)'
    color  = '#DC2626'
    Icon   = WifiOff
    text   = pendingCount > 0
      ? `Sin conexión · ${pendingCount} pedido${pendingCount !== 1 ? 's' : ''} guardado${pendingCount !== 1 ? 's' : ''} localmente`
      : 'Sin conexión · Los pedidos se guardarán localmente'
  } else if (isSyncing || syncStatus === 'syncing') {
    bg     = 'rgba(217,119,6,0.12)'
    border = 'rgba(217,119,6,0.45)'
    color  = '#D97706'
    Icon   = RotateCw
    text   = `Sincronizando ${pendingCount > 0 ? pendingCount + ' pedido' + (pendingCount !== 1 ? 's' : '') : 'datos'} con el servidor…`
  } else if (syncStatus === 'done') {
    bg     = 'rgba(22,163,74,0.12)'
    border = 'rgba(22,163,74,0.45)'
    color  = '#16A34A'
    Icon   = Check
    text   = 'Todo sincronizado correctamente'
  } else if (syncStatus === 'error') {
    bg     = 'rgba(217,119,6,0.12)'
    border = 'rgba(217,119,6,0.45)'
    color  = '#D97706'
    Icon   = AlertTriangle
    text   = 'Algunos pedidos no se sincronizaron — reintentando al reconectarse'
  } else {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position:   'fixed',
        top:        0,
        left:       0,
        right:      0,
        zIndex:     9999,
        background: bg,
        borderBottom: `1px solid ${border}`,
        backdropFilter: 'blur(8px)',
        padding:    '8px 16px',
        display:    'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap:        10,
        animation:  'offlineBannerIn .25s ease',
      }}
    >
      <style>{`
        @keyframes offlineBannerIn {
          from { opacity: 0; transform: translateY(-100%); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spinSlow {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Icono */}
      <Icon
        size={15}
        color={color}
        style={{
          display:  'inline-block',
          animation: (isSyncing || syncStatus === 'syncing')
            ? 'spinSlow .9s linear infinite'
            : 'none',
        }}
      />

      {/* Texto */}
      <span style={{
        fontSize:   12,
        fontWeight: 700,
        color,
        letterSpacing: .3,
        fontFamily: 'var(--body, sans-serif)',
      }}>
        {text}
      </span>

      {/* Dot parpadeante cuando offline */}
      {!isOnline && (
        <span style={{
          width:  8,
          height: 8,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
          animation: 'blink 1.2s ease-in-out infinite',
        }}/>
      )}
    </div>
  )
}
