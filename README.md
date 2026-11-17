# ANTOJITOS AL PASO — Sistema POS & Comandas v20 Pro

> Sistema completo de punto de venta, gestión de comandas y cocina para el restaurante **Antojitos al Paso**, Catacaos - Piura, Perú.

---

## Desarrollador

| Campo        | Detalle                       |
|--------------|-------------------------------|
| **Nombre**   | Miguel Alexander Flores Chuye |
| **Correo**   | floreschuyem@gmail.com        |
| **Celular**  | 924 996 961                   |
| **Rol**      | Desarrollador Full Stack       |

---

## ⚠️ Antes de tocar código — lee esto

Este repo tiene **dos capas de código para "mesero/cocina/caja"** y solo una de
las dos es real. Si vas a pedirle un cambio a un asistente de IA (o a otro
desarrollador), dile primero cuál es cuál — es la causa más probable de un
"arreglé esto pero en el local no cambió nada":

| Función | Archivo REAL (edítalo aquí) | Archivo NO usado en producción |
|---------|------------------------------|----------------------------------|
| Mesero  | `src-apps/mesero/main.jsx` (sirve `mesero.html`) | `src/views/WaiterView.jsx` |
| Cocina  | `src-apps/cocina/main.jsx` (sirve `cocina.html`) | `src/views/KitchenView.jsx` |
| Caja    | `src/features/cashier/CashierPanel.jsx` (pestaña "Caja" de `AdminDashboard.jsx`) | `src/views/CashierView.jsx` |

`RoleSelector.jsx` (la pantalla de inicio) manda "Mesero" y "Cocina" **directo**
a `/mesero.html` y `/cocina.html` — nunca a las rutas `/waiter` `/kitchen`
`/cashier` del router de React. Esas tres rutas y sus vistas se conservan por
compatibilidad, tienen un aviso al inicio de cada archivo, y no reciben
funciones nuevas.

---

## Descripción del Proyecto

Sistema digitalizado de gestión para restaurante con **tres puertas de acceso reales**, todas contra la misma base de datos Supabase en tiempo real:

- **App Mesero (`/mesero.html`)** — PWA móvil para el personal de sala. Gestiona mesas, toma pedidos, **amplía un pedido ya enviado sin perder lo anterior** (sistema de rondas), cobra y muestra el reporte del turno. Login propio por PIN (no usa Supabase Auth).

