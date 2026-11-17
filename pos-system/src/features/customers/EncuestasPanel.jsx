import { useCallback, useEffect, useMemo, useState } from 'react'
import { DB } from '@/services/supabase'
import { crmErrorMessage, isCrmMissing } from '@/utils/crm'
import { AlertTriangle, Star } from 'lucide-react'

/* ENCUESTAS DE SATISFACCIÓN (migracion-crm-avanzado.sql) — respuestas recibidas.
   Los enlaces se generan desde la ficha del cliente (botón "Encuesta"). */
export default function EncuestasPanel() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [err, setErr]         = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setRows(await DB.getEncuestas({ limit: 300 })); setErr('') }
    catch (e) { if (isCrmMissing(e)) setMissing(true); else setErr(crmErrorMessage(e)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const resumen = useMemo(() => {
    const n = rows.length
    const dist = [1, 2, 3, 4, 5].map(s => rows.filter(r => r.puntaje === s).length)
    const avg = n ? rows.reduce((s, r) => s + (Number(r.puntaje) || 0), 0) / n : 0
    return { n, dist, avg }
  }, [rows])

  if (missing) return <div style={notice}><AlertTriangle size={13} /> Para encuestas ejecuta <strong>migracion-crm-avanzado.sql</strong>.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ ...card, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--fog)', letterSpacing: 1 }}>PROMEDIO</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--snow)' }}>{resumen.n ? resumen.avg.toFixed(1) : '—'} <Star size={18} style={{ color: '#D97706', verticalAlign: -2 }} /></div>
          <div style={{ fontSize: 11, color: 'var(--fog)' }}>{resumen.n} respuesta{resumen.n !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          {[5, 4, 3, 2, 1].map(s => {
            const c = resumen.dist[s - 1]
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mist)' }}>
                <span style={{ width: 18 }}>{s}★</span>
                <div style={{ flex: 1, height: 7, background: 'var(--ink3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${resumen.n ? (c * 100 / resumen.n) : 0}%`, height: '100%', background: '#D97706' }} />
                </div>
                <span style={{ width: 24, textAlign: 'right' }}>{c}</span>
              </div>
            )
          })}
        </div>
      </div>
      {err && <div style={{ fontSize: 12, color: '#DC2626' }}>{err}</div>}
      {loading && <div style={{ fontSize: 12, color: 'var(--fog)' }}>Cargando…</div>}
      {!loading && !rows.length && <div style={{ fontSize: 12, color: 'var(--fog)' }}>Aún no hay respuestas. Envía una encuesta desde la ficha de un cliente.</div>}
      {rows.map(r => (
        <div key={r.id} style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <strong style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--snow)' }}>{r.clientes?.nombre || 'Cliente'}</strong>
            <span style={{ color: '#D97706', fontSize: 13, letterSpacing: 1 }}>{'★'.repeat(r.puntaje || 0)}{'☆'.repeat(5 - (r.puntaje || 0))}</span>
          </div>
          {r.comentario && <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 4, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{r.comentario}</div>}
          <div style={{ fontSize: 10.5, color: 'var(--fog)', marginTop: 4 }}>
            {new Date(r.respondida_at).toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        </div>
      ))}
    </div>
  )
}

const card = { background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 12, padding: '10px 12px', minWidth: 0 }
const notice = { padding: '10px 12px', background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', borderRadius: 8, fontSize: 12, color: '#D97706', lineHeight: 1.5, display: 'flex', gap: 6 }
