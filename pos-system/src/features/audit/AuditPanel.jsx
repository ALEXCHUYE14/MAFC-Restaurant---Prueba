import { useState, useEffect, useMemo, useCallback } from 'react'
import { DB } from '@/services/supabase'
import { formatPEN } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import { Skeleton } from '@/components/Loader'
import {
  Tag, Unlock, Lock, Receipt, Pencil, Trash2, PlusCircle, EyeOff, Store,
  Armchair, ChefHat, KeyRound, Circle, AlertTriangle, ShieldAlert, Info,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   AUDITORÍA — bitácora de acciones administrativas
   ══════════════════════════════════════════════════════════════════
   Panel de SOLO LECTURA — no escribe nada. Lee los últimos registros
   de audit_log (escritos por CajaContext/ExpensesContext/InventoryContext
   como efecto secundario, best-effort, DESPUÉS de cada operación real).
   Si la migración migracion-auditoria.sql no se corrió, DB.getAuditLog()
   ya devuelve [] de forma segura — este panel solo muestra un aviso.
   ══════════════════════════════════════════════════════════════════ */

const ACTION_META = {
  price_change:     { label: 'Cambio de precio',  icon: Tag,      color: '#D97706' },
  caja_open:        { label: 'Apertura de caja',  icon: Unlock,   color: '#16A34A' },
  caja_close:       { label: 'Cierre de caja',    icon: Lock,     color: '#DC2626' },
  expense_create:   { label: 'Egreso registrado', icon: Receipt,  color: '#DC2626' },
  expense_update:   { label: 'Egreso editado',    icon: Pencil,   color: '#D97706' },
  expense_delete:   { label: 'Egreso eliminado',  icon: Trash2,   color: '#DC2626' },
  menu_item_create: { label: 'Plato creado',      icon: PlusCircle, color: '#16A34A' },
  menu_item_update: { label: 'Plato editado',     icon: Pencil,   color: '#D97706' },
  menu_item_delete: { label: 'Plato eliminado',   icon: Trash2,   color: '#DC2626' },
  menu_item_hide:   { label: 'Plato ocultado',    icon: EyeOff,   color: '#DC2626' },
  stock_add:        { label: 'Stock sumado (compra)', icon: PlusCircle, color: '#16A34A' },
  order_cancel:     { label: 'Pedido anulado',     icon: Trash2,   color: '#DC2626' },
  kitchen_access_change: { label: 'Acceso de cocina cambiado', icon: KeyRound, color: '#D97706' },
  cost_change:      { label: 'Cambio de costo',   icon: Tag,      color: '#D97706' },
  business_config_update: { label: 'Datos del negocio editados', icon: Store, color: '#2563EB' },
  table_add:         { label: 'Mesas agregadas',    icon: Armchair, color: '#16A34A' },
  table_remove:      { label: 'Mesa quitada',       icon: Armchair, color: '#DC2626' },
  waiter_create:     { label: 'Mesero creado',      icon: ChefHat,  color: '#16A34A' },
  waiter_update:     { label: 'Mesero editado',     icon: ChefHat,  color: '#D97706' },
  waiter_pin_change: { label: 'PIN de mesero cambiado', icon: KeyRound, color: '#D97706' },
}

const RANGES = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: 'Últimos 7 días' },
  { key: 'all',   label: 'Todo (últimos 300)' },
]

function inRange(iso, range) {
  if (range === 'all') return true
  const d = new Date(iso)
  const now = new Date()
  if (range === 'today') return d.toDateString() === now.toDateString()
  // week
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7)
  return d >= weekAgo
}

function describe(entry) {
  const d = entry.detail || {}
  switch (entry.action) {
    case 'price_change':
      return `${d.plato || 'Plato'}: ${formatPEN(d.antes)} → ${formatPEN(d.despues)}`
    case 'caja_open':
      return d.fondoInicial != null ? `Fondo inicial: ${formatPEN(d.fondoInicial)}` : 'Turno iniciado'
    case 'caja_close':
      return d.totalVentas != null ? `Total del turno: ${formatPEN(d.totalVentas)}` : 'Turno cerrado'
    case 'expense_create':
    case 'expense_update':
    case 'expense_delete':
      return d.concepto ? `${d.concepto} — ${formatPEN(d.monto)}` : 'Egreso'
    case 'menu_item_create':
    case 'menu_item_update':
    case 'menu_item_delete':
    case 'menu_item_hide':
      return d.plato || d.name || 'Plato'
    case 'cost_change':
      return `${d.plato || 'Producto'}: ${d.antes == null ? '—' : formatPEN(d.antes)} → ${d.despues == null ? '—' : formatPEN(d.despues)}`
    case 'kitchen_access_change':
      return `Usuario: ${d.usuario || '—'}`
    case 'order_cancel':
      return `${d.mesa ? `Mesa ${d.mesa}` : (d.zona || 'Pedido')} · ${formatPEN(d.total)}${d.motivo ? ` · ${d.motivo}` : ''}${d.stockDevuelto ? ` · ${d.stockDevuelto} u. devueltas al stock` : ''}`
    case 'stock_add':
      return `${d.plato || 'Producto'}: ${d.antes ?? '∞'} + ${d.sumado} → ${d.despues}`
    case 'table_add':
      return d.hasta > d.desde ? `Mesas ${d.desde} a ${d.hasta} · ${d.zona}` : `Mesa ${d.desde} · ${d.zona}`
    case 'table_remove':
      return `Mesa ${d.numero}${d.zona ? ` · ${d.zona}` : ''}`
    case 'waiter_create':
      return `${d.nombre}${d.pinAsignado === false ? ' (sin PIN propio)' : ''}`
    case 'waiter_update':
      if (d.antes && d.despues) return `Nombre: ${d.antes} → ${d.despues}`
      return d.activo === undefined ? `${d.nombre}: color` : `${d.nombre}: ${d.activo ? 'activado' : 'desactivado'}`
    case 'waiter_pin_change':
      return d.nombre || 'Mesero'
    case 'business_config_update':
      return Array.isArray(d.campos) && d.campos.length
        ? `${d.quitado ? 'Se quitó' : 'Cambió'}: ${d.campos.join(', ')}`
        : 'Ajustes del negocio'
    default:
      return ''
  }
}

