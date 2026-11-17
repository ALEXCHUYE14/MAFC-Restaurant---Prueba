import { useState, useMemo } from 'react'
import { useOrders, STATUS_LABELS } from './OrdersContext'
import OrderCard from './OrderCard'
import { Skeleton } from '@/components/Loader'

const STATUS_TABS = ['all', 'pending', 'in_progress', 'ready', 'served', 'paid']

export default function OrderPanel({ role, onPayOrder }) {
  const { orders, loading, updateOrder, cancelOrder, pending, inProgress, ready } = useOrders()
  const [tab, setTab] = useState('all')

  const filtered = useMemo(() => {
    if (tab === 'all') return orders
    // 'paid' incluye tanto 'paid' como 'Pagado - Efectivo' / 'Pagado - Yape' de mesero.html
    if (tab === 'paid') return orders.filter(o => o.status === 'paid' || o.status?.startsWith('Pagado'))
    return orders.filter(o => o.status === tab)
  }, [orders, tab])

  const counts = useMemo(() => ({
    pending:     pending.length,
    in_progress: inProgress.length,
    ready:       ready.length,
  }), [pending, inProgress, ready])

  function tabLabel(t) {
    if (t === 'all') return 'Todos'
    return STATUS_LABELS[t] || t
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tabs */}
      <div style={{
        display: 'flex', gap: 4, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', overflowX: 'auto', flexShrink: 0,
      }}>
        {STATUS_TABS.map(t => {
          const count = counts[t]
          const active = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 12px', borderRadius: 20, border: 'none',
                fontWeight: 700, fontSize: 11, letterSpacing: .5, whiteSpace: 'nowrap',
                cursor: 'pointer', transition: 'all .15s', position: 'relative',
                background: active ? 'var(--amber)' : 'var(--ink3)',
                color: active ? '#FFFFFF' : 'var(--mist)',
              }}
            >
              {tabLabel(t)}
              {count > 0 && !active && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: 'var(--crimson)', color: '#fff',
                  fontSize: 9, fontWeight: 800,
                  width: 16, height: 16, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Stats strip */}
      <div style={{
        display: 'flex', gap: 8, padding: '8px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0,
      }}>
        {[
          { label: 'Pendientes', val: pending.length,     color: '#D97706' },
          { label: 'En cocina',  val: inProgress.length,  color: '#EA580C' },
          { label: 'Listos',     val: ready.length,       color: '#2563EB' },
          { label: 'Total hoy',  val: orders.length,      color: 'var(--mist)' },
        ].map(s => (
          <div key={s.label} style={{
            flex: 1, background: 'var(--ink3)', border: '1px solid var(--line)',
            borderRadius: 'var(--r2)', padding: '8px 10px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 22, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 2, letterSpacing: .5 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Order list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} height={140} style={{ marginBottom: 0 }} />
          ))
        ) : filtered.length === 0 ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 10, paddingTop: 40,
          }}>
            <span style={{ fontSize: 40 }}>🍽️</span>
            <p style={{ color: 'var(--fog)', fontSize: 13 }}>No hay pedidos {tab !== 'all' ? `"${tabLabel(tab)}"` : 'por ahora'}</p>
          </div>
        ) : (
          filtered.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              role={role}
              onUpdate={updateOrder}
              onCancel={role === 'admin' ? cancelOrder : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}
