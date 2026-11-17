import { supabase } from './supabase'
import { compressImageToBlob, compressImageToDataUrl } from '@/utils/image'

/* ══════════════════════════════════════════════════════════════════
   STORAGE — fotos de platos en Supabase Storage (no en la fila)
   ══════════════════════════════════════════════════════════════════
   Antes, cada foto comprimida se guardaba como data-URI base64 directo
   en la columna img_url de `inventory`/`menu_items`. Eso infla cada
   SELECT * y cada payload de Realtime de esas tablas — la causa raíz
   del bug de imágenes que se parchó una vez (Supabase omite columnas
   TOAST grandes en los eventos UPDATE de Realtime).

   Ahora la foto comprimida se sube como archivo real al bucket público
   "menu-images" y solo se guarda su URL (un string corto) en la fila —
   payload liviano, y el navegador cachea la imagen como cualquier
   imagen normal (antes, al ser un data-URI embebido en el JSON, nunca
   se beneficiaba de caché HTTP).

   DEGRADACIÓN SEGURA: si el bucket todavía no existe (la migración
   migracion-storage-imagenes.sql no se ha corrido) o la subida falla
   por cualquier motivo, cae automáticamente al data-URI de siempre
   (compressImageToDataUrl) — subir una foto NUNCA se rompe por esto.
══════════════════════════════════════════════════════════════════ */

const BUCKET = 'menu-images'

// idHint: el id del plato (o 'nuevo' si aún no existe) — solo se usa
// para nombrar el archivo, no tiene que ser único de por vida porque
// cada subida agrega un timestamp.
export async function uploadDishImage(file, idHint = 'plato') {
  if (!supabase) return compressImageToDataUrl(file)

  try {
    const blob = await compressImageToBlob(file)
    const safeId = String(idHint).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'plato'
    const path = `${safeId}-${Date.now()}.jpg`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000', // 1 año — el nombre de archivo ya cambia en cada subida
      upsert: true,
    })
    if (upErr) throw upErr

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    if (!data?.publicUrl) throw new Error('No se obtuvo URL pública del archivo subido')
    return data.publicUrl
  } catch (e) {
    console.warn('[Storage] Subida a bucket falló — usando data-URI de respaldo:', e.message)
    return compressImageToDataUrl(file)
  }
}

// QR de pago (Yape) — mismo bucket y mismas políticas que las fotos de platos
// (solo admin sube; lectura pública). Diferencias con una foto de plato: se
// conserva más resolución/calidad (un QR comprimido de más deja de
// escanearse) y se rellena fondo blanco (ver `fill` en utils/image.js).
// Misma degradación segura: si el bucket no existe, cae al data-URI.
const QR_OPTS = { maxDim: 900, quality: 0.95, fill: '#FFFFFF' }

export async function uploadPaymentQr(file) {
  if (!supabase) return compressImageToDataUrl(file, QR_OPTS)

  try {
    const blob = await compressImageToBlob(file, QR_OPTS)
    const path = `qr-yape-${Date.now()}.jpg`

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: true,
    })
    if (upErr) throw upErr

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
    if (!data?.publicUrl) throw new Error('No se obtuvo URL pública del archivo subido')
    return data.publicUrl
  } catch (e) {
    console.warn('[Storage] Subida del QR al bucket falló — usando data-URI de respaldo:', e.message)
    return compressImageToDataUrl(file, QR_OPTS)
  }
}
