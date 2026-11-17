/* ══════════════════════════════════════════════════════════════════
   ⚠️  NO USADO EN PRODUCCIÓN — no editar pensando que afecta al mesero real.
   ══════════════════════════════════════════════════════════════════
   El mesero real de "Antojitos al Paso" es /mesero.html
   (código en src-apps/mesero/main.jsx). RoleSelector.jsx nunca navega
   a esta vista — la tarjeta "Mesero" de la pantalla de inicio redirige
   directo a /mesero.html. Esta ruta (/waiter) solo se alcanzaría si un
   usuario con rol "waiter" hiciera login por Supabase Auth en /login,
   flujo que el mesero real no usa (su login es por PIN, no por email).

   Además, este componente no tiene el sistema de "rondas" para ampliar
   un pedido ya enviado, ni las alertas de urgencia — no está a la
   altura del flujo real y no se mantiene desde hace varios commits.

   Si necesitas cambiar algo del mesero, el archivo correcto es
   src-apps/mesero/main.jsx. Si quieres retomar y unificar esta vista
   como reemplazo real, revisa primero el informe de auditoría del
   sistema (Fase 0/2) antes de tocarla.
   ══════════════════════════════════════════════════════════════════ */
import { useState, useCallback } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { useOrders } from '@/features/orders/OrdersContext'
import { useTables } from '@/features/tables/TablesContext'
import TableMap from '@/features/tables/TableMap'
import NewOrderModal from '@/features/orders/NewOrderModal'
import OrderCard from '@/features/orders/OrderCard'
import Badge from '@/components/Badge'
import useToast from '@/hooks/useToast'
import ToastContainer from '@/components/Toast'

export default function WaiterView() {
  const { user, logout }            = useAuth()
  const { orders, addOrder, updateOrder } = useOrders()
  const { tables, occupyTable }     = useTables()
  const { toasts, success, error: toastError, dismiss } = useToast()

  const [tab, setTab]               = useState('tables')
  const [selectedTable, setSelectedTable] = useState(null)
  const [showNewOrder, setShowNewOrder]   = useState(false)

  // My orders (by this waiter)
  const myOrders = orders.filter(o => o.waiterId === user?.uid && o.status !== 'paid')

  function handleSelectTable(table) {
    setSelectedTable(table)
    if (table.status === 'available') {
      setShowNewOrder(true)
    }
  }

  async function handleSubmitOrder(orderData) {
    try {
      const orderId = await addOrder(orderData)
      await occupyTable(selectedTable.id, {
        orderId,
        waiterId:   user.uid,
        waiterName: user.name,
      })
      success(`✅ Pedido enviado a cocina · Mesa ${orderData.tableNumber}`)
      setSelectedTable(null)
    } catch (e) {
      toastError('Error al enviar el pedido: ' + e.message)
    }
  }

  const navItems = [
    { key: 'tables', icon: '🗺️', label: 'Mesas' },
    { key: 'orders', icon: '📋', label: 'Mis Pedidos', badge: myOrders.length },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--ink)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        background: 'var(--ink1)', borderBottom: '1px solid var(--line)',
        padding: '0 14px', height: 54,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, position: 'relative',
      }} className="topline">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🔥</span>
          <div>
            <p style={{ fontFamily: 'var(--display)', fontSize: 17, color: 'var(--amber)', letterSpacing: 1, lineHeight: 1 }}>
              ANTOJITOS AL PASO
            </p>
            <p style={{ fontSize: 9, color: 'var(--mist)', letterSpacing: 2 }}>
              SISTEMA MESERO
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 30, padding: '3px 10px 3px 4px',
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: (user?.color || '#2563EB') + '22',
              color: user?.color || '#2563EB',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800,
            }}>
              {user?.avatar}
            </div>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{user?.name}</span>
          </div>
          <button
            onClick={logout}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--fog)', fontSize: 11, cursor: 'pointer',
              padding: '5px 8px',
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {/* Nav tabs */}
      <div style={{
        display: 'flex', background: 'var(--ink1)', borderBottom: '1px solid var(--line)',
        flexShrink: 0,
      }}>
        {navItems.map(item => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            style={{
              flex: 1, padding: '10px 4px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              fontSize: 9.5, fontWeight: 700, letterSpacing: .5, textTransform: 'uppercase',
              color: tab === item.key ? 'var(--amber)' : 'var(--fog)',
              background: 'none', border: 'none',
              borderBottom: `2px solid ${tab === item.key ? 'var(--amber)' : 'transparent'}`,
              cursor: 'pointer', transition: 'all .2s', position: 'relative',
            }}
          >
            <span style={{ fontSize: 17 }}>{item.icon}</span>
            {item.label}
            {item.badge > 0 && (
              <span className="anim-pop-in" style={{
                position: 'absolute', top: 5, right: 'calc(50% - 14px)',
                background: 'var(--crimson)', color: '#fff',
                fontSize: 9, fontWeight: 800, width: 16, height: 16,
                borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'tables' && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <p style={{ fontSize: 11, color: 'var(--mist)' }}>
                Toca una mesa <span style={{ color: 'var(--emerald)' }}>disponible</span> para crear un pedido
              </p>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <TableMap
                onSelectTable={handleSelectTable}
                selectedId={selectedTable?.id}
                compact
              />
            </div>
          </div>
        )}

        {tab === 'orders' && (
          <div style={{ height: '100%', overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {myOrders.length === 0 ? (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 10, paddingTop: 60,
              }}>
                <span style={{ fontSize: 40 }}>📋</span>
                <p style={{ color: 'var(--fog)', fontSize: 13 }}>No tienes pedidos activos</p>
              </div>
            ) : (
              myOrders.map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  role="waiter"
                  onUpdate={updateOrder}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* New Order Modal */}
      <NewOrderModal
        open={showNewOrder}
        onClose={() => { setShowNewOrder(false); setSelectedTable(null) }}
        onSubmit={handleSubmitOrder}
        tableNumber={selectedTable?.number}
        waiter={user}
      />

      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
