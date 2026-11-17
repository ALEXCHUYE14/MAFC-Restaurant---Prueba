/* ══════════════════════════════════════════════════════════════════
   ComprobanteModal — elegir y emitir Boleta / Factura de un pedido cobrado
   ══════════════════════════════════════════════════════════════════
   Uso (app del mesero y Caja del panel admin):
     <ComprobanteModal sb={supabase} orderId=... total=... titulo="Mesa 4"
                       emitidoPor="Carlos" onClose={() => ...} />
   · "Sin comprobante" = nota de venta interna (no se emite nada).
   · Si el pedido ya tiene comprobante, se muestra directo (no se duplica).
   ══════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react'
import { FileText, Receipt, Building2, Printer, Share2, RotateCw, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import {
  emitirComprobante, consultarComprobante, obtenerComprobante,
  NOMBRE_TIPO, ESTADOS, enlaceWhatsapp,
} from './facturacion'

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  box: { background: 'var(--ink2, #fff)', color: 'var(--snow, #0f172a)', borderRadius: 16, width: '100%', maxWidth: 360, padding: 18, boxShadow: '0 20px 50px rgba(0,0,0,.25)', maxHeight: '92vh', overflowY: 'auto' },
  titulo: { fontFamily: 'var(--display)', fontSize: 22, letterSpacing: .5, display: 'flex', alignItems: 'center', gap: 8 },
  sub: { fontSize: 12, color: 'var(--mist, #475569)', marginTop: 2, marginBottom: 14 },
  opcion: (activa) => ({
    flex: 1, padding: '12px 6px', borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 13,
    border: `2px solid ${activa ? 'var(--amber, #2563eb)' : 'var(--line2, #cbd5e1)'}`,
    background: activa ? 'var(--amber, #2563eb)' : 'var(--ink3, #f1f5f9)',
    color: activa ? '#fff' : 'var(--snow, #0f172a)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  }),
  label: { fontSize: 11, fontWeight: 700, color: 'var(--mist, #475569)', margin: '10px 0 4px' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1.5px solid var(--line2, #cbd5e1)', background: 'var(--ink3, #f1f5f9)', color: 'var(--snow, #0f172a)', fontSize: 15 },
  primario: (off) => ({ width: '100%', marginTop: 14, padding: '13px 0', borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 15, cursor: off ? 'default' : 'pointer', background: off ? 'var(--line2, #cbd5e1)' : 'var(--amber, #2563eb)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }),
  secundario: { flex: 1, padding: '11px 0', borderRadius: 12, border: '1.5px solid var(--line2, #cbd5e1)', background: 'var(--ink3, #f1f5f9)', color: 'var(--snow, #0f172a)', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 },
  texto: { width: '100%', marginTop: 10, padding: '8px 0', border: 'none', background: 'none', color: 'var(--mist, #475569)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' },
  error: { marginTop: 12, padding: '10px 12px', borderRadius: 10, background: '#FEF2F2', color: '#B91C1C', fontSize: 13, display: 'flex', gap: 8, alignItems: 'flex-start' },
}

export default function ComprobanteModal({ sb, orderId, total, titulo, emitidoPor, celular, onClose, onEmitido }) {
  const [comprobante, setComprobante] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [tipo, setTipo] = useState('boleta')
  const [numero, setNumero] = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [consultando, setConsultando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    obtenerComprobante(sb, orderId).then(c => { if (vivo) { setComprobante(c); setCargando(false) } })
    return () => { vivo = false }
  }, [sb, orderId])

  // Mientras está "pendiente", se pregunta a SUNAT unas veces (el worker tarda segundos)
  useEffect(() => {
    if (comprobante?.estado !== 'pendiente') return
    let intentos = 0
    const t = setInterval(async () => {
      intentos += 1
      try { const c = await consultarComprobante(sb, orderId); if (c) setComprobante(c) } catch (_) { /* reintenta */ }
      if (intentos >= 6) clearInterval(t)
    }, 4000)
    return () => clearInterval(t)
  }, [comprobante?.estado, sb, orderId])

  const doc = numero.replace(/\D/g, '')
  const requiereNombre = tipo === 'factura' || doc.length > 0
  const montoAlto = tipo === 'boleta' && Number(total) >= 700
  const docValido = tipo === 'factura'
    ? /^(10|15|16|17|20)\d{9}$/.test(doc)
    : doc === '' ? !montoAlto : (/^\d{8}$/.test(doc) || /^(10|15|16|17|20)\d{9}$/.test(doc))
  const listo = docValido && (!requiereNombre || nombre.trim().length >= 3)

  const emitir = async () => {
    if (!listo || enviando) return
    setEnviando(true); setError('')
    try {
      const c = await emitirComprobante(sb, {
        orderId, tipo,
        cliente: doc ? { numero: doc, razon_social: nombre.trim() } : null,
        emitidoPor,
      })
      setComprobante(c)
      onEmitido?.(c)
    } catch (e) {
      setError(e.message || 'No se pudo emitir')
    } finally {
      setEnviando(false)
    }
  }

  const actualizar = async () => {
    setConsultando(true); setError('')
    try { const c = await consultarComprobante(sb, orderId); if (c) setComprobante(c) }
    catch (e) { setError(e.message) }
    finally { setConsultando(false) }
  }

  const abrir = (url) => { if (url) window.open(url, '_blank', 'noopener') }

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={S.titulo}><Receipt size={20} /> Comprobante</div>
            <div style={S.sub}>{titulo} · S/ {Number(total || 0).toFixed(2)}</div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--mist)' }} aria-label="Cerrar"><X size={20} /></button>
        </div>

        {cargando ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--mist)' }}><Loader2 size={22} className="spin" style={{ animation: 'spin .8s linear infinite' }} /></div>
        ) : comprobante ? (
          <Resultado c={comprobante} celular={celular} abrir={abrir} actualizar={actualizar} consultando={consultando} onClose={onClose} />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.opcion(tipo === 'boleta')} onClick={() => { setTipo('boleta'); setError('') }}>
                <FileText size={18} /> Boleta
              </button>
              <button style={S.opcion(tipo === 'factura')} onClick={() => { setTipo('factura'); setError('') }}>
                <Building2 size={18} /> Factura
              </button>
            </div>

            <div style={S.label}>
              {tipo === 'factura' ? 'RUC del cliente' : `DNI o RUC del cliente ${montoAlto ? '(obligatorio desde S/ 700)' : '(opcional)'}`}
            </div>
            <input
              style={S.input} inputMode="numeric" maxLength={11} value={numero}
              placeholder={tipo === 'factura' ? '20123456789' : 'Vacío = clientes varios'}
              onChange={e => setNumero(e.target.value.replace(/\D/g, ''))}
            />

            {requiereNombre && (
              <>
                <div style={S.label}>{doc.length === 8 ? 'Nombre del cliente' : 'Razón social'}</div>
                <input
                  style={S.input} value={nombre} maxLength={200}
                  placeholder={doc.length === 8 ? 'Juan Pérez' : 'EMPRESA SAC'}
                  onChange={e => setNombre(e.target.value)}
                />
              </>
            )}

            {error && <div style={S.error}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {error}</div>}

            <button style={S.primario(!listo || enviando)} disabled={!listo || enviando} onClick={emitir}>
              {enviando ? <><Loader2 size={17} style={{ animation: 'spin .8s linear infinite' }} /> Emitiendo…</> : `Emitir ${tipo === 'factura' ? 'factura' : 'boleta'}`}
            </button>
            <button style={S.texto} onClick={onClose}>Sin comprobante (nota de venta)</button>
          </>
        )}
      </div>
    </div>
  )
}

