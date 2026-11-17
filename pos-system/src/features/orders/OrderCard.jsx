import { useState } from 'react'
import Badge from '@/components/Badge'
import { formatPEN } from '@/utils/currency'
import { formatTime, minutesElapsed } from '@/utils/dates'
import { STATUS_LABELS, STATUS_NEXT } from './OrdersContext'
import {
  ClipboardList, User, Phone, MapPin, Clock, ChefHat, CheckCircle2,
  UtensilsCrossed, CreditCard, AlertTriangle, NotebookPen, Check,
  Banknote, Smartphone, Ban, Loader2,
} from 'lucide-react'

function DeliveryNotesBlock({ notes }) {
  let info = null
  try { info = JSON.parse(notes) } catch (_) {}

  if (!info || typeof info !== 'object' || !('customerName' in info)) {
    return (
      <div style={{
        background: 'rgba(217,119,6,.06)', border: '1px solid rgba(217,119,6,.15)',
        borderRadius: 'var(--r3)', padding: '7px 10px',
        fontSize: 11, color: 'var(--mist)', display: 'flex', alignItems: 'center', gap: 5,
      }}>
        <ClipboardList size={12} style={{flexShrink:0}}/> {notes}
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(37,99,235,.06)', border: '1px solid rgba(37,99,235,.2)',
      borderRadius: 'var(--r3)', padding: '9px 12px',
      fontSize: 11, display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      {info.customerName && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: 'var(--fog)', minWidth: 132, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}><User size={11}/> Nombre del cliente:</span>
          <strong style={{ color: 'var(--snow)' }}>{info.customerName}</strong>
        </div>
      )}
      {info.phone && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: 'var(--fog)', minWidth: 132, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11}/> Teléfono:</span>
          <strong style={{ color: 'var(--snow)' }}>{info.phone}</strong>
        </div>
      )}
      {info.address && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span style={{ color: 'var(--fog)', minWidth: 132, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={11}/> Dirección:</span>
          <strong style={{ color: 'var(--snow)' }}>{info.address}</strong>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--fog)', minWidth: 132, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={11}/> Hora de recogida:</span>
        <strong style={{ color: info.pickupTime ? 'var(--snow)' : 'var(--fog)' }}>
          {info.pickupTime || 'No especificada'}
        </strong>
      </div>
    </div>
  )
}

const STATUS_ACTIONS = {
  pending:     { icon: ChefHat,         text: 'Iniciar preparación', next: 'in_progress' },
  in_progress: { icon: CheckCircle2,    text: 'Listo para servir',   next: 'ready'       },
  ready:       { icon: UtensilsCrossed, text: 'Marcado como servido', next: 'served'     },
  served:      { icon: CreditCard,      text: 'Procesar pago',       next: 'paid'        },
}

const DIRECT_TO_CASHIER_ZONES = ['Para Llevar', 'Delivery', 'Recojo en Local']

const PM_ICONS  = { efectivo: Banknote, yape: Smartphone, tarjeta: CreditCard, plin: Smartphone }
const PM_LABELS = { efectivo: 'Efectivo', yape: 'Yape', tarjeta: 'Tarjeta', plin: 'Plin' }

