import { useEffect, useState } from 'react'
import { useBusiness } from '@/services/businessConfig'
import { useInventory } from '@/features/inventory/InventoryContext'
import { escHtml } from '@/utils/print'
import { QrCode, Copy, Check, ExternalLink, Download, Printer, AlertTriangle, Loader2 } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   AJUSTES → CARTA DIGITAL Y QR
   ══════════════════════════════════════════════════════════════════
   La carta (carta.html) es una página pública de SOLO LECTURA que muestra
   lo que se registra en Stock. Aquí se obtiene su enlace y su código QR
   para imprimir y poner en las mesas.

   El enlace se arma con el dominio desde el que se abre el panel. Si el
   admin está en un entorno local (localhost / IP de red), el QR apuntaría
   a una dirección que el teléfono del cliente no puede abrir — se avisa
   con claridad en vez de generar un QR inútil sin decir nada.
══════════════════════════════════════════════════════════════════ */

const isLocalHost = h =>
  h === 'localhost' || h === '127.0.0.1' || h === '[::1]' ||
  /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)

const btn = (variant) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '9px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  border: variant === 'primary' ? '1px solid var(--amber)' : '1px solid var(--line2)',
  background: variant === 'primary' ? 'var(--amber)' : 'transparent',
  color: variant === 'primary' ? '#fff' : 'var(--snow)',
  transition: 'opacity .15s',
})

