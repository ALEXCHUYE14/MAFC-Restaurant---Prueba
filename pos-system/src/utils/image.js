// ── Compresión de imágenes subidas desde el AdminDashboard ────────────────────
// Convierte un archivo de imagen a un data-URI JPEG comprimido y redimensionado,
// para poder guardarlo directamente en la columna `img_url` de `inventory` sin
// necesitar un bucket de almacenamiento externo. Pensado para fotos de platos
// (no fotos de alta resolución), así el payload de Realtime se mantiene liviano.

const MAX_RAW_BYTES = 12 * 1024 * 1024 // 12MB — límite antes de intentar procesar

// ── Placeholder — se muestra cuando una imagen (URL rota, data-URI corrupto,
// sin conexión, etc.) falla al cargar, para nunca dejar un hueco roto en el
// diseño. Inline SVG en data-URI: no depende de red ni de archivos estáticos.
export const IMG_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" fill="#334155"/>
    <g fill="none" stroke="#94A3B8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="40" r="16"/>
      <path d="M22 82c0-15 12-27 28-27s28 12 28 27"/>
    </g>
  </svg>`
)

// Handler reutilizable para <img onError>: evita loops infinitos si el
// placeholder también fallara por alguna razón excepcional.
export function handleImgError(e) {
  const el = e?.currentTarget || e?.target
  if (!el || el.src === IMG_PLACEHOLDER) return
  el.src = IMG_PLACEHOLDER
}

// ── Núcleo compartido — valida, redimensiona y dibuja en un <canvas>.
// Tanto compressImageToDataUrl (legado / respaldo) como compressImageToBlob
// (usado para subir a Supabase Storage) parten de este mismo canvas, para
// no duplicar la lógica de validación/redimensión en dos lugares.
// `fill` (opcional): color de fondo que se pinta ANTES de la imagen. Sin él
// (fotos de platos, comportamiento de siempre) un PNG con transparencia se
// convierte a JPEG con fondo negro; el QR de pagos lo usa con '#FFFFFF' para
// que nunca quede negro sobre negro y siga siendo escaneable.
function drawToCanvas(file, { maxDim = 640, fill = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No se seleccionó ningún archivo'))
    if (!file.type || !file.type.startsWith('image/')) {
      return reject(new Error('El archivo debe ser una imagen (JPG, PNG, WEBP…)'))
    }
    if (file.size > MAX_RAW_BYTES) {
      return reject(new Error('La imagen es demasiado grande (máx. 12MB)'))
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('El archivo no es una imagen válida'))
      img.onload = () => {
        try {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
          const w = Math.max(1, Math.round(img.width * scale))
          const h = Math.max(1, Math.round(img.height * scale))

          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) return reject(new Error('No se pudo procesar la imagen en este navegador'))
          if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, w, h) }
          ctx.drawImage(img, 0, 0, w, h)
          resolve(canvas)
        } catch (err) {
          reject(err instanceof Error ? err : new Error('Error inesperado al procesar la imagen'))
        }
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

export async function compressImageToDataUrl(file, opts = {}) {
  const canvas = await drawToCanvas(file, opts)
  const dataUrl = canvas.toDataURL('image/jpeg', opts.quality ?? 0.72)
  if (!dataUrl || dataUrl === 'data:,') throw new Error('No se pudo comprimir la imagen')
  return dataUrl
}

// Igual que compressImageToDataUrl pero devuelve un Blob binario — para
// subir a Supabase Storage (uploadDishImage en services/storage.js) en vez
// de guardar el base64 (~33% más pesado) directo en una columna de la fila.
export function compressImageToBlob(file, opts = {}) {
  return drawToCanvas(file, opts).then(canvas => new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen')),
      'image/jpeg',
      opts.quality ?? 0.72
    )
  }))
}
