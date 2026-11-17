import { useCallback, useEffect, useMemo, useState } from 'react'
import { DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { formatPEN } from '@/utils/currency'
import { isCrmMissing, crmErrorMessage, maskDoc, daysSince, daysToBirthday, toCsv } from '@/utils/crm'
import CustomersPanel from './CustomersPanel'
import ClienteFicha, { WhatsAppModal } from './ClienteFicha'
import CuponesPanel from './CuponesPanel'
import EncuestasPanel from './EncuestasPanel'
import { AlertTriangle, Cake, Download, Gift, Loader2, MessageCircle, RotateCw, Search, Star, Ticket, Upload, UserPlus, Users } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   CLIENTES (CRM) — fichas, fidelidad y alertas
   · Inactivos: no vienen hace más de X días (Ajustes → Clientes).
   · Cumpleaños: hoy y próximos 7 días.
   · Con premio: les toca su premio de fidelidad en la próxima visita.
   · WhatsApp con plantilla solo a quienes dieron su consentimiento.
   Si migracion-clientes-crm.sql no se ejecutó, se muestra el panel
   anterior (clientes armados desde los pedidos de delivery).
   ══════════════════════════════════════════════════════════════════ */

const PAGE = 60
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function CrmPanel() {
  const { user } = useAuth()
  const [rows, setRows]       = useState([])
  const [config, setConfig]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [missing, setMissing] = useState(false)
  const [filter, setFilter]   = useState('todos')
  const [q, setQ]             = useState('')
  const [limit, setLimit]     = useState(PAGE)
  const [ficha, setFicha]     = useState(undefined)   // undefined = cerrada, null = nuevo, objeto = existente
  const [wa, setWa]           = useState(null)        // { cliente, key }
  const [view, setView]       = useState('clientes')  // clientes | cupones | encuestas
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [r, c] = await Promise.all([DB.crmResumenClientes(), DB.getCrmConfig()])
      setRows(Array.isArray(r) ? r : []); setConfig(c)
    } catch (e) {
      if (isCrmMissing(e)) setMissing(true)
      else setError(crmErrorMessage(e))
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const diasInactivo = Number(config?.dias_inactivo) || 30
  const enriched = useMemo(() => rows.map(r => {
    const pedidos = Number(r.pedidos) || 0
    const dias = daysSince(r.ultima_visita)
    const cumpleEn = daysToBirthday(r.cumple_dia, r.cumple_mes)
    return {
      ...r,
      visitas: Number(r.visitas) || 0,
      pedidos,
      ticket: pedidos ? Math.round((Number(r.total_gastado) || 0) * 100 / pedidos) / 100 : 0,
      diasSinVenir: dias,
      inactivo: dias !== null && dias > diasInactivo,
      cumpleEn,
      nuevo: daysSince(r.created_at) !== null && daysSince(r.created_at) <= 30,
    }
  }), [rows, diasInactivo])

  const counts = useMemo(() => ({
    todos:    enriched.length,
    inactivos: enriched.filter(c => c.inactivo).length,
    cumple:   enriched.filter(c => c.cumpleEn !== null && c.cumpleEn <= 7).length,
    premio:   enriched.filter(c => c.premio_disponible).length,
    nuevos:   enriched.filter(c => c.nuevo).length,
  }), [enriched])

  const list = useMemo(() => {
    let l = enriched
    if (filter === 'inactivos') l = l.filter(c => c.inactivo).sort((a, b) => (b.diasSinVenir ?? 0) - (a.diasSinVenir ?? 0))
    if (filter === 'cumple')    l = l.filter(c => c.cumpleEn !== null && c.cumpleEn <= 7).sort((a, b) => a.cumpleEn - b.cumpleEn)
    if (filter === 'premio')    l = l.filter(c => c.premio_disponible)
    if (filter === 'nuevos')    l = l.filter(c => c.nuevo)
    const t = q.trim().toLowerCase()
    if (t) l = l.filter(c => String(c.nombre || '').toLowerCase().includes(t) || String(c.celular || '').includes(t) || String(c.dni || '').includes(t))
    return l
  }, [enriched, filter, q])

  // Convierte en fichas los teléfonos de pedidos antiguos (delivery/recojo)
  async function importar() {
    if (importing) return
    if (!window.confirm('¿Importar los clientes de pedidos antiguos (Delivery, Recojo, Para Llevar con teléfono)?\n\nSe crean fichas SIN consentimiento de WhatsApp. No duplica a quienes ya existen.')) return
    setImporting(true); setImportMsg('')
    try {
      const r = await DB.crmImportarAntiguos()
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'customer_import', entity: 'clientes', entityId: null, detail: r })
      setImportMsg(`✓ ${r.clientes_creados || 0} fichas nuevas · ${r.pedidos_ligados || 0} pedidos y ${r.reservas_ligadas || 0} reservas ligados.`)
      await load()
    } catch (e) { setImportMsg('⚠ ' + (isCrmMissing(e) ? 'Falta ejecutar migracion-crm-avanzado.sql.' : crmErrorMessage(e))) }
    finally { setImporting(false) }
  }

  // Exporta lo que se ve en la lista (filtro y búsqueda actuales) a Excel (CSV)
  function exportar() {
    const head = ['Nombre', 'Celular', 'DNI', 'Cumpleaños', 'Visitas', 'Pedidos', 'Total gastado', 'Ticket promedio', 'Última visita', 'Acepta WhatsApp', 'Registrado']
    const data = list.map(c => [
      c.nombre, c.celular || '', c.dni || '',
      c.cumple_dia && c.cumple_mes ? `${String(c.cumple_dia).padStart(2, '0')}/${String(c.cumple_mes).padStart(2, '0')}` : '',
      c.visitas, c.pedidos, (Number(c.total_gastado) || 0).toFixed(2), c.ticket.toFixed(2),
      c.ultima_visita ? fmtDate(c.ultima_visita) : '', c.acepta_marketing ? 'Sí' : 'No', fmtDate(c.created_at),
    ])
    const blob = new Blob([toCsv(head, data)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clientes-${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'customer_export', entity: 'clientes', entityId: null, detail: { filas: data.length } })
  }

  async function markContacted(c) {
    try { await DB.updateCliente(c.id, { ultimo_contacto_at: new Date().toISOString() }) } catch (_) { /* no crítico */ }
    DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'customer_whatsapp', entity: 'clientes', entityId: c.id, detail: {} })
    load()
  }

  if (missing) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...notice, margin: 12 }}>
          <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Para fichas de clientes, puntos, cumpleaños y WhatsApp ejecuta <strong>migracion-clientes-crm.sql</strong> en Supabase. Mientras tanto se muestran los clientes de delivery.</span>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}><CustomersPanel /></div>
      </div>
    )
  }

  const FILTERS = [
    { key: 'todos',     label: 'Todos',        icon: Users },
    { key: 'inactivos', label: `No vienen +${diasInactivo} días`, icon: AlertTriangle },
    { key: 'cumple',    label: 'Cumpleaños',   icon: Cake },
    { key: 'premio',    label: 'Con premio',   icon: Gift },
    { key: 'nuevos',    label: 'Nuevos (30 días)', icon: UserPlus },
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 22, color: 'var(--amber)', letterSpacing: 1, lineHeight: 1 }}>CLIENTES</div>
            <div style={{ fontSize: 11.5, color: 'var(--mist)', marginTop: 4 }}>
              Fichas, fidelidad ({config?.premio_texto || 'premio'} cada {config?.visitas_premio || 10} visitas) y alertas
            </div>
          </div>
          <button onClick={load} disabled={loading} style={btn}>
            {loading ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <RotateCw size={13} />} Actualizar
          </button>
          <button onClick={() => setFicha(null)} style={btnPrimary}><UserPlus size={13} /> Nuevo cliente</button>
        </div>

        {/* Secciones */}
        <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--line2)', paddingBottom: 8, flexWrap: 'wrap' }}>
          {[{ k: 'clientes', l: 'Clientes', I: Users }, { k: 'cupones', l: 'Cupones', I: Ticket }, { k: 'encuestas', l: 'Encuestas', I: Star }].map(({ k, l, I }) => (
            <button key={k} onClick={() => setView(k)} style={{ ...chip, ...(view === k ? chipOn : {}) }}><I size={12} /> {l}</button>
          ))}
        </div>
        {view === 'cupones' && <CuponesPanel />}
        {view === 'encuestas' && <EncuestasPanel />}
        {view === 'clientes' && (<>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={importar} disabled={importing} style={btn} title="Crea fichas con los teléfonos de pedidos antiguos">
            {importing ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Upload size={13} />} Importar clientes antiguos
          </button>
          <button onClick={exportar} disabled={!list.length} style={btn} title="Descarga la lista actual para Excel">
            <Download size={13} /> Exportar a Excel ({list.length})
          </button>
          {importMsg && <span style={{ fontSize: 11.5, color: importMsg.startsWith('⚠') ? '#DC2626' : '#16A34A', fontWeight: 700 }}>{importMsg}</span>}
        </div>

        {error && <div style={{ ...notice, color: '#DC2626', borderColor: 'rgba(220,38,38,.3)', background: 'rgba(220,38,38,.08)' }}><AlertTriangle size={13} /> {error}</div>}

        {/* Alertas / filtros */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTERS.map(f => {
            const on = filter === f.key
            const Icon = f.icon
            return (
              <button key={f.key} onClick={() => { setFilter(f.key); setLimit(PAGE) }} style={{ ...chip, ...(on ? chipOn : {}) }}>
                <Icon size={12} /> {f.label} <strong>{counts[f.key]}</strong>
              </button>
            )
          })}
        </div>

        <div style={{ position: 'relative' }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--fog)' }} />
          <input value={q} onChange={e => { setQ(e.target.value); setLimit(PAGE) }} placeholder="Buscar por nombre, celular o DNI…" style={{ ...input, paddingLeft: 30 }} />
        </div>

        {loading && !rows.length && <div style={{ fontSize: 12, color: 'var(--fog)' }}>Cargando…</div>}
        {!loading && !list.length && (
          <div style={{ fontSize: 12, color: 'var(--fog)' }}>
            {rows.length ? 'Ningún cliente coincide con el filtro.' : 'Aún no hay clientes. Se registran desde el pedido (celular o DNI) o con "Nuevo cliente".'}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {list.slice(0, limit).map(c => (
            <div key={c.id} style={card}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <strong style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--snow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</strong>
                <span style={{ fontSize: 11, color: 'var(--fog)', whiteSpace: 'nowrap' }}>{c.celular ? maskDoc(c.celular) : `DNI ${maskDoc(c.dni)}`}</span>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '6px 0' }}>
                {c.cumpleEn === 0 && <Badge color="#DB2777"><Cake size={10} /> ¡Cumple hoy!</Badge>}
                {c.cumpleEn > 0 && c.cumpleEn <= 7 && <Badge color="#DB2777"><Cake size={10} /> Cumple en {c.cumpleEn} día{c.cumpleEn !== 1 ? 's' : ''}</Badge>}
                {c.premio_disponible && <Badge color="#16A34A"><Gift size={10} /> Premio disponible</Badge>}
                {c.inactivo && <Badge color="#DC2626">No viene hace {c.diasSinVenir} días</Badge>}
                {c.nuevo && <Badge color="#2563EB">Nuevo</Badge>}
                {!c.acepta_marketing && <Badge color="#94A3B8">Sin consentimiento WhatsApp</Badge>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, fontSize: 11, color: 'var(--mist)' }}>
                <span>Visitas<br /><strong style={{ color: 'var(--snow)' }}>{c.visitas}</strong></span>
                <span>Ticket prom.<br /><strong style={{ color: 'var(--snow)' }}>{formatPEN(c.ticket)}</strong></span>
                <span>Última visita<br /><strong style={{ color: 'var(--snow)' }}>{fmtDate(c.ultima_visita)}</strong></span>
              </div>
              {c.ultimo_contacto_at && (
                <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 4 }}>Último WhatsApp: hace {daysSince(c.ultimo_contacto_at)} día(s)</div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => setFicha(c)} style={{ ...btn, flex: 1, justifyContent: 'center' }}>Ver ficha</button>
                <button
                  onClick={() => setWa({ cliente: c, key: c.cumpleEn === 0 ? 'cumple' : c.premio_disponible ? 'premio' : 'inactivo' })}
                  disabled={!c.celular || !c.acepta_marketing}
                  title={!c.celular ? 'Sin celular' : !c.acepta_marketing ? 'Sin consentimiento para mensajes' : 'Enviar WhatsApp'}
                  style={{ ...btn, color: (!c.celular || !c.acepta_marketing) ? 'var(--fog)' : '#16A34A', opacity: (!c.celular || !c.acepta_marketing) ? .55 : 1 }}
                ><MessageCircle size={13} /> WhatsApp</button>
              </div>
            </div>
          ))}
        </div>
        {list.length > limit && (
          <button onClick={() => setLimit(l => l + PAGE)} style={{ ...btn, alignSelf: 'center' }}>Ver más ({list.length - limit})</button>
        )}
        </>)}
      </div>

      {ficha !== undefined && (
        <ClienteFicha cliente={ficha} config={config} onClose={() => setFicha(undefined)} onSaved={load} onDeleted={load} />
      )}
      {wa && (
        <WhatsAppModal cliente={wa.cliente} config={config} initialKey={wa.key}
          onClose={() => setWa(null)} onSent={() => markContacted(wa.cliente)} />
      )}
    </div>
  )
}

const Badge = ({ color, children }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 800, color, border: `1px solid ${color}55`, background: `${color}14`, borderRadius: 6, padding: '2px 6px' }}>{children}</span>
)
const card = { background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 12, padding: '10px 12px', minWidth: 0 }
const input = { width: '100%', boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none' }
const btn = { padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--ink3)', color: 'var(--mist)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }
const btnPrimary = { padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const chip = { padding: '6px 11px', borderRadius: 20, border: '1px solid var(--line2)', background: 'var(--ink3)', color: 'var(--mist)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }
const chipOn = { borderColor: 'var(--amber)', color: 'var(--amber)', background: 'rgba(217,119,6,.1)' }
const notice = { padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6 }
