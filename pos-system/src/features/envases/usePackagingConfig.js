import { useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'
import { fetchPackagingConfig } from '@/utils/packaging'

/* Configuración de envases (precio fijo + activo), compartida por el POS,
   Externos y Ajustes. null = migracion-envases.sql no ejecutada o sin
   conexión → la opción de envases no se muestra (nada se rompe). */
let _cfg = null
let _loaded = false
let _loading = null
const _listeners = new Set()

export async function reloadPackagingConfig() {
  if (_loading) return _loading
  _loading = (async () => {
    _cfg = await fetchPackagingConfig(supabase)
    _loaded = true
    _listeners.forEach(fn => { try { fn(_cfg) } catch (_) { /* nada */ } })
    return _cfg
  })()
  try { return await _loading } finally { _loading = null }
}

export function usePackagingConfig() {
  const [cfg, setCfg] = useState(_cfg)
  useEffect(() => {
    _listeners.add(setCfg)
    if (!_loaded) reloadPackagingConfig().catch(() => {})
    else setCfg(_cfg)
    // Al volver a la pestaña se relee (por si el precio cambió en otro equipo)
    const onVis = () => { if (document.visibilityState === 'visible') reloadPackagingConfig().catch(() => {}) }
    document.addEventListener('visibilitychange', onVis)
    return () => { _listeners.delete(setCfg); document.removeEventListener('visibilitychange', onVis) }
  }, [])
  return cfg
}
