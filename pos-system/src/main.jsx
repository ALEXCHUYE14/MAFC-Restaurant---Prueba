import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { initMonitoring } from '@/services/monitoring'

// No-op si VITE_SENTRY_DSN no está configurado — ver services/monitoring.js
initMonitoring()

// Desregistrar el SW de mesero.html si tiene scope '/' y está bloqueando el panel admin.
// En modo incógnito no hay SW previo — esto asegura el mismo comportamiento en navegador normal.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(regs => {
    regs.forEach(reg => {
      const rootScope = `${location.origin}/`
      if (reg.scope === rootScope) {
        reg.unregister()
      }
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
