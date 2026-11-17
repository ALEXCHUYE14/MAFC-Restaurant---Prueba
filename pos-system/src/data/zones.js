// ── Zonas del local ───────────────────────────────────────────────────────────
// Las 30 mesas originales se reparten por rangos (1-12 Salón Principal,
// 13-22 Terraza, 23-30 Privados). Las mesas agregadas desde Ajustes traen su
// zona en la columna `mesas.zona`. Esto es lo ÚNICO que decide a qué zona
// pertenece una mesa — el panel admin (TableGrid, Ajustes) y, con la misma
// regla, mesero.html (src-apps/mesero/main.jsx → defaultZoneOf).

export const DEFAULT_ZONE_NAMES = ['Salón Principal', 'Terraza', 'Privados']

// Zona de una mesa que NO trae `zona` guardada (las 30 originales)
export function defaultZoneOf(n) {
  if (n <= 12) return 'Salón Principal'
  if (n <= 22) return 'Terraza'
  if (n <= 30) return 'Privados'
  return 'Salón Principal' // mesa nueva sin zona (no debería pasar: Ajustes siempre la pide)
}

// [{ name, tables: [números] }] — las zonas de siempre primero y en su orden,
// luego las zonas nuevas por orden de aparición. Una zona sin mesas no se lista.
export function groupTablesByZone(tables) {
  const byZone = new Map()
  for (const t of tables || []) {
    const name = (t.zone || defaultZoneOf(t.number)).trim() || 'Salón Principal'
    if (!byZone.has(name)) byZone.set(name, [])
    byZone.get(name).push(t.number)
  }
  const ordered = [
    ...DEFAULT_ZONE_NAMES.filter(n => byZone.has(n)),
    ...[...byZone.keys()].filter(n => !DEFAULT_ZONE_NAMES.includes(n)),
  ]
  return ordered.map(name => ({ name, tables: byZone.get(name).sort((a, b) => a - b) }))
}
