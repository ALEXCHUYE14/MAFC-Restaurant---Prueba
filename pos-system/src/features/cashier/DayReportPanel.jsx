import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DB, DEMO_MODE } from '@/services/supabase'
import { formatPEN } from '@/utils/currency'
import { generateDayReport } from '@/utils/pdf'
import { buildDayReport, limaDayRange, limaTime, todayLima } from './dayReport'
import { AlertTriangle, FileText, Loader2, RotateCw } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   REPORTE DEL DÍA — todos los turnos (solo administrador: vive en /admin)
   Ventas cobradas en el día (incluye las ya archivadas por los cierres),
   cada turno con su arqueo (cierres_caja) y el consolidado del día.
   Solo lectura: no modifica nada.
   ══════════════════════════════════════════════════════════════════ */

const METHOD_LABEL = { efectivo: 'Efectivo', yape: 'Yape', plin: 'Plin', tarjeta: 'Tarjeta' }
const methodLabel = m => METHOD_LABEL[m] || (m ? m.charAt(0).toUpperCase() + m.slice(1) : '—')

export default function DayReportPanel() {
  const [fecha, setFecha]     = useState(() => todayLima())
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [raw, setRaw]         = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const reqRef = useRef(0)   // descarta respuestas viejas si se cambia de fecha rápido

  const load = useCallback(async () => {
    const range = limaDayRange(fecha)
    if (!range) { setError('Fecha no válida'); return }
    if (DEMO_MODE) { setRaw({ orders: [], anuladosAbiertos: [], cierres: [], egresos: [], cierresMissing: false }); return }
    const req = ++reqRef.current
    setLoading(true); setError('')
    try {
      const data = await DB.getDayReportData(range.start.toISOString(), range.end.toISOString())
      if (req === reqRef.current) setRaw(data)
    } catch (e) {
      if (req === reqRef.current) { setError(e?.message || 'No se pudo cargar el reporte'); setRaw(null) }
    } finally {
      if (req === reqRef.current) setLoading(false)
    }
  }, [fecha])

  useEffect(() => { load() }, [load])

  const report = useMemo(() => raw ? buildDayReport(raw) : null, [raw])
  const c = report?.consolidated

  const dateLabel = useMemo(() => {
    const r = limaDayRange(fecha)
    if (!r) return fecha
    const txt = r.start.toLocaleDateString('es-PE', { timeZone: 'America/Lima', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    return txt.charAt(0).toUpperCase() + txt.slice(1)
  }, [fecha])

  async function downloadPdf() {
    if (!report || pdfBusy) return
    setPdfBusy(true)
    try {
      await generateDayReport({
        dateLabel,
        fileDate: fecha,
        consolidated: report.consolidated,
        shifts: report.shifts,
        expenses: (raw?.egresos || []).map(e => ({ hora: limaTime(e.fecha), concepto: e.concepto, categoria: e.categoria, monto: e.monto })),
      })
    } catch (e) {
      setError('No se pudo generar el PDF: ' + (e?.message || 'error'))
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* Encabezado */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 22, color: 'var(--amber)', letterSpacing: 1, lineHeight: 1 }}>REPORTE DEL DÍA</div>
            <div style={{ fontSize: 11.5, color: 'var(--mist)', marginTop: 4 }}>{dateLabel} · todos los turnos</div>
          </div>
          <input type="date" value={fecha} max={todayLima()}
            onChange={e => { if (limaDayRange(e.target.value)) setFecha(e.target.value) }}
            style={{
              background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8,
              padding: '7px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none',
            }} />
          <button onClick={load} disabled={loading} style={ghostBtn} title="Actualizar">
            {loading ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <RotateCw size={13} />} Actualizar
          </button>
          <button onClick={downloadPdf} disabled={!report || pdfBusy} style={primaryBtn}>
            {pdfBusy ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : <FileText size={13} />} PDF del día
          </button>
        </div>

        {error && (
          <div style={{ ...notice, color: '#DC2626', borderColor: 'rgba(220,38,38,.3)', background: 'rgba(220,38,38,.08)' }}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} /> {error}
          </div>
        )}
        {raw?.cierresMissing && (
          <div style={notice}>
            <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Se muestran las ventas del día, pero sin el arqueo de cada turno: ejecuta <strong>migracion-cierres-turno.sql</strong> para guardar el historial de cierres.</span>
          </div>
        )}

        {!report && loading && (
          <div style={{ fontSize: 12, color: 'var(--fog)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> Cargando…
          </div>
        )}

        {c && (
          <>
            {/* Consolidado */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
              <Stat label="Total vendido" value={formatPEN(c.total)} strong />
              <Stat label="N° pedidos" value={String(c.count)} />
              <Stat label="Ticket promedio" value={formatPEN(c.avg)} />
              <Stat label="Egresos" value={formatPEN(c.egresos)} />
              <Stat label="Neto del día" value={formatPEN(c.neto)} strong />
              <Stat label="Diferencias de arqueo" value={formatPEN(c.diferencias)}
                hint={c.cierresCount ? `${c.cierresCount} cierre${c.cierresCount !== 1 ? 's' : ''}` : 'sin cierres'} />
            </div>

            {/* Métodos + extras */}
            <div style={card}>
              <div style={cardTitle}>Ventas por método de pago</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.keys(c.byMethod).length === 0 && <span style={{ fontSize: 12, color: 'var(--fog)' }}>Sin ventas en este día</span>}
                {Object.entries(c.byMethod).map(([m, v]) => (
                  <div key={m} style={chip}><span style={{ color: 'var(--fog)' }}>{methodLabel(m)}</span> <strong style={{ color: 'var(--snow)', fontFamily: 'var(--mono)' }}>{formatPEN(v)}</strong></div>
                ))}
              </div>
              {(c.envasesCount > 0 || c.anuladosCount > 0 || c.descuentosCount > 0) && (
                <div style={{ fontSize: 11.5, color: 'var(--mist)', marginTop: 10, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {c.envasesCount > 0 && <span>Envases descartables: <strong>{c.envasesCount}</strong> und. · {formatPEN(c.envasesTotal)}</span>}
                  {c.anuladosCount > 0 && <span>Pedidos anulados: <strong>{c.anuladosCount}</strong> · {formatPEN(c.anuladosTotal)}</span>}
                  {c.descuentosCount > 0 && <span>Descuentos: <strong>{c.descuentosCount}</strong> pedido(s) · {formatPEN(c.descuentos)}</span>}
                </div>
              )}
            </div>

            {/* Turnos */}
            <div style={card}>
              <div style={cardTitle}>Turnos ({report.shifts.length})</div>
              {report.shifts.length === 0 && <div style={{ fontSize: 12, color: 'var(--fog)' }}>No hay ventas ni cierres en este día.</div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {report.shifts.map(t => (
                  <div key={t.id} style={{ background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <strong style={{ fontSize: 13, color: 'var(--snow)' }}>{t.label}</strong>
                      <span style={{ fontSize: 11, color: 'var(--fog)', whiteSpace: 'nowrap' }}>{t.horario}</span>
                    </div>
                    {t.id !== 'open' && (
                      <div style={{ fontSize: 10.5, color: 'var(--fog)', marginTop: 2 }}>Abrió: {t.abrio} · Cerró: {t.cerro}</div>
                    )}
                    <Row label={`Ventas (${t.count} pedido${t.count !== 1 ? 's' : ''})`} value={formatPEN(t.total)} bold />
                    {Object.entries(t.byMethod).map(([m, v]) => <Row key={m} label={`· ${methodLabel(m)}`} value={formatPEN(v)} />)}
                    {t.envasesCount > 0 && <Row label="· Envases" value={`${t.envasesCount} · ${formatPEN(t.envasesTotal)}`} />}
                    {t.id !== 'open' ? (
                      <>
                        <Row label="Fondo inicial" value={formatPEN(t.fondo)} />
                        <Row label="Egresos" value={formatPEN(t.egresos)} />
                        <Row label="Efectivo esperado" value={formatPEN(t.esperado)} />
                        <Row label="Efectivo contado" value={formatPEN(t.contado)} />
                        <Row label={t.diferencia === 0 ? 'Diferencia (cuadra)' : t.diferencia > 0 ? 'Sobrante' : 'Faltante'}
                          value={`${t.diferencia > 0 ? '+' : ''}${formatPEN(t.diferencia)}`} bold
                          color={t.diferencia === 0 ? 'var(--mist)' : t.diferencia > 0 ? '#16A34A' : '#DC2626'} />
                        {t.pedidosCierre !== t.count && (
                          <div style={{ fontSize: 10, color: '#D97706', marginTop: 4, lineHeight: 1.35 }}>
                            El cierre registró {t.pedidosCierre} pedido(s) por {formatPEN(t.totalCierre)} (incluye cobros de otro día).
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 10.5, color: 'var(--fog)', marginTop: 6, lineHeight: 1.4 }}>
                        Cobros aún no cerrados (turno abierto) o de cierres hechos antes de guardar el historial.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Egresos */}
            <div style={card}>
              <div style={cardTitle}>Egresos del día ({(raw?.egresos || []).length})</div>
              {(raw?.egresos || []).length === 0 && <div style={{ fontSize: 12, color: 'var(--fog)' }}>Sin egresos</div>}
              {(raw?.egresos || []).map(e => (
                <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '5px 0', borderTop: '1px solid var(--line)' }}>
                  <span style={{ color: 'var(--fog)', fontFamily: 'var(--mono)', flexShrink: 0 }}>{limaTime(e.fecha)}</span>
                  <span style={{ flex: 1, minWidth: 0, color: 'var(--snow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.concepto} <span style={{ color: 'var(--fog)' }}>· {e.categoria}</span>
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--snow)', flexShrink: 0 }}>{formatPEN(e.monto)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, hint, strong }) {
  return (
    <div style={{ ...card, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fog)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: strong ? 19 : 16, fontWeight: 800, color: 'var(--snow)', marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

function Row({ label, value, bold, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, marginTop: 4 }}>
      <span style={{ color: 'var(--mist)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--mono)', color: color || 'var(--snow)', fontWeight: bold ? 800 : 600, whiteSpace: 'nowrap' }}>{value}</span>
    </div>
  )
}

const card = { background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 12, padding: '12px 14px', boxSizing: 'border-box', minWidth: 0 }
const cardTitle = { fontSize: 12, fontWeight: 800, color: 'var(--snow)', marginBottom: 8 }
const chip = { background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 20, padding: '5px 12px', fontSize: 12, display: 'inline-flex', gap: 6 }
const ghostBtn = {
  padding: '7px 12px', borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--ink3)',
  color: 'var(--mist)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5,
}
const primaryBtn = {
  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'linear-gradient(135deg, var(--amber), var(--amber2))', color: '#fff',
  fontWeight: 800, fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
}
const notice = {
  padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
  borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6,
}
