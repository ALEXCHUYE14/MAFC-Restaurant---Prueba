import { useState, useEffect, useMemo, useCallback } from 'react'
import { InsumosDB, INSUMO_UNITS, INSUMO_CATEGORIES, MOV_TYPES, fmtQty } from '@/services/insumos'
import { formatPEN } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import { Skeleton } from '@/components/Loader'
import {
  Carrot, ClipboardCheck, BarChart3, History, PlusCircle, MinusCircle, Pencil, Archive,
  ArchiveRestore, Trash2, AlertTriangle, Loader2, X, RefreshCw, Download, Check,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   INSUMOS — despensa de la cocina
   ══════════════════════════════════════════════════════════════════
   Cómo funciona (para el dueño del negocio):
     1. Despensa  → registra cada insumo una vez (limón en kg, papa en kg…)
     2. Compras   → al registrar una compra, elige el insumo: se SUMA solo
     3. Conteo    → al cierre, escribe cuánto QUEDA: lo que falta es lo
                    que se usó (el sistema lo calcula y lo valoriza)
     4. Resumen   → por día/semana/mes: compró, usó, merma, queda, costo
   Uso y merma también se pueden registrar a mano en cualquier momento.
   ══════════════════════════════════════════════════════════════════ */

const VIEWS = [
  { key: 'despensa',    label: 'Despensa',    icon: Carrot },
  { key: 'conteo',      label: 'Conteo',      icon: ClipboardCheck },
  { key: 'resumen',     label: 'Resumen',     icon: BarChart3 },
  { key: 'movimientos', label: 'Movimientos', icon: History },
]

/* ── Fechas ─────────────────────────────────────────────────────── */
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function isToday(iso) { return !!iso && new Date(iso).toDateString() === new Date().toDateString() }
function sinceLabel(iso) {
  if (!iso) return 'Nunca contado'
  const days = Math.round((startOfDay() - startOfDay(new Date(iso))) / 86400000)
  if (days <= 0) return 'Contado hoy'
  if (days === 1) return 'Contado ayer'
  return `Contado hace ${days} días`
}
const PERIODS = [
  { key: 'hoy',    label: 'Hoy',             range: () => [startOfDay(), addDays(startOfDay(), 1)] },
  { key: 'ayer',   label: 'Ayer',            range: () => [addDays(startOfDay(), -1), startOfDay()] },
  { key: '7d',     label: 'Últimos 7 días',  range: () => [addDays(startOfDay(), -6), addDays(startOfDay(), 1)] },
  { key: '30d',    label: 'Últimos 30 días', range: () => [addDays(startOfDay(), -29), addDays(startOfDay(), 1)] },
  { key: 'mes',    label: 'Este mes',        range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth(), 1), addDays(startOfDay(), 1)] } },
  { key: 'mesant', label: 'Mes anterior',    range: () => { const n = new Date(); return [new Date(n.getFullYear(), n.getMonth() - 1, 1), new Date(n.getFullYear(), n.getMonth(), 1)] } },
]

// Número escrito por el usuario → número (acepta coma decimal). '' → null. Inválido → NaN
function parseNum(v) {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(String(v).replace(',', '.').trim())
  return isFinite(n) ? n : NaN
}