export default function OrderCard({ order, onUpdate, onCancel, compact, role }) {
  const [pmPaying, setPmPaying] = useState('')  // '' = inactivo; PM = procesando
  const [cancelling, setCancelling] = useState(false)

  // Normaliza nombres de campo: soporta snake_case (Supabase) y camelCase (legado)
  const tableNumber = order.table_number  ?? order.tableNumber  ?? 0
  const waiterName  = order.waiter_name   ?? order.waiterName   ?? '–'
  const waiterColor = order.waiter_color  ?? order.waiterColor  ?? '#2563EB'
  const waiterAvatar = order.waiter_avatar ?? order.waiterAvatar ?? '🧑'
  const createdAt   = order.created_at    ?? order.createdAt
  const payMethod   = order.payment_method ?? order.paymentMethod ?? ''

  const elapsed  = minutesElapsed(createdAt)
  const isUrgent = elapsed > 20 && order.status !== 'paid' && !order.status?.startsWith('Pagado')
  const action   = STATUS_ACTIONS[order.status]
  const isPaid   = order.status === 'paid' || order.status?.startsWith('Pagado')

  // Anular (solo admin, solo pedidos no cobrados). La base de datos vuelve a
  // verificar que no esté cobrado, devuelve el stock y libera la mesa.
  async function handleCancel() {
    if (cancelling || !onCancel) return
    const label = tableNumber > 0 ? `Mesa ${tableNumber}` : (order.zone || 'este pedido')
    const motivo = window.prompt(
      `¿Anular el pedido de ${label} por ${formatPEN(order.total || 0)}?\n\n` +
      'No se contará como venta, lo descontado del stock vuelve y la mesa se libera.\n\n' +
      'Escribe el motivo (opcional) y pulsa Aceptar:', ''
    )
    if (motivo === null) return // canceló
    setCancelling(true)
    try {
      const r = await onCancel(order, motivo)
      const n = Number(r?.returned_units) || 0
      if (n > 0) alert(`Pedido anulado. ${n} unidad${n === 1 ? '' : 'es'} devuelta${n === 1 ? '' : 's'} al stock.`)
    } catch (e) {
      alert('⚠ No se pudo anular: ' + (e?.message || 'error desconocido'))
      setCancelling(false)
    }
  }

  return (
    <div
      className="anim-fade-up"
      style={{
        background: 'var(--ink2)',
        border: `1px solid ${isUrgent ? 'rgba(220,38,38,.4)' : 'var(--line)'}`,
        borderRadius: 'var(--r)', padding: compact ? '12px 14px' : '16px',
        display: 'flex', flexDirection: 'column', gap: 10,
        transition: 'border-color .2s',
        boxShadow: isUrgent ? '0 0 16px rgba(220,38,38,.1)' : 'none',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 'var(--r3)', padding: '3px 9px',
            fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, color: 'var(--amber)',
          }}>
            {tableNumber > 0 ? `Mesa ${tableNumber}` : (order.zone || 'Externo')}
          </span>
          <Badge status={order.status} pulse={order.status === 'pending' || order.status === 'in_progress'} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isUrgent && (
            <span className="anim-blink" style={{ fontSize: 11, color: 'var(--crimson)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <AlertTriangle size={11}/> {elapsed}m
            </span>
          )}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fog)' }}>
            {formatTime(createdAt)}
          </span>
        </div>
      </div>

      {/* Waiter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%',
          background: waiterColor + '22',
          color: waiterColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12,
        }}>
          {waiterAvatar}
        </span>
        <span style={{ fontSize: 11, color: 'var(--mist)' }}>
          {waiterName}
        </span>
        {payMethod && (
          <span style={{
            marginLeft: 4, fontSize: 10, color: 'var(--fog)',
            background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 'var(--r3)', padding: '1px 6px',
            display: 'inline-flex', alignItems: 'center', gap: 3,
          }}>
            {PM_ICONS[payMethod] && (() => { const PmIcon = PM_ICONS[payMethod]; return <PmIcon size={10}/>; })()}
            {PM_LABELS[payMethod] || payMethod}
          </span>
        )}
        <span style={{ fontSize: 10, color: 'var(--fog)', marginLeft: 'auto' }}>
          #{order.id?.substring(0, 6).toUpperCase()}
        </span>
      </div>

      {/* Items */}
      <div style={{
        background: 'var(--ink3)', borderRadius: 'var(--r2)',
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {(order.items || []).map((item, i) => {
          // Normaliza qty: soporta 'qty' (nuevo) y 'quantity' (legado)
          const qty = item.qty ?? item.quantity ?? 1
          return (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <span style={{
                background: 'var(--amber)', color: '#FFFFFF', borderRadius: 4,
                fontSize: 10, fontWeight: 800, padding: '1px 5px', flexShrink: 0, marginTop: 1,
              }}>
                {qty}×
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--snow)', fontWeight: 600 }}>{item.name}</div>
                {item.notes && (
                  <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <NotebookPen size={10}/> {item.notes}
                  </div>
                )}
                {item.note && (
                  <div style={{ fontSize: 10, color: 'var(--amber)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertTriangle size={10}/> {item.note}
                  </div>
                )}
              </div>
              <span style={{ fontSize: 11, color: 'var(--fog)', fontFamily: 'var(--mono)', flexShrink: 0 }}>
                {formatPEN((item.price || 0) * qty)}
              </span>
            </div>
          )
        })}
      </div>

      {/* Notes */}
      {order.notes && <DeliveryNotesBlock notes={order.notes} />}

      {/* Footer */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderTop: '1px solid var(--line)', paddingTop: 10, gap: 8,
      }}>
        <div>
          <span style={{ fontSize: 10, color: 'var(--fog)' }}>TOTAL</span>
          <div style={{
            fontFamily: 'var(--display)', fontSize: 20, color: 'var(--amber)',
            letterSpacing: .5, lineHeight: 1,
          }}>
            {formatPEN(order.total || 0)}
          </div>
        </div>

        {/* Botón de avance de estado (no aplica a cashier ni a órdenes ya pagadas) */}
        {action && onUpdate && role !== 'waiter' && role !== 'cashier' && !isPaid && (
          <button
            onClick={() => onUpdate(order.id, { status: action.next })}
            style={{
              background: 'linear-gradient(135deg, var(--amber), var(--amber2))',
              color: '#FFFFFF', border: 'none', borderRadius: 'var(--r2)',
              padding: '8px 14px', fontSize: 11, fontWeight: 800,
              cursor: 'pointer', transition: 'all .15s', letterSpacing: .3,
              whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.opacity = '.85'}
            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          >
            <action.icon size={13}/> {action.text}
          </button>
        )}

        {/* Selector de cobro: pedidos entregados por mesero ('served')
            o pedidos listos de zonas sin mesero (Para Llevar, Delivery, Recojo).
            Controlado + deshabilitado durante el procesamiento para evitar doble cobro. */}
        {role === 'cashier' && onUpdate &&
          (order.status === 'served' ||
           (order.status === 'ready' && DIRECT_TO_CASHIER_ZONES.includes(order.zone))) && (
          <select
            value={pmPaying}
            disabled={!!pmPaying}
            onChange={async e => {
              const pm = e.target.value
              if (!pm || pmPaying) return
              setPmPaying(pm)
              try {
                await onUpdate(order.id, {
                  status:         `Pagado - ${pm.charAt(0).toUpperCase() + pm.slice(1)}`,
                  payment_method: pm,
                  paid_at:        new Date().toISOString(),
                })
              } catch (_) {
                setPmPaying('')  // reset en error para permitir reintento
              }
            }}
            style={{
              background: pmPaying ? 'var(--ink4)' : 'var(--ink3)',
              border: '1px solid var(--line2)',
              borderRadius: 'var(--r2)', padding: '7px 10px',
              color: pmPaying ? 'var(--fog)' : 'var(--snow)',
              fontSize: 12, cursor: pmPaying ? 'not-allowed' : 'pointer',
              transition: 'all .15s',
            }}
          >
            <option value="" disabled>{pmPaying ? '⏳ Procesando...' : '💳 Cobrar…'}</option>
            {!pmPaying && <>
              <option value="efectivo">💵 Efectivo</option>
              <option value="tarjeta">💳 Tarjeta</option>
              <option value="yape">📱 Yape</option>
              <option value="plin">📱 Plin</option>
            </>}
          </select>
        )}

        {/* Anular pedido (solo admin, no cobrado) */}
        {role === 'admin' && onCancel && !isPaid && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            title="Anular pedido (no se cobra)"
            style={{
              background: 'transparent', border: '1px solid rgba(220,38,38,.35)',
              color: '#DC2626', borderRadius: 'var(--r2)', padding: '7px 10px',
              fontSize: 11, fontWeight: 800, cursor: cancelling ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
            }}
          >
            {cancelling ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }}/> : <Ban size={12}/>}
            {cancelling ? 'Anulando…' : 'Anular'}
          </button>
        )}

        {/* Badge de pago ya procesado */}
        {isPaid && (
          <span style={{
            background: 'rgba(22,163,74,.12)', border: '1px solid rgba(22,163,74,.3)',
            borderRadius: 'var(--r2)', padding: '5px 10px',
            fontSize: 11, fontWeight: 700, color: '#16A34A',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            <Check size={12}/> {PM_LABELS[payMethod] || 'Cobrado'}
          </span>
        )}
      </div>
    </div>
  )
}
