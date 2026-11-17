import { useEffect, useState } from 'react'
import { DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { useInventory } from '@/features/inventory/InventoryContext'
import { isCrmMissing, crmErrorMessage } from '@/utils/crm'
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react'

/* AJUSTES → CLIENTES Y FIDELIDAD (migracion-clientes-crm.sql)
   Reglas del premio, días de inactividad y plantillas de WhatsApp.
   Variables de las plantillas: {nombre} {negocio} {premio} {dias} */
export default function CrmSettings() {
  const { user } = useAuth()
  const { effectiveCategories } = useInventory()
  const [cfg, setCfg]         = useState(null)
  const [missing, setMissing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')
  const [ok, setOk]           = useState('')

  useEffect(() => {
    DB.getCrmConfig().then(c => setCfg(c)).catch(e => { if (isCrmMissing(e)) setMissing(true); else setErr(crmErrorMessage(e)) })
  }, [])

  const set = (k, v) => { setCfg(c => ({ ...c, [k]: v })); setErr(''); setOk('') }

  async function save() {
    if (saving || !cfg) return
    const visitas = Math.round(Number(cfg.visitas_premio))
    const dias    = Math.round(Number(cfg.dias_inactivo))
    if (!(visitas >= 2 && visitas <= 50)) { setErr('Las visitas para el premio deben estar entre 2 y 50.'); return }
    if (!(dias >= 7 && dias <= 365)) { setErr('Los días de inactividad deben estar entre 7 y 365.'); return }
    const premio = String(cfg.premio_texto || '').trim()
    const cat    = String(cfg.premio_categoria || '').trim()
    if (!premio || premio.length > 60) { setErr('Describe el premio (máx. 60 caracteres).'); return }
    if (!cat) { setErr('Elige la categoría de productos del premio.'); return }
    for (const k of ['plantilla_inactivo', 'plantilla_cumple', 'plantilla_premio']) {
      if (String(cfg[k] || '').length > 500) { setErr('Cada plantilla puede tener hasta 500 caracteres.'); return }
    }
    setSaving(true); setErr(''); setOk('')
    try {
      const patch = {
        visitas_premio: visitas, dias_inactivo: dias, premio_texto: premio, premio_categoria: cat,
        plantilla_inactivo: String(cfg.plantilla_inactivo || ''), plantilla_cumple: String(cfg.plantilla_cumple || ''),
        plantilla_premio: String(cfg.plantilla_premio || ''),
      }
      await DB.updateCrmConfig(patch)
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'crm_config', entity: 'crm_config', entityId: '1', detail: { visitas, dias, premio, cat } })
      setOk('✓ Guardado')
    } catch (e) { setErr(crmErrorMessage(e)) }
    finally { setSaving(false) }
  }

  if (missing) {
    return (
      <div style={notice}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Para fichas de clientes y fidelidad ejecuta <strong>migracion-clientes-crm.sql</strong> en Supabase.</span></div>
    )
  }
  if (!cfg) return <div style={{ fontSize: 12, color: err ? '#DC2626' : 'var(--fog)' }}>{err || 'Cargando…'}</div>

  const cats = (effectiveCategories || []).filter(c => c && c !== 'Todos')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.5 }}>
        Una visita = un día con pedido cobrado (máximo 1 por día). En la visita número <strong>{cfg.visitas_premio}</strong> el cliente
        recibe el premio como cortesía a S/ 0.00 (se elige un producto de la categoría indicada).
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
        <Field label="Visitas para el premio"><input type="number" min={2} max={50} value={cfg.visitas_premio} onChange={e => set('visitas_premio', e.target.value)} style={input} /></Field>
        <Field label="Premio"><input value={cfg.premio_texto} maxLength={60} onChange={e => set('premio_texto', e.target.value)} style={input} /></Field>
        <Field label="Categoría del premio">
          <select value={cfg.premio_categoria} onChange={e => set('premio_categoria', e.target.value)} style={input}>
            {!cats.includes(cfg.premio_categoria) && <option value={cfg.premio_categoria}>{cfg.premio_categoria} (no existe)</option>}
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Alerta: no viene hace (días)"><input type="number" min={7} max={365} value={cfg.dias_inactivo} onChange={e => set('dias_inactivo', e.target.value)} style={input} /></Field>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fog)' }}>Plantillas de WhatsApp — puedes usar {'{nombre}'}, {'{negocio}'}, {'{premio}'} y {'{dias}'}.</div>
      <Field label="Te extrañamos"><textarea rows={2} maxLength={500} value={cfg.plantilla_inactivo} onChange={e => set('plantilla_inactivo', e.target.value)} style={{ ...input, resize: 'vertical' }} /></Field>
      <Field label="Cumpleaños"><textarea rows={2} maxLength={500} value={cfg.plantilla_cumple} onChange={e => set('plantilla_cumple', e.target.value)} style={{ ...input, resize: 'vertical' }} /></Field>
      <Field label="Premio disponible"><textarea rows={2} maxLength={500} value={cfg.plantilla_premio} onChange={e => set('plantilla_premio', e.target.value)} style={{ ...input, resize: 'vertical' }} /></Field>
      {err && <div style={{ fontSize: 12, color: '#DC2626' }}>{err}</div>}
      {ok && <div style={{ fontSize: 12, color: '#16A34A', fontWeight: 700, display: 'flex', gap: 5, alignItems: 'center' }}><Check size={13} /> {ok}</div>}
      <div>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={13} />} Guardar
        </button>
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
const input = { width: '100%', boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none' }
const btnPrimary = { padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const notice = { padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6 }
