import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, width = 480, noPadding }) {
  useEffect(() => {
    if (!open) return
    const handler = e => { if (e.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(15,23,42,.45)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose?.() }}
    >
      <div
        className="anim-scale-in"
        style={{
          background: '#FFFFFF', border: '1px solid var(--line2)',
          borderRadius: 'var(--r)', width: '100%', maxWidth: width,
          maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(15,23,42,.16), 0 4px 16px rgba(15,23,42,.08)',
        }}
      >
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: '1px solid var(--line)',
            flexShrink: 0, background: '#FFFFFF',
          }}>
            <h2 style={{
              fontFamily: 'var(--display)', fontSize: 20, letterSpacing: 1,
              color: 'var(--snow)', lineHeight: 1,
            }}>
              {title}
            </h2>
            <button
              onClick={onClose}
              style={{
                background: 'var(--ink3)', border: '1px solid var(--line2)',
                borderRadius: 'var(--r3)',
                width: 28, height: 28, display: 'flex', alignItems: 'center',
                justifyContent: 'center', color: 'var(--mist)', cursor: 'pointer',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--snow)'; e.currentTarget.style.background = 'var(--ink4)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--mist)'; e.currentTarget.style.background = 'var(--ink3)' }}
            >
              <X size={14}/>
            </button>
          </div>
        )}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: noPadding ? 0 : 20,
        }}>
          {children}
        </div>
      </div>
    </div>
  )
}
