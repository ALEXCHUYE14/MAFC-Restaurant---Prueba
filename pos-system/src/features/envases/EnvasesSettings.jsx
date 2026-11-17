import { useEffect, useState } from 'react'
import { supabase, DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { cleanUnitPrice } from '@/utils/packaging'
import { reloadPackagingConfig, usePackagingConfig } from './usePackagingConfig'

/* ══════════════════════════════════════════════════════════════════
   AJUSTES → ENVASES PARA LLEVAR (migracion-envases.sql)
   Precio fijo por envase descartable y activar/desactivar la opción.
   El precio nuevo se aplica a los envases que se agreguen desde ahora;
   un pedido ya abierto conserva el precio con el que se agregaron.
   ══════════════════════════════════════════════════════════════════ */

export default function EnvasesSettings() {
  const { user } = useAuth()
  const cfg = usePackagingConfig()
  const [missing, setMissing] = useState(false)
  const [precio, setPrecio] = useState('')
  const [activo, setActivo] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')

  useEffect(() => {
    let alive = true
    if (!supabase) return
    supabase.from('envases_config').select('activo, precio').eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (!alive) return
      if (error) {
        if (/envases_config|does not exist|PGRST205|42P01/i.test(`${error.code} ${error.message}`)) setMissing(true)
        return
      }
      if (data) { setPrecio(Number(data.precio).toFixed(2)); setActivo(data.activo === true) }
    })
    return () => { alive = false }
  }, [])

  async function save() {
    if (saving) return
    setErr(''); setOkMsg('')
    const p = cleanUnitPrice(String(precio).replace(',', '.'))
    if (p === null || String(precio).trim() === '') { setErr('Precio no válido (entre S/ 0.00 y S/ 50.00).'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase.from('envases_config')
        .update({ precio: p, activo, updated_at: new Date().toISOString() })
        .eq('id', 1).select('id')
      if (error) throw error
      if (!data || !data.length) throw new Error('Solo el administrador puede cambiar esta configuración.')
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'packaging_config', entity: 'envases_config', entityId: '1', detail: { precio: p, activo } })
      await reloadPackagingConfig()
      setPrecio(p.toFixed(2))
      setOkMsg('✓ Guardado. Se aplica a los envases que se agreguen desde ahora.')
    } catch (e) {
      setErr(e?.message || 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  if (missing) {
    return (
      <div style={notice}>
        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Para cobrar envases descartables ejecuta <strong>migracion-envases.sql</strong> en Supabase (SQL Editor).</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.5 }}>
        En el carrito (Para Llevar, Delivery, Recojo y la app del mesero) aparece un contador de envases.
        Cada envase suma este precio al total y sale desglosado en la comanda, la pre-cuenta y el ticket.
        No usa ni descuenta stock.
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
        <label>
          <span style={lbl}>Precio por envase (S/)</span>
          <input value={precio} inputMode="decimal" maxLength={6}
            onChange={e => { setPrecio(e.target.value.replace(/[^\d.,]/g, '')); setErr('') }}
            style={{ ...input, width: 120 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--snow)', cursor: 'pointer', paddingBottom: 8 }}>
          <input type="checkbox" checked={activo} onChange={e => setActivo(e.target.checked)} />
          Mostrar la opción de envases
        </label>
        <button onClick={save} disabled={saving} style={btn}>
          {saving ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Check size={13} />} Guardar
        </button>
      </div>
      {cfg && (
        <div style={{ fontSize: 11, color: 'var(--fog)' }}>
          Vigente: {cfg.enabled ? `activo · S/ ${cfg.unit.toFixed(2)} por envase` : 'desactivado'}
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: '#DC2626', display: 'flex', gap: 6 }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{err}</div>}
      {okMsg && <div style={{ fontSize: 12, color: '#16A34A', fontWeight: 700 }}>{okMsg}</div>}
    </div>
  )
}

const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--mist)', marginBottom: 4 }
const input = {
  boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none',
}
const btn = {
  padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff',
  fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
}
const notice = {
  padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
  borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6,
}
