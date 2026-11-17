import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { useBusiness } from '@/services/businessConfig'
import { useInventory } from './InventoryContext'
import {
  exportStockBackup, readStockBackup, loadCurrentStock, planStockImport, applyStockImport,
} from '@/services/stockBackup'
import {
  X, Download, Upload, Loader2, CheckCircle2, AlertTriangle, PackagePlus, RefreshCw,
  Equal, Image as ImageIcon, ShieldCheck, Archive,
} from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   STOCK → RESPALDO (exportar / importar .zip con productos e imágenes)
   Toda la lógica y las validaciones viven en services/stockBackup.js;
   aquí solo se guía al admin: elegir → (importar) vista previa → aplicar.
   Mientras una operación está en curso la ventana no se puede cerrar,
   para no dejar un import a medio camino por un toque accidental.
══════════════════════════════════════════════════════════════════ */

const fmtBytes = n => n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`

export default function StockBackupModal({ onClose }) {
  const { user } = useAuth()
  const { business } = useBusiness()
  const { refreshMenuItems } = useInventory()
  const actor = useMemo(() => ({ uid: user?.uid, name: user?.name }), [user])

  // phase: menu | working | preview | done | error
  const [phase, setPhase]       = useState('menu')
  const [progress, setProgress] = useState({ step: '', done: 0, total: 0 })
  const [error, setError]       = useState('')
  const [result, setResult]     = useState(null)
  const [backup, setBackup]     = useState(null)   // readStockBackup()
  const [current, setCurrent]   = useState(null)   // Map id → fila actual
  const [restoreStock, setRestoreStock] = useState(false) // Opción A por defecto
  const [confirmed, setConfirmed] = useState(false)
  const fileRef = useRef(null)
  const busy = phase === 'working'

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const plan = useMemo(
    () => (backup && current ? planStockImport(backup.items, current, { restoreStock }) : null),
    [backup, current, restoreStock],
  )

  const run = async (fn) => {
    setError(''); setPhase('working'); setProgress({ step: 'Preparando…', done: 0, total: 0 })
    try { await fn() }
    catch (e) { setError(e?.message || 'Ocurrió un error inesperado.'); setPhase('error') }
  }

  const handleExport = () => run(async () => {
    const r = await exportStockBackup({ businessName: business?.nombre, actor, onProgress: setProgress })
    setResult({ kind: 'export', ...r })
    setPhase('done')
  })

  const handleFile = e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      const b = await readStockBackup(file, { onProgress: setProgress })
      setProgress({ step: 'Comparando con el Stock actual…', done: 0, total: 0 })
      const cur = await loadCurrentStock()
      setBackup(b); setCurrent(cur); setConfirmed(false); setRestoreStock(false)
      setPhase('preview')
    })
  }

  const handleApply = () => {
    if (!plan) return
    run(async () => {
      const r = await applyStockImport(plan, current, { restoreStock, actor, onProgress: setProgress })
      await refreshMenuItems()
      setResult({ kind: 'import', ...r })
      setPhase('done')
    })
  }

  const toWrite = plan ? plan.create.length + plan.update.length : 0
  const imgCount = backup ? backup.items.filter(i => i.imageBytes).length : 0
  const imgMissing = backup ? backup.items.filter(i => i.imageMissing).length : 0

  const btn = (variant = 'ghost') => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '10px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: 'pointer',
    border: variant === 'primary' ? 'none' : '1px solid var(--line2)',
    background: variant === 'primary' ? 'linear-gradient(135deg, var(--amber), var(--amber2))' : 'transparent',
    color: variant === 'primary' ? '#fff' : 'var(--snow)',
  })
  const stat = (icon, label, val, color) => (
    <div style={{ flex: '1 1 90px', background: 'var(--ink3)', border: '1px solid var(--line)', borderRadius: 10, padding: '10px', textAlign: 'center' }}>
      <div style={{ color, display: 'flex', justifyContent: 'center', marginBottom: 4 }}>{icon}</div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 22, color, lineHeight: 1 }}>{val}</div>
      <div style={{ fontSize: 9.5, color: 'var(--fog)', marginTop: 3, letterSpacing: .4 }}>{label}</div>
    </div>
  )

  return (
    <div onClick={() => { if (!busy) onClose() }} style={{
      position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Respaldo de Stock" style={{
        width: '100%', maxWidth: 480, maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        background: 'var(--ink1)', border: '1px solid var(--line2)', borderRadius: 16,
        boxShadow: '0 20px 50px rgba(0,0,0,.3)', overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <Archive size={18} color="var(--amber)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--snow)' }}>Respaldo de Stock</div>
            <div style={{ fontSize: 11, color: 'var(--fog)' }}>Productos e imágenes en un archivo .zip</div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Cerrar" style={{ background: 'none', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', color: 'var(--fog)', opacity: busy ? .4 : 1 }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          <input ref={fileRef} type="file" accept=".zip,application/zip" onChange={handleFile} style={{ display: 'none' }} />

          {phase === 'menu' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <button onClick={handleExport} style={{ ...cardBtn }}>
                <Download size={20} color="var(--amber)" />
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <strong style={{ display: 'block', fontSize: 14, color: 'var(--snow)' }}>Exportar respaldo</strong>
                  <span style={{ fontSize: 11.5, color: 'var(--fog)' }}>Descarga todos los productos con sus imágenes. Solo lee, no cambia nada.</span>
                </span>
              </button>
              <button onClick={() => fileRef.current && fileRef.current.click()} style={{ ...cardBtn }}>
                <Upload size={20} color="var(--sapphire, #2563EB)" />
                <span style={{ flex: 1, textAlign: 'left' }}>
                  <strong style={{ display: 'block', fontSize: 14, color: 'var(--snow)' }}>Importar respaldo</strong>
                  <span style={{ fontSize: 11.5, color: 'var(--fog)' }}>Elige un .zip exportado. Verás una vista previa antes de aplicar.</span>
                </span>
              </button>
              <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--fog)', lineHeight: 1.5 }}>
                <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 1, color: '#16A34A' }} />
                <span>Importar nunca borra productos y conserva el identificador de cada uno, así las mesas abiertas y los QR de la carta siguen funcionando.</span>
              </div>
            </div>
          )}

          {phase === 'working' && (
            <div style={{ textAlign: 'center', padding: '24px 6px' }}>
              <Loader2 size={30} className="anim-spin" color="var(--amber)" />
              <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--snow)', marginTop: 12 }}>{progress.step}</div>
              {progress.total > 0 && (
                <>
                  <div style={{ height: 6, borderRadius: 6, background: 'var(--ink3)', marginTop: 14, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((progress.done / progress.total) * 100)}%`, background: 'var(--amber)', transition: 'width .2s' }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 6 }}>{progress.done} de {progress.total}</div>
                </>
              )}
              <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 14 }}>No cierres esta ventana.</div>
            </div>
          )}

          {phase === 'preview' && plan && backup && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--mist)', marginBottom: 12, lineHeight: 1.5 }}>
                Respaldo {backup.business ? <>de <strong>{backup.business}</strong> </> : ''}
                {backup.exportedAt ? <>del <strong>{new Date(backup.exportedAt).toLocaleString('es-PE')}</strong></> : ''} · {backup.items.length} productos
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                {stat(<PackagePlus size={16} />, 'NUEVOS', plan.create.length, '#16A34A')}
                {stat(<RefreshCw size={16} />, 'SE ACTUALIZAN', plan.update.length, '#D97706')}
                {stat(<Equal size={16} />, 'SIN CAMBIOS', plan.same.length, 'var(--fog)')}
                {stat(<ImageIcon size={16} />, 'IMÁGENES', imgCount, 'var(--sapphire, #2563EB)')}
              </div>

              <label style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px', borderRadius: 10, cursor: 'pointer',
                border: '1px solid var(--line2)', background: 'var(--ink3)', marginBottom: 10,
              }}>
                <input type="checkbox" checked={!restoreStock} onChange={e => setRestoreStock(!e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--amber)' }} />
                <span>
                  <strong style={{ fontSize: 12.5, color: 'var(--snow)', display: 'block' }}>Conservar stock y disponibilidad actuales (recomendado)</strong>
                  <span style={{ fontSize: 11, color: 'var(--fog)', lineHeight: 1.5 }}>
                    Solo se restauran nombre, categoría, precio, descripción y foto. Desmárcalo para restaurar también las cantidades del respaldo.
                    Los productos nuevos siempre toman las del respaldo.
                  </span>
                </span>
              </label>

              {imgMissing > 0 && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: '#D97706', marginBottom: 10 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{imgMissing} {imgMissing === 1 ? 'producto no trae' : 'productos no traen'} su imagen en el .zip: conservarán la imagen que tengan hoy.</span>
                </div>
              )}

              {toWrite === 0 ? (
                <div style={{ display: 'flex', gap: 8, fontSize: 12, color: '#16A34A' }}>
                  <CheckCircle2 size={15} style={{ flexShrink: 0 }} /> Tu Stock ya coincide con este respaldo. No hay nada que aplicar.
                </div>
              ) : (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--snow)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} style={{ accentColor: 'var(--amber)' }} />
                  Revisé el resumen y quiero aplicar {toWrite} {toWrite === 1 ? 'cambio' : 'cambios'}.
                </label>
              )}
            </div>
          )}

          {phase === 'done' && result && (
            <div style={{ textAlign: 'center', padding: '14px 4px' }}>
              <CheckCircle2 size={38} color="#16A34A" />
              {result.kind === 'export' ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--snow)', marginTop: 10 }}>Respaldo descargado</div>
                  <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 6, lineHeight: 1.6 }}>
                    {result.count} productos · {result.images} imágenes · {fmtBytes(result.bytes)}<br />
                    Guárdalo en un lugar seguro (Drive, USB o correo).
                  </div>
                  {result.missing.length > 0 && (
                    <div style={{ fontSize: 11.5, color: '#D97706', marginTop: 10 }}>
                      Sin imagen descargable: {result.missing.join(', ')}. Sus datos sí están en el respaldo.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--snow)', marginTop: 10 }}>Respaldo importado</div>
                  <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 6, lineHeight: 1.6 }}>
                    {result.created} nuevos · {result.updated} actualizados · {result.same} sin cambios · {result.uploaded} imágenes subidas
                  </div>
                  {result.imageErrors.length > 0 && (
                    <div style={{ fontSize: 11.5, color: '#D97706', marginTop: 10 }}>
                      No se pudo subir la imagen de: {result.imageErrors.join(', ')}. Conservan su imagen anterior.
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div style={{ textAlign: 'center', padding: '14px 4px' }}>
              <AlertTriangle size={36} color="#DC2626" />
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--snow)', marginTop: 10 }}>No se completó la operación</div>
              <div style={{ fontSize: 12, color: 'var(--mist)', marginTop: 6, lineHeight: 1.6 }}>{error}</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
          {phase === 'preview' && (
            <>
              <button onClick={() => { setBackup(null); setCurrent(null); setPhase('menu') }} style={btn()}>Cancelar</button>
              <button onClick={handleApply} disabled={!toWrite || !confirmed}
                style={{ ...btn('primary'), opacity: toWrite && confirmed ? 1 : .5, cursor: toWrite && confirmed ? 'pointer' : 'not-allowed' }}>
                <Upload size={15} /> Aplicar respaldo
              </button>
            </>
          )}
          {(phase === 'done' || phase === 'error') && (
            <>
              <button onClick={() => { setBackup(null); setCurrent(null); setResult(null); setError(''); setPhase('menu') }} style={btn()}>Volver</button>
              <button onClick={onClose} style={btn('primary')}>Listo</button>
            </>
          )}
          {phase === 'menu' && <button onClick={onClose} style={btn()}>Cerrar</button>}
        </div>
      </div>
    </div>
  )
}

const cardBtn = {
  display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '14px',
  borderRadius: 12, border: '1px solid var(--line2)', background: 'var(--ink3)', cursor: 'pointer',
}
