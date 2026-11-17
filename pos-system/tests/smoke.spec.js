import { test, expect } from '@playwright/test'

/* ══════════════════════════════════════════════════════════════════
   SMOKE TESTS — red mínima antes de crecer el equipo
   ══════════════════════════════════════════════════════════════════
   No prueban flujos de negocio contra Supabase real (sin entorno de
   staging separado, escribir ahí sería escribir en el sistema del
   local real). Lo que SÍ atrapan, en cada push:
     - Un error de sintaxis o de import que rompe una pantalla a blanco.
     - Una excepción de render no capturada (pageerror).
     - Que el elemento de entrada esperado de cada superficie exista.
   ══════════════════════════════════════════════════════════════════ */

// Recolecta errores de consola/página en cualquier test que la use —
// centraliza el patrón "cero errores de JS" que se repite en las 5 rutas.
function collectErrors(page) {
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message))
  return errors
}

test.describe('Selector de rol', () => {
  test('carga sin errores y muestra las 3 rutas de acceso', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/')
    await expect(page.getByText('Cocina', { exact: true })).toBeVisible()
    await expect(page.getByText('Mesero', { exact: true })).toBeVisible()
    await expect(page.getByText('Administración', { exact: true })).toBeVisible()
    expect(errors, `Errores de consola: ${JSON.stringify(errors)}`).toEqual([])
  })
})

test.describe('Login de administración', () => {
  test('carga sin errores y muestra el formulario', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/login')
    await expect(page.getByText('BIENVENIDO')).toBeVisible()
    await expect(page.getByPlaceholder('Ingresa tu usuario')).toBeVisible()
    await expect(page.getByText('Ingresar al Sistema')).toBeVisible()
    expect(errors, `Errores de consola: ${JSON.stringify(errors)}`).toEqual([])
  })
})

test.describe('App Mesero (mesero.html)', () => {
  test('carga sin errores y muestra el login por PIN', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/mesero.html')
    await expect(page.getByText('Iniciar Turno', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByPlaceholder('• • • •')).toBeVisible()
    expect(errors, `Errores de consola: ${JSON.stringify(errors)}`).toEqual([])
  })
})

test.describe('Panel de Cocina (cocina.html)', () => {
  test('carga sin errores y muestra el login', async ({ page }) => {
    const errors = collectErrors(page)
    await page.goto('/cocina.html')
    await expect(page.getByText('COMANDA COCINA')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByPlaceholder('Ingresa tu usuario')).toBeVisible()
    expect(errors, `Errores de consola: ${JSON.stringify(errors)}`).toEqual([])
  })
})
