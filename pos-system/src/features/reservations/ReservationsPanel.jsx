import { useState, useEffect, useMemo, useCallback } from 'react'
import { DB } from '@/services/supabase'
import { formatDate } from '@/utils/dates'
import { Skeleton } from '@/components/Loader'
import { useAuth } from '@/features/auth/AuthContext'
import { useTables } from '@/features/tables/TablesContext'
import ClienteQuickPicker from '@/features/customers/ClienteQuickPicker'
import {
  PlusCircle, AlertTriangle, CalendarDays, Users, Phone, Check, Flag, X,
  Trash2, Loader2, Save, Info,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   RESERVAS DE MESA
   ══════════════════════════════════════════════════════════════════
   A propósito NO toca `mesas` ni `orders` — es un registro de
   intención a futuro, independiente del mapa de mesas en tiempo real
   que ya usan mesero.html/AdminDashboard. El mesero sigue abriendo la
   mesa exactamente igual que siempre cuando el cliente llega; esta
   pestaña solo ayuda al admin a recordar quién reservó qué.
   ══════════════════════════════════════════════════════════════════ */

const ESTADO_META = {
  pendiente:  { label: 'Pendiente',  color: '#D97706', bg: 'rgba(217,119,6,.10)' },
  confirmada: { label: 'Confirmada', color: '#2563EB', bg: 'rgba(37,99,235,.10)' },
  completada: { label: 'Completada', color: '#16A34A', bg: 'rgba(22,163,74,.10)' },
  cancelada:  { label: 'Cancelada',  color: '#94A3B8', bg: 'rgba(148,163,184,.10)' },
}

const EMPTY_FORM = { clienteNombre: '', telefono: '', personas: '2', fecha: '', hora: '', mesaNumero: '', notas: '' }

function combineFechaHora(fecha, hora) {
  if (!fecha || !hora) return null
  const d = new Date(`${fecha}T${hora}:00`)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export default function ReservationsPanel() {
  const { user } = useAuth()
  // Última mesa que existe hoy (30 de base + las agregadas desde Ajustes)
  const { tables } = useTables()
  const maxMesa = tables.reduce((m, t) => Math.max(m, t.number), 30)
  const [reservas, setReservas] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [view,     setView]     = useState('proximas') // 'proximas' | 'historial'
  const [form,     setForm]     = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [showForm, setShowForm] = useState(false)
  // Ficha del cliente (CRM) ligada a la reserva — opcional
  const [cliente,  setCliente]  = useState(null)
  function onClienteChange(c) {
    setCliente(c)
    if (c) setForm(p => ({
      ...p,
      clienteNombre: p.clienteNombre.trim() ? p.clienteNombre : String(c.nombre || '').slice(0, 80),
      telefono:      p.telefono.trim() ? p.telefono : (c.celular || ''),
    }))
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const now   = new Date()
    const start = new Date(now); start.setDate(start.getDate() - 30)
    const end   = new Date(now); end.setDate(end.getDate() + 90)
    try {
      const data = await DB.getReservas({ startISO: start.toISOString(), endISO: end.toISOString() })
      setReservas(data)
    } catch (err) {
      setError(err?.message || 'No se pudo cargar las reservas')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const { proximas, historial } = useMemo(() => {
    const now = new Date()
    const prox = [], hist = []
    for (const r of reservas) {
      const isPast = new Date(r.fecha_hora) < now
      const isClosed = r.estado === 'cancelada' || r.estado === 'completada'
      ;(isPast || isClosed ? hist : prox).push(r)
    }
    prox.sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))
    hist.sort((a, b) => new Date(b.fecha_hora) - new Date(a.fecha_hora))
    return { proximas: prox, historial: hist }
  }, [reservas])

  const list = view === 'proximas' ? proximas : historial

  function setField(key, val) { setForm(p => ({ ...p, [key]: val })); setFormError('') }

  async function handleCreate() {
    if (saving) return
    const nombre = form.clienteNombre.trim()
    if (!nombre) { setFormError('El nombre del cliente es obligatorio'); return }
    const fechaHora = combineFechaHora(form.fecha, form.hora)
    if (!fechaHora) { setFormError('Selecciona una fecha y hora válidas'); return }
    const personas = Number(form.personas)
    if (!isFinite(personas) || personas < 1) { setFormError('El número de personas debe ser al menos 1'); return }
    const mesaNumero = form.mesaNumero ? Number(form.mesaNumero) : null
    if (mesaNumero != null && (!isFinite(mesaNumero) || mesaNumero < 1 || mesaNumero > maxMesa)) {
      setFormError(`La mesa debe ser un número entre 1 y ${maxMesa}`); return
    }

    setSaving(true)
    setFormError('')
    try {
      const id = await DB.addReserva({
        clienteNombre: nombre,
        telefono:      form.telefono.trim() || null,
        personas,
        fechaHora,
        mesaNumero,
        notas:         form.notas.trim() || null,
        createdBy:     user?.name || null,
        clienteId:     cliente?.id || null,
      })
      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'reservation_create',
        entity: 'reservas', entityId: id, detail: { cliente: nombre, fechaHora, personas },
      })
      setForm(EMPTY_FORM)
      setCliente(null)
      setShowForm(false)
      await load()
    } catch (err) {
      setFormError(err?.message || 'No se pudo guardar la reserva')
    } finally {
      setSaving(false)
    }
  }

  async function handleEstado(reserva, estado) {
    try {
      await DB.updateReservaEstado(reserva.id, estado)
      setReservas(prev => prev.map(r => r.id === reserva.id ? { ...r, estado } : r))
      if (estado === 'cancelada') {
        DB.logAudit({
          actorId: user?.uid, actorName: user?.name, action: 'reservation_cancel',
          entity: 'reservas', entityId: reserva.id, detail: { cliente: reserva.cliente_nombre },
        })
      }
    } catch (err) {
      alert('⚠ No se pudo actualizar la reserva: ' + (err?.message || 'error desconocido'))
    }
  }

  async function handleDelete(reserva) {
    if (!window.confirm(`¿Eliminar la reserva de ${reserva.cliente_nombre}? Esta acción no se puede deshacer.`)) return
    try {
      await DB.deleteReserva(reserva.id)
      setReservas(prev => prev.filter(r => r.id !== reserva.id))
    } catch (err) {
      alert('⚠ No se pudo eliminar: ' + (err?.message || 'error desconocido'))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Tabs + botón nueva reserva */}
      <div style={{
        display: 'flex', gap: 6, padding: '10px 14px', alignItems: 'center',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {[
          { key: 'proximas',  label: `Próximas (${proximas.length})` },
          { key: 'historial', label: `Historial (${historial.length})` },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            style={{
              padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
              border: `1px solid ${view === t.key ? 'var(--amber)' : 'var(--line2)'}`,
              background: view === t.key ? 'rgba(217,119,6,.12)' : 'transparent',
              color: view === t.key ? 'var(--amber)' : 'var(--fog)',
              fontSize: 12, fontWeight: 700,
            }}
          >{t.label}</button>
        ))}
        <button
          onClick={() => { setCliente(null); setShowForm(true) }}
          style={{
            marginLeft: 'auto', padding: '7px 16px', borderRadius: 'var(--r2)', border: 'none',
            background: 'linear-gradient(135deg, #D97706, #B45309)', color: '#fff',
            fontWeight: 800, fontSize: 12, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 5,
          }}><PlusCircle size={14}/> Nueva reserva</button>
      </div>

      {error && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 12px', flexShrink: 0,
          background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)',
          borderRadius: 8, fontSize: 12, color: '#DC2626', lineHeight: 1.5,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{display:'flex',alignItems:'center',gap:5}}><AlertTriangle size={13}/> {error}</span>
          <button onClick={load} style={{
            border: '1px solid rgba(220,38,38,.4)', background: 'transparent',
            color: '#DC2626', borderRadius: 6, padding: '4px 10px', fontSize: 11,
            fontWeight: 700, cursor: 'pointer', flexShrink: 0,
          }}>Reintentar</button>
        </div>
      )}

      {!loading && !error && reservas.length === 0 && (
        <div style={{
          margin: '10px 14px 0', padding: '9px 12px', flexShrink: 0,
          background: 'rgba(148,163,184,.10)', border: '1px solid var(--line2)',
          borderRadius: 8, fontSize: 11, color: 'var(--fog)', lineHeight: 1.5,
          display: 'flex', gap: 6,
        }}>
          <Info size={13} style={{flexShrink:0, marginTop: 1}}/>
          <span>Sin reservas todavía. Si acabas de crear una y no aparece, confirma que corriste{' '}
          <code style={{ color: 'var(--mist)' }}>migracion-reservas.sql</code> en tu Supabase.</span>
        </div>
      )}

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={70} />)}
          </div>
        ) : list.length === 0 ? (
          reservas.length > 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>
              <CalendarDays size={32} strokeWidth={1.5} style={{opacity: .3, marginBottom: 8}}/>
              {view === 'proximas' ? 'Sin reservas próximas' : 'Sin historial todavía'}
            </div>
          )
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map(r => {
              const meta = ESTADO_META[r.estado] || ESTADO_META.pendiente
              return (
                <div key={r.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--ink2)', border: '1px solid var(--line)',
                  borderLeft: `3px solid ${meta.color}`,
                  borderRadius: 'var(--r2)', padding: '10px 12px',
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>{r.cliente_nombre}</span>
                      <span style={{
                        fontSize: 8, fontWeight: 800, padding: '1px 7px', borderRadius: 10,
                        background: meta.bg, color: meta.color, letterSpacing: .3,
                      }}>{meta.label.toUpperCase()}</span>
                      {r.mesa_numero && (
                        <span style={{ fontSize: 10, color: 'var(--fog)' }}>Mesa {r.mesa_numero}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--mist)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      <CalendarDays size={11}/> {formatDate(r.fecha_hora)} · <Users size={11}/> {r.personas} persona{r.personas !== 1 ? 's' : ''}
                      {r.telefono ? <> · <Phone size={11}/> {r.telefono}</> : ''}
                    </div>
                    {r.notas && (
                      <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2, fontStyle: 'italic' }}>
                        {r.notas}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {r.estado === 'pendiente' && (
                      <button onClick={() => handleEstado(r, 'confirmada')} title="Confirmar" style={iconBtnStyle}><Check size={13}/></button>
                    )}
                    {(r.estado === 'pendiente' || r.estado === 'confirmada') && (
                      <>
                        <button onClick={() => handleEstado(r, 'completada')} title="Marcar completada" style={iconBtnStyle}><Flag size={13}/></button>
                        <button onClick={() => handleEstado(r, 'cancelada')} title="Cancelar" style={{ ...iconBtnStyle, color: '#DC2626' }}><X size={13}/></button>
                      </>
                    )}
                    <button onClick={() => handleDelete(r)} title="Eliminar" style={{ ...iconBtnStyle, color: '#DC2626' }}><Trash2 size={13}/></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      {/* Modal — nueva reserva */}
      {showForm && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
          }}
          onClick={() => !saving && setShowForm(false)}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 16,
            padding: '22px 20px', maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(15,23,42,.3)',
          }}>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--amber)', letterSpacing: 1, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
              <CalendarDays size={16}/> Nueva reserva
            </h2>

            {/* Cliente frecuente (opcional): liga la reserva a su ficha */}
            <div style={{ marginBottom: 10 }}>
              <ClienteQuickPicker value={cliente} onChange={onClienteChange} disabled={saving} />
            </div>

            <label style={labelStyle}>Nombre del cliente *</label>
            <input value={form.clienteNombre} onChange={e => setField('clienteNombre', e.target.value)} style={inputStyle} maxLength={80} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={labelStyle}>Fecha *</label>
                <input type="date" value={form.fecha} onChange={e => setField('fecha', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Hora *</label>
                <input type="time" value={form.hora} onChange={e => setField('hora', e.target.value)} style={inputStyle} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={labelStyle}>Personas</label>
                <input type="number" min="1" value={form.personas} onChange={e => setField('personas', e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Mesa (opcional)</label>
                <input type="number" min="1" max={maxMesa} placeholder={`1-${maxMesa}`} value={form.mesaNumero} onChange={e => setField('mesaNumero', e.target.value)} style={inputStyle} />
              </div>
            </div>

            <label style={labelStyle}>Teléfono (opcional)</label>
            <input value={form.telefono} onChange={e => setField('telefono', e.target.value)} style={inputStyle} maxLength={20} />

            <label style={labelStyle}>Notas (opcional)</label>
            <input value={form.notas} onChange={e => setField('notas', e.target.value)} placeholder="Cumpleaños, alergias, preferencia de zona…" style={{ ...inputStyle, marginBottom: 12 }} maxLength={200} />

            {formError && (
              <div style={{
                background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
                borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 5,
              }}><AlertTriangle size={13}/> {formError}</div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(false)} disabled={saving} style={{
                flex: 1, padding: '10px 0', borderRadius: 'var(--r2)', border: '1px solid var(--line2)',
                background: 'transparent', color: 'var(--fog)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
              }}>Cancelar</button>
              <button onClick={handleCreate} disabled={saving} style={{
                flex: 2, padding: '10px 0', borderRadius: 'var(--r2)', border: 'none',
                background: saving ? 'var(--ink3)' : 'linear-gradient(135deg, #D97706, #B45309)',
                color: saving ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 13,
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}>{saving ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Guardando…</> : <><Save size={13}/> Guardar reserva</>}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  textTransform: 'uppercase', color: 'var(--fog)', marginBottom: 4, marginTop: 8,
}

const inputStyle = {
  width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)',
  fontSize: 12, outline: 'none', boxSizing: 'border-box', marginBottom: 4,
}

const iconBtnStyle = {
  width: 30, height: 30, borderRadius: 6, border: '1px solid var(--line2)',
  background: 'var(--ink3)', color: 'var(--mist)', fontSize: 13, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
