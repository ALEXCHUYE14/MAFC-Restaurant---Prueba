/* ══════════════════════════════════════════════════════════════════
   ENCUESTA DE SATISFACCIÓN — página pública (migracion-crm-avanzado.sql)
   El cliente llega con un enlace único (?t=<token de 32 caracteres>)
   enviado por WhatsApp. Califica de 1 a 5 y deja un comentario.
   Un enlace = una sola respuesta; vence a los 14 días. Toda la
   validación la hace el servidor (encuesta_info / encuesta_responder).
   ══════════════════════════════════════════════════════════════════ */
import React from 'react'
import * as ReactDOM from 'react-dom/client'
import { supabase } from '@/services/supabase'

const { useEffect, useState } = React
const LABELS = ['', 'Muy mala', 'Mala', 'Regular', 'Buena', '¡Excelente!']

function readToken() {
  try {
    const t = new URLSearchParams(window.location.search).get('t') || ''
    return /^[0-9a-f]{32}$/.test(t) ? t : null
  } catch (_) { return null }
}

function App() {
  const [token]  = useState(readToken)
  const [estado, setEstado] = useState(token ? 'cargando' : 'invalida')
  const [nombre, setNombre] = useState('')
  const [negocio, setNegocio] = useState('')
  const [puntaje, setPuntaje] = useState(0)
  const [comentario, setComentario] = useState('')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!token || !supabase) { setEstado('invalida'); return }
    let alive = true
    supabase.rpc('encuesta_info', { p_token: token }).then(({ data, error }) => {
      if (!alive) return
      if (error) { setEstado('error'); return }
      setEstado(data?.estado || 'invalida')
      setNombre(String(data?.nombre || '').slice(0, 40))
    })
    supabase.from('negocio_config').select('nombre').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (alive && data?.nombre) setNegocio(String(data.nombre).slice(0, 60)) }, () => {})
    return () => { alive = false }
  }, [token])

  async function enviar() {
    if (sending || puntaje < 1) return
    setSending(true); setErr('')
    try {
      const { error } = await supabase.rpc('encuesta_responder', {
        p_token: token, p_puntaje: puntaje, p_comentario: comentario.trim().slice(0, 500) || null,
      })
      if (error) {
        if (/RATE_LIMIT/.test(error.message || '')) throw new Error('Hay muchas respuestas en este momento. Intenta en un minuto.')
        if (/NO_DISPONIBLE/.test(error.message || '')) { setEstado('respondida'); return }
        throw new Error('No se pudo enviar. Revisa tu conexión e inténtalo de nuevo.')
      }
      setEstado('gracias')
    } catch (e) { setErr(e.message) }
    finally { setSending(false) }
  }

  let body
  if (estado === 'cargando') body = <p>Cargando…</p>
  else if (estado === 'invalida') body = <><h1>Enlace no válido</h1><p>Revisa que el enlace esté completo.</p></>
  else if (estado === 'vencida') body = <><h1>Encuesta vencida</h1><p>Este enlace ya no está disponible. ¡Gracias de todas formas!</p></>
  else if (estado === 'respondida') body = <><h1>¡Ya respondiste!</h1><p>Esta encuesta ya fue contestada. Gracias por tu tiempo.</p></>
  else if (estado === 'error') body = <><h1>Sin conexión</h1><p>No pudimos cargar la encuesta. Intenta más tarde.</p></>
  else if (estado === 'gracias') body = <><div className="ok">¡Gracias{nombre ? `, ${nombre}` : ''}!</div><p style={{ marginTop: 10 }}>Tu opinión nos ayuda a mejorar.</p></>
  else body = (
    <>
      <h1>¿Cómo te atendimos{nombre ? `, ${nombre}` : ''}?</h1>
      <p>Califica tu última visita{negocio ? ` a ${negocio}` : ''}.</p>
      <div className="stars" role="radiogroup" aria-label="Calificación">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} type="button" role="radio" aria-checked={puntaje === n} aria-label={`${n} de 5: ${LABELS[n]}`}
            className={n <= puntaje ? 'on' : ''} onClick={() => setPuntaje(n)}>★</button>
        ))}
      </div>
      <p style={{ minHeight: 20, fontWeight: 600, color: 'var(--ink)' }}>{LABELS[puntaje] || ' '}</p>
      <textarea value={comentario} maxLength={500} onChange={e => setComentario(e.target.value)}
        placeholder="¿Algo que quieras contarnos? (opcional)" aria-label="Comentario" />
      <button className="send" disabled={sending || puntaje < 1} onClick={enviar}>{sending ? 'Enviando…' : 'Enviar'}</button>
      {err && <div className="msg err">{err}</div>}
      <small>Solo el administrador del local ve tu respuesta.</small>
    </>
  )
  return <div className="card">{body}</div>
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
