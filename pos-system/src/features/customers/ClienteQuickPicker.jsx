import { useState } from 'react'
import { DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { normalizeDoc, crmErrorMessage, isCrmMissing, maskDoc } from '@/utils/crm'
import { Cake, Gift, Loader2, Search, UserPlus, UserRound, X } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   CLIENTE EN EL PEDIDO (panel admin) — registro rápido por celular o DNI
   Siempre OPCIONAL: si no se identifica al cliente, la venta sigue igual.
   value = { id, nombre, celular, dni, direccion, acepta_marketing,
             cumple_hoy, stats:{ visita_actual, meta, premio_disponible,
             premio_texto, premio_categoria, visitas } } | null
   ══════════════════════════════════════════════════════════════════ */
export default function ClienteQuickPicker({ value, onChange, disabled = false, onCanjear = null, canjeHecho = false }) {
  const { user } = useAuth()
  const [doc, setDoc]         = useState('')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')
  const [missing, setMissing] = useState(false)
  const [reg, setReg]         = useState(null)   // { tipo, valor } cuando no existe → formulario
  const [form, setForm]       = useState({ nombre: '', dia: '', mes: '', acepta: false, celular: '' })

  function toCliente(r) {
    return {
      id: r.id, nombre: r.nombre_completo || r.nombre, celular: r.celular || null, dni: r.dni || null,
      direccion: r.direccion || null, acepta_marketing: !!r.acepta_marketing, cumple_hoy: !!r.cumple_hoy,
      stats: r.stats || null, nuevo: !!r.nuevo,
    }
  }

  async function buscar() {
    if (busy || disabled) return
    setErr('')
    const d = normalizeDoc(doc)
    if (!d) { setErr('Escribe un celular (9 dígitos, empieza con 9) o un DNI (8 dígitos).'); return }
    setBusy(true)
    try {
      const r = await DB.crmIdentificar({ doc: d.valor })
      if (r?.encontrado) { onChange(toCliente(r)); setDoc(''); setReg(null) }
      else { setReg(d); setForm({ nombre: '', dia: '', mes: '', acepta: false, celular: '' }) }
    } catch (e) {
      if (isCrmMissing(e)) setMissing(true)
      else setErr(crmErrorMessage(e))
    } finally { setBusy(false) }
  }

  async function registrar() {
    if (busy || !reg) return
    setErr('')
    const nombre = form.nombre.trim().replace(/\s+/g, ' ')
    if (!nombre) { setErr('Escribe el nombre del cliente.'); return }
    if (nombre.length > 80) { setErr('El nombre es demasiado largo.'); return }
    const dia = form.dia ? Number(form.dia) : null
    const mes = form.mes ? Number(form.mes) : null
    if ((dia && !mes) || (!dia && mes)) { setErr('Completa día y mes del cumpleaños (o deja ambos vacíos).'); return }
    if (form.celular && (!normalizeDoc(form.celular) || normalizeDoc(form.celular).tipo !== 'celular')) { setErr('Celular no válido.'); return }
    setBusy(true)
    try {
      const r = await DB.crmIdentificar({
        doc: reg.valor, nombre, acepta: form.acepta, cumpleDia: dia, cumpleMes: mes,
        celularExtra: reg.tipo === 'dni' ? (form.celular || null) : null, creadoPor: user?.name || 'Admin',
      })
      if (r?.encontrado) { onChange(toCliente(r)); setDoc(''); setReg(null) }
    } catch (e) {
      setErr(crmErrorMessage(e))
    } finally { setBusy(false) }
  }

  if (missing) return null   // sin migración: el formulario sigue como siempre

  // ── Cliente elegido ──
  if (value) {
    const s = value.stats || {}
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 10px', borderRadius: 10, background: 'var(--ink3)', border: '1px solid var(--line2)' }}>
        <UserRound size={14} style={{ color: 'var(--amber)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 140, fontSize: 12, color: 'var(--snow)', lineHeight: 1.35 }}>
          <strong>{value.nombre}</strong>
          <span style={{ color: 'var(--fog)' }}> · {value.celular ? maskDoc(value.celular) : `DNI ${maskDoc(value.dni)}`}</span>
          <div style={{ fontSize: 10.5, color: 'var(--mist)' }}>
            {value.nuevo ? 'Cliente nuevo' : `${s.visitas || 0} visita${s.visitas === 1 ? '' : 's'}`}
            {s.meta ? ` · visita ${s.visita_actual} de ${s.meta}` : ''}
            {value.cumple_hoy && <span style={{ color: '#DB2777', fontWeight: 800 }}> · <Cake size={10} style={{ verticalAlign: -1 }} /> ¡cumple hoy!</span>}
          </div>
        </div>
        {s.premio_disponible && onCanjear && !canjeHecho && (
          <button type="button" onClick={onCanjear} disabled={disabled} style={{ ...btn, background: '#16A34A', color: '#fff', border: 'none' }}>
            <Gift size={12} /> Canjear {s.premio_texto || 'premio'}
          </button>
        )}
        {canjeHecho && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#16A34A' }}><Gift size={11} style={{ verticalAlign: -1 }} /> Premio en el pedido</span>}
        {!disabled && (
          <button type="button" onClick={() => onChange(null)} title="Quitar cliente" style={{ ...btn, padding: 5 }}><X size={12} /></button>
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          value={doc} disabled={disabled || busy} inputMode="numeric" maxLength={15}
          onChange={e => { setDoc(e.target.value); setErr(''); setReg(null) }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscar() } }}
          placeholder="Cliente: celular o DNI (opcional)"
          style={{ ...input, flex: 1 }}
        />
        <button type="button" onClick={buscar} disabled={disabled || busy || !doc.trim()} style={btn}>
          {busy && !reg ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <Search size={12} />} Buscar
        </button>
      </div>
      {reg && (
        <div style={{ padding: '8px 10px', borderRadius: 10, border: '1px dashed var(--line2)', background: 'var(--ink3)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--mist)' }}>No está registrado ({reg.tipo === 'dni' ? 'DNI' : 'celular'} {reg.valor}). Registro rápido:</div>
          <input value={form.nombre} maxLength={80} placeholder="Nombre del cliente" onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} style={input} />
          {reg.tipo === 'dni' && (
            <input value={form.celular} maxLength={15} inputMode="numeric" placeholder="Celular (opcional, para WhatsApp)" onChange={e => setForm(f => ({ ...f, celular: e.target.value }))} style={input} />
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--fog)' }}>Cumpleaños (opcional):</span>
            <select value={form.dia} onChange={e => setForm(f => ({ ...f, dia: e.target.value }))} style={{ ...input, width: 70, padding: '5px 6px' }}>
              <option value="">Día</option>
              {Array.from({ length: 31 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <select value={form.mes} onChange={e => setForm(f => ({ ...f, mes: e.target.value }))} style={{ ...input, width: 96, padding: '5px 6px' }}>
              <option value="">Mes</option>
              {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11, color: 'var(--mist)', lineHeight: 1.35, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.acepta} onChange={e => setForm(f => ({ ...f, acepta: e.target.checked }))} style={{ marginTop: 2 }} />
            El cliente acepta recibir promociones y saludos por WhatsApp (puede retirarse cuando quiera).
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" onClick={registrar} disabled={busy} style={{ ...btn, background: 'var(--amber)', color: '#fff', border: 'none' }}>
              {busy ? <Loader2 size={12} style={{ animation: 'spin .8s linear infinite' }} /> : <UserPlus size={12} />} Registrar
            </button>
            <button type="button" onClick={() => setReg(null)} style={btn}>Cancelar</button>
          </div>
        </div>
      )}
      {err && <div style={{ fontSize: 11, color: '#DC2626' }}>{err}</div>}
    </div>
  )
}

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic']
const input = {
  boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8,
  padding: '7px 10px', color: 'var(--snow)', fontSize: 12, outline: 'none', minWidth: 0,
}
const btn = {
  padding: '6px 10px', borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--ink2)', color: 'var(--mist)',
  fontSize: 11, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
}
