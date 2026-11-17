import { useEffect, useMemo, useState } from 'react'
import { DB } from '@/services/supabase'
import { useAuth } from '@/features/auth/AuthContext'
import { formatPEN } from '@/utils/currency'
import { getBusiness } from '@/services/businessConfig'
import { normalizeDoc, crmErrorMessage, isCrmMissing, fillTemplate, whatsappLink, firstName, daysSince, maskDoc } from '@/utils/crm'
import { CalendarDays, Gift, Loader2, Merge, MessageCircle, Save, Star, Trash2, X } from 'lucide-react'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const orderWhere = o => Number(o.table_number) > 0 ? `Mesa ${o.table_number}` : (o.zone || 'Externo')
const orderEstado = s => {
  const t = String(s || '')
  if (t.startsWith('Pagado') || t === 'paid' || t === 'archivado') return 'cobrado'
  if (t === 'anulado') return 'anulado'
  return 'en curso'
}

/* ══════════════════════════════════════════════════════════════════
   WHATSAPP CON PLANTILLA — solo para clientes que dieron su
   consentimiento (Ley 29733). Abre WhatsApp con el texto listo; el
   envío lo confirma el administrador en su teléfono.
   ══════════════════════════════════════════════════════════════════ */
export function WhatsAppModal({ cliente, config, initialKey = 'inactivo', onClose, onSent, extra = null }) {
  const opciones = [
    { key: 'inactivo', label: 'Te extrañamos', tpl: config?.plantilla_inactivo },
    { key: 'cumple',   label: 'Cumpleaños',    tpl: config?.plantilla_cumple },
    { key: 'premio',   label: 'Premio',        tpl: config?.plantilla_premio },
    ...(extra ? [extra] : []),
  ]
  const vars = {
    nombre:  firstName(cliente?.nombre),
    negocio: getBusiness()?.nombre || '',
    premio:  config?.premio_texto || '',
    dias:    daysSince(cliente?.ultima_visita) ?? '',
  }
  const [key, setKey]   = useState(initialKey)
  const [text, setText] = useState(() => fillTemplate(opciones.find(o => o.key === initialKey)?.tpl, vars))
  const link = whatsappLink(cliente?.celular, text)

  function choose(k) { setKey(k); setText(fillTemplate(opciones.find(o => o.key === k)?.tpl, vars)) }
  function open() {
    if (!link) return
    window.open(link, '_blank', 'noopener,noreferrer')
    onSent?.()
    onClose()
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...sheet, maxWidth: 420 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <MessageCircle size={16} style={{ color: '#16A34A' }} />
          <strong style={{ flex: 1, fontSize: 14, color: 'var(--snow)' }}>WhatsApp a {cliente?.nombre}</strong>
          <button onClick={onClose} aria-label="Cerrar" style={iconBtn}><X size={16} /></button>
        </div>
        {!cliente?.acepta_marketing ? (
          <div style={notice}>Este cliente no dio su consentimiento para recibir mensajes. Regístralo en su ficha si lo autoriza.</div>
        ) : !link ? (
          <div style={notice}>El cliente no tiene un celular válido.</div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              {opciones.map(o => (
                <button key={o.key} onClick={() => choose(o.key)} style={{ ...chip, ...(key === o.key ? chipOn : {}) }}>{o.label}</button>
              ))}
            </div>
            <textarea value={text} onChange={e => setText(e.target.value.slice(0, 1000))} rows={5} style={{ ...input, width: '100%', resize: 'vertical' }} />
            <div style={{ fontSize: 10.5, color: 'var(--fog)', margin: '6px 0 10px' }}>Puedes editar el mensaje antes de abrir WhatsApp.</div>
            <button onClick={open} style={{ ...btnPrimary, background: '#16A34A', width: '100%', justifyContent: 'center' }}>
              <MessageCircle size={14} /> Abrir WhatsApp
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   FICHA DEL CLIENTE — datos, fidelidad, plato favorito e historial
   (pedidos, reservas y premios canjeados). cliente = null → nuevo.
   ══════════════════════════════════════════════════════════════════ */
export default function ClienteFicha({ cliente, config, onClose, onSaved, onDeleted }) {
  const { user } = useAuth()
  const isNew = !cliente?.id
  const [form, setForm] = useState(() => ({
    nombre:    cliente?.nombre || '',
    celular:   cliente?.celular || '',
    dni:       cliente?.dni || '',
    dia:       cliente?.cumple_dia ? String(cliente.cumple_dia) : '',
    mes:       cliente?.cumple_mes ? String(cliente.cumple_mes) : '',
    direccion: cliente?.direccion || '',
    notas:     cliente?.notas || '',
    aviso:     cliente?.aviso_mesero || '',
    acepta:    !!cliente?.acepta_marketing,
  }))
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')
  const [stats, setStats]     = useState(null)
  const [hist, setHist]       = useState(null)
  const [histErr, setHistErr] = useState('')
  const [showWa, setShowWa]   = useState(false)
  const [busyCanje, setBusyCanje] = useState(null)
  // Unir con otra ficha duplicada
  const [mergeDoc, setMergeDoc]   = useState('')
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeMsg, setMergeMsg]   = useState('')
  const [showMerge, setShowMerge] = useState(false)
  // Encuesta de satisfacción
  const [encuestaBusy, setEncuestaBusy] = useState(false)
  const [encuestaExtra, setEncuestaExtra] = useState(null)
  const [encuestas, setEncuestas] = useState(null)
  const [hasAvisoCol, setHasAvisoCol] = useState(false)   // columna aviso_mesero existe

  const loadHist = async () => {
    if (isNew) return
    try {
      const [st, h] = await Promise.all([DB.crmStatsCliente(cliente.id), DB.getClienteHistorial(cliente.id, cliente.celular)])
      setStats(st); setHist(h); setHistErr('')
    } catch (e) { setHistErr(crmErrorMessage(e)) }
  }
  useEffect(() => { loadHist() }, [cliente?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // Ficha completa (el resumen de la lista no trae el aviso)
  useEffect(() => {
    if (isNew) return
    DB.getCliente(cliente.id).then(row => {
      if (row && Object.prototype.hasOwnProperty.call(row, 'aviso_mesero')) {
        setHasAvisoCol(true)
        setForm(f => ({ ...f, aviso: f.aviso || row.aviso_mesero || '' }))
      }
    }).catch(() => {})
  }, [cliente?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (isNew) return
    DB.getEncuestas({ clienteId: cliente.id, limit: 20 }).then(setEncuestas).catch(() => setEncuestas(null))
  }, [cliente?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function unir() {
    if (mergeBusy) return
    setMergeMsg('')
    const d = normalizeDoc(mergeDoc)
    if (!d) { setMergeMsg('Escribe el celular o DNI de la ficha duplicada.'); return }
    setMergeBusy(true)
    try {
      const r = await DB.crmIdentificar({ doc: d.valor })
      if (!r?.encontrado) { setMergeMsg('No existe una ficha con ese celular/DNI.'); return }
      if (r.id === cliente.id) { setMergeMsg('Esa es esta misma ficha.'); return }
      const otro = r.nombre_completo || r.nombre
      if (!window.confirm(`¿Unir "${otro}" (${r.celular ? maskDoc(r.celular) : 'DNI ' + maskDoc(r.dni)}) dentro de "${cliente.nombre}"?\n\nSus pedidos, reservas y premios pasan a esta ficha y la otra se elimina. No se puede deshacer.`)) return
      const res = await DB.crmUnirClientes(cliente.id, r.id)
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'customer_merge', entity: 'clientes', entityId: cliente.id, detail: { origen: r.id, ...res } })
      onSaved?.()
      onClose()
    } catch (e) {
      setMergeMsg(isCrmMissing(e) ? 'Falta ejecutar migracion-crm-avanzado.sql.' : crmErrorMessage(e))
    } finally { setMergeBusy(false) }
  }

  async function encuesta() {
    if (encuestaBusy) return
    setEncuestaBusy(true)
    try {
      const token = await DB.crmCrearEncuesta(cliente.id, user?.name || 'Admin')
      if (!/^[0-9a-f]{32}$/.test(String(token || ''))) throw new Error('ENCUESTA')
      const url = `${window.location.origin}/encuesta.html?t=${token}`
      setEncuestaExtra({
        key: 'encuesta', label: 'Encuesta',
        tpl: `Hola {nombre}, gracias por visitarnos en {negocio}. ¿Nos ayudas con 1 minuto? Califica tu experiencia aquí: ${url}`,
      })
      setShowWa(true)
    } catch (e) {
      setHistErr(isCrmMissing(e) ? 'Para encuestas ejecuta migracion-crm-avanzado.sql.' : crmErrorMessage(e))
    } finally { setEncuestaBusy(false) }
  }

  // Plato favorito: más unidades pedidas (sin cortesías ni anulados)
  const favoritos = useMemo(() => {
    const m = new Map()
    for (const o of hist?.orders || []) {
      if (orderEstado(o.status) === 'anulado') continue
      for (const it of Array.isArray(o.items) ? o.items : []) {
        if (!it || it.cortesia) continue
        const name = String(it.name || '').trim()
        if (!name) continue
        m.set(name, (m.get(name) || 0) + (Number(it.qty) || 0))
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  }, [hist])

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErr('') }

  async function save() {
    if (saving) return
    const nombre = form.nombre.trim().replace(/\s+/g, ' ')
    if (!nombre || nombre.length > 80) { setErr('Escribe el nombre (máx. 80 caracteres).'); return }
    const cel = form.celular.trim() ? normalizeDoc(form.celular) : null
    if (form.celular.trim() && (!cel || cel.tipo !== 'celular')) { setErr('Celular no válido (9 dígitos, empieza con 9).'); return }
    const dni = form.dni.trim() ? normalizeDoc(form.dni) : null
    if (form.dni.trim() && (!dni || dni.tipo !== 'dni')) { setErr('DNI no válido (8 dígitos).'); return }
    if (!cel && !dni) { setErr('Registra al menos un celular o un DNI.'); return }
    const dia = form.dia ? Number(form.dia) : null, mes = form.mes ? Number(form.mes) : null
    if ((dia && !mes) || (!dia && mes)) { setErr('Completa día y mes del cumpleaños (o deja ambos vacíos).'); return }
    if (form.direccion.length > 200 || form.notas.length > 300) { setErr('Dirección o notas demasiado largas.'); return }
    if (form.aviso.length > 80) { setErr('El aviso para mesero/cocina admite hasta 80 caracteres.'); return }
    const row = {
      nombre, celular: cel?.valor || null, dni: dni?.valor || null,
      cumple_dia: dia, cumple_mes: mes,
      direccion: form.direccion.trim() || null, notas: form.notas.trim() || null,
      acepta_marketing: form.acepta,
    }
    // Aviso solo si la migración avanzada existe (columna aviso_mesero)
    if (hasAvisoCol || form.aviso.trim()) row.aviso_mesero = form.aviso.trim() || null
    // Fecha del consentimiento: se guarda al otorgarlo
    if (form.acepta && !cliente?.acepta_marketing) row.acepta_marketing_at = new Date().toISOString()
    if (!form.acepta) row.acepta_marketing_at = null
    setSaving(true); setErr('')
    try {
      if (isNew) {
        const id = await DB.createCliente({ ...row, created_by: user?.name || 'Admin' })
        DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'customer_create', entity: 'clientes', entityId: id, detail: { nombre } })
      } else {
        await DB.updateCliente(cliente.id, row)
        DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'customer_update', entity: 'clientes', entityId: cliente.id, detail: { nombre } })
      }
      onSaved?.()
      onClose()
    } catch (e) { setErr(crmErrorMessage(e)) }
    finally { setSaving(false) }
  }

  async function remove() {
    if (isNew || saving) return
    if (!window.confirm(`¿Eliminar la ficha de ${cliente.nombre}?\n\nSus pedidos se conservan (sin datos personales). Esta acción no se puede deshacer.`)) return
    setSaving(true)
    try {
      await DB.deleteCliente(cliente.id)
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'customer_delete', entity: 'clientes', entityId: cliente.id, detail: {} })
      onDeleted?.()
      onClose()
    } catch (e) { setErr(crmErrorMessage(e)); setSaving(false) }
  }

  async function anularCanje(c) {
    if (busyCanje) return
    if (!window.confirm('¿Anular este canje? El cliente recupera el premio.')) return
    setBusyCanje(c.id)
    try {
      await DB.crmAnularCanje(c.id)
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'reward_void', entity: 'clientes_canjes', entityId: c.id, detail: { cliente: cliente.id } })
      await loadHist()
    } catch (e) { setHistErr(crmErrorMessage(e)) }
    finally { setBusyCanje(null) }
  }

  async function markContacted() {
    try { await DB.updateCliente(cliente.id, { ultimo_contacto_at: new Date().toISOString() }); onSaved?.() } catch (_) { /* no crítico */ }
  }

  return (
    <div onClick={() => !saving && onClose()} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...sheet, maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <strong style={{ flex: 1, fontSize: 16, color: 'var(--snow)' }}>{isNew ? 'Nuevo cliente' : cliente.nombre}</strong>
          {!isNew && cliente.celular && cliente.acepta_marketing && (
            <button onClick={encuesta} disabled={encuestaBusy} style={btn} title="Genera un enlace único y lo envía por WhatsApp">
              {encuestaBusy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Star size={13} />} Encuesta
            </button>
          )}
          {!isNew && cliente.celular && (
            <button onClick={() => { setEncuestaExtra(null); setShowWa(true) }} style={{ ...btn, color: '#16A34A' }}><MessageCircle size={13} /> WhatsApp</button>
          )}
          <button onClick={onClose} aria-label="Cerrar" style={iconBtn}><X size={16} /></button>
        </div>

        {/* Fidelidad y estadísticas */}
        {!isNew && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginBottom: 12 }}>
            <Stat label="Visitas" value={stats ? String(stats.visitas) : '…'} />
            <Stat label="Ticket promedio" value={stats ? formatPEN(stats.ticket_promedio) : '…'} />
            <Stat label="Total gastado" value={stats ? formatPEN(stats.total_gastado) : '…'} />
            <Stat label="Última visita" value={stats ? fmtDate(stats.ultima_visita) : '…'} />
            <Stat label="Fidelidad" value={stats ? `${stats.visita_actual} / ${stats.meta}` : '…'}
              hint={stats?.premio_disponible ? `🎁 ${stats.premio_texto} disponible` : null} />
            <Stat label="Plato favorito" value={favoritos[0]?.[0] || '—'} small
              hint={favoritos.length > 1 ? `Luego: ${favoritos.slice(1).map(f => f[0]).join(', ')}` : null} />
          </div>
        )}

        {/* Datos */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
          <Field label="Nombre *"><input value={form.nombre} maxLength={80} onChange={e => set('nombre', e.target.value)} style={input} /></Field>
          <Field label="Celular"><input value={form.celular} maxLength={15} inputMode="numeric" onChange={e => set('celular', e.target.value)} style={input} /></Field>
          <Field label="DNI"><input value={form.dni} maxLength={8} inputMode="numeric" onChange={e => set('dni', e.target.value.replace(/\D/g, ''))} style={input} /></Field>
          <Field label="Cumpleaños">
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={form.dia} onChange={e => set('dia', e.target.value)} style={{ ...input, flex: 1 }}>
                <option value="">Día</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
              <select value={form.mes} onChange={e => set('mes', e.target.value)} style={{ ...input, flex: 2 }}>
                <option value="">Mes</option>
                {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Dirección (delivery)"><input value={form.direccion} maxLength={200} onChange={e => set('direccion', e.target.value)} style={input} /></Field>
          <Field label="Notas (solo administración)"><input value={form.notas} maxLength={300} onChange={e => set('notas', e.target.value)} placeholder="Ej: mesa junto a la ventana" style={input} /></Field>
          <Field label="⚠ Aviso para mesero y cocina"><input value={form.aviso} maxLength={80} onChange={e => set('aviso', e.target.value)} placeholder="Ej: Alergia al maní" style={input} /></Field>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--fog)', marginTop: 4 }}>
          El aviso lo verá el mesero al identificar al cliente y saldrá en la comanda. Escribe solo lo necesario (dato de salud: compártelo solo con permiso del cliente).
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 11.5, color: 'var(--mist)', lineHeight: 1.4, margin: '10px 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.acepta} onChange={e => set('acepta', e.target.checked)} style={{ marginTop: 2 }} />
          Acepta recibir promociones y saludos por WhatsApp (Ley 29733). Puede retirarlo cuando quiera.
        </label>
        {err && <div style={{ fontSize: 12, color: '#DC2626', marginBottom: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={save} disabled={saving} style={btnPrimary}>
            {saving ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Save size={13} />} Guardar
          </button>
          {!isNew && (
            <button onClick={() => { setShowMerge(v => !v); setMergeMsg('') }} disabled={saving} style={btn}><Merge size={13} /> Unir con ficha duplicada</button>
          )}
          {!isNew && (
            <button onClick={remove} disabled={saving} style={{ ...btn, color: '#DC2626' }}><Trash2 size={13} /> Eliminar ficha</button>
          )}
        </div>
        {showMerge && !isNew && (
          <div style={{ marginTop: 10, padding: '10px 12px', border: '1px dashed var(--line2)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11.5, color: 'var(--mist)' }}>Celular o DNI de la OTRA ficha (la duplicada). Todo lo suyo pasa a esta ficha.</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={mergeDoc} maxLength={15} inputMode="numeric" onChange={e => { setMergeDoc(e.target.value); setMergeMsg('') }} style={{ ...input, flex: 1 }} />
              <button onClick={unir} disabled={mergeBusy || !mergeDoc.trim()} style={btnPrimary}>
                {mergeBusy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <Merge size={13} />} Unir
              </button>
            </div>
            {mergeMsg && <div style={{ fontSize: 11.5, color: '#DC2626' }}>{mergeMsg}</div>}
          </div>
        )}

        {/* Historial */}
        {!isNew && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {histErr && <div style={{ fontSize: 12, color: '#DC2626' }}>{histErr}</div>}
            <Section title={`Pedidos (${hist?.orders?.length ?? '…'})`}>
              {(hist?.orders || []).slice(0, 30).map(o => (
                <Line key={o.id} left={`${fmtDate(o.paid_at || o.created_at)} · ${orderWhere(o)}`} right={formatPEN(o.total || 0)} sub={orderEstado(o.status)} />
              ))}
              {hist && !hist.orders.length && <Empty>Aún no tiene pedidos ligados.</Empty>}
            </Section>
            <Section title={`Reservas (${hist?.reservas?.length ?? '…'})`}>
              {(hist?.reservas || []).map(r => (
                <Line key={r.id} left={<><CalendarDays size={11} style={{ verticalAlign: -1 }} /> {new Date(r.fecha_hora).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' })}</>}
                  right={`${r.personas} pers.`} sub={r.estado} />
              ))}
              {hist && !hist.reservas.length && <Empty>Sin reservas.</Empty>}
            </Section>
            {encuestas && (
              <Section title={`Encuestas respondidas (${encuestas.length})`}>
                {encuestas.map(e => (
                  <Line key={e.id} left={<>{'★'.repeat(e.puntaje || 0)}{'☆'.repeat(5 - (e.puntaje || 0))} {e.comentario ? `· ${e.comentario}` : ''}</>} right={fmtDate(e.respondida_at)} />
                ))}
                {!encuestas.length && <Empty>Sin respuestas todavía.</Empty>}
              </Section>
            )}
            <Section title={`Premios canjeados (${hist?.canjes?.length ?? '…'})`}>
              {(hist?.canjes || []).map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 12 }}>
                  <Gift size={12} style={{ color: c.anulado ? 'var(--fog)' : '#16A34A', flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0, color: c.anulado ? 'var(--fog)' : 'var(--snow)', textDecoration: c.anulado ? 'line-through' : 'none' }}>
                    {fmtDate(c.created_at)} · {c.producto || c.premio}
                  </span>
                  {!c.anulado && (
                    <button onClick={() => anularCanje(c)} disabled={!!busyCanje} style={{ ...btn, padding: '3px 8px', fontSize: 10.5 }}>
                      {busyCanje === c.id ? <Loader2 size={11} style={{ animation: 'spin .8s linear infinite' }} /> : 'Anular'}
                    </button>
                  )}
                </div>
              ))}
              {hist && !hist.canjes.length && <Empty>Sin canjes.</Empty>}
            </Section>
          </div>
        )}
      </div>
      {showWa && !isNew && (
        <WhatsAppModal cliente={{ ...cliente, ...stats, acepta_marketing: cliente.acepta_marketing }} config={config}
          initialKey={encuestaExtra ? 'encuesta' : stats?.premio_disponible ? 'premio' : 'inactivo'}
          extra={encuestaExtra}
          onClose={() => { setShowWa(false); setEncuestaExtra(null) }} onSent={markContacted} />
      )}
    </div>
  )
}

function Stat({ label, value, hint, small }) {
  return (
    <div style={{ background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 10, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--fog)', letterSpacing: .8, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: small ? 12.5 : 15, fontWeight: 800, color: 'var(--snow)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: '#16A34A', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</div>}
    </div>
  )
}
const Field = ({ label, children }) => (
  <label style={{ display: 'block', minWidth: 0 }}>
    <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--mist)', marginBottom: 4 }}>{label}</span>
    {children}
  </label>
)
const Section = ({ title, children }) => (
  <div><div style={{ fontSize: 12, fontWeight: 800, color: 'var(--snow)', marginBottom: 4 }}>{title}</div>{children}</div>
)
const Line = ({ left, right, sub }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 12 }}>
    <span style={{ flex: 1, minWidth: 0, color: 'var(--snow)' }}>{left}{sub && <span style={{ color: 'var(--fog)' }}> · {sub}</span>}</span>
    <span style={{ fontFamily: 'var(--mono)', color: 'var(--snow)', whiteSpace: 'nowrap' }}>{right}</span>
  </div>
)
const Empty = ({ children }) => <div style={{ fontSize: 11.5, color: 'var(--fog)', padding: '4px 0' }}>{children}</div>

const overlay = { position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }
const sheet = { background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 14, padding: 16, width: '100%', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', boxSizing: 'border-box' }
const input = { width: '100%', boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none' }
const btn = { padding: '7px 11px', borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--ink3)', color: 'var(--mist)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }
const btnPrimary = { padding: '8px 14px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }
const iconBtn = { border: 'none', background: 'transparent', color: 'var(--fog)', cursor: 'pointer', display: 'inline-flex' }
const chip = { padding: '5px 10px', borderRadius: 20, border: '1px solid var(--line2)', background: 'var(--ink3)', color: 'var(--mist)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }
const chipOn = { borderColor: '#16A34A', color: '#16A34A', background: 'rgba(22,163,74,.1)' }
const notice = { padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5 }