export default function InsumosPanel() {
  const [view, setView]         = useState('despensa')
  const [insumos, setInsumos]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [missing, setMissing]   = useState(false)
  const [loadErr, setLoadErr]   = useState('')
  const [histFor, setHistFor]   = useState(null) // insumo id para filtrar Movimientos

  const reload = useCallback(async () => {
    try {
      const r = await InsumosDB.list()
      setInsumos(r.rows)
      setMissing(r.missing)
      setLoadErr('')
    } catch (e) {
      setLoadErr(e?.message || 'No se pudo cargar la despensa')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const activos = useMemo(() => insumos.filter(i => i.activo), [insumos])
  const bajos   = useMemo(() => activos.filter(i => i.minimo != null && i.stock <= i.minimo), [activos])

  function openHistory(id) { setHistFor(id); setView('movimientos') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Sub-pestañas */}
      <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0, overflowX: 'auto' }}>
        {VIEWS.map(v => {
          const Icon = v.icon
          const active = view === v.key
          return (
            <button key={v.key} onClick={() => { setView(v.key); if (v.key !== 'movimientos') setHistFor(null) }} style={{
              padding: '7px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', flexShrink: 0,
              fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
              background: active ? 'var(--amber)' : 'var(--ink3)', color: active ? '#fff' : 'var(--mist)',
            }}>
              <Icon size={14} /> {v.label}
              {v.key === 'despensa' && bajos.length > 0 && (
                <span style={{ background: '#DC2626', color: '#fff', borderRadius: 10, padding: '0 6px', fontSize: 10 }}>{bajos.length}</span>
              )}
            </button>
          )
        })}
        <button onClick={() => { setLoading(true); reload() }} title="Actualizar" style={{ ...iconBtn, marginLeft: 'auto' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      {missing ? (
        <div style={{ padding: 16 }}>
          <Notice>
            La despensa de insumos aún no está activada. Ejecuta <strong>migracion-insumos.sql</strong> en
            Supabase (SQL Editor → New query → pegar → Run) y luego pulsa actualizar.
          </Notice>
        </div>
      ) : loadErr ? (
        <div style={{ padding: 16 }}><Notice>{loadErr}</Notice></div>
      ) : loading ? (
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={54} />)}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {view === 'despensa'    && <DespensaView insumos={insumos} activos={activos} bajos={bajos} onChanged={reload} onCount={() => setView('conteo')} onHistory={openHistory} />}
          {view === 'conteo'      && <ConteoView activos={activos} onSaved={reload} />}
          {view === 'resumen'     && <ResumenView insumos={insumos} />}
          {view === 'movimientos' && <MovimientosView insumos={insumos} initialInsumo={histFor} />}
        </div>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════
   DESPENSA
   ══════════════════════════════════════════════════════════════════ */
function DespensaView({ insumos, activos, bajos, onChanged, onCount, onHistory }) {
  const [search, setSearch]       = useState('')
  const [cat, setCat]             = useState('Todas')
  const [form, setForm]           = useState(null)   // null · { mode:'new' } · { mode:'edit', insumo }
  const [salida, setSalida]       = useState(null)   // insumo para registrar uso/merma
  const [showArch, setShowArch]   = useState(false)
  const [busyId, setBusyId]       = useState(null)
  const [msg, setMsg]             = useState('')

  const archivados = insumos.filter(i => !i.activo)
  const cats = useMemo(() => ['Todas', ...new Set(activos.map(i => i.categoria || 'Sin categoría'))], [activos])
  const activeCat = cats.includes(cat) ? cat : 'Todas'

  const filtered = activos.filter(i =>
    (activeCat === 'Todas' || (i.categoria || 'Sin categoría') === activeCat) &&
    (!search || i.nombre.toLowerCase().includes(search.toLowerCase()))
  )
  const groups = filtered.reduce((acc, i) => {
    const k = i.categoria || 'Sin categoría'
    ;(acc[k] = acc[k] || []).push(i)
    return acc
  }, {})

  const valor = activos.reduce((s, i) => s + (i.costoUnit != null ? i.stock * i.costoUnit : 0), 0)
  const contadosHoy = activos.filter(i => isToday(i.ultimoConteo)).length

  function flash(t) { setMsg(t); setTimeout(() => setMsg(''), 3500) }

  async function setActivo(i, activo) {
    setBusyId(i.id)
    try { await InsumosDB.update(i.id, { activo }); await onChanged(); flash(activo ? `✓ ${i.nombre} restaurado` : `✓ ${i.nombre} archivado`) }
    catch (e) { alert('⚠ ' + (e?.message || 'No se pudo guardar')) }
    finally { setBusyId(null) }
  }
  async function removeForever(i) {
    if (!window.confirm(`¿Eliminar "${i.nombre}" y TODO su historial de compras y conteos? Esto no se puede deshacer.\n\nSi solo ya no lo usas, mejor déjalo archivado.`)) return
    setBusyId(i.id)
    try { await InsumosDB.remove(i.id); await onChanged(); flash(`✓ ${i.nombre} eliminado`) }
    catch (e) { alert('⚠ ' + (e?.message || 'No se pudo eliminar')) }
    finally { setBusyId(null) }
  }

  return (
    <>
      {/* Resumen */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
        <Stat label="Insumos" val={activos.length} color="var(--mist)" />
        <Stat label="Bajo el mínimo" val={bajos.length} color={bajos.length ? '#DC2626' : '#16A34A'} />
        <Stat label="Valor en despensa" val={formatPEN(valor)} color="var(--amber)" />
        <Stat label="Contados hoy" val={`${contadosHoy}/${activos.length}`} color={activos.length && contadosHoy === activos.length ? '#16A34A' : '#D97706'} />
      </div>

      {activos.length > 0 && contadosHoy === 0 && (
        <div style={{ margin: '10px 14px 0', padding: '10px 12px', borderRadius: 10, background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>
          <ClipboardCheck size={16} color="#D97706" />
          <span style={{ flex: '1 1 200px', fontSize: 12, color: 'var(--snow)' }}>
            Aún no se hizo el conteo de hoy. Al cierre, cuenta lo que queda para saber cuánto se usó.
          </span>
          <button onClick={onCount} style={btn('primary')}>Hacer conteo</button>
        </div>
      )}

      {/* Barra */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Buscar insumo..." style={{ ...input, flex: '1 1 180px', minWidth: 0 }} />
        <button onClick={() => setForm({ mode: 'new' })} style={btn('primary')}><PlusCircle size={14} /> Nuevo insumo</button>
        <button onClick={onCount} style={btn('ghost')}><ClipboardCheck size={14} /> Hacer conteo</button>
      </div>
      {cats.length > 2 && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
          {cats.map(c => <button key={c} onClick={() => setCat(c)} style={chip(activeCat === c)}>{c}</button>)}
        </div>
      )}
      {msg && <div style={{ margin: '8px 14px 0', fontSize: 12, fontWeight: 700, color: '#16A34A' }}>{msg}</div>}

      {/* Lista */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {activos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--fog)' }}>
            <Carrot size={34} strokeWidth={1.5} style={{ opacity: .35, marginBottom: 8 }} />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--snow)', marginBottom: 6 }}>Tu despensa está vacía</div>
            <div style={{ fontSize: 12, maxWidth: 360, margin: '0 auto 14px', lineHeight: 1.5 }}>
              Agrega los insumos que compras seguido (limón, papa, aceite, pollo…) con la unidad en que los
              cuentas y cuánto tienes ahora.
            </div>
            <button onClick={() => setForm({ mode: 'new' })} style={btn('primary')}><PlusCircle size={14} /> Agregar el primer insumo</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--fog)', fontSize: 12 }}>Sin resultados</div>
        ) : Object.entries(groups).map(([g, items]) => (
          <div key={g} style={{ marginBottom: 18 }}>
            <h3 style={{ fontFamily: 'var(--display)', fontSize: 14, letterSpacing: 1, color: 'var(--amber)', margin: '0 0 8px', paddingBottom: 4, borderBottom: '1px solid var(--line)' }}>{g}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.map(i => {
                const agotado = i.stock <= 0
                const bajo = !agotado && i.minimo != null && i.stock <= i.minimo
                const color = agotado ? '#DC2626' : bajo ? '#D97706' : '#16A34A'
                return (
                  <div key={i.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    background: agotado ? 'rgba(220,38,38,.05)' : bajo ? 'rgba(217,119,6,.05)' : 'var(--ink2)',
                    border: '1px solid var(--line)', borderLeft: `3px solid ${color}`, borderRadius: 'var(--r2)', padding: '9px 10px',
                  }}>
                    <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>{i.nombre}</div>
                      <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>
                        {sinceLabel(i.ultimoConteo)}
                        {i.costoUnit != null && ` · ${formatPEN(i.costoUnit)} por ${i.unidad}`}
                        {i.minimo != null && ` · mínimo ${fmtQty(i.minimo)} ${i.unidad}`}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 90 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 800, color }}>{fmtQty(i.stock)} <span style={{ fontSize: 11 }}>{i.unidad}</span></div>
                      <div style={{ fontSize: 9, fontWeight: 700, color }}>{agotado ? 'AGOTADO' : bajo ? 'COMPRAR PRONTO' : 'EN DESPENSA'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button onClick={() => setSalida(i)} title="Registrar uso o merma" style={iconBtn}><MinusCircle size={14} /></button>
                      <button onClick={() => onHistory(i.id)} title="Historial" style={iconBtn}><History size={14} /></button>
                      <button onClick={() => setForm({ mode: 'edit', insumo: i })} title="Editar" style={iconBtn}><Pencil size={13} /></button>
                      <button onClick={() => setActivo(i, false)} disabled={busyId === i.id} title="Archivar (ya no se usa)" style={iconBtn}><Archive size={13} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {archivados.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setShowArch(p => !p)} style={{ background: 'transparent', border: 'none', color: 'var(--fog)', fontSize: 11, cursor: 'pointer', padding: '4px 0' }}>
              {showArch ? '▾' : '▸'} Insumos archivados ({archivados.length})
            </button>
            {showArch && archivados.map(i => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginTop: 5, background: 'var(--ink3)', border: '1px solid var(--line)', borderRadius: 8 }}>
                <span style={{ flex: 1, fontSize: 11, color: 'var(--fog)' }}>{i.nombre} · {fmtQty(i.stock)} {i.unidad}</span>
                <button onClick={() => setActivo(i, true)} disabled={busyId === i.id} style={btn('ghost', true)}><ArchiveRestore size={12} /> Restaurar</button>
                <button onClick={() => removeForever(i)} disabled={busyId === i.id} title="Eliminar definitivamente" style={{ ...iconBtn, color: '#DC2626' }}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      {form && (
        <InsumoFormModal
          mode={form.mode} insumo={form.insumo}
          categories={[...new Set([...INSUMO_CATEGORIES, ...insumos.map(i => i.categoria).filter(Boolean)])]}
          onClose={() => setForm(null)}
          onSaved={async (t) => { setForm(null); await onChanged(); flash(t) }}
        />
      )}
      {salida && (
        <SalidaModal
          insumo={salida}
          onClose={() => setSalida(null)}
          onSaved={async (t) => { setSalida(null); await onChanged(); flash(t) }}
        />
      )}
    </>
  )
}

/* ── Alta / edición ─────────────────────────────────────────────── */
function InsumoFormModal({ mode, insumo, categories, onClose, onSaved }) {
  const isEdit = mode === 'edit'
  const [nombre, setNombre]       = useState(insumo?.nombre || '')
  const [categoria, setCategoria] = useState(insumo?.categoria || '')
  const [otraCat, setOtraCat]     = useState(false)
  const [unidad, setUnidad]       = useState(insumo?.unidad || 'kg')
  const [minimo, setMinimo]       = useState(insumo?.minimo != null ? String(insumo.minimo) : '')
  const [inicial, setInicial]     = useState('')
  const [err, setErr]             = useState('')
  const [saving, setSaving]       = useState(false)

  const unitChanged = isEdit && unidad !== insumo.unidad

  async function save() {
    if (saving) return
    const n = nombre.trim()
    if (!n) { setErr('Escribe el nombre del insumo.'); return }
    const min = parseNum(minimo)
    if (Number.isNaN(min) || (min != null && min < 0)) { setErr('El mínimo debe ser un número mayor o igual a 0.'); return }
    const ini = parseNum(inicial)
    if (!isEdit && (Number.isNaN(ini) || (ini != null && ini < 0))) { setErr('La cantidad actual debe ser un número mayor o igual a 0.'); return }
    if (unitChanged && !window.confirm(`Cambiarás la unidad de "${insumo.unidad}" a "${unidad}". Las cantidades guardadas NO se convierten solas. ¿Continuar?`)) return

    setSaving(true); setErr('')
    try {
      if (isEdit) {
        await InsumosDB.update(insumo.id, { nombre: n, categoria, unidad, minimo: min })
        await onSaved(`✓ ${n} actualizado`)
      } else {
        await InsumosDB.create({ nombre: n, categoria, unidad, minimo: min, stockInicial: ini })
        await onSaved(`✓ ${n} agregado a la despensa`)
      }
    } catch (e) {
      setErr(e?.message || 'No se pudo guardar')
      setSaving(false)
    }
  }

  return (
    <Modal title={isEdit ? 'Editar insumo' : 'Nuevo insumo'} onClose={onClose}>
      <Field label="Nombre">
        <input value={nombre} onChange={e => { setNombre(e.target.value); setErr('') }} placeholder="Ej: Limón, Papa amarilla, Aceite" maxLength={60} style={input} autoFocus />
      </Field>
      <Field label="Categoría (opcional)">
        {!otraCat ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={categoria} onChange={e => setCategoria(e.target.value)} style={{ ...input, flex: 1 }}>
              <option value="">Sin categoría</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => { setOtraCat(true); setCategoria('') }} style={btn('ghost', true)}>+ Otra</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={categoria} onChange={e => setCategoria(e.target.value)} placeholder="Nombre de la categoría" maxLength={30} style={{ ...input, flex: 1 }} />
            <button onClick={() => { setOtraCat(false); setCategoria('') }} style={btn('ghost', true)}>Cancelar</button>
          </div>
        )}
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Se cuenta en" style={{ flex: 1 }}>
          <select value={unidad} onChange={e => setUnidad(e.target.value)} style={input}>
            {INSUMO_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </Field>
        <Field label={`Avisar si baja de (${unidad})`} style={{ flex: 1 }}>
          <input value={minimo} onChange={e => { setMinimo(e.target.value); setErr('') }} inputMode="decimal" placeholder="Ej: 2" style={input} />
        </Field>
      </div>
      {!isEdit && (
        <Field label={`¿Cuánto tienes ahora? (${unidad})`}>
          <input value={inicial} onChange={e => { setInicial(e.target.value); setErr('') }} inputMode="decimal" placeholder="Ej: 3.5 — déjalo vacío si no tienes" style={input} />
        </Field>
      )}
      <p style={{ fontSize: 11, color: 'var(--fog)', lineHeight: 1.5, margin: '2px 0 12px' }}>
        {isEdit
          ? 'La cantidad en despensa no se edita aquí: cambia con las compras, el uso y los conteos (así queda todo en el historial).'
          : 'El costo por unidad se calcula solo con cada compra que registres en Compras.'}
      </p>
      {unitChanged && <ErrorLine text={`Ojo: las cantidades actuales (${fmtQty(insumo.stock)} ${insumo.unidad}) no se convierten a ${unidad}.`} warn />}
      {err && <ErrorLine text={err} />}
      <ModalActions onClose={onClose} onSave={save} saving={saving} label={isEdit ? 'Guardar cambios' : 'Agregar insumo'} />
    </Modal>
  )
}

/* ── Registrar uso o merma ──────────────────────────────────────── */
function SalidaModal({ insumo, onClose, onSaved }) {
  const [tipo, setTipo]       = useState('consumo')
  const [cantidad, setCant]   = useState('')
  const [nota, setNota]       = useState('')
  const [err, setErr]         = useState('')
  const [saving, setSaving]   = useState(false)

  const q = parseNum(cantidad)
  const valido = q != null && !Number.isNaN(q) && q > 0
  const queda = valido ? Math.max(0, insumo.stock - q) : null

  async function save() {
    if (saving) return
    if (!valido) { setErr('Escribe una cantidad mayor a 0.'); return }
    if (q > insumo.stock && !window.confirm(`En despensa figuran ${fmtQty(insumo.stock)} ${insumo.unidad} y vas a sacar ${fmtQty(q)}. Quedará en 0. ¿Continuar? (Si en realidad tienes más, haz un conteo.)`)) return
    setSaving(true); setErr('')
    try {
      await InsumosDB.salida(insumo.id, q, tipo, nota.trim() || null)
      await onSaved(`✓ ${tipo === 'merma' ? 'Merma' : 'Uso'} registrado: ${fmtQty(q)} ${insumo.unidad} de ${insumo.nombre}`)
    } catch (e) {
      setErr(e?.message || 'No se pudo guardar')
      setSaving(false)
    }
  }

  return (
    <Modal title={`Sacar de la despensa · ${insumo.nombre}`} onClose={onClose}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {[
          { k: 'consumo', t: 'Uso en cocina', d: 'Se usó para preparar' },
          { k: 'merma',   t: 'Merma',         d: 'Se malogró, venció o se perdió' },
        ].map(o => (
          <button key={o.k} onClick={() => setTipo(o.k)} style={{
            flex: 1, textAlign: 'left', padding: '9px 10px', borderRadius: 10, cursor: 'pointer',
            border: `1px solid ${tipo === o.k ? 'var(--amber)' : 'var(--line2)'}`,
            background: tipo === o.k ? 'rgba(37,99,235,.08)' : 'var(--ink3)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--snow)' }}>{o.t}</div>
            <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>{o.d}</div>
          </button>
        ))}
      </div>
      <Field label={`Cantidad (${insumo.unidad})`}>
        <input value={cantidad} onChange={e => { setCant(e.target.value); setErr('') }} inputMode="decimal" placeholder="Ej: 1.5" style={input} autoFocus />
      </Field>
      <Field label="Nota (opcional)">
        <input value={nota} onChange={e => setNota(e.target.value)} maxLength={120} placeholder={tipo === 'merma' ? 'Ej: se malograron con el calor' : 'Ej: evento del sábado'} style={input} />
      </Field>
      <p style={{ fontSize: 11, color: 'var(--fog)', margin: '0 0 12px' }}>
        En despensa: <strong style={{ color: 'var(--snow)' }}>{fmtQty(insumo.stock)} {insumo.unidad}</strong>
        {queda != null && <> → quedará <strong style={{ color: 'var(--snow)' }}>{fmtQty(queda)} {insumo.unidad}</strong></>}
        {valido && insumo.costoUnit != null && <> · valor {formatPEN(Math.min(q, insumo.stock) * insumo.costoUnit)}</>}
      </p>
      {err && <ErrorLine text={err} />}
      <ModalActions onClose={onClose} onSave={save} saving={saving} label={tipo === 'merma' ? 'Registrar merma' : 'Registrar uso'} />
    </Modal>
  )
}

/* ══════════════════════════════════════════════════════════════════
   CONTEO — "¿cuánto queda?"
   ══════════════════════════════════════════════════════════════════ */
function ConteoView({ activos, onSaved }) {
  const [vals, setVals]     = useState({})   // { [id]: string }
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const [result, setResult] = useState(null) // resumen del último conteo guardado

  const groups = activos.reduce((acc, i) => { const k = i.categoria || 'Sin categoría'; (acc[k] = acc[k] || []).push(i); return acc }, {})

  const filled = activos
    .map(i => ({ i, q: parseNum(vals[i.id]) }))
    .filter(x => x.q != null)
  const invalid = filled.some(x => Number.isNaN(x.q) || x.q < 0)
  const costoUsado = filled.reduce((s, { i, q }) => s + (!Number.isNaN(q) && q < i.stock && i.costoUnit != null ? (i.stock - q) * i.costoUnit : 0), 0)

  async function save() {
    if (saving) return
    if (!filled.length) { setErr('Escribe cuánto queda de al menos un insumo.'); return }
    if (invalid) { setErr('Hay cantidades que no son válidas (deben ser números, 0 o más).'); return }
    if (!window.confirm(`¿Guardar el conteo de ${filled.length} insumo${filled.length !== 1 ? 's' : ''}?${costoUsado > 0 ? `\nCosto de lo usado: ${formatPEN(costoUsado)}` : ''}`)) return
    setSaving(true); setErr('')
    const snapshot = filled.map(({ i, q }) => ({ nombre: i.nombre, unidad: i.unidad, antes: i.stock, queda: q, costo: i.costoUnit }))
    try {
      await InsumosDB.conteoLote(filled.map(({ i, q }) => ({ id: i.id, queda: q })))
      setVals({})
      setResult({ items: snapshot, costo: costoUsado, at: new Date().toISOString() })
      await onSaved()
    } catch (e) {
      setErr(e?.message || 'No se pudo guardar el conteo')
    } finally {
      setSaving(false)
    }
  }

  if (activos.length === 0) {
    return <div style={{ padding: 30, textAlign: 'center', color: 'var(--fog)', fontSize: 12 }}>Primero agrega insumos en la Despensa.</div>
  }

  return (
    <>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>Conteo de cierre</div>
        <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 3, lineHeight: 1.5 }}>
          Escribe cuánto <strong>queda realmente</strong> de cada insumo. Lo que falta respecto al sistema es lo que se usó.
          Puedes contar solo algunos: los que dejes vacíos no cambian.
        </div>
      </div>

      {result && (
        <div style={{ margin: '10px 14px 0', padding: '10px 12px', borderRadius: 10, background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.3)', flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#16A34A', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} /> Conteo guardado · {result.items.length} insumo{result.items.length !== 1 ? 's' : ''}{result.costo > 0 ? ` · costo de lo usado ${formatPEN(result.costo)}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4, lineHeight: 1.6 }}>
            {result.items.map(x => {
              const d = x.antes - x.queda
              return <div key={x.nombre}>{x.nombre}: {d > 0 ? `se usaron ${fmtQty(d)} ${x.unidad}` : d < 0 ? `sobran ${fmtQty(-d)} ${x.unidad}` : 'sin cambios'} · quedan {fmtQty(x.queda)} {x.unidad}</div>
            })}
          </div>
          <button onClick={() => setResult(null)} style={{ ...btn('ghost', true), marginTop: 6 }}>Cerrar</button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {Object.entries(groups).map(([g, items]) => (
          <div key={g} style={{ marginBottom: 16 }}>
            <h3 style={{ fontFamily: 'var(--display)', fontSize: 14, letterSpacing: 1, color: 'var(--amber)', margin: '0 0 8px', paddingBottom: 4, borderBottom: '1px solid var(--line)' }}>{g}</h3>
            {items.map(i => {
              const q = parseNum(vals[i.id])
              const ok = q != null && !Number.isNaN(q) && q >= 0
              const d = ok ? i.stock - q : 0
              return (
                <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px', marginBottom: 6, background: 'var(--ink2)', border: `1px solid ${ok ? 'rgba(37,99,235,.35)' : 'var(--line)'}`, borderRadius: 'var(--r2)' }}>
                  <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>{i.nombre}</div>
                    <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>Sistema: {fmtQty(i.stock)} {i.unidad} · {sinceLabel(i.ultimoConteo)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--fog)' }}>Queda</span>
                    <input
                      value={vals[i.id] ?? ''}
                      onChange={e => { setVals(p => ({ ...p, [i.id]: e.target.value })); setErr('') }}
                      inputMode="decimal" placeholder="—"
                      aria-label={`Cuánto queda de ${i.nombre} en ${i.unidad}`}
                      style={{ ...input, width: 86, textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 700 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--fog)', minWidth: 34 }}>{i.unidad}</span>
                    <button onClick={() => setVals(p => ({ ...p, [i.id]: String(i.stock) }))} title="Queda lo mismo que dice el sistema" style={btn('ghost', true)}>= igual</button>
                  </div>
                  <div style={{ flexBasis: '100%', fontSize: 11, fontWeight: 700, minHeight: ok || Number.isNaN(q) ? 14 : 0, color: !ok ? '#DC2626' : d > 0 ? '#D97706' : d < 0 ? '#2563EB' : '#16A34A' }}>
                    {Number.isNaN(q) ? 'Escribe solo números (ej: 1.5)'
                      : !ok ? ''
                      : d > 0 ? `Se usaron ${fmtQty(d)} ${i.unidad}${i.costoUnit != null ? ` · ${formatPEN(d * i.costoUnit)}` : ''}`
                      : d < 0 ? `Sobran ${fmtQty(-d)} ${i.unidad} (¿alguna compra sin registrar?)`
                      : 'Sin cambios'}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0, background: 'var(--ink2)' }}>
        <div style={{ flex: '1 1 160px', fontSize: 12, color: 'var(--mist)' }}>
          {filled.length} de {activos.length} contados{costoUsado > 0 && <> · usado <strong style={{ color: 'var(--snow)' }}>{formatPEN(costoUsado)}</strong></>}
          {err && <div style={{ color: '#DC2626', fontWeight: 700, marginTop: 3 }}>{err}</div>}
        </div>
        <button onClick={save} disabled={saving} style={btn('primary')}>
          {saving ? <><Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> Guardando…</> : <><ClipboardCheck size={14} /> Guardar conteo</>}
        </button>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════
   RESUMEN — compró · usó · merma · queda · costo
   ══════════════════════════════════════════════════════════════════ */
function ResumenView({ insumos }) {
  const [period, setPeriod]   = useState('7d')
  const [movs, setMovs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')

  const range = useMemo(() => (PERIODS.find(p => p.key === period) || PERIODS[2]).range(), [period])

  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    InsumosDB.movimientos({ desde: range[0].toISOString(), hasta: range[1].toISOString(), limit: 5000 })
      .then(r => { if (alive) setMovs(r.rows) })
      .catch(e => { if (alive) setErr(e?.message || 'No se pudo cargar el resumen') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [range])

  // Agregado por insumo
  const rows = useMemo(() => {
    const byId = new Map()
    const get = (id, m) => {
      if (!byId.has(id)) {
        const ins = insumos.find(i => i.id === id)
        byId.set(id, {
          id, nombre: ins?.nombre || m.nombre, unidad: ins?.unidad || m.unidad, queda: ins ? ins.stock : null,
          compro: 0, gasto: 0, uso: 0, costoUso: 0, merma: 0, costoMerma: 0, sobrante: 0,
        })
      }
      return byId.get(id)
    }
    for (const m of movs) {
      const r = get(m.insumoId, m)
      if (m.tipo === 'compra')         { r.compro += m.cambio; r.gasto += m.monto || 0 }
      else if (m.tipo === 'anulacion') { r.compro += m.cambio; r.gasto += m.monto || 0 } // cambio y monto negativos
      else if (m.tipo === 'merma')     { r.merma += -m.cambio; r.costoMerma += m.monto || 0 }
      else if (m.tipo === 'consumo' || (m.tipo === 'conteo' && m.cambio < 0)) { r.uso += -m.cambio; r.costoUso += m.monto || 0 }
      else if (m.tipo === 'conteo' && m.cambio > 0) { r.sobrante += m.cambio }
    }
    // Incluir también los insumos activos sin movimientos (para ver su "queda")
    insumos.filter(i => i.activo && !byId.has(i.id)).forEach(i => get(i.id, { nombre: i.nombre, unidad: i.unidad }))
    return [...byId.values()].sort((a, b) => (b.costoUso + b.costoMerma) - (a.costoUso + a.costoMerma) || a.nombre.localeCompare(b.nombre))
  }, [movs, insumos])

  const tot = rows.reduce((t, r) => ({ gasto: t.gasto + r.gasto, uso: t.uso + r.costoUso, merma: t.merma + r.costoMerma }), { gasto: 0, uso: 0, merma: 0 })
  const periodLabel = (PERIODS.find(p => p.key === period) || {}).label || ''

  function exportCSV() {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const num = v => (v == null ? '' : String(Math.round(v * 1000) / 1000).replace('.', ','))
    const lines = [
      ['Insumo', 'Unidad', 'Compró', 'Gasto compras (S/)', 'Usó', 'Costo uso (S/)', 'Merma', 'Costo merma (S/)', 'Sobrante en conteo', 'Queda ahora'].map(q).join(';'),
      ...rows.map(r => [q(r.nombre), q(r.unidad), num(r.compro), num(r.gasto), num(r.uso), num(r.costoUso), num(r.merma), num(r.costoMerma), num(r.sobrante), num(r.queda)].join(';')),
    ]
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `insumos-${periodLabel.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }

  return (
    <>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
        {PERIODS.map(p => <button key={p.key} onClick={() => setPeriod(p.key)} style={chip(period === p.key)}>{p.label}</button>)}
        <button onClick={exportCSV} disabled={loading || !rows.length} style={{ ...btn('ghost', true), marginLeft: 'auto' }}><Download size={12} /> Excel (CSV)</button>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap', flexShrink: 0 }}>
        <Stat label="Gastado en compras" val={formatPEN(tot.gasto)} color="var(--mist)" />
        <Stat label="Costo de lo usado" val={formatPEN(tot.uso)} color="#D97706" />
        <Stat label="Pérdida por merma" val={formatPEN(tot.merma)} color="#DC2626" />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px' }}>
        {err ? <Notice>{err}</Notice> : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={40} />)}</div>
        ) : rows.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--fog)', fontSize: 12 }}>Sin insumos registrados</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 620 }}>
            <thead>
              <tr style={{ textAlign: 'right', color: 'var(--fog)', fontSize: 10 }}>
                <th style={{ ...th, textAlign: 'left' }}>Insumo</th>
                <th style={th}>Compró</th><th style={th}>Usó</th><th style={th}>Merma</th>
                <th style={th}>Queda</th><th style={th}>Costo usado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700, color: 'var(--snow)' }}>
                    {r.nombre}
                    {r.sobrante > 0 && <div style={{ fontSize: 10, color: '#2563EB', fontWeight: 600 }}>+{fmtQty(r.sobrante)} {r.unidad} sobrante en conteo</div>}
                  </td>
                  <td style={td}>{r.compro ? `${fmtQty(r.compro)} ${r.unidad}` : '—'}{r.gasto ? <div style={sub}>{formatPEN(r.gasto)}</div> : null}</td>
                  <td style={{ ...td, color: r.uso ? '#D97706' : undefined }}>{r.uso ? `${fmtQty(r.uso)} ${r.unidad}` : '—'}</td>
                  <td style={{ ...td, color: r.merma ? '#DC2626' : undefined }}>{r.merma ? `${fmtQty(r.merma)} ${r.unidad}` : '—'}{r.costoMerma ? <div style={sub}>{formatPEN(r.costoMerma)}</div> : null}</td>
                  <td style={td}>{r.queda != null ? `${fmtQty(r.queda)} ${r.unidad}` : '—'}</td>
                  <td style={{ ...td, fontWeight: 800, color: 'var(--snow)' }}>{r.costoUso ? formatPEN(r.costoUso) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ fontSize: 10.5, color: 'var(--fog)', lineHeight: 1.5, marginTop: 12 }}>
          "Usó" suma lo registrado como uso y lo que faltó en cada conteo. "Queda" es la cantidad actual en despensa.
          El costo se calcula con el precio promedio de tus compras.
        </p>
      </div>
    </>
  )
}

/* ══════════════════════════════════════════════════════════════════
   MOVIMIENTOS — historial
   ══════════════════════════════════════════════════════════════════ */
function MovimientosView({ insumos, initialInsumo }) {
  const [insumoId, setInsumoId] = useState(initialInsumo || '')
  const [tipo, setTipo]         = useState('')
  const [period, setPeriod]     = useState('30d')
  const [rows, setRows]         = useState([])
  const [loading, setLoading]   = useState(true)
  const [err, setErr]           = useState('')

  useEffect(() => { setInsumoId(initialInsumo || '') }, [initialInsumo])

  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    const p = PERIODS.find(x => x.key === period)
    const [d, h] = p ? p.range() : [null, null]
    InsumosDB.movimientos({ desde: d ? d.toISOString() : null, hasta: h ? h.toISOString() : null, insumoId: insumoId || null, limit: 1000 })
      .then(r => { if (alive) setRows(r.rows) })
      .catch(e => { if (alive) setErr(e?.message || 'No se pudo cargar el historial') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [insumoId, period])

  const visible = tipo ? rows.filter(r => r.tipo === tipo || (tipo === 'uso' && (r.tipo === 'consumo' || (r.tipo === 'conteo' && r.cambio < 0)))) : rows

  return (
    <>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <select value={insumoId} onChange={e => setInsumoId(e.target.value)} style={{ ...input, flex: '1 1 160px', width: 'auto' }}>
          <option value="">Todos los insumos</option>
          {insumos.map(i => <option key={i.id} value={i.id}>{i.nombre}{i.activo ? '' : ' (archivado)'}</option>)}
        </select>
        <select value={tipo} onChange={e => setTipo(e.target.value)} style={{ ...input, flex: '1 1 130px', width: 'auto' }}>
          <option value="">Todos los tipos</option>
          <option value="compra">Compras</option>
          <option value="uso">Uso (incluye conteos)</option>
          <option value="conteo">Conteos</option>
          <option value="merma">Merma</option>
          <option value="anulacion">Compras anuladas</option>
        </select>
        <select value={period} onChange={e => setPeriod(e.target.value)} style={{ ...input, flex: '1 1 130px', width: 'auto' }}>
          {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {err ? <Notice>{err}</Notice> : loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={46} />)}</div>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--fog)', fontSize: 12 }}>Sin movimientos en este periodo</div>
        ) : visible.map(m => {
          const t = MOV_TYPES[m.tipo] || { label: m.tipo, color: 'var(--fog)' }
          const label = m.tipo === 'conteo' ? (m.cambio < 0 ? 'Conteo · uso' : m.cambio > 0 ? 'Conteo · sobrante' : 'Conteo · sin cambios') : t.label
          return (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginBottom: 5, background: 'var(--ink3)', border: '1px solid var(--line)', borderLeft: `3px solid ${t.color}`, borderRadius: 8, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--snow)' }}>{m.nombre} <span style={{ fontWeight: 600, color: t.color, fontSize: 11 }}>· {label}</span></div>
                <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>
                  {formatDate(m.createdAt)}{m.actorName ? ` · ${m.actorName}` : ''}{m.nota ? ` · ${m.nota}` : ''}
                </div>
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fog)', whiteSpace: 'nowrap' }}>
                {fmtQty(m.antes)} → <strong style={{ color: 'var(--snow)' }}>{fmtQty(m.despues)}</strong> {m.unidad}
              </div>
              <div style={{ textAlign: 'right', minWidth: 80 }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 800, color: m.cambio > 0 ? '#16A34A' : m.cambio < 0 ? '#DC2626' : 'var(--fog)' }}>
                  {m.cambio > 0 ? '+' : m.cambio < 0 ? '−' : ''}{fmtQty(Math.abs(m.cambio))}
                </div>
                {m.monto != null && <div style={{ fontSize: 10, color: 'var(--fog)' }}>{formatPEN(Math.abs(m.monto))}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ── Piezas compartidas ─────────────────────────────────────────── */
function Stat({ label, val, color }) {
  return (
    <div style={{ flex: '1 1 110px', background: 'var(--ink3)', border: '1px solid var(--line)', borderRadius: 'var(--r2)', padding: '8px 10px', textAlign: 'center' }}>
      <div style={{ fontFamily: 'var(--display)', fontSize: 20, color, lineHeight: 1.1 }}>{val}</div>
      <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 3 }}>{label}</div>
    </div>
  )
}
function Notice({ children }) {
  return (
    <div style={{ padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6 }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>{children}</span>
    </div>
  )
}
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title} style={{ background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 16, padding: '18px 18px 16px', width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(15,23,42,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <h2 style={{ flex: 1, margin: 0, fontFamily: 'var(--display)', fontSize: 17, color: 'var(--amber)' }}>{title}</h2>
          <button onClick={onClose} title="Cerrar" style={iconBtn}><X size={14} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
function Field({ label, children, style }) {
  return (
    <label style={{ display: 'block', marginBottom: 10, ...style }}>
      <span style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--mist)', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}
function ErrorLine({ text, warn }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: warn ? '#D97706' : '#DC2626', marginBottom: 10 }}>
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /><span>{text}</span>
    </div>
  )
}
function ModalActions({ onClose, onSave, saving, label }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={onClose} style={{ ...btn('ghost'), flex: 1, justifyContent: 'center' }}>Cancelar</button>
      <button onClick={onSave} disabled={saving} style={{ ...btn('primary'), flex: 2, justifyContent: 'center' }}>
        {saving ? <><Loader2 size={14} style={{ animation: 'spin .8s linear infinite' }} /> Guardando…</> : label}
      </button>
    </div>
  )
}

const input = {
  width: '100%', boxSizing: 'border-box', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none',
}
const iconBtn = {
  width: 30, height: 30, borderRadius: 7, border: '1px solid var(--line2)', background: 'var(--ink3)',
  color: 'var(--mist)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
const th = { padding: '6px 8px', fontWeight: 700, whiteSpace: 'nowrap' }
const td = { padding: '8px', textAlign: 'right', color: 'var(--mist)', verticalAlign: 'top', whiteSpace: 'nowrap' }
const sub = { fontSize: 10, color: 'var(--fog)', marginTop: 2 }
function btn(kind, small) {
  const base = {
    padding: small ? '5px 10px' : '8px 14px', borderRadius: 8, fontWeight: 800, fontSize: small ? 11 : 12,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0,
  }
  if (kind === 'primary') return { ...base, border: 'none', background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff' }
  return { ...base, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--snow)' }
}
function chip(active) {
  return {
    padding: '5px 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700, flexShrink: 0,
    background: active ? 'var(--amber)' : 'var(--ink3)', color: active ? '#fff' : 'var(--mist)',
  }
}
