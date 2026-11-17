import { useState, useEffect, useCallback, useRef } from 'react'
import { DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { AlertTriangle, KeyRound, Palette, PlusCircle, Loader2, Save, Pencil, Pause, Play } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   AJUSTES → PERFILES DE MESEROS
   ══════════════════════════════════════════════════════════════════
   Crea meseros nuevos (aparecen en el login de mesero.html en tiempo
   real), cambia su nombre, su color, su PIN y los activa/desactiva.

   - Un mesero NUNCA se borra: tiene ventas, pedidos y turnos a su nombre.
     Se DESACTIVA y deja de aparecer en el login (conserva su historial).
   - Cambiar el nombre está permitido, pero NO mientras el mesero tenga una
     mesa abierta: mesero.html identifica las mesas abiertas por nombre y
     cambiarlo en ese momento la dejaría "huérfana" (ver DB.renameMesero, que
     lo verifica contra la base). Su sesión abierta en mesero.html se actualiza
     sola; ventas, pedidos y PIN se enlazan por id y no se ven afectados.
   - El PIN se guarda solo como HASH (set_mesero_pin). Un mesero SIN PIN
     propio entra con el PIN compartido de respaldo — por eso al crearlo el
     PIN es obligatorio, y la lista avisa quién todavía no tiene el suyo.

   Necesita migracion-mesas-meseros.sql (tabla `meseros`) y, para los PIN,
   migracion-seguridad-pines-sesiones.sql.
══════════════════════════════════════════════════════════════════ */

const PALETTE = ['#f5a623', '#e63946', '#3b9eff', '#2ecc71', '#9b59b6', '#ff6b35', '#1abc9c', '#e91e63', '#795548', '#607d8b']

const labelStyle = {
  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  textTransform: 'uppercase', color: 'var(--fog)', marginBottom: 4,
}
const inputStyle = {
  width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}
const smallBtn = (color = 'var(--snow)') => ({
  padding: '5px 12px', borderRadius: 16, border: '1px solid var(--line2)', background: 'var(--ink3)',
  color, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
})

function nextWaiterId(rows) {
  const nums = rows.map(r => /^w(\d+)$/.exec(r.id)).filter(Boolean).map(m => Number(m[1]))
  return `w${Math.max(4, ...nums) + 1}`
}

function Swatches({ value, onPick, disabled }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {PALETTE.map(c => (
        <button
          key={c} type="button" disabled={disabled} onClick={() => onPick(c)} title={c}
          style={{
            width: 26, height: 26, borderRadius: '50%', background: c, cursor: disabled ? 'not-allowed' : 'pointer',
            border: value === c ? '3px solid var(--snow)' : '2px solid transparent',
            boxShadow: value === c ? '0 0 0 1px var(--line3)' : 'none', padding: 0,
          }}
        />
      ))}
    </div>
  )
}

