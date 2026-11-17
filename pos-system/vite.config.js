import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { resolve } from 'path'

// Copia ../img/ (fuera de pos-system/) en public/img/ para que las fotos
// del menú estático estén disponibles en /img/ tanto en dev como en build.
function syncParentImg() {
  const copyDir = (src, dest) => {
    if (!existsSync(src)) return
    mkdirSync(dest, { recursive: true })
    for (const f of readdirSync(src, { withFileTypes: true })) {
      const srcPath  = resolve(src, f.name)
      const destPath = resolve(dest, f.name)
      if (f.isDirectory()) copyDir(srcPath, destPath)
      else try { copyFileSync(srcPath, destPath) } catch (_) {}
    }
  }
  const sync = () => copyDir(resolve(__dirname, '../img'), resolve(__dirname, 'public/img'))
  return {
    name: 'sync-parent-img',
    buildStart: sync,
    configureServer: sync,
  }
}

export default defineConfig({
  plugins: [react(), syncParentImg()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  build: {
    rollupOptions: {
      // Multi-página: mesero.html y cocina.html eran archivos estáticos en
      // public/ que Babel-Standalone transpilaba EN EL NAVEGADOR en cada
      // carga (lento, sin minificar, sin cache-busting real). Ahora son
      // entradas de build como cualquier otra — compiladas, minificadas y
      // versionadas igual que el panel admin, sirviendo exactamente el
      // mismo código (ver src-apps/mesero|cocina/main.jsx).
      input: {
        main:   resolve(__dirname, 'index.html'),
        mesero: resolve(__dirname, 'mesero.html'),
        cocina: resolve(__dirname, 'cocina.html'),
        carta:  resolve(__dirname, 'carta.html'), // carta digital pública (QR)
        encuesta: resolve(__dirname, 'encuesta.html'), // encuesta de satisfacción (enlace por WhatsApp)
      },
    },
  },
})
