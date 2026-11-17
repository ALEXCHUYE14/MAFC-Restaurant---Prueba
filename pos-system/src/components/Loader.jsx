export default function Loader({ fullscreen, size = 32, label }) {
  const spinner = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div
        className="anim-spin"
        style={{
          width: size, height: size, borderRadius: '50%',
          border: '3px solid var(--line2)',
          borderTopColor: 'var(--amber)',
        }}
      />
      {label && <p style={{ fontSize: 12, color: 'var(--mist)', letterSpacing: 1 }}>{label}</p>}
    </div>
  )

  if (fullscreen) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'var(--ink)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9000,
      }}>
        {spinner}
      </div>
    )
  }
  return spinner
}

export function Skeleton({ width = '100%', height = 18, style }) {
  return (
    <div
      className="skeleton"
      style={{ width, height, borderRadius: 'var(--r3)', ...style }}
    />
  )
}
