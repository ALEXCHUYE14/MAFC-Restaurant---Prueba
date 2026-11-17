import { useCallback, useEffect, useState } from 'react'
import { supabase, DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { AlertTriangle, Check, Copy, KeyRound, Loader2, Plus, Printer, RotateCw, Trash2 } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   IMPRESORAS DE RED (Wi-Fi / LAN) — migracion-impresion-red.sql
   ══════════════════════════════════════════════════════════════════
   · Registra las tiketeras de red del local (nombre, IP fija, puerto).
   · Genera el token del AGENTE de impresión (agente-impresion.js), que
     corre en una PC del local: se muestra UNA sola vez; en la base de datos
     queda solo su huella cifrada. Generar uno nuevo invalida el anterior.
   · Muestra si el agente está en línea y los últimos errores de impresión.
   ══════════════════════════════════════════════════════════════════ */

const IP_RE = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/

function isPrivateIp(ip) {
  const [a, b] = ip.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
function isMissing(error) {
  const msg = String(error?.message || error?.details || '')
  return ['PGRST202', 'PGRST205', '42883', '42P01'].includes(error?.code)
    || /could not find|does not exist|impresoras_red|estado_impresion_red/i.test(msg)
}
function agoText(iso) {
  if (!iso) return 'nunca'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `hace ${s} s`
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return new Date(iso).toLocaleString('es-PE')
}

export default function NetworkPrintersSettings() {
  const { user } = useAuth()
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [list, setList]       = useState([])
  const [estado, setEstado]   = useState(null)
  const [errores, setErrores] = useState([])
  const [form, setForm]       = useState({ nombre: '', ip: '', puerto: '9100', ancho: '48' })
  const [busy, setBusy]       = useState('')
  const [err, setErr]         = useState('')
  const [okMsg, setOkMsg]     = useState('')
  const [token, setToken]     = useState('')
  const [copied, setCopied]   = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    try {
      const [r1, r2, r3] = await Promise.all([
        supabase.from('impresoras_red').select('id, nombre, ip, puerto, ancho_cols, activa').order('nombre'),
        supabase.rpc('estado_impresion_red'),
        supabase.from('print_jobs').select('id, tipo, ultimo_error, created_at, impresora_id')
          .eq('estado', 'error').order('created_at', { ascending: false }).limit(5),
      ])
      if (r1.error) { if (isMissing(r1.error)) { setMissing(true); return } throw r1.error }
      if (r2.error && isMissing(r2.error)) { setMissing(true); return }
      setList(r1.data || [])
      setEstado(r2.error ? null : r2.data)
      setErrores(r3.error ? [] : (r3.data || []))
    } catch (e) {
      setErr(e?.message || 'No se pudo cargar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function done(msg) { setOkMsg(msg); setErr(''); setTimeout(() => setOkMsg(''), 4000) }

  async function add() {
    if (busy) return
    setErr(''); setOkMsg('')
    const nombre = form.nombre.trim()
    const ip = form.ip.trim()
    const puerto = Number(form.puerto)
    const ancho = Number(form.ancho)
    if (!nombre || nombre.length > 40) { setErr('Escribe un nombre (máx. 40 caracteres), ej. "Cocina".'); return }
    if (!IP_RE.test(ip)) { setErr('IP no válida. Ejemplo: 192.168.1.200'); return }
    if (!isPrivateIp(ip)) { setErr('La IP debe ser de la red del local (192.168.x.x, 10.x.x.x o 172.16–31.x.x).'); return }
    if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) { setErr('Puerto no válido (normalmente 9100).'); return }
    if (list.some(p => p.ip === ip && p.puerto === puerto)) { setErr('Ya hay una impresora con esa IP y puerto.'); return }
    setBusy('add')
    try {
      const { error } = await supabase.from('impresoras_red').insert({ nombre, ip, puerto, ancho_cols: ancho })
      if (error) throw error
      setForm({ nombre: '', ip: '', puerto: '9100', ancho: '48' })
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'net_printer_add', entity: 'impresoras_red', entityId: ip, detail: { nombre, ip, puerto } })
      done('✓ Impresora agregada. En cada celular: Ajustes → Impresoras → "Red (Wi-Fi)".')
      await load()
    } catch (e) {
      setErr(/row-level|permission/i.test(e?.message || '') ? 'Solo el administrador puede registrar impresoras.' : (e?.message || 'No se pudo guardar'))
    } finally {
      setBusy('')
    }
  }

  async function toggle(p) {
    if (busy) return
    setBusy(p.id)
    try {
      const { error } = await supabase.from('impresoras_red').update({ activa: !p.activa, updated_at: new Date().toISOString() }).eq('id', p.id)
      if (error) throw error
      await load()
    } catch (e) { setErr(e?.message || 'No se pudo actualizar') }
    finally { setBusy('') }
  }

  async function remove(p) {
    if (busy) return
    if (!window.confirm(`¿Quitar la impresora "${p.nombre}" (${p.ip})?\nLos celulares que la usaban imprimirán por la ventana del navegador hasta que elijan otra.`)) return
    setBusy(p.id)
    try {
      const { error } = await supabase.from('impresoras_red').delete().eq('id', p.id)
      if (error) throw error
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'net_printer_delete', entity: 'impresoras_red', entityId: p.ip, detail: { nombre: p.nombre } })
      await load()
    } catch (e) { setErr(e?.message || 'No se pudo quitar') }
    finally { setBusy('') }
  }

  async function test(p) {
    if (busy) return
    setBusy(p.id); setErr(''); setOkMsg('')
    try {
      const line = '-'.repeat(Math.max(16, (p.ancho_cols || 48) - 2))
      const txt = `\x1B\x61\x01\x1D\x21\x01PRUEBA DE IMPRESION\x1D\x21\x00\n${line}\nImpresora: ${p.nombre}\nIP: ${p.ip}:${p.puerto}\n${new Date().toLocaleString('es-PE')}\n${line}\x1B\x61\x00\n`
      const ascii = txt.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7F]/g, '?')
      const { error } = await supabase.rpc('encolar_impresion', { p_impresora: p.id, p_tipo: 'prueba', p_contenido: btoa(ascii), p_origen: 'Panel admin' })
      if (error) throw new Error(/PRINTER_NOT_FOUND/.test(error.message) ? 'La impresora está desactivada.' : error.message)
      done(estado?.ultimo_contacto && Date.now() - new Date(estado.ultimo_contacto).getTime() < 60000
        ? '✓ Prueba enviada: debe salir en unos segundos.'
        : '✓ Prueba en cola. Saldrá cuando el agente de impresión esté en línea.')
      setTimeout(load, 4000)
    } catch (e) { setErr(e?.message || 'No se pudo enviar la prueba') }
    finally { setBusy('') }
  }

  async function genToken() {
    if (busy) return
    if (estado?.token_configurado && !window.confirm('Ya hay un token. Si generas uno nuevo, el agente actual dejará de imprimir hasta que pongas el nuevo token en su config.json. ¿Continuar?')) return
    setBusy('token'); setErr(''); setOkMsg(''); setCopied(false)
    try {
      const { data, error } = await supabase.rpc('generar_token_agente')
      if (error) throw new Error(/NOT_ALLOWED/.test(error.message) ? 'Solo el administrador puede generar el token.' : error.message)
      setToken(String(data || ''))
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'print_agent_token', entity: 'print_agente', entityId: '1', detail: {} })
      await load()
    } catch (e) { setErr(e?.message || 'No se pudo generar el token') }
    finally { setBusy('') }
  }

  async function copyToken() {
    try { await navigator.clipboard.writeText(token); setCopied(true) } catch (_) { /* el usuario puede copiarlo a mano */ }
  }

  if (missing) {
    return (
      <div style={notice}>
        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Para imprimir por red (tiketeras Wi-Fi / cable de red) ejecuta <strong>migracion-impresion-red.sql</strong> en
          Supabase (SQL Editor) y luego instala el agente de impresión (carpeta <strong>agente-impresion</strong>, ver LEEME.txt).
        </span>
      </div>
    )
  }

  const online = estado?.ultimo_contacto && Date.now() - new Date(estado.ultimo_contacto).getTime() < 60000
  const nameOf = id => list.find(p => p.id === id)?.nombre || 'Impresora'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--mist)', lineHeight: 1.5 }}>
        Los celulares envían los tickets a una cola y el <strong>agente de impresión</strong> (en una PC del local, misma red
        que las tiketeras) los imprime. Si una tiketera está apagada, el ticket espera y se reintenta.
      </div>

      {/* Estado del agente */}
      <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: online ? '#16A34A' : '#DC2626', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 180, fontSize: 12, color: 'var(--snow)', lineHeight: 1.45 }}>
          <strong>Agente {online ? 'en línea' : 'sin conexión'}</strong>
          <span style={{ color: 'var(--fog)' }}>
            {' · '}{estado?.token_configurado ? `último contacto ${agoText(estado?.ultimo_contacto)}${estado?.equipo ? ` (${estado.equipo})` : ''}` : 'sin token generado'}
            {estado && <> · en cola: {estado.pendientes} · impresos 24 h: {estado.impresos_hoy} · errores 24 h: {estado.errores_hoy}</>}
          </span>
        </div>
        <button onClick={load} disabled={loading} style={ghostBtn} title="Actualizar">
          {loading ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <RotateCw size={13} />}
        </button>
        <button onClick={genToken} disabled={!!busy} style={ghostBtn}>
          {busy === 'token' ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <KeyRound size={13} />}
          {estado?.token_configurado ? 'Generar token nuevo' : 'Generar token del agente'}
        </button>
      </div>

      {token && (
        <div style={{ ...box, borderColor: 'rgba(217,119,6,.45)' }}>
          <div style={{ fontSize: 11.5, color: '#D97706', fontWeight: 700, marginBottom: 6 }}>
            Copia este token en el config.json del agente. Por seguridad NO se volverá a mostrar.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, fontSize: 12, wordBreak: 'break-all', color: 'var(--snow)', background: 'var(--ink2)', padding: '7px 9px', borderRadius: 6, userSelect: 'all' }}>{token}</code>
            <button onClick={copyToken} style={ghostBtn}>{copied ? <><Check size={13} /> Copiado</> : <><Copy size={13} /> Copiar</>}</button>
            <button onClick={() => setToken('')} style={ghostBtn}>Listo</button>
          </div>
        </div>
      )}

      {/* Lista */}
      {list.length === 0 && !loading && (
        <div style={{ fontSize: 12, color: 'var(--fog)' }}>Aún no hay impresoras de red registradas.</div>
      )}
      {list.map(p => (
        <div key={p.id} style={{ ...box, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', opacity: p.activa ? 1 : 0.6 }}>
          <Printer size={15} style={{ color: 'var(--mist)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>{p.nombre}{!p.activa && ' (desactivada)'}</div>
            <div style={{ fontSize: 11, color: 'var(--fog)' }}>{p.ip}:{p.puerto} · {p.ancho_cols === 32 ? '58 mm' : '80 mm'}</div>
          </div>
          <button onClick={() => test(p)} disabled={!!busy || !p.activa} style={ghostBtn}>Probar</button>
          <button onClick={() => toggle(p)} disabled={!!busy} style={ghostBtn}>{p.activa ? 'Desactivar' : 'Activar'}</button>
          <button onClick={() => remove(p)} disabled={!!busy} style={{ ...ghostBtn, color: '#DC2626' }} title="Quitar"><Trash2 size={13} /></button>
        </div>
      ))}

      {/* Agregar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, alignItems: 'end' }}>
        <label><span style={lbl}>Nombre</span>
          <input value={form.nombre} maxLength={40} placeholder="Cocina" onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} style={input} /></label>
        <label><span style={lbl}>IP fija</span>
          <input value={form.ip} maxLength={15} placeholder="192.168.1.200" inputMode="decimal" onChange={e => setForm(f => ({ ...f, ip: e.target.value }))} style={input} /></label>
        <label><span style={lbl}>Puerto</span>
          <input value={form.puerto} maxLength={5} inputMode="numeric" onChange={e => setForm(f => ({ ...f, puerto: e.target.value.replace(/\D/g, '') }))} style={input} /></label>
        <label><span style={lbl}>Papel</span>
          <select value={form.ancho} onChange={e => setForm(f => ({ ...f, ancho: e.target.value }))} style={input}>
            <option value="48">80 mm</option>
            <option value="42">80 mm (márgenes amplios)</option>
            <option value="32">58 mm</option>
          </select></label>
        <button onClick={add} disabled={!!busy} style={primaryBtn}>
          {busy === 'add' ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Plus size={13} />} Agregar
        </button>
      </div>

      {err && <div style={{ fontSize: 12, color: '#DC2626', display: 'flex', gap: 6, alignItems: 'flex-start' }}><AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />{err}</div>}
      {okMsg && <div style={{ fontSize: 12, color: '#16A34A', fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}><Check size={13} />{okMsg}</div>}

      {errores.length > 0 && (
        <div style={box}>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: '#DC2626', marginBottom: 6 }}>Últimos tickets que no se pudieron imprimir</div>
          {errores.map(j => (
            <div key={j.id} style={{ fontSize: 11, color: 'var(--mist)', lineHeight: 1.5 }}>
              {new Date(j.created_at).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })} · {nameOf(j.impresora_id)} · {j.tipo} — {j.ultimo_error || 'error'}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const box = { background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 10, padding: '10px 12px' }
const lbl = { display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--mist)', marginBottom: 4 }
const input = {
  width: '100%', boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none',
}
const ghostBtn = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--ink2)',
  color: 'var(--mist)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
}
const primaryBtn = {
  padding: '9px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff',
  fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
}
const notice = {
  padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
  borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6,
}