export default function WaitersSettings() {
  const { user } = useAuth()
  const [rows, setRows]       = useState(null)   // null = cargando · [] con missing = sin migración
  const [missing, setMissing] = useState(false)
  const [pinOk, setPinOk]     = useState({})     // id → true / false / null (no se pudo saber)
  const [busy, setBusy]       = useState(false)
  const [msg, setMsg]         = useState(null)
  const [editing, setEditing] = useState(null)   // { id, mode: 'color' | 'pin' }
  const [editPin, setEditPin] = useState('')
  const [editName, setEditName] = useState('')

  const [showNew, setShowNew] = useState(false)
  const [nName, setNName]     = useState('')
  const [nColor, setNColor]   = useState(PALETTE[4])
  const [nPin, setNPin]       = useState('')
  const [nPin2, setNPin2]     = useState('')
  const mounted = useRef(true)

  const load = useCallback(async () => {
    const data = await DB.getMeseros()
    if (!mounted.current) return
    if (!data) { setMissing(true); setRows([]); return }
    setMissing(false)
    setRows(data)
    const entries = await Promise.all(data.map(async r => [r.id, await DB.getMeseroPinConfigured(r.id)]))
    if (mounted.current) setPinOk(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    mounted.current = true
    load()
    const unsub = DB.subscribeMeseros(load) // otro admin crea/edita → esta lista se actualiza sola
    return () => { mounted.current = false; unsub() }
  }, [load])

  function flash(ok, text) { setMsg({ ok, text }) }
  const audit = (action, entityId, detail) =>
    DB.logAudit({ actorId: user?.uid, actorName: user?.name, action, entity: 'meseros', entityId, detail })

  const list        = rows || []
  const activeCount = list.filter(r => r.active).length

  async function handleCreate() {
    if (busy) return
    const name = nName.trim()
    if (name.length < 2 || name.length > 20) { flash(false, 'El nombre debe tener entre 2 y 20 caracteres'); return }
    if (list.some(r => r.name.trim().toLowerCase() === name.toLowerCase())) { flash(false, `Ya existe un mesero llamado “${name}”`); return }
    if (!/^\d{4}$/.test(nPin)) { flash(false, 'El PIN debe tener exactamente 4 números'); return }
    if (nPin !== nPin2) { flash(false, 'Los dos PIN no coinciden'); return }

    setBusy(true)
    setMsg(null)
    const id = nextWaiterId(list)
    try {
      await DB.addMesero({
        id, name, color: nColor, initial: name.charAt(0).toUpperCase(), active: true,
        sort_order: Math.max(0, ...list.map(r => r.sort_order || 0)) + 1,
      })
    } catch (err) {
      setBusy(false)
      flash(false, err?.message || 'No se pudo crear el mesero')
      return
    }
    // El perfil ya existe. El PIN se asigna aparte: si falla, se avisa claro (no se pierde el perfil).
    let pinError = null
    try { await DB.setMeseroPin(id, nPin) } catch (err) { pinError = err?.message || 'error desconocido' }
    audit('waiter_create', id, { nombre: name, pinAsignado: !pinError })
    setNName(''); setNPin(''); setNPin2(''); setShowNew(false)
    await load()
    setBusy(false)
    flash(!pinError, pinError
      ? `Perfil “${name}” creado, pero NO se pudo guardar su PIN (${pinError}). Mientras tanto entra con el PIN compartido — asígnale el suyo con “Cambiar PIN”.`
      : `✓ “${name}” creado — ya aparece en el login de la app del mesero`)
  }

  async function handleToggle(r) {
    if (busy) return
    if (r.active && activeCount <= 1) { flash(false, 'Debe quedar al menos un mesero activo'); return }
    if (r.active && !window.confirm(`¿Desactivar a ${r.name}? Dejará de aparecer en el login; su historial se conserva. Si tiene una mesa abierta, podrá terminarla.`)) return
    setBusy(true); setMsg(null)
    try {
      await DB.updateMesero(r.id, { active: !r.active })
      audit('waiter_update', r.id, { nombre: r.name, activo: !r.active })
      await load()
      flash(true, r.active ? `✓ ${r.name} desactivado` : `✓ ${r.name} activado — ya aparece en el login`)
    } catch (err) { flash(false, err?.message || 'No se pudo guardar el cambio') }
    finally { setBusy(false) }
  }

  async function handleRename(r) {
    if (busy) return
    const name = editName.trim()
    if (name.length < 2 || name.length > 20) { flash(false, 'El nombre debe tener entre 2 y 20 caracteres'); return }
    if (name === r.name) { setEditing(null); return }
    if (list.some(x => x.id !== r.id && x.name.trim().toLowerCase() === name.toLowerCase())) {
      flash(false, `Ya existe un mesero llamado “${name}”`); return
    }
    setBusy(true); setMsg(null)
    try {
      await DB.renameMesero(r.id, r.name, name)
      audit('waiter_update', r.id, { antes: r.name, despues: name })
      setEditing(null)
      await load()
      flash(true, `✓ “${r.name}” ahora se llama “${name}” — la app del mesero ya lo muestra`)
    } catch (err) { flash(false, err?.message || 'No se pudo cambiar el nombre') }
    finally { setBusy(false) }
  }

  async function handleColor(r, color) {
    if (busy) return
    setBusy(true); setMsg(null)
    try {
      await DB.updateMesero(r.id, { color })
      audit('waiter_update', r.id, { nombre: r.name, color })
      await load()
      setEditing(null)
      flash(true, `✓ Color de ${r.name} actualizado`)
    } catch (err) { flash(false, err?.message || 'No se pudo guardar el color') }
    finally { setBusy(false) }
  }

  async function handlePin(r) {
    if (busy) return
    if (!/^\d{4}$/.test(editPin)) { flash(false, 'El PIN debe tener exactamente 4 números'); return }
    setBusy(true); setMsg(null)
    try {
      await DB.setMeseroPin(r.id, editPin)
      audit('waiter_pin_change', r.id, { nombre: r.name }) // el PIN nunca se registra
      setEditPin(''); setEditing(null)
      await load()
      flash(true, `✓ PIN de ${r.name} actualizado`)
    } catch (err) {
      flash(false, `No se pudo cambiar el PIN: ${err?.message || 'error'}. ¿Corriste migracion-seguridad-pines-sesiones.sql?`)
    } finally { setBusy(false) }
  }

  if (rows === null) return <div style={{ fontSize: 12, color: 'var(--fog)' }}>Cargando perfiles…</div>

  return (
    <div>
      {missing && (
        <div style={{
          marginBottom: 12, padding: '9px 12px', borderRadius: 8, fontSize: 11, lineHeight: 1.5,
          background: 'rgba(217,119,6,.10)', border: '1px solid rgba(217,119,6,.3)', color: '#D97706',
          display: 'flex', gap: 6,
        }}>
          <AlertTriangle size={13} style={{flexShrink:0, marginTop: 1}}/>
          <span>La tabla de meseros aún no existe en Supabase. Corre <code>migracion-mesas-meseros.sql</code> en el
          SQL Editor para crear perfiles desde aquí. Mientras tanto la app del mesero usa los 4 perfiles de siempre.</span>
        </div>
      )}

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map(r => (
          <div key={r.id} style={{
            background: 'var(--ink2)', border: '1px solid var(--line)', borderRadius: 'var(--r2)',
            padding: '10px 12px', opacity: r.active ? 1 : .6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                background: r.color + '26', color: r.color, fontWeight: 800, fontSize: 15,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{(r.initial || r.name.charAt(0)).toUpperCase()}</div>

              <div style={{ flex: 1, minWidth: 120 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>
                  {r.name} <span style={{ fontSize: 10, color: 'var(--ghost)', fontWeight: 500 }}>({r.id})</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  <span style={pill(r.active ? '#16A34A' : 'var(--fog)')}>{r.active ? '● Activo' : 'Inactivo'}</span>
                  {pinOk[r.id] === true  && <span style={{...pill('#2563EB'), display:'inline-flex', alignItems:'center', gap:3}}><KeyRound size={10}/> PIN propio</span>}
                  {pinOk[r.id] === false && <span style={{...pill('#D97706'), display:'inline-flex', alignItems:'center', gap:3}}><AlertTriangle size={10}/> Usa el PIN compartido</span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button disabled={busy || missing} style={{...smallBtn(), display:'inline-flex', alignItems:'center', gap:4}} onClick={() => { setEditName(r.name); setEditing(editing?.id === r.id && editing.mode === 'name' ? null : { id: r.id, mode: 'name' }) }}><Pencil size={11}/> Nombre</button>
                <button disabled={busy || missing} style={{...smallBtn(), display:'inline-flex', alignItems:'center', gap:4}} onClick={() => setEditing(editing?.id === r.id && editing.mode === 'color' ? null : { id: r.id, mode: 'color' })}><Palette size={11}/> Color</button>
                <button disabled={busy || missing} style={{...smallBtn(), display:'inline-flex', alignItems:'center', gap:4}} onClick={() => { setEditPin(''); setEditing(editing?.id === r.id && editing.mode === 'pin' ? null : { id: r.id, mode: 'pin' }) }}><KeyRound size={11}/> Cambiar PIN</button>
                <button disabled={busy || missing} style={{...smallBtn(r.active ? '#DC2626' : '#16A34A'), display:'inline-flex', alignItems:'center', gap:4}} onClick={() => handleToggle(r)}>
                  {r.active ? <><Pause size={11}/> Desactivar</> : <><Play size={11}/> Activar</>}
                </button>
              </div>
            </div>

            {editing?.id === r.id && editing.mode === 'name' && (
              <form
                onSubmit={e => { e.preventDefault(); handleRename(r) }}
                style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
              >
                <input
                  id={`cfg-nombre-${r.id}`} value={editName} maxLength={20} autoFocus
                  onChange={e => { setEditName(e.target.value); setMsg(null) }}
                  style={{ ...inputStyle, width: 200 }}
                />
                <button type="submit" disabled={busy} style={smallBtn('#16A34A')}>Guardar nombre</button>
                <button type="button" disabled={busy} onClick={() => setEditing(null)} style={smallBtn('var(--fog)')}>Cancelar</button>
                <span style={{ fontSize: 10, color: 'var(--fog)' }}>
                  No se puede cambiar mientras {r.name} tenga una mesa abierta.
                </span>
              </form>
            )}
            {editing?.id === r.id && editing.mode === 'color' && (
              <div style={{ marginTop: 10 }}>
                <Swatches value={r.color} disabled={busy} onPick={c => handleColor(r, c)} />
              </div>
            )}
            {editing?.id === r.id && editing.mode === 'pin' && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  id={`cfg-pin-${r.id}`} type="password" inputMode="numeric" maxLength={4} value={editPin}
                  autoComplete="new-password" placeholder="• • • •"
                  onChange={e => setEditPin(e.target.value.replace(/\D/g, ''))}
                  style={{ ...inputStyle, width: 120, letterSpacing: 4, textAlign: 'center' }}
                />
                <button disabled={busy} onClick={() => handlePin(r)} style={smallBtn('#16A34A')}>Guardar PIN</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Nuevo mesero */}
      {!missing && (
        <div style={{ marginTop: 14 }}>
          {!showNew ? (
            <button onClick={() => { setShowNew(true); setMsg(null) }} style={{
              padding: '9px 20px', borderRadius: 'var(--r2)', border: 'none',
              background: 'linear-gradient(135deg, #D97706, #B45309)', color: '#fff',
              fontWeight: 800, fontSize: 12, cursor: 'pointer', letterSpacing: .3,
              display: 'flex', alignItems: 'center', gap: 6,
            }}><PlusCircle size={14}/> Nuevo mesero</button>
          ) : (
            <div style={{ padding: 14, border: '1px solid var(--line2)', borderRadius: 12, background: 'var(--ink1)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)', marginBottom: 12 }}>Nuevo perfil de mesero</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 12 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Nombre *</label>
                  <input id="cfg-mesero-nombre" value={nName} maxLength={20} placeholder="Ej: Luis"
                    onChange={e => { setNName(e.target.value); setMsg(null) }} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>PIN de 4 dígitos *</label>
                  <input id="cfg-mesero-pin" type="password" inputMode="numeric" maxLength={4} value={nPin}
                    autoComplete="new-password" placeholder="• • • •"
                    onChange={e => { setNPin(e.target.value.replace(/\D/g, '')); setMsg(null) }}
                    style={{ ...inputStyle, letterSpacing: 4, textAlign: 'center' }} />
                </div>
                <div>
                  <label style={labelStyle}>Repite el PIN *</label>
                  <input id="cfg-mesero-pin2" type="password" inputMode="numeric" maxLength={4} value={nPin2}
                    autoComplete="new-password" placeholder="• • • •"
                    onChange={e => { setNPin2(e.target.value.replace(/\D/g, '')); setMsg(null) }}
                    style={{ ...inputStyle, letterSpacing: 4, textAlign: 'center' }} />
                </div>
              </div>
              <label style={labelStyle}>Color del perfil</label>
              <Swatches value={nColor} onPick={setNColor} />
              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button onClick={handleCreate} disabled={busy} style={{
                  padding: '9px 20px', borderRadius: 'var(--r2)', border: 'none',
                  background: busy ? 'var(--ink3)' : 'linear-gradient(135deg, #16A34A, #15803D)',
                  color: busy ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 12,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>{busy ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Creando…</> : <><Save size={13}/> Crear mesero</>}</button>
                <button onClick={() => { setShowNew(false); setNName(''); setNPin(''); setNPin2(''); setMsg(null) }} disabled={busy}
                  style={smallBtn('var(--fog)')}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
          background: msg.ok ? 'rgba(22,163,74,.10)' : 'rgba(220,38,38,.10)',
          border: `1px solid ${msg.ok ? 'rgba(22,163,74,.3)' : 'rgba(220,38,38,.3)'}`,
          color: msg.ok ? '#16A34A' : '#DC2626',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>{!msg.ok && <AlertTriangle size={13}/>}{msg.text}</div>
      )}
    </div>
  )
}

const pill = color => ({
  fontSize: 9, fontWeight: 800, letterSpacing: .3, color,
  background: 'rgba(148,163,184,.14)', padding: '2px 8px', borderRadius: 10,
})
