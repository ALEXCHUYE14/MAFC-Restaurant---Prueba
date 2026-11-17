import { useState } from 'react'
import { useTables } from '@/features/tables/TablesContext'
import { useAuth } from '@/features/auth/AuthContext'
import { DB } from '@/services/supabase'
import { groupTablesByZone } from '@/data/zones'
import { AlertTriangle, Wrench, Loader2, PlusCircle, Trash2 } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   AJUSTES → MESAS DEL LOCAL
   ══════════════════════════════════════════════════════════════════
   Agrega mesas nuevas (a partir de la 31) a una zona existente o a una zona
   nueva, y quita las que se agregaron por error (solo si están libres).
   Las 30 mesas originales no se pueden quitar — los pedidos históricos y el
   cierre de caja las usan.

   Cómo llega a mesero.html: escribe en la tabla `mesas`, la MISMA que ya
   sincroniza la ocupación entre meseros. mesero.html recibe el alta por
   Realtime (INSERT), agrega la mesa a su mapa y la muestra en su zona sin
   recargar. Necesita migracion-mesas-meseros.sql (columna `zona` y las
   políticas de INSERT/DELETE solo admin).
══════════════════════════════════════════════════════════════════ */

const BASE_TABLES  = 30   // las originales — no se pueden quitar
const MAX_TABLES   = 200  // tope de seguridad del mapa
const MAX_BATCH    = 20   // mesas por alta
const NEW_ZONE     = '__nueva__'

// [16,17,18,20] → "16–18, 20"
function rangesText(nums) {
  const out = []
  let i = 0
  while (i < nums.length) {
    let j = i
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++
    out.push(j > i ? `${nums[i]}–${nums[j]}` : `${nums[i]}`)
    i = j + 1
  }
  return out.join(', ')
}

