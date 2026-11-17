 -- ══════════════════════════════════════════════════════════════════════════════
-- ANTOJITOS AL PASO — Schema Supabase (CORREGIDO)
-- Pega TODO este contenido en: Supabase → SQL Editor → New Query → Run
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. TABLA ORDERS (pedidos) ─────────────────────────────────────────────────
create table if not exists public.orders (
  id              uuid          default gen_random_uuid() primary key,
  table_number    integer       not null,
  zone            text,
  waiter_id       text,
  waiter_name     text,
  waiter_avatar   text,
  waiter_color    text,
  items           jsonb         not null default '[]',
  status          text          not null default 'pending',
  total           numeric(10,2) default 0,
  subtotal        numeric(10,2) default 0,
  payment_method  text,
  paid_at         timestamptz,
  notes           text,
  created_at      timestamptz   default now(),
  updated_at      timestamptz   default now()
);

-- ── 2. TABLA MESAS (estado en tiempo real — usada por mesero.html y panel admin) ─
-- mesero.html escribe aquí con updateMesaEstado()
-- supabase.js lee con getMesas() y escucha con subscribeMesas()
create table if not exists public.mesas (
  id                   text        primary key,        -- ej: 'table-1', 'table-2'
  numero_mesa          integer     not null unique,
  estado               text        not null default 'libre',  -- 'libre' | 'ocupada'
  mesero_nombre        text,
  mesero_color         text,
  ultima_actualizacion timestamptz default now()
);

-- ── 3. TABLA TABLES (compatibilidad panel admin — TablesContext / subscribeTables) ─
create table if not exists public.tables (
  id               text        primary key,
  number           integer     not null,
  capacity         integer     default 4,
  status           text        default 'available',
  current_order_id uuid        references public.orders(id) on delete set null,
  waiter_id        text,
  waiter_name      text,
  opened_at        timestamptz,
  updated_at       timestamptz default now()
);

-- ── 4. TABLA INVENTORY ───────────────────────────────────────────────────────
create table if not exists public.inventory (
  id          text    primary key,
  menu_id     integer,
  name        text    not null,
  cat         text,
  available   boolean default true,
  stock       integer,
  alert_at    integer
);

-- ── 5. TABLA USERS (perfil extendido de auth.users) ──────────────────────────
create table if not exists public.users (
  id      uuid  references auth.users(id) on delete cascade primary key,
  email   text  not null,
  name    text,
  role    text  not null default 'waiter',
  avatar  text,
  color   text
);

-- ── 6. TABLA VENTAS_MESEROS ───────────────────────────────────────────────────
-- mesero.html escribe aquí con saveVentaMesero() al cerrar una mesa
create table if not exists public.ventas_meseros (
  id             uuid          default gen_random_uuid() primary key,
  mesero_id      text,
  mesero_nombre  text,
  mesa_nro       integer,
  total          numeric(10,2),
  metodo_pago    text,
  zona           text,
  items          jsonb         default '[]',
  created_at     timestamptz   default now()
);


-- ── 7. REALTIME — habilitar para todas las tablas críticas ───────────────────
-- Usa bloques DO para ignorar si la tabla ya está en la publicación (error 42710).
do $$ begin alter publication supabase_realtime add table public.orders;          exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.mesas;           exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tables;          exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.ventas_meseros;  exception when others then null; end $$;


-- ── 8. ROW LEVEL SECURITY ────────────────────────────────────────────────────
alter table public.orders          enable row level security;
alter table public.mesas           enable row level security;
alter table public.tables          enable row level security;
alter table public.inventory       enable row level security;
alter table public.users           enable row level security;
alter table public.ventas_meseros  enable row level security;


-- ── 9. ELIMINAR POLÍTICAS ANTIGUAS (para evitar conflictos) ──────────────────
drop policy if exists "Acceso autenticado - orders"      on public.orders;
drop policy if exists "Acceso autenticado - tables"      on public.tables;
drop policy if exists "Acceso autenticado - inventory"   on public.inventory;
drop policy if exists "Acceso autenticado - users"       on public.users;
drop policy if exists "Acceso publico - orders"          on public.orders;
drop policy if exists "Acceso publico - mesas"           on public.mesas;
drop policy if exists "Acceso publico - tables"          on public.tables;
drop policy if exists "Acceso publico - inventory"       on public.inventory;
drop policy if exists "Acceso publico - users"           on public.users;
drop policy if exists "Acceso publico - ventas_meseros"  on public.ventas_meseros;


-- ── 10. POLÍTICAS ABIERTAS (anon + authenticated) ────────────────────────────
-- CAUSA DEL PROBLEMA: las políticas anteriores usaban auth.role() = 'authenticated'
-- lo que bloqueaba TODO insert/update desde mesero.html (cliente anónimo sin login).
-- Con using(true) / with check(true) funciona para ambos roles.

