import { Gift, X } from 'lucide-react'

/* Productos que se pueden dar como premio de fidelidad: los de la categoría
   configurada (Ajustes → Clientes y Fidelidad), disponibles y sin tamaños. */
export function premioProducts(menu, categoria) {
  const cat = String(categoria || '').trim().toLowerCase()
  if (!cat) return []
  return (menu || []).filter(m =>
    String(m?.cat || '').trim().toLowerCase() === cat &&
    m.available !== false &&
    !(Array.isArray(m.variants) && m.variants.length > 0) &&
    (m.stock === null || m.stock === undefined || Number(m.stock) > 0)
  )
}

export default function PremioPicker({ products, premioTexto, categoria, onPick, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 14, padding: 16,
        width: '100%', maxWidth: 380, maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Gift size={16} style={{ color: '#16A34A' }} />
          <strong style={{ flex: 1, fontSize: 14, color: 'var(--snow)' }}>Canjear: {premioTexto || 'premio'}</strong>
          <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: 'transparent', color: 'var(--fog)', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--mist)', marginBottom: 10, lineHeight: 1.4 }}>
          Elige el producto. Se agrega al pedido a S/ 0.00 (cortesía); cocina lo prepara y el stock se descuenta.
        </div>
        {products.length === 0 ? (
          <div style={{ fontSize: 12, color: '#D97706' }}>
            No hay productos disponibles en la categoría “{categoria}”. Revísalo en Ajustes → Clientes y Fidelidad.
          </div>
        ) : products.map(p => (
          <button key={p.id} onClick={() => onPick(p)} style={{
            width: '100%', textAlign: 'left', padding: '9px 10px', marginBottom: 6, borderRadius: 8,
            border: '1px solid var(--line2)', background: 'var(--ink3)', color: 'var(--snow)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>{p.name}</button>
        ))}
      </div>
    </div>
  )
}
