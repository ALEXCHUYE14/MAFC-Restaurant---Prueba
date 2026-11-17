import { useState, useEffect, useMemo, useCallback } from 'react'
import { DB } from '@/services/supabase'
import { formatPEN } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import { Skeleton } from '@/components/Loader'
import { Bike, Store, ShoppingBag, AlertTriangle, Contact, RotateCw, Phone, Circle } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   CLIENTES — mini-CRM de pedidos externos recurrentes
   ══════════════════════════════════════════════════════════════════
   Panel de SOLO LECTURA — no escribe nada nuevo, no agrega tablas.
   Reconstruye el historial de clientes a partir de datos que el panel
   admin YA captura hoy: Delivery/Recojo en Local/Para Llevar guardan
   { customerName, phone, address } como JSON dentro de `orders.notes`
   (ver ExternalOrdersSection en AdminDashboard.jsx y speakReadyOrder
   en cocina.html — el mismo formato en los dos lugares). Este panel
   solo agrupa por teléfono lo que ya existe; cero riesgo para el
   flujo de creación de pedidos.

   Un cliente sin teléfono capturado queda fuera del ranking — el
   teléfono es el único identificador confiable (el nombre puede
   repetirse o escribirse distinto de una visita a otra).
   ══════════════════════════════════════════════════════════════════ */

const EXTERNAL_ZONES = ['Delivery', 'Recojo en Local', 'Para Llevar']

const RANGES = [
  { key: 'month',   label: 'Este mes' },
  { key: 'quarter', label: 'Últimos 3 meses' },
  { key: 'all',     label: 'Todo' }, // práctico: últimos ~2 años, no una query sin límite
]

function getRangeBounds(range) {
  const now = new Date()
  const end = new Date(now); end.setDate(end.getDate() + 1)
  if (range === 'quarter') {
    const start = new Date(now); start.setDate(start.getDate() - 90)
    return { start, end }
  }
  if (range === 'all') {
    const start = new Date(now); start.setFullYear(start.getFullYear() - 2)
    return { start, end }
  }
  // 'month' (default)
  return { start: new Date(now.getFullYear(), now.getMonth(), 1), end }
}

const SORTS = {
  gasto:      { label: 'Mayor gasto',    cmp: (a, b) => b.totalGastado - a.totalGastado },
  frecuencia: { label: 'Más frecuente',  cmp: (a, b) => b.pedidosTotal - a.pedidosTotal },
  reciente:   { label: 'Visita reciente', cmp: (a, b) => new Date(b.ultimaVisita) - new Date(a.ultimaVisita) },
}

function buildCustomerRoster(orders) {
  const roster = new Map() // phone → stats

  for (const o of orders) {
    if (!EXTERNAL_ZONES.includes(o.zone)) continue
    let info = {}
    try { info = JSON.parse(o.notes || '{}') } catch (_) { /* notes no es JSON — pedido sin datos de cliente */ }
    const phone = (info.phone || '').trim()
    if (!phone) continue // sin teléfono no se puede identificar al cliente de forma confiable

    if (!roster.has(phone)) {
      roster.set(phone, {
        phone, name: info.customerName || phone, address: info.address || null,
        totalGastado: 0, pedidosPagados: 0, pedidosTotal: 0,
        ultimaVisita: o.created_at, zonas: new Set(),
      })
    }
    const c = roster.get(phone)
    if (info.customerName) c.name = info.customerName // conserva el nombre más reciente
    if (info.address)      c.address = info.address    // y la dirección más reciente
    c.pedidosTotal += 1
    if (o.zone) c.zonas.add(o.zone)
    if (typeof o.status === 'string' && o.status.startsWith('Pagado')) {
      c.totalGastado  += Number(o.total) || 0
      c.pedidosPagados += 1
    }
    if (new Date(o.created_at) > new Date(c.ultimaVisita)) c.ultimaVisita = o.created_at
  }

  return Array.from(roster.values()).map(c => ({
    ...c,
    zonas: Array.from(c.zonas),
    ticketPromedio: c.pedidosPagados ? c.totalGastado / c.pedidosPagados : 0,
  }))
}

const ZONE_ICON = { Delivery: Bike, 'Recojo en Local': Store, 'Para Llevar': ShoppingBag }

export default function CustomersPanel() {
  const [range,   setRange]   = useState('month')
  const [sort,    setSort]    = useState('gasto')
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [orders,  setOrders]  = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { start, end } = getRangeBounds(range)
    try {
      const data = await DB.getOrdersInRange(start.toISOString(), end.toISOString())
      setOrders(data)
    } catch (err) {
      setError(err?.message || 'No se pudo cargar el historial de pedidos')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  const roster = useMemo(() => {
    const list = buildCustomerRoster(orders).sort(SORTS[sort].cmp)
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q))
  }, [orders, sort, search])

  const recurrentes = roster.filter(c => c.pedidosTotal >= 2).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Filtros */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center',
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
          value={sort}
          onChange={e => setSort(e.target.value)}
          style={{
            marginLeft: 'auto', background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 8, padding: '6px 10px', color: 'var(--snow)', fontSize: 12, outline: 'none',
          }}
        >
          {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
        </select>
      </div>

      {/* Resumen */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Clientes identificados', val: roster.length, color: '#2563EB' },
          { label: 'Recurrentes (2+ pedidos)', val: recurrentes, color: '#16A34A' },
          { label: 'Gasto total del rango', val: formatPEN(roster.reduce((s, c) => s + c.totalGastado, 0)), color: 'var(--amber)' },
        ].map(s => (
          <div key={s.label} style={{
            flex: '1 1 120px', background: 'var(--ink3)', border: '1px solid var(--line)',
            borderRadius: 'var(--r2)', padding: '8px 10px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 2, letterSpacing: .5 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar por nombre o teléfono..."
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

      {/* Ranking */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={64} />)}
          </div>
        ) : roster.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>
            <Contact size={32} strokeWidth={1.5} style={{opacity: .3, marginBottom: 8}}/>
            Sin clientes con teléfono registrado en este rango
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {roster.map(c => (
              <div key={c.phone} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--ink2)', border: '1px solid var(--line)',
                borderLeft: `3px solid ${c.pedidosTotal >= 2 ? '#16A34A' : 'var(--line2)'}`,
                borderRadius: 'var(--r2)', padding: '10px 12px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>{c.name}</span>
                    {c.pedidosTotal >= 2 && (
                      <span style={{
                        fontSize: 8, fontWeight: 800, letterSpacing: .5, color: '#16A34A',
                        background: 'rgba(22,163,74,.12)', border: '1px solid rgba(22,163,74,.3)',
                        borderRadius: 10, padding: '2px 7px',
                        display: 'inline-flex', alignItems: 'center', gap: 3,
                      }}><RotateCw size={9}/> RECURRENTE</span>
                    )}
                    {c.zonas.map(z => (
                      <span key={z} title={z} style={{ display: 'inline-flex' }}>{(() => { const ZIcon = ZONE_ICON[z] || Circle; return <ZIcon size={12}/>; })()}</span>
                    ))}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--mist)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Phone size={10}/> {c.phone}{c.address ? ` · ${c.address}` : ''}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>
                    {c.pedidosTotal} pedido{c.pedidosTotal !== 1 ? 's' : ''} · última visita {formatDate(c.ultimaVisita)}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 800, color: '#16A34A' }}>
                    {formatPEN(c.totalGastado)}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 2 }}>
                    tick. prom. {formatPEN(c.ticketPromedio)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}
