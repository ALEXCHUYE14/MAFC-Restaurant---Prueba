const PRESET = {
  pending:     { label: 'Pendiente',    bg: 'rgba(217,119,6,.10)',   color: '#92400E', dot: '#D97706'  },
  in_progress: { label: 'Preparando',   bg: 'rgba(234,88,12,.10)',   color: '#9A3412', dot: '#EA580C'  },
  ready:       { label: 'Listo',        bg: 'rgba(22,163,74,.10)',   color: '#14532D', dot: '#16A34A'  },
  served:      { label: 'Servido',      bg: 'rgba(124,58,237,.10)',  color: '#4C1D95', dot: '#7C3AED'  },
  paid:        { label: 'Pagado',       bg: 'rgba(22,163,74,.10)',   color: '#14532D', dot: '#16A34A'  },
  available:   { label: 'Disponible',   bg: 'rgba(22,163,74,.10)',   color: '#14532D', dot: '#16A34A'  },
  occupied:    { label: 'Ocupada',      bg: 'rgba(220,38,38,.10)',   color: '#7F1D1D', dot: '#DC2626'  },
  reserved:    { label: 'Reservada',    bg: 'rgba(37,99,235,.10)',   color: '#1E3A8A', dot: '#2563EB'  },
  cleaning:    { label: 'Por Limpiar',  bg: 'rgba(217,119,6,.10)',   color: '#92400E', dot: '#D97706'  },
}

export default function Badge({ status, label, color, bg, pulse, small }) {
  const p = PRESET[status] || {}
  const text  = label  || p.label  || status
  const bg_   = bg     || p.bg     || 'rgba(100,116,139,.10)'
  const color_= color  || p.color  || 'var(--mist)'
  const dot   = p.dot  || color_

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: small ? 4 : 5,
      background: bg_, borderRadius: 20,
      padding: small ? '2px 7px' : '3px 9px',
      fontSize: small ? 9 : 10.5, fontWeight: 700,
      letterSpacing: .5, color: color_, whiteSpace: 'nowrap',
    }}>
      <span
        className={pulse ? 'anim-blink' : ''}
        style={{
          width: small ? 5 : 6, height: small ? 5 : 6,
          borderRadius: '50%', background: dot, flexShrink: 0,
        }}
      />
      {text}
    </span>
  )
}
