# MAFC Restaurant + MAFC Facturación (boletas y facturas SUNAT)

```
App mesero / Caja ──> Edge Function "emitir-comprobante" ──> MAFC Facturación ──> SUNAT
   (elige Boleta      (guarda la API key en secreto,          (firma, numera,
    o Factura)         lee el pedido de la BD)                  PDF y ticket)
```

- Al **cobrar una mesa** (app del mesero) o un pedido en **Caja** (panel admin) aparece la ventana
  **Comprobante**: *Boleta*, *Factura* o *Sin comprobante (nota de venta)*.
- En **Caja → Cobrados**, cada venta muestra su número (`B001-00000012 · Aceptado por SUNAT`)
  o el botón **Emitir boleta o factura** para emitirla después.
- La API key **nunca** va en el navegador. Los montos salen del pedido en la base de datos.
- Un pedido = un comprobante: presionar dos veces devuelve el mismo, no crea otro.
- Boleta sin documento = "CLIENTES VARIOS". Desde S/ 700 pide DNI y nombre (regla SUNAT).
- Descuentos, cupones y envases se reflejan; las cortesías (precio 0) no se facturan.
- Se puede emitir hasta **3 días** después del cobro.

Todo se activa con `VITE_FACTURACION_ELECTRONICA=1`. Sin esa variable, el sistema funciona igual que antes.

---

## Paso a paso (pruebas con SUNAT beta)

### 1. MAFC Facturación encendido y con API key para el restaurante

En `C:\mafc-facturacion` (con `docker compose up` corriendo en otra ventana):

```
docker compose restart app
docker compose run --rm app php artisan mafc:api-key 20000000001 mafc-restaurant
```

Copia la key (`mafc_test_...`). Con un cliente real usas su RUC en lugar de `20000000001`.

### 2. Túnel: darle a tu API una dirección https

Supabase está en internet y no llega a tu `localhost`. Instala cloudflared (una sola vez):

```
winget install --id Cloudflare.cloudflared
```

Cierra y abre CMD, y deja esta ventana abierta:

```
cloudflared tunnel --url http://localhost:8000
```

Copia la dirección que aparece, tipo `https://algo-algo-algo.trycloudflare.com`.

> La dirección **cambia cada vez** que reinicias cloudflared → repite el paso 5 (solo `MAFC_API_URL`).
> Para clientes reales la API va en un VPS con dominio fijo.

### 3. Base de datos: crear la tabla de comprobantes

Supabase → **SQL Editor** → New query → pega todo `migracion-facturacion-electronica.sql` → **Run**.
Solo agrega una tabla nueva; no modifica pedidos ni otras tablas.

### 4. Desplegar la Edge Function

En la carpeta `pos-system`:

```
npx supabase login
npx supabase functions deploy emitir-comprobante --project-ref fvzosidupnnjowbbipbo --no-verify-jwt
```

### 5. Secretos de la función

```
npx supabase secrets set --project-ref fvzosidupnnjowbbipbo MAFC_API_URL=https://TU-TUNEL.trycloudflare.com/api/v1 MAFC_API_KEY=mafc_test_TU_KEY
```

Opcionales: `MAFC_SERIE_BOLETA` (por defecto `B001`) y `MAFC_SERIE_FACTURA` (por defecto `F001`).
También se pueden poner en Supabase → Edge Functions → Secrets.

### 6. Activar en la app

En `pos-system/.env.local` (créalo si no existe):

```
VITE_FACTURACION_ELECTRONICA=1
```

```
npm run dev
```

Cobra una mesa en `mesero.html` → aparece **Comprobante** → *Emitir boleta* → *Imprimir ticket*.

Para producción: agrega `VITE_FACTURACION_ELECTRONICA=1` en Vercel → Project Settings →
Environment Variables y vuelve a desplegar.

---

## Errores frecuentes

| Mensaje | Causa | Solución |
| --- | --- | --- |
| No se pudo conectar con el servicio de facturación | Docker o cloudflared apagado, o cambió la dirección del túnel | Enciende ambos; actualiza `MAFC_API_URL` (paso 5) |
| La API key de facturación no es válida | Key mal copiada | Genera otra (paso 1) y actualiza `MAFC_API_KEY` |
| Falta desplegar la función "emitir-comprobante" | No se hizo el paso 4 | Paso 4 |
| Solo se emite comprobante de un pedido cobrado | El cobro no llegó a guardarse en Supabase | Revisa internet y vuelve a abrirlo desde Caja → Cobrados |
| Se queda en "Enviando a SUNAT" | El `worker` de MAFC Facturación no está corriendo | `docker compose up` (no solo `app`) |
| Los productos suman S/ X pero el total cobrado es S/ Y | Pedido con datos inconsistentes | Revisa el pedido; emite desde MAFC Facturación |

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `migracion-facturacion-electronica.sql` | Tabla `comprobantes_electronicos` (solo lectura desde la app) |
| `supabase/functions/emitir-comprobante/index.ts` | Edge Function: valida, arma y emite; consulta estado |
| `supabase/functions/emitir-comprobante/items.ts` | Pedido → líneas del comprobante (descuentos, envases, céntimos exactos) |
| `src/features/facturacion/facturacion.js` | Cliente de la función (lo usan mesero y admin) |
| `src/features/facturacion/ComprobanteModal.jsx` | Ventana Boleta / Factura / Imprimir / WhatsApp |
| `src-apps/mesero/main.jsx` | Abre la ventana después de "Cobrar Mesa" |
| `src/features/cashier/CashierPanel.jsx` | Abre la ventana al cobrar y muestra el número en "Cobrados" |

## Pendiente (siguientes pasos)

- Ticket electrónico por la **impresora Bluetooth** (QR con el comando ESC/POS). Hoy se imprime
  el PDF de 80 mm desde el navegador.
- Anular boleta/factura desde Caja (la API ya lo soporta: `POST /comprobantes/{id}/anular`).
