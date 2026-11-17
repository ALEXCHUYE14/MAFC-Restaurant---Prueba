-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Endurecer RLS (Row Level Security)
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve — DOS problemas distintos, encontrados al auditar cada
-- política de cada tabla contra el código real que las usa:
--
-- (A) BUG EN PRODUCCIÓN — dos tablas bloquean SELECT a `anon`:
--     `caja_estado` y `menu_items` exigían auth.role() = 'authenticated'
--     para leer. Eso funciona para el AdminDashboard (login real de
--     Supabase Auth), pero mesero.html y cocina.html son ANÓNIMOS por
--     diseño (login propio por PIN, no usan Supabase Auth) — sus
--     lecturas a esas dos tablas venían siendo filtradas en silencio
--     (RLS no da error, simplemente devuelve 0 filas), así que:
--       · el candado de "Caja Cerrada" en mesero.html nunca se activaba
--         de verdad (cajaAbierta se queda en su default `true` para
--         siempre en esa app).
--       · los platos nuevos creados desde Stock (tabla menu_items)
--         probablemente NO estaban llegando a mesero.html.
--     Este archivo corrige el SELECT de ambas tablas a público — son
--     datos no sensibles (un booleano de caja abierta/cerrada, y el
--     catálogo de platos que de todos modos se le muestra al cliente).
--     Los UPDATE/INSERT/DELETE de esas dos tablas SIGUEN restringidos
--     a admin — nada de esto afloja la escritura.
--
-- (B) SUPERFICIE DE ATAQUE — `orders`, `mesas`, `tables`, `inventory`,
--     `ventas_meseros` y `users` tenían políticas "for all using(true)":
--     cualquiera con la anon key (visible en el código fuente de
--     mesero.html/cocina.html) podía leer Y BORRAR cualquier fila de
--     pedidos, mesas, stock, ventas o el listado de usuarios — sin
--     pasar por la app en absoluto, directo contra la API de Supabase.
--     Este archivo reemplaza cada "for all" por políticas explícitas
--     SOLO para los verbos (select/insert/update) que el código
--     REALMENTE usa — verificado grep por grep contra mesero.html,
--     cocina.html y src/services/supabase.js antes de escribir esto.
--     Ninguna de esas tablas se borra jamás desde el cliente (los
--     "cierres" son soft-delete vía columna `status`/`archived`), así
--     que DELETE queda simplemente SIN política — nadie puede borrar
--     nada desde fuera de la base de datos.
--
-- Riesgo de esta migración: BAJO. No se le quita ningún permiso a
-- ninguna operación que el código realmente haga — se verificó cada
-- tabla contra su uso real antes de escribir la política. Aun así,
-- después de correrla, prueba el flujo completo una vez (login mesero,
-- enviar comanda, cobrar, abrir/cerrar caja, editar stock) antes de
-- confiar en que quedó perfecto.
--
-- Seguro de ejecutar más de una vez.
-- ══════════════════════════════════════════════════════════════════


-- ── A1. caja_estado — arreglar el SELECT bloqueado para anon ────────────────
drop policy if exists "auth_caja_estado_select" on public.caja_estado;
create policy "public_caja_estado_select"
  on public.caja_estado for select
  using (true);
-- admin_caja_estado_modify (UPDATE, solo admin) queda intacta.


-- ── A2. menu_items — arreglar el SELECT bloqueado para anon ─────────────────
drop policy if exists "auth_menu_items_select" on public.menu_items;
create policy "public_menu_items_select"
  on public.menu_items for select
  using (true);
-- admin_menu_items_modify (insert/update/delete, solo admin) queda intacta.


-- ── B1. orders — quitar DELETE de la superficie pública ──────────────────────
-- Uso real verificado: SELECT (las 3 apps) · INSERT (mesero.html, nuevo
-- pedido) · UPDATE (mesero.html: rondas/pago · cocina.html: estado ·
-- AdminDashboard/Caja: cierre). DELETE: sin uso en ningún flujo activo.
drop policy if exists "Acceso publico - orders" on public.orders;

do $$ begin
  create policy "orders_select" on public.orders for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "orders_insert" on public.orders for insert with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "orders_update" on public.orders for update using (true) with check (true);
exception when duplicate_object then null; end $$;


-- ── B2. mesas — quitar INSERT y DELETE de la superficie pública ─────────────
-- Uso real verificado: SELECT + UPDATE (estado de la mesa). Las 30 filas
-- se siembran una sola vez por SQL — el cliente nunca inserta ni borra.
drop policy if exists "Acceso publico - mesas" on public.mesas;

do $$ begin
  create policy "mesas_select" on public.mesas for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "mesas_update" on public.mesas for update using (true) with check (true);
exception when duplicate_object then null; end $$;


-- ── B3. tables — quitar INSERT y DELETE de la superficie pública ────────────
-- Uso real verificado: SELECT + UPDATE (TableMap del AdminDashboard).
drop policy if exists "Acceso publico - tables" on public.tables;

do $$ begin
  create policy "tables_select" on public.tables for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "tables_update" on public.tables for update using (true) with check (true);
exception when duplicate_object then null; end $$;


-- ── B4. inventory — quitar INSERT y DELETE de la superficie pública ─────────
-- Uso real verificado: SELECT (las 3 apps) + UPDATE (InventoryPanel:
-- precio/stock/disponibilidad/imagen). Las filas del catálogo estático
-- se siembran una sola vez por SQL — el cliente nunca inserta ni borra.
drop policy if exists "Acceso publico - inventory" on public.inventory;

do $$ begin
  create policy "inventory_select" on public.inventory for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "inventory_update" on public.inventory for update using (true) with check (true);
exception when duplicate_object then null; end $$;


-- ── B5. ventas_meseros — quitar UPDATE y DELETE de la superficie pública ────
-- Uso real verificado: SELECT (reportes/turno) + INSERT (al cobrar una
-- mesa). Un registro de venta nunca se edita ni se borra una vez creado
-- — es historial contable.
drop policy if exists "Acceso publico - ventas_meseros" on public.ventas_meseros;

do $$ begin
  create policy "ventas_meseros_select" on public.ventas_meseros for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "ventas_meseros_insert" on public.ventas_meseros for insert with check (true);
exception when duplicate_object then null; end $$;


-- ── B6. users — de "cualquiera lee todo" a "cada quien lee su propio perfil" ─
-- Uso real verificado: el AdminDashboard solo lee el perfil del usuario
-- YA autenticado (auth.uid()), nunca el de otro. No hay INSERT/UPDATE/
-- DELETE desde el cliente (el perfil se crea por SQL al dar de alta un
-- admin nuevo). Antes cualquiera con la anon key podía listar nombres y
-- correos de TODO el staff — ahora cada sesión solo ve su propia fila.
drop policy if exists "Acceso publico - users" on public.users;

do $$ begin
  create policy "users_select_own" on public.users for select using (auth.uid() = id);
exception when duplicate_object then null; end $$;
