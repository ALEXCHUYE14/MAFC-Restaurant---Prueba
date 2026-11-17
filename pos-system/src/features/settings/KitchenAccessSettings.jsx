import { useEffect, useState } from 'react'
import { supabase, DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { AlertTriangle, Check, Eye, EyeOff, Loader2, Lock } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   ACCESO DE COCINA — usuario y clave del panel Comanda Cocina
   ══════════════════════════════════════════════════════════════════
   La clave se guarda CIFRADA en la base de datos (migracion-clave-cocina.sql)
   y la app de cocina solo recibe sí/no al verificarla: nunca está en el
   código. Este panel solo la CAMBIA (no se puede leer la clave actual).
   ══════════════════════════════════════════════════════════════════ */

function isMissingFn(error) {
  const msg = String(error?.message || error?.details || '')
  return error?.code === 'PGRST202' || error?.code === '42883' || /could not find the function/i.test(msg)
}

export default function KitchenAccessSettings() {
  const { user } = useAuth()
  const [current, setCurrent]   = useState(null)   // usuario actual
  const [missing, setMissing]   = useState(false)
  const [usuario, setUsuario]   = useState('')
  const [clave, setClave]       = useState('')
  const [clave2, setClave2]     = useState('')
  const [show, setShow]         = useState(false)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')
  const [okMsg, setOkMsg]       = useState('')

  useEffect(() => {
    let alive = true
    if (!supabase) return
    supabase.rpc('get_cocina_usuario').then(({ data, error }) => {
      if (!alive) return
      if (error) { if (isMissingFn(error)) setMissing(true); return }
      setCurrent(data || '')
      setUsuario(data || '')
    })
    return () => { alive = false }
  }, [])

  async function save() {
    if (saving) return
    setErr(''); setOkMsg('')
    const u = usuario.trim().toLowerCase()
    if (!/^[a-z0-9._-]{3,30}$/.test(u)) { setErr('El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo (sin espacios).'); return }
    if (clave.length < 4) { setErr('La clave debe tener al menos 4 caracteres.'); return }
    if (clave !== clave2) { setErr('Las dos claves no coinciden.'); return }
    if (clave === '2026') { setErr('Elige una clave distinta a la de fábrica ("2026").'); return }
    setSaving(true)
    try {
      const { error } = await supabase.rpc('set_cocina_acceso', { p_usuario: u, p_clave: clave })
      if (error) {
        const msg = String(error.message || '')
        if (isMissingFn(error)) throw new Error('Falta ejecutar migracion-clave-cocina.sql en Supabase.')
        if (/NOT_ALLOWED/.test(msg)) throw new Error('Solo el administrador puede cambiar el acceso de cocina.')
        if (/USER_INVALID/.test(msg)) throw new Error('Usuario no válido.')
        if (/PASS_INVALID/.test(msg)) throw new Error('Clave no válida.')
        throw error
      }
      setCurrent(u); setClave(''); setClave2('')
      setOkMsg('✓ Acceso de cocina actualizado. Usa los nuevos datos la próxima vez que se ingrese a cocina.')
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'kitchen_access_change', entity: 'cocina_acceso', entityId: '1', detail: { usuario: u } })
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
        <span>
          La clave de cocina todavía está escrita dentro de la app. Ejecuta <strong>migracion-clave-cocina.sql</strong> en
          Supabase (SQL Editor) para guardarla cifrada y poder cambiarla aquí.
        </span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.5 }}>
        Usuario y clave con los que se entra a <strong>Comanda Cocina</strong>. La clave se guarda cifrada: nadie puede leerla,
        ni siquiera desde aquí; solo cambiarla. Tras 5 intentos fallidos, el acceso se bloquea 5 minutos.
        {current !== null && <> Usuario actual: <strong style={{ color: 'var(--snow)' }}>{current || '—'}</strong>.</>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
        <label style={field}>
          <span style={lbl}>Usuario</span>
          <input value={usuario} onChange={e => { setUsuario(e.target.value); setErr('') }} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={30} style={input} />
        </label>
        <label style={field}>
          <span style={lbl}>Nueva clave</span>
          <div style={{ position: 'relative' }}>
            <input type={show ? 'text' : 'password'} value={clave} onChange={e => { setClave(e.target.value); setErr('') }} autoComplete="new-password" maxLength={100} style={{ ...input, paddingRight: 38 }} />
            <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Ocultar clave' : 'Mostrar clave'} style={eye}>
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </label>
        <label style={field}>
          <span style={lbl}>Repite la clave</span>
          <input type={show ? 'text' : 'password'} value={clave2} onChange={e => { setClave2(e.target.value); setErr('') }} autoComplete="new-password" maxLength={100} style={input} />
        </label>
      </div>

      {err && <div style={{ fontSize: 12, color: '#DC2626', display: 'flex', gap: 6, alignItems: 'flex-start' }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{err}</div>}
      {okMsg && <div style={{ fontSize: 12, color: '#16A34A', fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}><Check size={13} />{okMsg}</div>}

      <div>
        <button onClick={save} disabled={saving} style={{
          padding: '9px 16px', borderRadius: 8, border: 'none', cursor: saving ? 'wait' : 'pointer',
          background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff',
          fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {saving ? <><Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> Guardando…</> : <><Lock size={13} /> Guardar acceso de cocina</>}
        </button>
      </div>
    </div>
  )
}

const field = { display: 'block' }
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--mist)', marginBottom: 4 }
const input = {
  width: '100%', boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none',
}
const eye = {
  position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30,
  border: 'none', background: 'transparent', color: 'var(--fog)', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const notice = {
  padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
  borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6,
}
