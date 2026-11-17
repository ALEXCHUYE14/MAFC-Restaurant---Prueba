// ── Credenciales públicas de Supabase (ÚNICA fuente de verdad) ────────────────
// Todas las apps (admin, carta, cocina, mesero, encuesta y el service worker del
// mesero) leen la URL y la clave desde aquí. Para cambiar de proyecto basta con
// editar este archivo y volver a compilar.
//
// Son valores PÚBLICOS por diseño: la "publishable key" (sb_publishable_...)
// viaja al navegador y la seguridad real la imponen las políticas RLS de la base.
// NUNCA pongas aquí una "secret key" (sb_secret_...) ni la service_role key.
//
// Se dejan fijas (no import.meta.env) a propósito, para que Vercel no inyecte
// valores de otro proyecto.

export const SUPABASE_URL = 'https://fvzosidupnnjowbbipbo.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_u82usmbbi_ZAnlQiMqyIUw_cb_67xzb'

// Defensa: si alguien pega por error una clave secreta, se aborta en vez de
// exponerla a todos los navegadores.
if (/^sb_secret_/i.test(SUPABASE_KEY)) {
  throw new Error('[Supabase] Configuración inválida: nunca uses una clave secreta en el frontend.')
}
