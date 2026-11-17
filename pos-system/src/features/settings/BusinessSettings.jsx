import { useState, useRef, useEffect } from 'react'
import { useBusiness, saveBusiness, DEFAULT_BUSINESS } from '@/services/businessConfig'
import { uploadPaymentQr } from '@/services/storage'
import { useAuth } from '@/features/auth/AuthContext'
import { DB } from '@/services/supabase'
import { handleImgError } from '@/utils/image'
import { AlertTriangle, Loader2, Save, Upload, RotateCw, Trash2 } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   AJUSTES → DATOS DEL NEGOCIO + QR DE YAPE
   ══════════════════════════════════════════════════════════════════
   Formulario de la fila compartida `negocio_config` (ver
   services/businessConfig.js). Lo que se guarda aquí es lo que imprimen
   los tickets y reportes, y lo que muestra el cobro por Yape en el admin
   y en la app del mesero.

   Validaciones: nombre obligatorio; RUC = 11 dígitos, DNI = 8 dígitos
   (o vacío — el ticket entonces omite la línea del documento).
══════════════════════════════════════════════════════════════════ */

const DOC_LEN = { RUC: 11, DNI: 8 }

const labelStyle = {
  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  textTransform: 'uppercase', color: 'var(--fog)', marginBottom: 4,
}
const inputStyle = {
  width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

// Estado de sincronización — deja claro si el cambio ya llegó a los meseros
// o quedó solo en este dispositivo (falta correr la migración).
export function SyncBadge({ synced }) {
  if (synced === true) {
    return <span style={badge('#16A34A')}>● Sincronizado con los meseros</span>
  }
  if (synced === false) {
    return <span style={{...badge('#D97706'), display:'inline-flex', alignItems:'center', gap:4}}><AlertTriangle size={10}/> Solo en este dispositivo</span>
  }
  return <span style={badge('var(--fog)')}>… verificando</span>
}
const badge = color => ({
  fontSize: 10, fontWeight: 700, color, background: 'rgba(148,163,184,.12)',
  padding: '3px 10px', borderRadius: 10, whiteSpace: 'nowrap',
})

export default function BusinessSettings() {
  const { business, synced } = useBusiness()
  const { user } = useAuth()

  const [form, setForm] = useState(() => toForm(business))
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState(null) // { ok, text }
  const [qrBusy, setQrBusy]     = useState(false)
  const fileRef = useRef(null)
  const msgTimer = useRef(null)

  // Si la configuración cambia desde otro dispositivo (Realtime) y el admin
  // no está editando nada, el formulario se refresca solo.
  const dirtyRef = useRef(false)
  useEffect(() => { if (!dirtyRef.current) setForm(toForm(business)) }, [business])
  useEffect(() => () => clearTimeout(msgTimer.current), [])

  function setField(key, val) {
    dirtyRef.current = true
    setForm(p => ({ ...p, [key]: val }))
    setMsg(null)
  }

  function flash(ok, text, ms = 5000) {
    setMsg({ ok, text })
    clearTimeout(msgTimer.current)
    msgTimer.current = setTimeout(() => setMsg(null), ms)
  }

  async function handleSave() {
    if (saving) return
    const nombre = form.nombre.trim()
    if (!nombre) { flash(false, 'El nombre del negocio es obligatorio'); return }

    const documento = form.documento.replace(/\s+/g, '')
    if (documento) {
      if (!/^\d+$/.test(documento)) { flash(false, `El ${form.tipoDocumento} solo debe tener números`); return }
      const need = DOC_LEN[form.tipoDocumento]
      if (documento.length !== need) { flash(false, `El ${form.tipoDocumento} debe tener ${need} dígitos (tiene ${documento.length})`); return }
    }

    const patch = {
      nombre,
      tipoDocumento: form.tipoDocumento,
      documento,
      direccion:     form.direccion.trim(),
      yapeNumero:    form.yapeNumero.trim(),
      yapeTitular:   form.yapeTitular.trim(),
    }

    setSaving(true)
    const { synced: ok, error } = await saveBusiness(patch, user?.name)
    setSaving(false)
    dirtyRef.current = false
    setForm(toForm({ ...business, ...patch })) // muestra los valores ya normalizados (sin espacios sobrantes)

    DB.logAudit({
      actorId: user?.uid, actorName: user?.name, action: 'business_config_update',
      entity: 'negocio_config', entityId: 1, detail: { campos: Object.keys(patch) },
    })

    if (ok) flash(true, '✓ Datos del negocio guardados — los tickets y los meseros ya usan los datos nuevos')
    else    flash(true, `✓ Guardado en este dispositivo. Aún no llega a los meseros: ${error}`, 9000)
  }

  async function handleQrFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setQrBusy(true)
    setMsg(null)
    try {
      const url = await uploadPaymentQr(file)
      const { synced: ok, error } = await saveBusiness({ yapeQrUrl: url }, user?.name)
      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'business_config_update',
        entity: 'negocio_config', entityId: 1, detail: { campos: ['yapeQrUrl'] },
      })
      if (ok) flash(true, '✓ QR de Yape actualizado')
      else    flash(true, `✓ QR guardado en este dispositivo. Aún no llega a los meseros: ${error}`, 9000)
    } catch (err) {
      flash(false, err?.message || 'No se pudo procesar la imagen del QR')
    } finally {
      setQrBusy(false)
    }
  }

  async function handleQrRemove() {
    if (!window.confirm('¿Quitar el QR de Yape? Al cobrar con Yape se mostrará solo el número y el titular.')) return
    setQrBusy(true)
    const { synced: ok, error } = await saveBusiness({ yapeQrUrl: null }, user?.name)
    DB.logAudit({
      actorId: user?.uid, actorName: user?.name, action: 'business_config_update',
      entity: 'negocio_config', entityId: 1, detail: { campos: ['yapeQrUrl'], quitado: true },
    })
    setQrBusy(false)
    if (ok) flash(true, '✓ QR de Yape quitado')
    else    flash(true, `✓ QR quitado en este dispositivo. Aún no llega a los meseros: ${error}`, 9000)
  }

  const docLen = DOC_LEN[form.tipoDocumento]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <SyncBadge synced={synced} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 12 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Nombre del negocio *</label>
          <input
            id="cfg-nombre" value={form.nombre} maxLength={60}
            onChange={e => setField('nombre', e.target.value)}
            placeholder={DEFAULT_BUSINESS.nombre} style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Tipo de documento</label>
          <select
            id="cfg-tipo-doc" value={form.tipoDocumento}
            onChange={e => setField('tipoDocumento', e.target.value)}
            style={inputStyle}
          >
            <option value="RUC">RUC (11 dígitos)</option>
            <option value="DNI">DNI (8 dígitos)</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>{form.tipoDocumento} del negocio</label>
          <input
            id="cfg-documento" value={form.documento} maxLength={docLen} inputMode="numeric"
            onChange={e => setField('documento', e.target.value.replace(/\D/g, ''))}
            placeholder={form.tipoDocumento === 'RUC' ? '10456789012' : '12345678'} style={inputStyle}
          />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Dirección (opcional — sale en el ticket)</label>
          <input
            id="cfg-direccion" value={form.direccion} maxLength={90}
            onChange={e => setField('direccion', e.target.value)}
            placeholder="Jr. Zepita #349 - Catacaos, Piura" style={inputStyle}
          />
        </div>

        <div>
          <label style={labelStyle}>Número de Yape</label>
          <input
            id="cfg-yape-num" value={form.yapeNumero} maxLength={20} inputMode="tel"
            onChange={e => setField('yapeNumero', e.target.value)}
            placeholder="982 936 262" style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Titular de Yape</label>
          <input
            id="cfg-yape-titular" value={form.yapeTitular} maxLength={60}
            onChange={e => setField('yapeTitular', e.target.value)}
            placeholder="Nombre del titular" style={inputStyle}
          />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <button
          onClick={handleSave} disabled={saving}
          style={{
            padding: '9px 20px', borderRadius: 'var(--r2)', border: 'none',
            background: saving ? 'var(--ink3)' : 'linear-gradient(135deg, #D97706, #B45309)',
            color: saving ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 12,
            cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: .3,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >{saving ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Guardando…</> : <><Save size={13}/> Guardar datos del negocio</>}</button>
      </div>

      {msg && (
        <div style={{
          marginTop: 8, padding: '8px 12px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
          background: msg.ok ? 'rgba(22,163,74,.10)' : 'rgba(220,38,38,.10)',
          border: `1px solid ${msg.ok ? 'rgba(22,163,74,.3)' : 'rgba(220,38,38,.3)'}`,
          color: msg.ok ? '#16A34A' : '#DC2626',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>{!msg.ok && <AlertTriangle size={13}/>}{msg.text}</div>
      )}

      {/* ── QR de Yape ─────────────────────────────────────────────── */}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>QR de Yape</div>
        <div style={{ fontSize: 11, color: 'var(--fog)', margin: '2px 0 12px', lineHeight: 1.5 }}>
          Sube la captura o imagen de tu QR de Yape. Se muestra al cobrar con Yape (panel admin y app del mesero)
          para que el cliente lo escanee. Usa la imagen original, sin recortar los bordes.
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{
            width: 140, height: 140, borderRadius: 12, background: '#fff', padding: 6,
            border: '1px solid var(--line2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, overflow: 'hidden',
          }}>
            {business.yapeQrUrl ? (
              <img
                src={business.yapeQrUrl} alt="QR de Yape" onError={handleImgError}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', lineHeight: 1.4 }}>
                Sin QR<br />cargado
              </span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              id="cfg-qr-file" ref={fileRef} type="file" accept="image/*"
              onChange={handleQrFile} style={{ display: 'none' }}
            />
            <button
              onClick={() => fileRef.current?.click()} disabled={qrBusy}
              style={{
                padding: '9px 18px', borderRadius: 'var(--r2)', border: '1px solid var(--line2)',
                background: 'var(--ink3)', color: 'var(--snow)', fontWeight: 700, fontSize: 12,
                cursor: qrBusy ? 'not-allowed' : 'pointer', opacity: qrBusy ? .6 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >{qrBusy ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Procesando…</> : business.yapeQrUrl ? <><RotateCw size={13}/> Reemplazar QR</> : <><Upload size={13}/> Subir QR</>}</button>
            {business.yapeQrUrl && (
              <button
                onClick={handleQrRemove} disabled={qrBusy}
                style={{
                  padding: '7px 18px', borderRadius: 'var(--r2)', border: '1px solid rgba(220,38,38,.35)',
                  background: 'transparent', color: '#DC2626', fontWeight: 700, fontSize: 11,
                  cursor: qrBusy ? 'not-allowed' : 'pointer', opacity: qrBusy ? .6 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                }}
              ><Trash2 size={12}/> Quitar QR</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function toForm(b) {
  return {
    nombre:        b.nombre || '',
    tipoDocumento: b.tipoDocumento === 'DNI' ? 'DNI' : 'RUC',
    documento:     b.documento || '',
    direccion:     b.direccion || '',
    yapeNumero:    b.yapeNumero || '',
    yapeTitular:   b.yapeTitular || '',
  }
}
