import { useState, useMemo, useEffect } from 'react'
import Modal from '@/components/Modal'
import { CAT_ICONS } from '@/data/menu'
import { useInventory } from '@/features/inventory/InventoryContext'
import { useCaja } from '@/features/cashier/CajaContext'
import { formatPEN } from '@/utils/currency'
import { IMG_PLACEHOLDER, handleImgError } from '@/utils/image'
import { Lock, Loader2, Flame } from 'lucide-react'
import { hasVariants, applyVariant } from '@/utils/variants'

export default function NewOrderModal({ open, onClose, onSubmit, tableNumber, waiter }) {
  const { effectiveMenu, effectiveCategories } = useInventory()
  const { cajaAbierta } = useCaja()
  const [cat, setCat]     = useState('Todos')
  const [cart, setCart]   = useState({})    // { menuId: { item, qty, notes } }
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  // Un producto con tamaños aparece una vez por tamaño ("Ceviche (Fuente M.)"),
  // cada uno con su precio. `id` es la clave de la línea; `productId` el producto.
  const filtered = useMemo(() =>
    (cat === 'Todos' ? effectiveMenu : effectiveMenu.filter(m => m.cat === cat))
      .flatMap(m => hasVariants(m)
        ? m.variants.map(v => { const l = applyVariant(m, v); return { ...l, id: l.lineId, productId: m.id } })
        : [m]),
    [effectiveMenu, cat]
  )

  useEffect(() => {
    if (!effectiveCategories.includes(cat)) setCat('Todos')
  }, [effectiveCategories, cat])

  const cartItems = useMemo(() =>
    Object.values(cart).filter(c => c.qty > 0),
    [cart]
  )

  const total = useMemo(() =>
    cartItems.reduce((s, c) => s + c.item.price * c.qty, 0),
    [cartItems]
  )

  function setQty(item, delta) {
    if (delta > 0 && item.available === false) return // no se puede agregar un plato agotado
    setCart(prev => {
      const cur = prev[item.id]?.qty || 0
      const next = Math.max(0, cur + delta)
      if (next === 0) {
        const { [item.id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [item.id]: { item, qty: next, notes: prev[item.id]?.notes || '' } }
    })
  }

  function setItemNotes(id, val) {
    setCart(prev => ({ ...prev, [id]: { ...prev[id], notes: val } }))
  }

  async function handleSubmit() {
    // Armar el carrito siempre está permitido; solo se bloquea el envío
    // a cocina mientras la caja está cerrada (defensa extra — el botón ya
    // queda deshabilitado, esto cubre cualquier otra vía de invocación).
    if (!cajaAbierta) return
    if (cartItems.length === 0) return
    setLoading(true)
    try {
      await onSubmit({
        tableNumber,
        waiterId:     waiter?.uid,
        waiterName:   waiter?.name,
        waiterAvatar: waiter?.avatar,
        waiterColor:  waiter?.color,
        status: 'pending',
        items: cartItems.map(c => ({
          menuId: c.item.productId ?? c.item.id,
          name:   c.item.name,
          price:  c.item.price,
          quantity: c.qty,
          notes: c.notes,
        })),
        subtotal: total,
        total,
        notes,
        paymentMethod: null,
      })
      setCart({})
      setNotes('')
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Mesa ${tableNumber} — Nuevo Pedido`} width={560} noPadding>
      <div style={{ display: 'flex', flexDirection: 'column', height: '75vh' }}>
        {/* Category tabs */}
        <div style={{
          display: 'flex', gap: 6, padding: '12px 16px',
          borderBottom: '1px solid var(--line)', overflowX: 'auto', flexShrink: 0,
        }}>
          {effectiveCategories.map(c => (
            <button
              key={c}
              onClick={() => setCat(c)}
              style={{
                padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 11, letterSpacing: .5, whiteSpace: 'nowrap',
                transition: 'all .15s',
                background: cat === c ? 'var(--amber)' : 'var(--ink3)',
                color: cat === c ? '#FFFFFF' : 'var(--mist)',
              }}
            >
              {(() => { const Icon = CAT_ICONS[c] || CAT_ICONS.Todos; return <Icon size={13} style={{verticalAlign:-2, marginRight:3}}/>; })()}{c}
            </button>
          ))}
        </div>

        {/* Menu grid + cart split */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Menu list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtered.map(item => {
              const qty = cart[item.id]?.qty || 0
              const isAvailable = item.available !== false
              return (
                <div
                  key={item.id}
                  style={{
                    background: qty > 0 ? 'rgba(37,99,235,.06)' : 'var(--ink3)',
                    border: `1px solid ${qty > 0 ? 'rgba(37,99,235,.3)' : 'var(--line)'}`,
                    borderRadius: 'var(--r2)', padding: 10,
                    display: 'flex', alignItems: 'center', gap: 10,
                    transition: 'all .15s',
                    opacity: isAvailable ? 1 : 0.55,
                  }}
                >
                  <img
                    src={item.img || IMG_PLACEHOLDER}
                    alt={item.name}
                    loading="lazy" decoding="async"
                    style={{
                      width: 50, height: 50, borderRadius: 8, objectFit: 'cover', flexShrink: 0,
                      filter: isAvailable ? 'none' : 'grayscale(75%)',
                    }}
                    onError={handleImgError}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--snow)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {item.name}
                      {!isAvailable && (
                        <span style={{
                          background: '#DC2626', color: '#fff', fontSize: 8, fontWeight: 800,
                          padding: '2px 6px', borderRadius: 5, letterSpacing: .5,
                        }}>AGOTADO</span>
                      )}
                    </div>
                    {(item.portionTag || item.portionDesc) && (
                      <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 1 }}>
                        {[item.portionTag, item.portionDesc].filter(Boolean).join(' · ')}
                      </div>
                    )}
                    {qty > 0 && (
                      <input
                        value={cart[item.id]?.notes || ''}
                        onChange={e => setItemNotes(item.id, e.target.value)}
                        placeholder="Nota (sin sal, bien cocido…)"
                        style={{
                          marginTop: 5, width: '100%', background: 'var(--ink4)',
                          border: '1px solid var(--line2)', borderRadius: 4,
                          padding: '4px 8px', fontSize: 11, color: 'var(--snow)', outline: 'none',
                        }}
                      />
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span style={{
                      fontFamily: 'var(--display)', fontSize: 16, color: 'var(--amber)', lineHeight: 1,
                    }}>
                      {formatPEN(item.price)}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        onClick={() => setQty(item, -1)}
                        style={btnStyle('#DC2626', qty === 0)}
                        disabled={qty === 0}
                      >−</button>
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700,
                        color: qty > 0 ? 'var(--amber)' : 'var(--fog)',
                        minWidth: 18, textAlign: 'center',
                      }}>
                        {qty}
                      </span>
                      <button
                        onClick={() => setQty(item, 1)}
                        style={btnStyle('#16A34A', !isAvailable)}
                        disabled={!isAvailable}
                      >+</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Cart summary */}
          {cartItems.length > 0 && (
            <div style={{
              width: 160, borderLeft: '1px solid var(--line)',
              padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8,
              overflowY: 'auto', flexShrink: 0,
            }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--fog)', letterSpacing: 1, textTransform: 'uppercase' }}>
                Pedido
              </p>
              {cartItems.map(c => (
                <div key={c.item.id} style={{ fontSize: 11, color: 'var(--snow)' }}>
                  <span style={{ color: 'var(--amber)', fontWeight: 800 }}>{c.qty}× </span>
                  {c.item.name}
                  <div style={{ color: 'var(--fog)', fontSize: 10 }}>{formatPEN(c.item.price * c.qty)}</div>
                </div>
              ))}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 'auto' }}>
                <div style={{ fontSize: 10, color: 'var(--fog)' }}>TOTAL</div>
                <div style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--amber)', lineHeight: 1 }}>
                  {formatPEN(total)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
        }}>
          {!cajaAbierta && (
            <div style={{
              background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)',
              borderRadius: 8, padding: '8px 10px', fontSize: 10.5, color: '#DC2626',
              textAlign: 'center', lineHeight: 1.4,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>
              <Lock size={12}/> Caja Cerrada — para enviar el pedido a cocina se requiere abrir la caja
            </div>
          )}
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="📋 Notas generales del pedido…"
            style={{
              background: 'var(--ink3)', border: '1px solid var(--line2)',
              borderRadius: 'var(--r2)', padding: '9px 12px',
              color: 'var(--snow)', fontSize: 12, outline: 'none', width: '100%',
            }}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: 11, background: 'var(--ink3)',
                border: '1px solid var(--line2)', borderRadius: 'var(--r2)',
                color: 'var(--fog)', fontWeight: 700, fontSize: 12, cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              onClick={handleSubmit}
              disabled={cartItems.length === 0 || loading || !cajaAbierta}
              style={{
                flex: 2, padding: 11,
                background: (cartItems.length > 0 && cajaAbierta)
                  ? 'linear-gradient(135deg, var(--amber), var(--amber2))'
                  : 'var(--ink4)',
                border: 'none', borderRadius: 'var(--r2)',
                color: (cartItems.length > 0 && cajaAbierta) ? '#FFFFFF' : 'var(--fog)',
                fontWeight: 800, fontSize: 12,
                cursor: (cartItems.length > 0 && cajaAbierta) ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              {loading ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Enviando...</> : !cajaAbierta ? <><Lock size={13}/> Caja Cerrada</> : <><Flame size={13}/> Enviar a Cocina · {formatPEN(total)}</>}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function btnStyle(color, disabled) {
  return {
    width: 24, height: 24, borderRadius: 6,
    border: `1px solid ${disabled ? 'var(--line)' : color + '55'}`,
    background: disabled ? 'var(--ink4)' : color + '18',
    color: disabled ? 'var(--ghost)' : color,
    fontWeight: 800, fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all .1s', lineHeight: 1,
  }
}