create policy "Acceso publico - orders"
  on public.orders for all
  using (true)
  with check (true);

create policy "Acceso publico - mesas"
  on public.mesas for all
  using (true)
  with check (true);

create policy "Acceso publico - tables"
  on public.tables for all
  using (true)
  with check (true);

create policy "Acceso publico - inventory"
  on public.inventory for all
  using (true)
  with check (true);

create policy "Acceso publico - users"
  on public.users for all
  using (true)
  with check (true);

create policy "Acceso publico - ventas_meseros"
  on public.ventas_meseros for all
  using (true)
  with check (true);


-- ── 11. ÍNDICES ───────────────────────────────────────────────────────────────
create index if not exists idx_orders_status     on public.orders(status);
create index if not exists idx_orders_created_at on public.orders(created_at desc);
create index if not exists idx_orders_table      on public.orders(table_number);
create index if not exists idx_mesas_numero      on public.mesas(numero_mesa);


-- ── 12. TRIGGER updated_at automático ────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists tables_updated_at on public.tables;
create trigger tables_updated_at
  before update on public.tables
  for each row execute function public.set_updated_at();


-- ── 13. DATOS INICIALES — mesas (1 a 15, ajusta según tu local) ──────────────
insert into public.mesas (id, numero_mesa, estado)
select 'table-' || n, n, 'libre'
from generate_series(1, 15) as n
on conflict (id) do nothing;


-- ── 14. MIGRACIÓN: columnas kitchen_status / is_modified + índices ───────────
-- Usa IF NOT EXISTS para ser idempotente (seguro de ejecutar varias veces).
-- IMPORTANTE: corre esto aunque el schema base ya estuviera aplicado.

alter table public.orders add column if not exists kitchen_status text    default 'pending';
alter table public.orders add column if not exists is_modified    boolean default false;

create index if not exists idx_orders_zone           on public.orders(zone);
create index if not exists idx_orders_kitchen_status on public.orders(kitchen_status);


-- ── 15. FUNCIÓN RPC: cerrar_caja_reset ───────────────────────────────────────
-- Llamada desde el botón "Cerrar Caja" en el panel administrativo.
-- SECURITY DEFINER = corre con privilegios del owner de la función (postgres),
-- bypassando RLS para el rol anónimo (clave pública del sistema).
-- Regla de negocio: Para Llevar / Delivery en preparación NO se archivan
-- hasta que el cocinero los marque "Listo" (kitchen_status = 'ready').

create or replace function public.cerrar_caja_reset()
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  update orders
  set    status     = 'archivado',
         updated_at = now()
  where  status <> 'archivado'
    and  (
           zone is null
           or zone not in ('Para Llevar', 'Delivery', 'Recojo en Local')
           or kitchen_status = 'ready'
         );

  update mesas
  set    estado               = 'libre',
         mesero_nombre        = null,
         mesero_color         = null,
         ultima_actualizacion = now()
  where  estado <> 'libre';
end;
$func$;

revoke all on function public.cerrar_caja_reset() from public, anon;
grant execute on function public.cerrar_caja_reset() to authenticated;  -- antes: to anon (inseguro, ver migracion-seguridad-auditoria.sql)
grant execute on function public.cerrar_caja_reset() to authenticated;


-- ── 16. FUNCIÓN RPC: cerrar_caja_y_reiniciar_dia ─────────────────────────────
-- Versión completa de cierre de día: archiva TODOS los pedidos (sin excepción),
-- libera todas las mesas y limpia ventas_meseros del día actual.
-- Llamada exclusivamente desde el botón "Cerrar Caja" del panel administrativo.
-- SECURITY DEFINER garantiza ejecución con privilegios de superusuario,
-- evitando violaciones de Foreign Key o restricciones RLS desde el cliente.

create or replace function public.cerrar_caja_y_reiniciar_dia()
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  -- 1. Archivar TODOS los pedidos del día que no estén ya archivados.
  --    Incluye Para Llevar, Delivery y cualquier estado (pending, served, pagado, etc.)
  update orders
  set    status     = 'archivado',
         updated_at = now()
  where  status <> 'archivado';

  -- 2. Liberar todas las mesas: estado='libre', limpiar mesero asignado.
  update mesas
  set    estado               = 'libre',
         mesero_nombre        = null,
         mesero_color         = null,
         ultima_actualizacion = now()
  where  estado <> 'libre';

  -- 3. Eliminar ventas_meseros del día actual (reinicio de contadores diarios).
  --    Se conservan los registros de días anteriores para historial.
  delete from ventas_meseros
  where  created_at >= current_date;
end;
$func$;