export default function AuditPanel() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [range,   setRange]   = useState('today')
  const [actionFilter, setActionFilter] = useState('all')
  const [search,  setSearch]  = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await DB.getAuditLog({ limit: 300 })
      setEntries(data)
    } catch (err) {
      setError(err?.message || 'No se pudo cargar la auditoría')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const actionsPresent = useMemo(() =>
    Array.from(new Set(entries.map(e => e.action))), [entries])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter(e => {
      if (!inRange(e.created_at, range)) return false
      if (actionFilter !== 'all' && e.action !== actionFilter) return false
      if (q) {
        const haystack = `${e.actor_name || ''} ${describe(e)}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [entries, range, actionFilter, search])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Filtros */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {RANGES.map(r => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            style={{
              padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
              border: `1px solid ${range === r.key ? 'var(--amber)' : 'var(--line2)'}`,
              background: range === r.key ? 'rgba(217,119,6,.12)' : 'transparent',
              color: range === r.key ? 'var(--amber)' : 'var(--fog)',
              fontSize: 12, fontWeight: 700,
            }}
          >{r.label}</button>
        ))}
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          style={{
            marginLeft: 'auto', background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 8, padding: '6px 10px', color: 'var(--snow)', fontSize: 12, outline: 'none',
          }}
        >
          <option value="all">Todas las acciones</option>
          {actionsPresent.map(a => (
            <option key={a} value={a}>{ACTION_META[a]?.label || a}</option>
          ))}
        </select>
      </div>

      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar por persona o detalle..."
          style={{
            width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 8, padding: '7px 12px', color: 'var(--snow)',
            fontSize: 13, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {error && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 12px', flexShrink: 0,
          background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)',
          borderRadius: 8, fontSize: 12, color: '#DC2626', lineHeight: 1.5,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{display:'flex',alignItems:'center',gap:5}}><AlertTriangle size={13}/> {error}</span>
          <button onClick={load} style={{
            border: '1px solid rgba(220,38,38,.4)', background: 'transparent',
            color: '#DC2626', borderRadius: 6, padding: '4px 10px', fontSize: 11,
            fontWeight: 700, cursor: 'pointer', flexShrink: 0,
          }}>Reintentar</button>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <div style={{
          margin: '10px 14px 0', padding: '9px 12px', flexShrink: 0,
          background: 'rgba(148,163,184,.10)', border: '1px solid var(--line2)',
          borderRadius: 8, fontSize: 11, color: 'var(--fog)', lineHeight: 1.5,
          display: 'flex', gap: 6,
        }}>
          <Info size={13} style={{flexShrink:0, marginTop: 1}}/>
          <span>Sin registros de auditoría todavía. Si ya hiciste cambios de precio, egresos o
          movimientos de caja y no aparecen aquí, confirma que corriste{' '}
          <code style={{ color: 'var(--mist)' }}>migracion-auditoria.sql</code> en tu Supabase.</span>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={50} />)}
          </div>
        ) : filtered.length === 0 ? (
          entries.length > 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>
              <ShieldAlert size={32} strokeWidth={1.5} style={{ opacity: .3, marginBottom: 8 }}/>
              Sin resultados para este filtro
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(e => {
              const meta = ACTION_META[e.action] || { label: e.action, icon: Circle, color: 'var(--fog)' }
              return (
                <div key={e.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--ink2)', border: '1px solid var(--line)',
                  borderLeft: `3px solid ${meta.color}`,
                  borderRadius: 'var(--r2)', padding: '9px 12px',
                }}>
                  <meta.icon size={17} color={meta.color} style={{flexShrink: 0}}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--snow)' }}>{meta.label}</span>
                      <span style={{
                        fontSize: 8, fontWeight: 800, padding: '1px 7px', borderRadius: 10,
                        background: meta.color + '22', color: meta.color, letterSpacing: .3,
                      }}>{(e.actor_name || 'ADMIN').toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {describe(e)}
                    </div>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fog)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {formatDate(e.created_at)}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}