- **Panel Cocina (`/cocina.html`)** — Panel táctil para la cocina. Recibe pedidos en tiempo real, gestiona estados (Pendiente → Preparando → Listo) **por ronda**, alerta por urgencia y notifica al mesero con audio y TTS. Login propio con credenciales fijas (ver [Deuda técnica conocida](#deuda-técnica-conocida)).

- **Panel Administrativo (`/login` → `/admin`)** — Aplicación React (con Supabase Auth real) para el dueño/administrador. POS mesa a mesa, Delivery/Recojo, mapa de 30 mesas, Stock con catálogo editable, Caja, Egresos, **Compras** (registro de insumos comprados para la preparación de platos — es una entrada especializada al mismo sistema de Egresos, categoría "Insumos": resta de caja, se audita y entra al reporte PDF automáticamente, sin tabla ni lógica nueva), **Personal** (ranking de meseros: ventas, tiempo de atención, horas de turno, calificación de turno con comentario), **Clientes** (mini-CRM de pedidos externos recurrentes), **Reservas** (reservas de mesa) y **Auditoría** (quién cambió qué y cuándo). **Ajustes** permite configurar el nombre del negocio, RUC/DNI, dirección, datos de Yape y subir el **QR de Yape** (se muestra al cobrar en el admin y en la app del mesero), **agregar mesas** (a una zona existente o nueva) y **crear y renombrar perfiles de meseros** (con su PIN, color y activar/desactivar; un mesero no se renombra mientras tenga una mesa abierta) (todo llega a mesero.html en tiempo real), y conectar la **impresora térmica por Bluetooth** (ticket ESC/POS 58/80 mm; sin conexión, el ticket sale por la ventana de impresión como siempre). Más impresión de reportes.

---

## Arquitectura real

```
                    RoleSelector (pantalla de inicio, "/")
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                       ▼
  "Cocina" ──────────▶  "Mesero" ──────────▶  "Administración"
  /cocina.html         /mesero.html          /login (Supabase Auth)
  src-apps/cocina/     src-apps/mesero/            │
  main.jsx             main.jsx                    ▼
        │                     │              AdminDashboard.jsx
        │                     │              (usa OrdersContext,
        │                     │               TablesContext,
        │                     │               InventoryContext,
        │                     │               ExpensesContext,
        │                     │               CajaContext →
        │                     │               src/services/supabase.js)
        │                     │                    │
        └─────────────────────┴────────────────────┘
                              ▼
                    Supabase (PostgreSQL + Realtime)
```

**Punto clave:** `mesero.html` y `cocina.html` **cada uno abre su propio
cliente de Supabase** (definido inline en su `main.jsx`, con la misma anon
key) y hace sus propias queries — no pasan por `src/services/supabase.js` ni
por los Contexts de React. El panel admin sí usa esa capa compartida. Esto es
intencional (ambas apps nacieron como HTML + Babel-CDN independientes, antes
de que existiera el panel admin), pero significa que **una función que toque
"pedidos" casi siempre debe implementarse en más de un lugar**: en el
`main.jsx` correspondiente, y a veces también en `src/services/supabase.js`
si el panel admin también participa de ese flujo (por ejemplo, Delivery y
Recojo se crean desde el panel admin, no desde `mesero.html`).

### Modelo de pedidos — dos formas conviven en la misma tabla `orders`

| | Pedido de mesa (creado en `mesero.html`) | Pedido externo (Delivery / Recojo / Para Llevar, creado en el panel admin) |
|---|---|---|
| Estado de cocina | columna `status` (`pending`/`preparing`/`ready`/`Pagado - …`), **derivado siempre de `rounds`** | columna `kitchen_status` |
| Ampliaciones | sí — columna `rounds[]`: cada ronda es un envío nuevo a cocina; una mesa puede seguir ampliando su pedido aunque rondas anteriores ya estén "Listas" | no — un solo envío |
| Quién lo distingue | `cocina.html` decide con `EXTERNAL_ZONES.includes(order.zone)` | igual |

Cualquier reporte, analítica o edición de pedidos nueva tiene que contemplar
ambas formas o va a fallar silenciosamente para la mitad de los pedidos.

### Stack Tecnológico

| Capa                  | Tecnología                                                  |
|-----------------------|-------------------------------------------------------------|
| Bundler / dev server  | Vite 6 — **las tres apps** (`index.html`, `mesero.html`, `cocina.html`) se compilan con Vite; ya no se usa Babel-Standalone ni CDN de React en producción |
| Frontend Panel Admin  | React 18 + React Router + Context API                       |
| Frontend Mesero/Cocina| React 18, cada uno como app independiente en `src-apps/` compartiendo `package.json` pero con su propio `main.jsx`, cliente Supabase, estado y estilos |
| Base de datos         | Supabase (PostgreSQL) — esquema base + 7 migraciones incrementales (ver abajo) |
| Tiempo real           | Supabase Realtime (WebSockets) — `orders`, `mesas`, `ventas_meseros`, `inventory`, `menu_items`, `egresos`, `caja_estado` |
| Monitoreo             | Sentry (opcional — activar con `VITE_SENTRY_DSN`) vía `src/services/monitoring.js` |
| Offline (panel admin) | IndexedDB (`src/services/offlineDB.js`) + `OfflineContext` — cola de acciones pendientes |
| Offline (mesero)      | Service Worker propio (`public/sw-mesero.js`, polling en segundo plano + notificaciones nativas) + carrito persistido en `localStorage` con TTL 24h |
| Audio                 | Web Audio API (campanadas, pitidos, chimes)                 |
| Voz                   | SpeechSynthesis API — es-ES                                 |
| Impresión             | Bluetooth (ESC/POS por chunks), 1 o más impresoras repartidas por categoría del menú (mesero.html) + Web Print API como respaldo |
| CI                    | GitHub Actions — smoke tests con Playwright en cada push (`.github/workflows/ci.yml`) + backup diario automático de la base de datos (`.github/workflows/backup-supabase.yml`) |
| Deploy                | Vercel (`pos-system/dist`) |

---

## Estructura del Proyecto

```
APP Mesero - Antojitos Al paso/
│
├── README.md
├── print-gateway.js              # gateway local para impresora de red (Wi-Fi)
│
└── pos-system/
    ├── mesero.html                # entry point REAL del mesero → src-apps/mesero/main.jsx
    ├── cocina.html                # entry point REAL de cocina → src-apps/cocina/main.jsx
    ├── index.html                 # entry point del panel admin → src/main.jsx
    ├── supabase-schema.sql        # esquema BASE (tablas originales)
    ├── migracion-*.sql            # 7 migraciones incrementales — ver tabla abajo
    │
    ├── src-apps/
    │   ├── mesero/main.jsx        # ★ app real del mesero — cliente Supabase propio,
    │   │                            MENU, sistema de rondas, impresión, PIN
    │   └── cocina/main.jsx        # ★ app real de cocina — cliente Supabase propio,
    │                                urgencias, distinción rounds/kitchen_status
    │
    ├── src/
    │   ├── main.jsx / App.jsx     # panel admin — React Router
    │   ├── services/supabase.js   # capa de datos compartida del panel admin
    │   ├── context/OfflineContext.jsx
    │   ├── features/
    │   │   ├── auth/              # login Supabase Auth (solo panel admin)
    │   │   ├── orders/            # OrdersContext — usado por AdminDashboard
    │   │   ├── tables/            # TablesContext — usado por AdminDashboard
    │   │   ├── inventory/         # Stock + catálogo (menu_items)
    │   │   ├── expenses/          # Egresos
    │   │   └── cashier/           # CajaContext + CashierPanel (la Caja real)
    │   └── views/
    │       ├── AdminDashboard.jsx # ★ panel admin real (POS, Mesas, Stock, Caja, Egresos)
    │       ├── WaiterView.jsx     # ⚠️ no usado en producción — ver aviso en el archivo
    │       ├── KitchenView.jsx    # ⚠️ no usado en producción — ver aviso en el archivo
    │       └── CashierView.jsx    # ⚠️ no usado en producción — ver aviso en el archivo
    │
    ├── tests/smoke.spec.js        # Playwright — valida que las 3 puertas reales carguen sin error
    │
    └── dist/                      # build de producción (npm run build)
```

---

## Base de Datos Supabase

### Esquema base (`supabase-schema.sql`)

Tablas originales: `orders`, `mesas`, `inventory`, `users`, `ventas_meseros`.
Ver el archivo para el `CREATE TABLE` completo.

### Migraciones incrementales (aplicar en este orden si se recrea la base desde cero)

| Archivo | Qué agrega |
|---------|------------|
| `migracion-comanda-rondas.sql` | Columna `rounds` en `orders` — permite ampliar un pedido ya enviado sin perder lo anterior. |
| `migracion-catalogo-crud.sql` | Tabla `menu_items` — catálogo de platos editable desde el panel admin (Stock → "Agregar plato"), sincronizado en tiempo real hacia `mesero.html`. |
| `migracion-egresos-stock.sql` | Tabla de egresos + vínculo con descuento de stock. |
| `migracion-caja-global-egresos.sql` | Tabla `caja_estado` — abierta/cerrada, compartida entre el panel admin y `mesero.html` (bloquea enviar pedidos si la caja está cerrada). |
| `migracion-storage-imagenes.sql` | Bucket de Storage para imágenes de platos del catálogo. |
| `migracion-seguridad-pines-sesiones.sql` | Tabla `mesero_sesiones` (bitácora de inicio/cierre de turno) + funciones RPC `verify_mesero_pin` / `mesero_pin_configured` — PIN individual por mesero verificado en servidor, con degradación segura al PIN compartido histórico mientras un mesero no tenga PIN propio asignado. |
| `migracion-endurecer-rls.sql` | Endurece Row Level Security tabla por tabla, verificado contra el uso real de cada verbo (select/insert/update) en el código — corrige además un bug donde `caja_estado` y `menu_items` bloqueaban silenciosamente la lectura anónima. |
| `migracion-auditoria.sql` | Tabla `audit_log` — bitácora de acciones administrativas (cambios de precio, apertura/cierre de caja, egresos, catálogo). Solo el panel admin escribe/lee, con RLS restringida a `admin`. Registrada como efecto best-effort *después* de cada operación real — nunca la bloquea. |
| `migracion-evaluaciones-mesero.sql` | Tabla `mesero_evaluaciones` — calificación (1-5) + comentario que el admin le da a un mesero desde la pestaña Personal. Solo admin escribe/lee. Sin UPDATE/DELETE por diseño — una calificación no se edita, se corrige con una nueva. |
| `migracion-reservas.sql` | Tabla `reservas` — reservas de mesa (cliente, fecha/hora, personas, mesa opcional, estado). Independiente de `mesas`/`orders` a propósito — no bloquea ni asigna la mesa automáticamente, el mesero la abre igual que siempre al llegar el cliente. Solo admin. |
| `migracion-config-negocio.sql` | Tabla `negocio_config` (fila única id=1, mismo patrón que `caja_estado`) — nombre del negocio, RUC/DNI, dirección, número/titular de Yape y URL del QR. Lectura pública (mesero.html la necesita), escritura solo admin. Se edita desde Ajustes → Datos del Negocio y Yape; tickets, reportes y cobro por Yape del admin y del mesero leen estos datos. El QR se sube al bucket `menu-images`. Sin migración todo sigue con los valores de siempre y Ajustes guarda solo en el dispositivo (con aviso). |
| `migracion-mesas-meseros.sql` | Permite crear **mesas** y **perfiles de meseros** desde Ajustes. Agrega la columna `mesas.zona` crea las filas de las 30 mesas base que falten (el esquema original solo sembró 1–15), y las políticas admin de INSERT (mesas) y DELETE (solo mesas nuevas, número > 30, y libres — las 30 originales nunca se borran); crea la tabla `meseros` (siembra w1–w4; lectura pública porque el login de mesero.html es anónimo, alta/edición solo admin, sin DELETE: se desactivan). El PIN sigue en `mesero_pins` (se asigna con `set_mesero_pin`, de `migracion-seguridad-pines-sesiones.sql`). mesero.html recibe mesas y perfiles nuevos por Realtime. |
| `migracion-pago-mixto.sql` | Columna `orders.payment_breakdown` (jsonb, nula para el 99% de pedidos — pago simple de siempre). Agrega **Tarjeta** y **Cobro Mixto** (dividir una cuenta entre 2+ métodos) en los modales de cobro del admin y de `mesero.html`. Un trigger `BEFORE INSERT OR UPDATE` en `orders` (`check_payment_breakdown`) valida en el **servidor**, sin excepción, que la suma de los montos del desglose coincida EXACTO (al centavo) con el total, y fuerza `payment_method = 'mixto'` — defensa real, no solo del lado del cliente. `ventas_meseros` no cambia de esquema: un pago dividido inserta una fila por método (nunca `'mixto'` ahí), así que el ranking de Personal y el reporte de turno sigue sumando igual que siempre sin tocar ese código. |

Todas están escritas para ser **seguras de correr más de una vez** (usan
`IF NOT EXISTS` / bloques `DO $$ ... EXCEPTION` donde aplica).

### Realtime

```sql
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- Debe incluir: orders, mesas, ventas_meseros, inventory, menu_items, egresos, caja_estado
```

### Backups

Diario y automático vía GitHub Actions (`pg_dump`, 03:00 hora Perú) — ver
`.github/workflows/backup-supabase.yml`. Requiere el secreto
`SUPABASE_DB_URL` configurado una sola vez en GitHub → Settings → Secrets.

### Impresión de comandas por estación (`mesero.html`)

No requiere migración — es 100% del lado del cliente. `PrinterRegistry`
(dentro de `src-apps/mesero/main.jsx`, reemplaza al antiguo `BTService` de
una sola impresora) permite emparejar **una o más** impresoras Bluetooth
desde el botón "🖨️ Impresoras" de la topbar, y asignarle a cada una las
categorías del menú de las que se encarga (ej. "Tragos" → impresora
"Barra"). La que quede marcada ★ predeterminada recibe todo lo que ninguna
otra reclame. Al enviar una comanda a cocina, se reparte por estación: cada
impresora conectada con ítems de las suyas recibe SOLO esos ítems; una
estación sin ítems correspondientes simplemente no imprime nada para ese
pedido. Con una sola impresora configurada (el caso de toda instalación
existente antes de este cambio) el comportamiento es idéntico a siempre —
todo va a esa única impresora, nada cambia sin que el mesero toque nada en
Ajustes. La configuración (nombre, categorías, predeterminada) se recuerda
en `localStorage` del dispositivo; la conexión Bluetooth en sí se debe
re-establecer cada sesión (exigencia del navegador, igual que antes).

---

## Deuda técnica conocida

- **Cocina usa usuario/clave fijos en el código fuente** (`KITCHEN_USER`/`KITCHEN_PASS`
  en `src-apps/cocina/main.jsx`) — visibles para cualquiera que abra el código
  fuente del sitio. El mesero ya migró a un esquema mejor (PIN verificado en
  servidor vía RPC); cocina debería seguir el mismo patrón.
- **PIN individual del mesero** — el rollout es incremental: mientras un
  mesero no tenga un PIN propio asignado en la base, sigue aceptando el PIN
  compartido histórico (`1414`) solo para él. Confirmar que los 4 meseros
  tengan PIN propio asignado para cerrar ese respaldo por completo.
- **Lógica duplicada entre `mesero.html` y `cocina.html`** — cálculo de
  urgencia, formato de fecha/hora, colores de estado y zonas están copiados
  en ambos `main.jsx`. Ambos se compilan con Vite, así que ya se podrían
  compartir vía un módulo común — pendiente de hacer.
- **`src/views/WaiterView.jsx`, `KitchenView.jsx`, `CashierView.jsx`** y las
  rutas `/waiter` `/kitchen` `/cashier` no se usan en producción (ver tabla
  al inicio de este documento). Se conservan por compatibilidad con un aviso
  en cada archivo.
- **`NetPrinterService`/`PrinterConfigModal` en `src-apps/mesero/main.jsx` están muertos** —
  un intento anterior de imprimir por IP (HTTP → gateway local → TCP 9100) que
  nunca se terminó: el archivo `print-gateway.js` que asumía nunca se creó, y
  nada en la app actual los usa (comentario en el código: "WiFi printer UI
  eliminado — solo Bluetooth + ventana web como fallback"). Imprimir por IP
  directa no es posible desde este sistema hoy — es una app estática (Vite +
  Vercel) sin servidor propio, y el navegador no puede abrir un socket TCP
  crudo a una impresora de red sin un gateway local (que no existe) o que la
  impresora tenga su propia API HTTP. Si algún día se necesita, conviene
  decidir primero con qué marca/modelo de impresora de red se va a trabajar.
- **Lógica de pago mixto duplicada entre admin y `mesero.html`** —
  `src/utils/payments.js` (`validateBreakdown`/`buildOrderPaymentFields`/
  `buildPayStatus`) tiene una copia inline en `src-apps/mesero/main.jsx`
  (`validateBreakdownM`/`buildPayStatusM`, sufijo `_M`) porque mesero.html
  no puede importar de `src/` (bundle de Vite independiente). Si se cambia
  una regla de validación, hay que cambiarla en los dos archivos — hay un
  test (`test-payments.mjs`, no incluido en el repo) que compara que ambas
  copias den el mismo resultado para los mismos datos.

---

## Flujo de Estados de un Pedido de Mesa

```
[Mesero crea pedido — Ronda 1]
       │
       ▼
   pending  ──────────────────────────────────────────────────────────┐
  (Pendiente)                                                         │
       │  Cocinero pulsa "Empezar Preparación" (por ronda)            │
       ▼                                                              │
  preparing  ─────────────────────────────────────────────────────── │
  (Preparando)                                                        │  Mesero puede
       │  Cocinero pulsa "Pedido Listo" (por ronda)                   │  AMPLIAR el pedido
       ▼                                                              │  en cualquier estado
    ready  ──────────────────────────────────────── excepto ─────────┘  (crea una ronda
   (Listo)                                            ya pagado          nueva; el estado
       │  Mesero cobra (Efectivo o Yape)                                 agregado vuelve a
       ▼                                                                 'pending' si hacía
 "Pagado - Efectivo" o "Pagado - Yape"                                   falta)
```

Los pedidos externos (Delivery/Recojo/Para Llevar) siguen el mismo ciclo pero
en la columna `kitchen_status`, sin rondas — un solo envío.

---

## Instalación y Ejecución

### Requisitos previos
- Node.js ≥ 18
- Cuenta en [Supabase](https://supabase.com) con el esquema base + las 7 migraciones aplicadas (ver arriba)

### Correr todo en desarrollo

```bash
cd pos-system
npm install
npm run dev
# Abre:
#   http://localhost:5173/            → panel admin
#   http://localhost:5173/mesero.html → app mesero
#   http://localhost:5173/cocina.html → panel cocina
```

Las credenciales de Supabase están fijas a propósito dentro del código
(`src/services/supabase.js`, y cada `main.jsx` de `src-apps/`) — no hace
falta configurar variables de entorno para que el sistema funcione. La única
variable opcional es `VITE_SENTRY_DSN` (monitoreo de errores).

### Build de producción

```bash
npm run build      # genera pos-system/dist/
npm run preview    # sirve el build localmente
```

### Tests

```bash
npm run test:e2e     # Playwright — smoke tests de las 3 puertas reales
npm run test:e2e:ui  # modo interactivo
```

---

## Deployment en Vercel

1. Conectar el repositorio en [vercel.com](https://vercel.com)
2. **Build settings**:
   - Root directory: `pos-system`
   - Build command: `npm run build`
   - Output directory: `dist`
3. `vercel.json` ya tiene las rutas explícitas para `mesero.html` y `cocina.html`.
4. Variable de entorno opcional: `VITE_SENTRY_DSN` (Settings → Environment Variables).

---

## Credenciales del Sistema

### Panel Administrativo

| Usuario | Contraseña  | Rol           |
|---------|-------------|---------------|
| `leo`   | `antojitos26` | Administrador |

### Panel Cocina

| Usuario   | Contraseña |
|-----------|------------|
| `comanda` | `2026`     |

> ⚠️ Fijas en el código fuente de `cocina.html` — ver [Deuda técnica conocida](#deuda-técnica-conocida).

### Meseros — App Mesero

| Mesero | ID  | PIN compartido (respaldo) | Color     |
|--------|-----|----------------------------|-----------|
| Carlos | w1  | 1234 / 1414                | Ámbar     |
| María  | w2  | 1234 / 1414                | Carmesí   |
| Pedro  | w3  | 1234 / 1414                | Zafiro    |
| Carmen | w4  | 1234 / 1414                | Esmeralda |

> El PIN de cada mesero puede ya estar individualizado en la base de datos
> (ver `migracion-seguridad-pines-sesiones.sql`). El valor de respaldo solo
> aplica mientras un mesero no tenga PIN propio asignado.

---

## Zonas del Restaurante

| Zona              | Mesas    |
|-------------------|----------|
| Salón Principal   | 1 — 12   |
| Terraza           | 13 — 22  |
| Privados          | 23 — 30  |

**Total base: 30 mesas.** Desde Ajustes se pueden agregar más (a partir de la 31, en cualquier zona o en una zona nueva); `mesero.html` y el panel admin las muestran en tiempo real. Las 30 originales no se pueden quitar.

---

## Menú — Categorías

| Categoría  | Platos destacados                                   |
|------------|-----------------------------------------------------|
| Brasas     | Pollo a la Brasa (entero, ½, ¼, ⅛) con acompañamientos |
| Fast Food  | Hamburguesa, Hot Dog, Salchipapa                    |
| Bebidas    | Cebada, Maracuyá (500 ml)                           |

El menú base (17 platos) está hardcodeado en `src-apps/mesero/main.jsx`
(constante `MENU`) como respaldo — el catálogo real y editable vive en la
tabla `menu_items` y se sincroniza en tiempo real hacia el mesero desde el
panel admin (Stock → "Agregar plato").

---

## Información del Negocio

| Campo      | Dato                               |
|------------|-------------------------------------|
| Negocio    | Antojitos al Paso                  |
| Dirección  | Jr. Zepita #349, Catacaos, Piura   |
| RUC        | 10456789012                        |
| Titular    | Leonidas Juarez S.                 |
| Yape       | 982 936 262                        |

---

## Contacto del Desarrollador

**Miguel Alexander Flores Chuye**
- Correo: floreschuyem@gmail.com
- Celular: 924 996 961

*Sistema desarrollado a medida para Antojitos al Paso — 2025*