revoke all on function public.cerrar_caja_y_reiniciar_dia() from public, anon;
grant execute on function public.cerrar_caja_y_reiniciar_dia() to authenticated;  -- antes: to anon (inseguro, ver migracion-seguridad-auditoria.sql)
grant execute on function public.cerrar_caja_y_reiniciar_dia() to authenticated;


-- ── 17. FUNCIÓN RPC: cerrar_caja_y_reiniciar_jornada ─────────────────────────
-- Alias semántico de cerrar_caja_y_reiniciar_dia con nombre canónico definitivo.
-- Opera con SECURITY DEFINER para bypasar RLS desde el cliente anónimo (admin
-- hardcoded). Archiva pedidos, libera mesas y borra ventas del día en una sola
-- transacción atómica — sin violar Foreign Keys ni restricciones de integridad.
-- Tablas maestras intactas: inventory, users, tables (estructura), menu.

create or replace function public.cerrar_caja_y_reiniciar_jornada()
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  -- 1. Archivar TODOS los pedidos activos del día (cualquier status, cualquier zona).
  --    Tablas maestras (inventory, users) NO se tocan.
  update orders
  set    status     = 'archivado',
         updated_at = now()
  where  status <> 'archivado';

  -- 2. Liberar todas las mesas del salón.
  update mesas
  set    estado               = 'libre',
         mesero_nombre        = null,
         mesero_color         = null,
         ultima_actualizacion = now()
  where  estado <> 'libre';

  -- 3. Borrar ventas_meseros del día actual.
  --    Registros de días anteriores se conservan para historial e informes.
  delete from ventas_meseros
  where  created_at >= current_date;
end;
$func$;

revoke all on function public.cerrar_caja_y_reiniciar_jornada() from public, anon;
grant execute on function public.cerrar_caja_y_reiniciar_jornada() to authenticated;  -- antes: to anon (inseguro, ver migracion-seguridad-auditoria.sql)
grant execute on function public.cerrar_caja_y_reiniciar_jornada() to authenticated;


-- ── 18. FUNCIÓN RPC: ejecutar_cierre_caja_total ───────────────────────────────
-- Nombre canónico final para el botón "Cerrar Caja" del panel administrativo.
-- SECURITY DEFINER: corre con privilegios del owner, bypasando RLS y FK checks
-- que bloquearían al cliente anónimo. Operación atómica en una sola transacción:
--   1. Archiva todos los pedidos del día (cualquier estado, cualquier zona).
--   2. Libera todas las mesas del salón (estado='libre', sin mesero asignado).
--   3. Elimina las ventas_meseros del día actual (historial previo intacto).
-- Tablas maestras NO tocadas: inventory, users, tables (estructura), menú.

create or replace function public.ejecutar_cierre_caja_total()
returns void
language plpgsql
security definer
set search_path = public
as $func$
begin
  -- 1. Archivar pedidos activos del día (orders)
  update orders
  set    status     = 'archivado',
         updated_at = now()
  where  status <> 'archivado';

  -- 2. Liberar mesas del salón (mesas)
  update mesas
  set    estado               = 'libre',
         mesero_nombre        = null,
         mesero_color         = null,
         ultima_actualizacion = now()
  where  estado <> 'libre';

  -- 3. Limpiar ventas_meseros del día actual
  delete from ventas_meseros
  where  created_at >= current_date;
end;
$func$;

revoke all on function public.ejecutar_cierre_caja_total() from public, anon;
grant execute on function public.ejecutar_cierre_caja_total() to authenticated;  -- antes: to anon (inseguro, ver migracion-seguridad-auditoria.sql)
grant execute on function public.ejecutar_cierre_caja_total() to authenticated;


-- ══════════════════════════════════════════════════════════════════════════════
-- DESPUÉS DE EJECUTAR ESTE SCRIPT EN SUPABASE:
--
-- 1. Verifica que las 6 tablas existen en Table Editor:
--    orders, mesas, tables, inventory, users, ventas_meseros
--
-- 2. Verifica Realtime en: Database → Replication → supabase_realtime
--    Deben aparecer: orders, mesas, tables
--
-- 3. Crea tu usuario admin desde: Supabase → Authentication → Users → Add user
--    Email: admin@antojitos.com   Password: Admin2024!
--
-- 4. Inserta el perfil admin (reemplaza <UUID> con el UUID del paso anterior):
--    insert into public.users (id, email, name, role, avatar, color)
--    values ('<UUID>', 'admin@antojitos.com', 'Miguel Admin', 'admin', '👑', '#f5a623');
--
-- 5. Abre mesero.html en el navegador, abre DevTools → Consola.
--    Al enviar una comanda debe aparecer:
--      [DB] INSERT orders → { mesa, zone, waiter, total }
--      [DB] orders INSERT OK — id: xxxxxxxx-...
--    Si aparece error 42501 → las políticas RLS no se aplicaron, repite el script.
-- ══════════════════════════════════════════════════════════════════════════════