const labelStyle = {
  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  textTransform: 'uppercase', color: 'var(--fog)', marginBottom: 4,
}
const inputStyle = {
  width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

export default function TablesSettings() {
  const { tables, reload, missingBase } = useTables()
  const { user } = useAuth()

  const zones      = groupTablesByZone(tables)
  const lastNumber = tables.reduce((m, t) => Math.max(m, t.number), BASE_TABLES)
  const extras     = tables.filter(t => t.number > BASE_TABLES).sort((a, b) => a.number - b.number)

  const [cantidad, setCantidad] = useState('1')
  const [zona, setZona]         = useState('')          // '' = primera zona disponible
  const [zonaNueva, setZonaNueva] = useState('')
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState(null)         // { ok, text }

  const zonaElegida = zona === NEW_ZONE ? zonaNueva.trim() : (zona || zones[0]?.name || 'Salón Principal')
  const count       = Math.floor(Number(cantidad))
  const validCount  = Number.isFinite(count) && count >= 1 && count <= MAX_BATCH
  const desde       = lastNumber + 1
  const hasta       = lastNumber + (validCount ? count : 0)

  async function handleAdd() {
    if (busy) return
    if (!validCount) { setMsg({ ok: false, text: `Indica cuántas mesas agregar (de 1 a ${MAX_BATCH})` }); return }
    if (!zonaElegida) { setMsg({ ok: false, text: 'Escribe el nombre de la zona nueva' }); return }
    if (zonaElegida.length > 30) { setMsg({ ok: false, text: 'El nombre de la zona es muy largo (máx. 30 caracteres)' }); return }
    if (tables.length + count > MAX_TABLES) { setMsg({ ok: false, text: `El local no puede pasar de ${MAX_TABLES} mesas` }); return }

    setBusy(true)
    setMsg(null)
    try {
      const rows = Array.from({ length: count }, (_, i) => ({ numero: desde + i, zona: zonaElegida }))
      await DB.addMesas(rows)
      await reload()
      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'table_add',
        entity: 'mesas', entityId: desde, detail: { desde, hasta, zona: zonaElegida },
      })
      setCantidad('1')
      setZonaNueva('')
      setMsg({
        ok: true,
        text: count === 1
          ? `✓ Mesa ${desde} agregada en ${zonaElegida} — ya aparece en la app del mesero`
          : `✓ Mesas ${desde} a ${hasta} agregadas en ${zonaElegida} — ya aparecen en la app del mesero`,
      })
    } catch (err) {
      setMsg({ ok: false, text: err?.message || 'No se pudieron agregar las mesas' })
    } finally {
      setBusy(false)
    }
  }

  // Crea en la base las mesas base (1-30) que solo existían en el código.
  async function handleCreateBase() {
    if (busy || missingBase.length === 0) return
    setBusy(true)
    setMsg(null)
    try {
      await DB.addMesas(missingBase.map(n => ({ numero: n, zona: null }))) // zona null = la de siempre por rango
      await reload()
      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'table_add',
        entity: 'mesas', entityId: missingBase[0],
        detail: { desde: missingBase[0], hasta: missingBase[missingBase.length - 1], zona: 'zonas base', cantidad: missingBase.length },
      })
      setMsg({ ok: true, text: `✓ Se crearon las mesas ${rangesText(missingBase)} — ahora su ocupación se comparte entre todos los meseros` })
    } catch (err) {
      setMsg({ ok: false, text: err?.message || 'No se pudieron crear las mesas base' })
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(t) {
    if (busy) return
    if (t.status !== 'available') { setMsg({ ok: false, text: `La mesa ${t.number} está ocupada — solo se puede quitar una mesa libre` }); return }
    if (!window.confirm(`¿Quitar la mesa ${t.number}? Desaparecerá también de la app del mesero.`)) return
    setBusy(true)
    setMsg(null)
    try {
      await DB.deleteMesa(t.number)
      await reload()
      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'table_remove',
        entity: 'mesas', entityId: t.number, detail: { numero: t.number, zona: t.zone },
      })
      setMsg({ ok: true, text: `✓ Mesa ${t.number} quitada` })
    } catch (err) {
      setMsg({ ok: false, text: err?.message || 'No se pudo quitar la mesa' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {/* Resumen por zona */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={chip('var(--amber)')}>{tables.length} mesas en total</span>
        {zones.map(z => (
          <span key={z.name} style={chip('var(--fog)')}>{z.name} · {z.tables.length}</span>
        ))}
      </div>

      {/* Mesas base que faltan en la base de datos */}
      {missingBase.length > 0 && (
        <div style={{
          marginBottom: 14, padding: '10px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
          background: 'rgba(217,119,6,.10)', border: '1px solid rgba(217,119,6,.3)', color: '#D97706',
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <AlertTriangle size={13} style={{flexShrink:0, marginTop: 1}}/>
            <span>{missingBase.length === 1 ? 'La mesa' : 'Las mesas'} <strong>{rangesText(missingBase)}</strong>{' '}
            {missingBase.length === 1 ? 'no existe' : 'no existen'} todavía en la base de datos (el esquema original solo
            creó las mesas 1 a 15). Se ven y se pueden usar, pero cuando un mesero abre una de ellas los demás
            meseros no ven que está ocupada.</span>
          </div>
          <button
            onClick={handleCreateBase} disabled={busy}
            style={{
              marginTop: 8, padding: '7px 16px', borderRadius: 'var(--r2)', border: 'none',
              background: busy ? 'var(--ink3)' : '#D97706', color: busy ? 'var(--fog)' : '#fff',
              fontWeight: 800, fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >{busy ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Procesando…</> : <><Wrench size={13}/> Crear {missingBase.length === 1 ? 'la mesa que falta' : `las ${missingBase.length} mesas que faltan`}</>}</button>
        </div>
      )}

      {/* Alta */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 10 }}>
        <div>
          <label style={labelStyle}>Cuántas mesas agregar</label>
          <input
            id="cfg-mesas-cantidad" type="number" min="1" max={MAX_BATCH} value={cantidad}
            onChange={e => { setCantidad(e.target.value); setMsg(null) }} style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Zona</label>
          <select
            id="cfg-mesas-zona" value={zona || (zones[0]?.name ?? '')}
            onChange={e => { setZona(e.target.value); setMsg(null) }} style={inputStyle}
          >
            {zones.map(z => <option key={z.name} value={z.name}>{z.name}</option>)}
            <option value={NEW_ZONE}>➕ Nueva zona…</option>
          </select>
        </div>
        {zona === NEW_ZONE && (
          <div>
            <label style={labelStyle}>Nombre de la zona nueva</label>
            <input
              id="cfg-mesas-zona-nueva" value={zonaNueva} maxLength={30} placeholder="Ej: Patio, Segundo piso"
              onChange={e => { setZonaNueva(e.target.value); setMsg(null) }} style={inputStyle}
            />
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: 'var(--fog)', marginBottom: 10 }}>
        {validCount
          ? `Se crearán las mesas ${desde}${hasta > desde ? ` a ${hasta}` : ''} en “${zonaElegida || '…'}”.`
          : 'Indica una cantidad válida.'}
      </div>

      <button
        onClick={handleAdd} disabled={busy}
        style={{
          padding: '9px 20px', borderRadius: 'var(--r2)', border: 'none',
          background: busy ? 'var(--ink3)' : 'linear-gradient(135deg, #D97706, #B45309)',
          color: busy ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 12,
          cursor: busy ? 'not-allowed' : 'pointer', letterSpacing: .3,
          display: 'flex', alignItems: 'center', gap: 6,
        }}
      >{busy ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Procesando…</> : <><PlusCircle size={13}/> Agregar mesas</>}</button>

      {msg && (
        <div style={{
          marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
          background: msg.ok ? 'rgba(22,163,74,.10)' : 'rgba(220,38,38,.10)',
          border: `1px solid ${msg.ok ? 'rgba(22,163,74,.3)' : 'rgba(220,38,38,.3)'}`,
          color: msg.ok ? '#16A34A' : '#DC2626',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>{!msg.ok && <AlertTriangle size={13}/>}{msg.text}</div>
      )}

      {/* Mesas agregadas */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>Mesas agregadas</div>
        <div style={{ fontSize: 11, color: 'var(--fog)', margin: '2px 0 10px', lineHeight: 1.5 }}>
          Las 30 mesas originales no se pueden quitar. Una mesa agregada solo se quita si está libre.
        </div>
        {extras.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ghost)' }}>Todavía no agregaste mesas.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {extras.map(t => {
              const libre = t.status === 'available'
              return (
                <div key={t.number} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 10,
                }}>
                  <div>
                    <div style={{ fontFamily: 'var(--display)', fontSize: 16, lineHeight: 1, color: libre ? '#16A34A' : '#DC2626' }}>
                      {t.number}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 2 }}>{t.zone}{libre ? '' : ' · ocupada'}</div>
                  </div>
                  <button
                    onClick={() => handleRemove(t)} disabled={busy || !libre}
                    title={libre ? 'Quitar mesa' : 'La mesa está ocupada'}
                    style={{
                      width: 26, height: 26, borderRadius: 6, border: '1px solid var(--line2)',
                      background: 'var(--ink2)', color: '#DC2626',
                      cursor: busy || !libre ? 'not-allowed' : 'pointer', opacity: libre ? 1 : .4,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  ><Trash2 size={12}/></button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

const chip = color => ({
  fontSize: 10, fontWeight: 700, color, background: 'rgba(148,163,184,.12)',
  padding: '3px 10px', borderRadius: 10, whiteSpace: 'nowrap',
})
