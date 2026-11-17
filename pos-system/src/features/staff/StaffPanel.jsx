import { useState, useEffect, useMemo, useCallback } from 'react'
import { DB } from '@/services/supabase'
import { formatPEN } from '@/utils/currency'
import { formatDate, startOfDay } from '@/utils/dates'
import { Skeleton } from '@/components/Loader'
import { useAuth } from '@/features/auth/AuthContext'
import { AlertTriangle, Info, ChefHat, Trophy, Medal, Star, Save, Loader2 } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   PERSONAL — evaluación de meseros
   ══════════════════════════════════════════════════════════════════
   Panel de solo lectura: NO escribe en `orders`, `mesas` ni ninguna
   tabla que use el flujo real de mesero.html/cocina.html — arma sus
   métricas leyendo DB.getOrdersInRange() y DB.getMeseroSesiones()
   (ambas de solo lectura, agregadas en este mismo componente). Cero
   riesgo para el resto del sistema: si esta pestaña falla, el
   ErrorBoundary de AdminDashboard la aísla sin afectar las demás.

   Fuentes de datos:
   - orders.waiter_id / waiter_name / total / status / is_modified /
     created_at / paid_at   → ventas, ticket promedio, tiempo de
     atención, pedidos ampliados. Los pedidos externos (Delivery /
     Recojo / Para Llevar) no tienen waiter_id — quedan fuera del
     ranking, no se les atribuyen a ningún mesero.
   - mesero_sesiones (login_at/logout_at, de la migración de PIN)
     → horas de turno trabajadas. Si esa migración no se corrió,
     DB.getMeseroSesiones() ya devuelve [] de forma segura — el resto
     del panel sigue funcionando sin esa columna.
   ══════════════════════════════════════════════════════════════════ */

const RANGES = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: 'Últimos 7 días' },
  { key: 'month', label: 'Este mes' },
]