function Resultado({ c, celular, abrir, actualizar, consultando, onClose }) {
  const estado = ESTADOS[c.estado] || { label: c.estado, color: 'var(--mist)' }
  const valido = !['rechazado', 'error', 'anulado'].includes(c.estado)

  return (
    <>
      <div style={{ textAlign: 'center', padding: '6px 0 4px' }}>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>{NOMBRE_TIPO[c.tipo_doc] || 'Comprobante'} electrónica</div>
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: .5, margin: '2px 0' }}>{c.numero}</div>
        <div style={{ fontSize: 12, color: 'var(--mist)' }}>{c.cliente_nombre}{c.cliente_numero && c.cliente_numero !== '-' ? ` · ${c.cliente_numero}` : ''}</div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '5px 12px', borderRadius: 20, background: `${estado.color}1A`, color: estado.color, fontWeight: 700, fontSize: 12 }}>
          {c.estado === 'pendiente' ? <Loader2 size={13} style={{ animation: 'spin .8s linear infinite' }} /> : valido ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {estado.label}
        </div>
        {!valido && c.sunat_descripcion && (
          <div style={{ ...S.error, textAlign: 'left' }}><AlertTriangle size={16} style={{ flexShrink: 0 }} /> {c.sunat_descripcion}</div>
        )}
      </div>

      <button style={S.primario(!c.enlace_ticket)} disabled={!c.enlace_ticket} onClick={() => abrir(c.enlace_ticket)}>
        <Printer size={17} /> Imprimir ticket
      </button>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button style={S.secundario} onClick={() => abrir(c.enlace_pdf)} disabled={!c.enlace_pdf}><FileText size={15} /> PDF A4</button>
        <button style={S.secundario} onClick={() => abrir(enlaceWhatsapp(c, celular))} disabled={!c.enlace_pdf}><Share2 size={15} /> WhatsApp</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button style={S.secundario} onClick={actualizar} disabled={consultando}>
          <RotateCw size={15} style={consultando ? { animation: 'spin .8s linear infinite' } : undefined} /> Estado SUNAT
        </button>
        <button style={S.secundario} onClick={onClose}>Listo</button>
      </div>
    </>
  )
}