export default function DigitalMenuSettings() {
  const { business } = useBusiness()
  // Solo los platos del catálogo dinámico (menu_items) — es lo que muestra la carta
  const { effectiveMenu = [] } = useInventory() || {}
  const menuItems = effectiveMenu.filter(m => m.source === 'custom')
  const url = `${window.location.origin}/carta.html`
  const local = isLocalHost(window.location.hostname)

  const [qr, setQr]         = useState(null)   // data-URL PNG
  const [qrError, setQrErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [msg, setMsg]       = useState('')

  // La librería de QR se carga solo al abrir Ajustes (no pesa en el resto del panel)
  useEffect(() => {
    let alive = true
    import('qrcode')
      .then(mod => (mod.default || mod).toDataURL(url, {
        errorCorrectionLevel: 'M', margin: 2, width: 1024,
        color: { dark: '#111111', light: '#FFFFFF' },
      }))
      .then(dataUrl => { if (alive) setQr(dataUrl) })
      .catch(e => { if (alive) setQrErr(e?.message || 'No se pudo generar el código QR') })
    return () => { alive = false }
  }, [url])

  const flash = text => { setMsg(text); setTimeout(() => setMsg(''), 3500) }

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url)
      else {
        const ta = document.createElement('textarea')
        ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('copy')
      }
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {
      flash('No se pudo copiar automáticamente. Copia el enlace manualmente.')
    }
  }

  function handleDownload() {
    if (!qr) return
    const a = document.createElement('a')
    a.href = qr
    const slug = String(business.nombre || 'carta').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'carta'
    a.download = `qr-carta-${slug}.png`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  function handlePrint() {
    if (!qr) return
    const win = window.open('', '_blank', 'width=720,height=900')
    if (!win) { flash('El navegador bloqueó la ventana. Permite ventanas emergentes para imprimir.'); return }
    const name = escHtml(business.nombre || '')
    const addr = escHtml(business.direccion || '')
    win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>QR Carta · ${name}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Outfit:wght@400;600&display=swap" rel="stylesheet">
<style>
  @page { size: A5 portrait; margin: 12mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Outfit', system-ui, sans-serif; color: #1C1917; display: flex; justify-content: center; }
  .card { width: 100%; max-width: 420px; text-align: center; padding: 28px 24px; border: 2px solid #1C1917; border-radius: 22px; }
  .eyebrow { font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: #B45309; font-weight: 600; }
  h1 { font-family: 'Fraunces', Georgia, serif; font-size: 30px; line-height: 1.1; margin: 8px 0 4px; overflow-wrap: anywhere; }
  .addr { font-size: 12px; color: #57534E; }
  .qr { width: 78%; margin: 22px auto 16px; display: block; }
  .cta { font-family: 'Fraunces', Georgia, serif; font-size: 22px; font-weight: 600; }
  .sub { font-size: 12.5px; color: #57534E; margin-top: 6px; }
  .url { font-size: 10.5px; color: #78716C; margin-top: 16px; word-break: break-all; }
</style></head><body>
<div class="card">
  <div class="eyebrow">Carta digital</div>
  <h1>${name}</h1>
  ${addr ? `<div class="addr">${addr}</div>` : ''}
  <img class="qr" src="${qr}" alt="Código QR de la carta">
  <div class="cta">Escanea y mira nuestra carta</div>
  <div class="sub">Abre la cámara de tu celular y apunta al código</div>
  <div class="url">${escHtml(url)}</div>
</div>
<script>
  // Imprime cuando la imagen y las fuentes están listas (o a los 2 s como máximo)
  var done = false;
  function go(){ if (done) return; done = true; window.focus(); window.print(); }
  var img = document.querySelector('.qr');
  Promise.all([
    img.complete ? Promise.resolve() : new Promise(function(r){ img.onload = r; img.onerror = r; }),
    document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()
  ]).then(go);
  setTimeout(go, 2000);
<\/script>
</body></html>`)
    win.document.close()
  }

  const visibleCount = menuItems.length
  const availableCount = menuItems.filter(m => m.available !== false && !(m.stock !== null && m.stock !== undefined && m.stock <= 0)).length

  return (
    <div>
      <p style={{ fontSize: 12, color: 'var(--fog)', lineHeight: 1.55, marginBottom: 14 }}>
        Tus clientes escanean este código y ven la carta con los platos, bebidas y tragos de <strong>Stock</strong>,
        con fotos y precios siempre actualizados. Es solo para ver: el pedido lo sigue tomando el mesero.
      </p>

      {local && (
        <div style={{
          display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, marginBottom: 14,
          background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)', color: '#B45309', fontSize: 12, lineHeight: 1.5,
        }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Estás usando el panel en un entorno local (<strong>{window.location.host}</strong>). Este QR solo funciona en tu red.
            Para imprimir el QR definitivo, abre este panel desde el dominio publicado del sistema.</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{
          width: 168, height: 168, flexShrink: 0, borderRadius: 14, background: '#fff',
          border: '1px solid var(--line2)', display: 'grid', placeItems: 'center', overflow: 'hidden',
        }}>
          {qr
            ? <img src={qr} alt="Código QR de la carta digital" style={{ width: '100%', height: '100%' }} />
            : qrError
              ? <span style={{ fontSize: 11, color: 'var(--crimson)', padding: 10, textAlign: 'center' }}>{qrError}</span>
              : <Loader2 size={22} className="anim-spin" style={{ color: 'var(--fog)' }} />}
        </div>

        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: 'var(--fog)', textTransform: 'uppercase', marginBottom: 6 }}>
            Enlace de la carta
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderRadius: 10,
            background: 'var(--ink3)', border: '1px solid var(--line2)', marginBottom: 10,
          }}>
            <QrCode size={14} style={{ color: 'var(--fog)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontFamily: 'var(--mono, monospace)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
              {url}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={handleCopy} style={btn()}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar enlace'}
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" style={{ ...btn(), textDecoration: 'none' }}>
              <ExternalLink size={14} /> Ver carta
            </a>
            <button type="button" onClick={handleDownload} disabled={!qr} style={{ ...btn(), opacity: qr ? 1 : .5 }}>
              <Download size={14} /> Descargar QR
            </button>
            <button type="button" onClick={handlePrint} disabled={!qr} style={{ ...btn('primary'), opacity: qr ? 1 : .5 }}>
              <Printer size={14} /> Imprimir cartel
            </button>
          </div>

          <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 10 }}>
            {visibleCount} {visibleCount === 1 ? 'producto' : 'productos'} en Stock · {availableCount} disponibles · los agotados se muestran como “Agotado”
          </div>
          {msg && <div style={{ fontSize: 11, color: 'var(--crimson)', marginTop: 6 }}>{msg}</div>}
        </div>
      </div>
    </div>
  )
}
