import { defineConfig, devices } from '@playwright/test'

// ══════════════════════════════════════════════════════════════════
// Playwright — tests de humo (smoke tests)
// ══════════════════════════════════════════════════════════════════
// Objetivo deliberadamente acotado: NO probar flujos de negocio contra
// Supabase real (enviar comanda, cobrar, cerrar caja) — no hay entorno
// de staging separado de producción, así que un test que escriba datos
// terminaría escribiendo en el sistema real del local.
//
// En cambio, estos tests atrapan la clase de bug más común y más
// costosa de este proyecto (por experiencia real del equipo): un error
// de sintaxis o de import que rompe TODA una pantalla a blanco. Cada
// push corre esto automáticamente vía GitHub Actions — antes esa
// verificación se hacía a mano con scripts de Playwright improvisados
// en cada sesión de cambios; ahora queda repetible y permanente.
//
// webServer levanta `vite preview` (sirve dist/, tal cual queda en
// producción) antes de correr los tests, y lo apaga al terminar.
// ══════════════════════════════════════════════════════════════════
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run preview -- --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
