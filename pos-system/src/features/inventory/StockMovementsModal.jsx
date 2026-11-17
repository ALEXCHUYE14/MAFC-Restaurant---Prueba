import { useState, useEffect, useMemo, useCallback } from 'react'
import { useInventory } from './InventoryContext'
import { formatDate } from '@/utils/dates'
import { History, X, Loader2, AlertTriangle, RefreshCw } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   MOVIMIENTOS DE STOCK (kardex) — SOLO LECTURA
   ══════════════════════════════════════════════════════════════════
   Los registros los escribe la base de datos (trigger de
   migracion-kardex-costos.sql) cada vez que cambia el stock de un
   producto, venga de donde venga: venta en POS, venta del mesero,
   compra o ajuste manual. Este modal solo los lee. Si la migración no
   se ejecutó, muestra un aviso y no rompe nada.
   ══════════════════════════════════════════════════════════════════ */

const MOTIVOS = {
  venta_pos:    { label: 'Venta POS',     color: '#DC2626' },
  venta_mesero: { label: 'Venta mesero',  color: '#DC2626' },
  compra:       { label: 'Compra',        color: '#16A34A' },
  ajuste:       { label: 'Ajuste manual', color: '#D97706' },
  devolucion:   { label: 'Devuelto (pedido)', color: '#16A34A' },
  anulacion_compra: { label: 'Compra anulada', color: '#DC2626' },
  sistema:      { label: 'Sistema',       color: 'var(--fog)' },
}

const RANGES = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: '7 días' },
  { key: 'all',   label: 'Todo' },
]

function inRange(iso, range) {
  if (range === 'all') return true
  const d = new Date(iso)
  const now = new Date()
  if (range === 'today') return d.toDateString() === now.toDateString()
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
  return d >= weekAgo
}

const fmtStock = v => (v === null || v === undefined ? '∞' : String(v))

// item = producto de effectiveMenu para ver solo su historial, o null = todos
export default function StockMovementsModal({ item = null, onClose }) {
  const { getStockMovements } = useInventory()
  const [rows, setRows]       = useState([])
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [range, setRange]     = useState('week')
  const [motivo, setMotivo]   = useState('')

  const itemId = item?.source === 'custom' ? item.id : null
  const forStaticItem = !!item && item.source !== 'custom'

  const load = useCallback(async () => {
    if (forStaticItem) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const r = await getStockMovements({ itemId, limit: itemId ? 200 : 500 })
      setRows(r.rows || [])
      setMissing(!!r.missing)
    } catch (e) {
      setError(e?.message || 'No se pudo cargar el historial')
    } finally {
      setLoading(false)
    }
  }, [getStockMovements, itemId, forStaticItem])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() =>
    rows.filter(r => inRange(r.created_at, range) && (!motivo || r.motivo === motivo))
  , [rows, range, motivo])

  // Resumen del rango visible: unidades que entraron y salieron
  const resumen = useMemo(() => visible.reduce((acc, r) => {
    if (typeof r.cambio === 'number') {
      if (r.cambio > 0) acc.entradas += r.cambio
      else acc.salidas += -r.cambio
    }
    return acc
  }, { entradas: 0, salidas: 0 }), [visible])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 16,
        padding: '18px 18px 14px', maxWidth: 560, width: '100%', maxHeight: '88vh',
        display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(15,23,42,.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <History size={16} color="var(--amber)" />
          <h2 style={{ flex: 1, fontFamily: 'var(--display)', fontSize: 17, color: 'var(--amber)', letterSpacing: 1, margin: 0, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Movimientos{item ? ` · ${item.name}` : ' de stock'}
          </h2>
          <button onClick={load} disabled={loading} title="Actualizar" style={iconBtn}><RefreshCw size={13} /></button>
          <button onClick={onClose} title="Cerrar" style={iconBtn}><X size={14} /></button>
        </div>

        {/* Filtros */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={chip(range === r.key)}>{r.label}</button>
          ))}
          <select value={motivo} onChange={e => setMotivo(e.target.value)} style={{
            marginLeft: 'auto', background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 14,
            padding: '3px 10px', color: 'var(--snow)', fontSize: 11, outline: 'none',
          }}>
            <option value="">Todos los motivos</option>
            {Object.entries(MOTIVOS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>

        {!missing && !forStaticItem && !loading && !error && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={sumBox}><span style={{ color: '#16A34A', fontWeight: 800 }}>+{resumen.entradas}</span> entradas</div>
            <div style={sumBox}><span style={{ color: '#DC2626', fontWeight: 800 }}>−{resumen.salidas}</span> salidas</div>
            <div style={sumBox}><span style={{ color: 'var(--snow)', fontWeight: 800 }}>{visible.length}</span> movimientos</div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', minHeight: 120 }}>
          {forStaticItem ? (
            <Notice>El historial está disponible para los productos creados desde "Agregar producto".</Notice>
          ) : loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 30, color: 'var(--fog)' }}>
              <Loader2 size={18} style={{ animation: 'spin .8s linear infinite' }} />
            </div>
          ) : missing ? (
            <Notice>
              El historial aún no está activado. Ejecuta <strong>migracion-kardex-costos.sql</strong> en
              Supabase (SQL Editor). Desde ese momento se registrará cada venta, compra y ajuste.
            </Notice>
          ) : error ? (
            <Notice>{error}</Notice>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 30, color: 'var(--fog)', fontSize: 12 }}>Sin movimientos en este rango</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {visible.map(r => {
                const m = MOTIVOS[r.motivo] || { label: r.motivo, color: 'var(--fog)' }
                const delta = typeof r.cambio === 'number' ? r.cambio : null
                return (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                    background: 'var(--ink3)', border: '1px solid var(--line)', borderLeft: `3px solid ${m.color}`, borderRadius: 8,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--snow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item ? m.label : (r.item_name || 'Producto')}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 1 }}>
                        {formatDate(r.created_at)}{!item && ` · ${m.label}`}{r.actor_name ? ` · ${r.actor_name}` : ''}
                      </div>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fog)', whiteSpace: 'nowrap' }}>
                      {fmtStock(r.antes)} → <strong style={{ color: 'var(--snow)' }}>{fmtStock(r.despues)}</strong>
                    </div>
                    <div style={{
                      fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 800, minWidth: 44, textAlign: 'right',
                      color: delta === null ? 'var(--fog)' : delta > 0 ? '#16A34A' : '#DC2626',
                    }}>
                      {delta === null ? '—' : delta > 0 ? `+${delta}` : `−${-delta}`}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Notice({ children }) {
  return (
    <div style={{
      padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
      borderRadius: 8, fontSize: 11, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6,
    }}>
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{children}</span>
    </div>
  )
}

const iconBtn = {
  width: 28, height: 28, borderRadius: 7, border: '1px solid var(--line2)',
  background: 'var(--ink3)', color: 'var(--mist)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
const sumBox = {
  flex: 1, background: 'var(--ink3)', border: '1px solid var(--line)', borderRadius: 8,
  padding: '6px 8px', fontSize: 10, color: 'var(--fog)', textAlign: 'center',
}
function chip(active) {
  return {
    padding: '3px 12px', borderRadius: 14, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
    background: active ? 'var(--amber)' : 'var(--ink3)', color: active ? '#fff' : 'var(--mist)',
  }
}
