/* ══════════════════════════════════════════════════════════════════
   ⚠️  NO USADO EN PRODUCCIÓN — no editar pensando que afecta a cocina real.
   ══════════════════════════════════════════════════════════════════
   El panel de cocina real es /cocina.html
   (código en src-apps/cocina/main.jsx). RoleSelector.jsx nunca navega
   a esta vista — la tarjeta "Cocina" de la pantalla de inicio redirige
   directo a /cocina.html. Esta ruta (/kitchen) solo se alcanzaría con
   un login por Supabase Auth de rol "kitchen", flujo que cocina real
   no usa (su login es usuario/clave fijos dentro de cocina.html).

   Este componente no distingue pedidos de mesa (con `rounds`) de
   pedidos externos (`kitchen_status`), ni tiene el sistema de
   urgencia con umbrales de 10/20/15/25 min — no está a la altura del
   flujo real y no se mantiene desde hace varios commits.

   Si necesitas cambiar algo de cocina, el archivo correcto es
   src-apps/cocina/main.jsx.
   ══════════════════════════════════════════════════════════════════ */
import { useState, useEffect } from 'react'
import { useOrders } from '@/features/orders/OrdersContext'
import OrderCard from '@/features/orders/OrderCard'
import { useAuth } from '@/features/auth/AuthContext'
import { minutesElapsed, formatTime } from '@/utils/dates'

export default function KitchenView() {
  const { user, logout } = useAuth()
  const { pending, inProgress, ready, orders, loading, updateOrder } = useOrders()
  const [now,       setNow]       = useState(new Date())
  const [activeCol, setActiveCol] = useState('pending')

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const columns = [
    { key: 'pending',     label: 'NUEVOS',        data: pending,    color: '#D97706', icon: '🔔' },
    { key: 'in_progress', label: 'EN PREPARACIÓN', data: inProgress, color: '#EA580C', icon: '🍳' },
    { key: 'ready',       label: 'LISTOS',          data: ready,     color: '#16A34A', icon: '✅' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--ink)', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        background: 'var(--ink1)', borderBottom: '1px solid var(--line)',
        padding: '0 16px', height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, position: 'relative',
      }} className="topline">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🍳</span>
          <div>
            <p style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--amber)', letterSpacing: 1, lineHeight: 1 }}>
              COCINA
            </p>
            <p style={{ fontSize: 9, color: 'var(--mist)', letterSpacing: 2, textTransform: 'uppercase' }}>
              Antojitos al Paso
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 16, color: 'var(--snow)',
            background: 'var(--ink3)', border: '1px solid var(--line)',
            padding: '4px 12px', borderRadius: 20,
          }}>
            {now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })}
          </span>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(234,88,12,.10)', border: '1px solid rgba(234,88,12,.30)',
            borderRadius: 20, padding: '4px 10px',
          }}>
            <span style={{ fontSize: 12 }}>{user?.avatar}</span>
            <span style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>{user?.name}</span>
          </div>
          <button
            onClick={logout}
            style={{
              background: 'var(--ink3)', border: '1px solid var(--line2)',
              borderRadius: 'var(--r2)', padding: '5px 10px',
              color: 'var(--fog)', fontSize: 11, cursor: 'pointer',
              minHeight: 36,
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {/* ── Tabs de columna (solo en móvil) ── */}
      <div className="kitchen-mobile-tabs" style={{
        flexShrink: 0, background: 'var(--ink1)', borderBottom: '1px solid var(--line)',
      }}>
        {columns.map(col => {
          const isActive = activeCol === col.key
          return (
            <button
              key={col.key}
              onClick={() => setActiveCol(col.key)}
              style={{
                flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                background: isActive ? col.color + '14' : 'transparent',
                borderBottom: `2px solid ${isActive ? col.color : 'transparent'}`,
                transition: 'all .15s', position: 'relative',
                minHeight: 44,
              }}
            >
              <span style={{ fontSize: 18 }}>{col.icon}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: isActive ? col.color : 'var(--fog)', letterSpacing: .5 }}>
                {col.label}
              </span>
              {col.data.length > 0 && (
                <span style={{
                  position: 'absolute', top: 6, right: 'calc(50% - 18px)',
                  background: col.color, color: '#fff',
                  fontSize: 8, fontWeight: 800,
                  width: 15, height: 15, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{col.data.length}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Kanban de 3 columnas (en móvil: solo la columna activa) ── */}
      <div style={{ flex: 1, display: 'flex', gap: 0, overflow: 'hidden' }}>
        {columns.map((col, idx) => (
          <div
            key={col.key}
            className={activeCol !== col.key ? 'kitchen-col-hidden' : undefined}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
              borderRight: idx < columns.length - 1 ? '1px solid var(--line)' : 'none',
            }}
          >
            {/* Encabezado de columna */}
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--line)',
              background: col.color + '10', display: 'flex', alignItems: 'center',
              justifyContent: 'space-between', flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{col.icon}</span>
                <span style={{
                  fontFamily: 'var(--display)', fontSize: 14, letterSpacing: 2,
                  color: col.color,
                }}>
                  {col.label}
                </span>
              </div>
              <span style={{
                background: col.color + '22', color: col.color,
                fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 800,
                borderRadius: 20, padding: '2px 10px',
              }}>
                {col.data.length}
              </span>
            </div>

            {/* Pedidos de la columna */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {col.data.length === 0 ? (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: 120, gap: 8,
                }}>
                  <span style={{ fontSize: 28, opacity: .3 }}>{col.icon}</span>
                  <p style={{ fontSize: 11, color: 'var(--ghost)' }}>Sin pedidos</p>
                </div>
              ) : (
                col.data.map(order => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    role="kitchen"
                    onUpdate={updateOrder}
                    compact
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