function getRangeBounds(range) {
  const now = new Date()
  if (range === 'week') {
    const start = startOfDay(now)
    start.setDate(start.getDate() - 6)
    const end = startOfDay(now)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    return { start, end }
  }
  // 'today' (default)
  const start = startOfDay(now)
  const end   = startOfDay(now)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

// Agrega pedidos + sesiones + evaluaciones en un ranking por mesero. Pura — sin efectos.
// `currentNames` (id → nombre vigente, de la tabla `meseros`): pedidos, sesiones y
// evaluaciones guardan el nombre que tenía el mesero EN ESE MOMENTO; si el admin
// le cambió el nombre después, el ranking debe mostrar el actual (se agrupa por id).
function buildRoster(orders, sesiones, evaluaciones, currentNames = {}) {
  const roster = new Map()
  const ensure = (id, name) => {
    if (!roster.has(id)) {
      roster.set(id, {
        id, name: name || id,
        totalVentas: 0, pedidosPagados: 0, pedidosTotal: 0,
        pedidosAmpliados: 0, sumAtencionMin: 0, countAtencion: 0,
        horasTurno: 0, sesionActiva: false,
        sumRating: 0, countRating: 0, ultimaEvaluacion: null,
      })
    }
    const w = roster.get(id)
    if (name) w.name = name
    return w
  }

  for (const o of orders) {
    const wid = o.waiter_id
    if (!wid) continue // pedido externo (Delivery/Recojo/Para Llevar) — sin mesero asignado
    const w = ensure(wid, o.waiter_name)
    w.pedidosTotal += 1
    if (o.is_modified) w.pedidosAmpliados += 1
    const isPaid = typeof o.status === 'string' && o.status.startsWith('Pagado')
    if (isPaid) {
      w.totalVentas   += Number(o.total) || 0
      w.pedidosPagados += 1
      if (o.paid_at && o.created_at) {
        const mins = (new Date(o.paid_at) - new Date(o.created_at)) / 60000
        if (isFinite(mins) && mins >= 0) { w.sumAtencionMin += mins; w.countAtencion += 1 }
      }
    }
  }

  for (const s of sesiones) {
    const wid = s.waiter_id
    if (!wid) continue
    const w = ensure(wid, s.waiter_name)
    if (!s.login_at) continue
    const start = new Date(s.login_at)
    const end   = s.logout_at ? new Date(s.logout_at) : new Date() // turno aún abierto
    const hrs   = (end - start) / 3_600_000
    if (isFinite(hrs) && hrs >= 0) w.horasTurno += hrs
    if (!s.logout_at) w.sesionActiva = true
  }

  for (const ev of evaluaciones) {
    const wid = ev.waiter_id
    if (!wid) continue
    const w = ensure(wid, ev.waiter_name)
    w.sumRating += Number(ev.rating) || 0
    w.countRating += 1
    if (!w.ultimaEvaluacion || new Date(ev.created_at) > new Date(w.ultimaEvaluacion.created_at)) {
      w.ultimaEvaluacion = ev
    }
  }

  return Array.from(roster.values())
    .map(w => ({
      ...w,
      ticketPromedio:      w.pedidosPagados ? w.totalVentas / w.pedidosPagados : 0,
      pctAmpliados:        w.pedidosTotal   ? (w.pedidosAmpliados / w.pedidosTotal) * 100 : 0,
      atencionPromedioMin: w.countAtencion  ? w.sumAtencionMin / w.countAtencion : null,
      ratingPromedio:      w.countRating    ? w.sumRating / w.countRating : null,
      name:                currentNames[w.id] || w.name,
    }))
    .sort((a, b) => b.totalVentas - a.totalVentas)
}

export default function StaffPanel() {
  const { user } = useAuth()
  const [range,       setRange]       = useState('today')
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [orders,      setOrders]      = useState([])
  const [sesiones,    setSesiones]    = useState([])
  const [evaluaciones, setEvaluaciones] = useState([])
  const [currentNames, setCurrentNames] = useState({})
  const [evaluating,  setEvaluating]  = useState(null) // waiter en evaluación (abre el modal)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { start, end } = getRangeBounds(range)
    try {
      const [ordersData, sesionesData, evaluacionesData, meserosData] = await Promise.all([
        DB.getOrdersInRange(start.toISOString(), end.toISOString()),
        DB.getMeseroSesiones(start.toISOString(), end.toISOString()),
        DB.getEvaluacionesMesero(start.toISOString(), end.toISOString()),
        DB.getMeseros(), // null si la tabla no existe (migración pendiente) → se usan los nombres de cada registro
      ])
      setCurrentNames(Object.fromEntries((meserosData || []).map(m => [m.id, m.name])))
      setOrders(ordersData)
      setSesiones(sesionesData)       // ya viene en [] si la migración no está aplicada
      setEvaluaciones(evaluacionesData) // ídem
    } catch (err) {
      setError(err?.message || 'No se pudo cargar la información del rango seleccionado')
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { load() }, [load])

  const roster = useMemo(() => buildRoster(orders, sesiones, evaluaciones, currentNames), [orders, sesiones, evaluaciones, currentNames])

  const totalVentasRango = useMemo(() =>
    roster.reduce((s, w) => s + w.totalVentas, 0), [roster])
  const totalPedidosRango = useMemo(() =>
    roster.reduce((s, w) => s + w.pedidosTotal, 0), [roster])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Selector de rango */}
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
      </div>

      {/* Resumen del rango */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Ventas del rango',  val: formatPEN(totalVentasRango), color: '#16A34A' },
          { label: 'Pedidos atendidos', val: totalPedidosRango,           color: 'var(--amber)' },
          { label: 'Meseros con actividad', val: roster.length,          color: '#2563EB' },
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

      {sesiones.length === 0 && !loading && !error && (
        <div style={{
          margin: '10px 14px 0', padding: '9px 12px', flexShrink: 0,
          background: 'rgba(148,163,184,.10)', border: '1px solid var(--line2)',
          borderRadius: 8, fontSize: 11, color: 'var(--fog)', lineHeight: 1.5,
          display: 'flex', gap: 6,
        }}>
          <Info size={13} style={{flexShrink:0, marginTop: 1}}/>
          <span>No hay horas de turno registradas en este rango — requiere haber corrido{' '}
          <code style={{ color: 'var(--mist)' }}>migracion-seguridad-pines-sesiones.sql</code> y que
          los meseros hayan iniciado/cerrado turno desde entonces. El resto de las métricas
          (ventas, pedidos, tiempo de atención) no depende de esto.</span>
        </div>
      )}

      {/* Ranking */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={78} />)}
          </div>
        ) : roster.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>
            <ChefHat size={32} strokeWidth={1.5} style={{opacity: .3, marginBottom: 8}}/>
            Sin actividad de meseros en este rango
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {roster.map((w, idx) => (
              <StaffCard key={w.id} waiter={w} rank={idx + 1} onEvaluate={() => setEvaluating(w)} />
            ))}
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      {evaluating && (
        <EvaluationModal
          waiter={evaluating}
          evaluadoPor={user?.name}
          onClose={() => setEvaluating(null)}
          onSaved={() => { setEvaluating(null); load() }}
        />
      )}
    </div>
  )
}

