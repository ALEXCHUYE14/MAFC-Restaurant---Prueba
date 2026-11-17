import { useCallback, useEffect, useState } from 'react'
import { DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { formatPEN } from '@/utils/currency'
import { crmErrorMessage, isCrmMissing, normalizeDoc } from '@/utils/crm'
import { AlertTriangle, Loader2, Plus, Ticket } from 'lucide-react'

/* CUPONES DE DESCUENTO (migracion-descuentos-cupones.sql)
   El descuento lo calcula la base de datos sobre los platos. Un cupón
   personal ("solo para un cliente") sirve para el WhatsApp de "te extrañamos". */
const EMPTY = { codigo: '', tipo: 'pct', valor: '10', minimo: '', vence: '', usos_max: '', descripcion: '', clienteDoc: '' }

export default function CuponesPanel() {
  const { user } = useAuth()
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [err, setErr]         = useState('')
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)
  const [busyId, setBusyId]   = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await DB.cuponesConUsos()); setErr('') }
    catch (e) { if (isCrmMissing(e)) setMissing(true); else setErr(crmErrorMessage(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErr('') }

  async function create() {
    if (saving) return
    const codigo = form.codigo.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!/^[A-Z0-9]{3,20}$/.test(codigo)) { setErr('Código: 3 a 20 letras o números, sin espacios.'); return }
    const valor = Number(form.valor)
    if (!(valor > 0) || (form.tipo === 'pct' && valor > 100)) { setErr(form.tipo === 'pct' ? 'El % debe estar entre 1 y 100.' : 'El monto debe ser mayor a 0.'); return }
    const minimo = form.minimo === '' ? 0 : Number(form.minimo)
    if (!(minimo >= 0)) { setErr('Consumo mínimo no válido.'); return }
    const usos = form.usos_max === '' ? null : Math.round(Number(form.usos_max))
    if (usos !== null && !(usos > 0)) { setErr('Usos máximos no válidos.'); return }
    let soloCliente = null
    setSaving(true)
    try {
      if (form.clienteDoc.trim()) {
        const d = normalizeDoc(form.clienteDoc)
        if (!d) throw new Error('DOC_INVALIDO')
        const r = await DB.crmIdentificar({ doc: d.valor })
        if (!r?.encontrado) throw new Error('CLIENTE_NO_EXISTE')
        soloCliente = r.id
      }
      await DB.createCupon({
        codigo, tipo: form.tipo, valor, minimo, vence: form.vence || null, usos_max: usos,
        solo_cliente: soloCliente, descripcion: form.descripcion.trim().slice(0, 120) || null, created_by: user?.name || 'Admin',
      })
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'coupon_create', entity: 'cupones', entityId: codigo, detail: { tipo: form.tipo, valor } })
      setForm(EMPTY)
      await load()
    } catch (e) { setErr(crmErrorMessage(e)) }
    finally { setSaving(false) }
  }

  async function toggle(c) {
    if (busyId) return
    setBusyId(c.id)
    try {
      await DB.updateCupon(c.id, { activo: !c.activo })
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'coupon_toggle', entity: 'cupones', entityId: c.codigo, detail: { activo: !c.activo } })
      await load()
    } catch (e) { setErr(crmErrorMessage(e)) }
    finally { setBusyId(null) }
  }

  if (missing) {
    return <div style={notice}><AlertTriangle size={13} /> Para cupones de descuento ejecuta <strong>migracion-descuentos-cupones.sql</strong>.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={card}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--snow)', marginBottom: 8 }}>Nuevo cupón</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <Field label="Código"><input value={form.codigo} maxLength={20} placeholder="VUELVE10" onChange={e => set('codigo', e.target.value.toUpperCase())} style={input} /></Field>
          <Field label="Tipo">
            <select value={form.tipo} onChange={e => set('tipo', e.target.value)} style={input}>
              <option value="pct">% de descuento</option>
              <option value="monto">Monto fijo (S/)</option>
            </select>
          </Field>
          <Field label={form.tipo === 'pct' ? 'Porcentaje' : 'Monto S/'}><input type="number" min="0" step="0.5" value={form.valor} onChange={e => set('valor', e.target.value)} style={input} /></Field>
          <Field label="Consumo mínimo S/ (opcional)"><input type="number" min="0" step="1" value={form.minimo} onChange={e => set('minimo', e.target.value)} style={input} /></Field>
          <Field label="Vence (opcional)"><input type="date" value={form.vence} onChange={e => set('vence', e.target.value)} style={input} /></Field>
          <Field label="Usos máximos (opcional)"><input type="number" min="1" step="1" value={form.usos_max} onChange={e => set('usos_max', e.target.value)} style={input} /></Field>
          <Field label="Solo para (celular/DNI, opcional)"><input value={form.clienteDoc} maxLength={15} inputMode="numeric" onChange={e => set('clienteDoc', e.target.value)} style={input} /></Field>
          <Field label="Descripción"><input value={form.descripcion} maxLength={120} placeholder="Te extrañamos" onChange={e => set('descripcion', e.target.value)} style={input} /></Field>
        </div>
        {err && <div style={{ fontSize: 12, color: '#DC2626', marginTop: 8 }}>{err}</div>}
        <button onClick={create} disabled={saving} style={{ ...btnPrimary, marginTop: 10 }}>
          {saving ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Plus size={13} />} Crear cupón
        </button>
        <div style={{ fontSize: 10.5, color: 'var(--fog)', marginTop: 6 }}>
          El descuento se aplica solo a los platos (no a envases). Se usa desde el mesero o la caja con el pedido ya enviado a cocina.
        </div>
      </div>

      {loading && <div style={{ fontSize: 12, color: 'var(--fog)' }}>Cargando…</div>}
      {!loading && !rows.length && <div style={{ fontSize: 12, color: 'var(--fog)' }}>Aún no hay cupones.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {rows.map(c => {
          const vencido = c.vence && c.vence < new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
          const agotado = c.usos_max && Number(c.usos) >= c.usos_max
          return (
            <div key={c.id} style={{ ...card, opacity: c.activo && !vencido && !agotado ? 1 : .6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Ticket size={14} style={{ color: 'var(--amber)' }} />
                <strong style={{ flex: 1, fontFamily: 'var(--mono)', fontSize: 14, color: 'var(--snow)' }}>{c.codigo}</strong>
                <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--snow)' }}>{c.tipo === 'pct' ? `${Number(c.valor)}%` : formatPEN(c.valor)}</span>
              </div>
              {c.descripcion && <div style={{ fontSize: 11.5, color: 'var(--mist)', marginTop: 3 }}>{c.descripcion}</div>}
              <div style={{ fontSize: 10.5, color: 'var(--fog)', marginTop: 4, lineHeight: 1.5 }}>
                Usos: {c.usos}{c.usos_max ? ` de ${c.usos_max}` : ''}
                {Number(c.minimo) > 0 && ` · mínimo ${formatPEN(c.minimo)}`}
                {c.vence && ` · vence ${c.vence}`}
                {c.cliente_nombre && ` · solo ${c.cliente_nombre}`}
                {vencido && ' · VENCIDO'}{agotado && ' · AGOTADO'}
              </div>
              <button onClick={() => toggle(c)} disabled={!!busyId} style={{ ...btn, marginTop: 8 }}>
                {busyId === c.id ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : (c.activo ? 'Desactivar' : 'Activar')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const Field = ({ label, children }) => (
  <label style={{ display: 'block', minWidth: 0 }}>
    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--mist)', marginBottom: 4 }}>{label}</span>
    {children}
  </label>
)
const card = { background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 12, padding: '10px 12px', minWidth: 0 }
const input = { width: '100%', boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none' }
const btn = { padding: '6px 11px', borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--ink3)', color: 'var(--mist)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }
const btnPrimary = { padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const notice = { padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6 }