function StaffCard({ waiter, rank, onEvaluate }) {
  const medalColor = rank === 1 ? '#D97706' : rank === 2 ? '#94A3B8' : rank === 3 ? '#B45309' : null
  const MedalIcon = rank === 1 ? Trophy : (rank === 2 || rank === 3) ? Medal : null

  return (
    <div style={{
      background: 'var(--ink2)', border: '1px solid var(--line)',
      borderLeft: `3px solid ${rank === 1 ? '#D97706' : 'var(--line2)'}`,
      borderRadius: 'var(--r2)', padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fog)',
            width: 18, textAlign: 'center', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{MedalIcon ? <MedalIcon size={15} color={medalColor}/> : `#${rank}`}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--snow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {waiter.name}
          </span>
          {waiter.sesionActiva && (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: .5, color: '#16A34A',
              background: 'rgba(22,163,74,.12)', border: '1px solid rgba(22,163,74,.3)',
              borderRadius: 10, padding: '2px 7px', flexShrink: 0,
            }}>● EN TURNO</span>
          )}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 800, color: '#16A34A', whiteSpace: 'nowrap' }}>
          {formatPEN(waiter.totalVentas)}
        </div>
      </div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 8,
      }}>
        <Metric label="Pedidos"           value={waiter.pedidosTotal} />
        <Metric label="Ticket prom."      value={formatPEN(waiter.ticketPromedio)} />
        <Metric
          label="Atención prom."
          value={waiter.atencionPromedioMin != null ? `${Math.round(waiter.atencionPromedioMin)} min` : '—'}
        />
        <Metric
          label="Pedidos ampliados"
          value={waiter.pedidosTotal ? `${Math.round(waiter.pctAmpliados)}%` : '—'}
        />
        <Metric
          label="Horas de turno"
          value={waiter.horasTurno > 0 ? `${waiter.horasTurno.toFixed(1)} h` : '—'}
        />
        <Metric
          label={`Calificación${waiter.countRating ? ` (${waiter.countRating})` : ''}`}
          value={waiter.ratingPromedio != null ? <span style={{display:'inline-flex',alignItems:'center',gap:3}}><Star size={12} fill="#D97706" color="#D97706"/> {waiter.ratingPromedio.toFixed(1)}</span> : '—'}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        {waiter.ultimaEvaluacion?.comentario ? (
          <div style={{
            flex: 1, minWidth: 0, fontSize: 11, color: 'var(--mist)', fontStyle: 'italic',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={formatDate(waiter.ultimaEvaluacion.created_at)}>
            “{waiter.ultimaEvaluacion.comentario}” · {formatDate(waiter.ultimaEvaluacion.created_at)}
          </div>
        ) : <span />}
        <button onClick={onEvaluate} style={{
          flexShrink: 0, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
          border: '1px solid var(--line2)', background: 'transparent',
          color: 'var(--amber)', fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 5,
        }}><Star size={12}/> Evaluar turno</button>
      </div>
    </div>
  )
}

function StarPicker({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: n <= value ? '#D97706' : 'var(--line2)', padding: 0, lineHeight: 1,
            display: 'flex',
          }}
        ><Star size={24} fill={n <= value ? '#D97706' : 'none'}/></button>
      ))}
    </div>
  )
}

function EvaluationModal({ waiter, evaluadoPor, onClose, onSaved }) {
  const [rating,    setRating]    = useState(5)
  const [comentario, setComentario] = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await DB.addEvaluacionMesero({
        waiterId: waiter.id, waiterName: waiter.name, rating, comentario: comentario.trim(), evaluadoPor,
      })
      onSaved()
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la calificación — ¿corriste migracion-evaluaciones-mesero.sql?')
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 16,
        padding: '22px 20px', maxWidth: 380, width: '100%',
        boxShadow: '0 20px 60px rgba(15,23,42,.3)',
      }}>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--amber)', letterSpacing: 1, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Star size={16}/> Evaluar turno
        </h2>
        <p style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 16 }}>{waiter.name}</p>

        <div style={{ marginBottom: 16 }}>
          <StarPicker value={rating} onChange={setRating} />
        </div>

        <label style={{
          display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
          textTransform: 'uppercase', color: 'var(--fog)', marginBottom: 4,
        }}>Comentario (opcional)</label>
        <textarea
          value={comentario}
          onChange={e => setComentario(e.target.value)}
          placeholder="Trato al cliente, orden, actitud…"
          maxLength={300}
          rows={3}
          style={{
            width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 8, padding: '8px 10px', color: 'var(--snow)',
            fontSize: 12, outline: 'none', boxSizing: 'border-box', resize: 'vertical',
            fontFamily: 'inherit', marginBottom: 12,
          }}
        />

        {error && (
          <div style={{
            background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 5,
          }}><AlertTriangle size={13}/> {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: '10px 0', borderRadius: 'var(--r2)', border: '1px solid var(--line2)',
            background: 'transparent', color: 'var(--fog)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              flex: 2, padding: '10px 0', borderRadius: 'var(--r2)', border: 'none',
              background: saving ? 'var(--ink3)' : 'linear-gradient(135deg, #D97706, #B45309)',
              color: saving ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 13,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >{saving ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Guardando…</> : <><Save size={13}/> Guardar calificación</>}</button>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>{value}</div>
      <div style={{ fontSize: 8.5, color: 'var(--fog)', marginTop: 1, letterSpacing: .3, textTransform: 'uppercase' }}>{label}</div>
    </div>
  )
}
