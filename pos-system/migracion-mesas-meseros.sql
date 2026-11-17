-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Agregar mesas y perfiles de meseros desde Ajustes
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   Las 30 mesas (3 zonas) y los 4 meseros estaban escritos a mano en el
--   código de mesero.html y del panel admin — agregar una mesa o un mesero
--   exigía editar código. Esta migración permite que el admin los cree
--   desde Ajustes y que mesero.html los vea en tiempo real.
--
--   1) MESAS — la tabla `mesas` ya es la fuente de verdad de la ocupación.
--      Se agrega la columna `zona` (a qué zona pertenece una mesa NUEVA;
--      las 30 originales siguen usando sus rangos de siempre, zona = null)
--      y dos políticas SOLO admin:
--        · INSERT — crear mesas nuevas.
--        · DELETE — quitar una mesa NUEVA (número > 30) que esté libre.
--      Las 30 mesas originales nunca se pueden borrar (los pedidos
--      históricos y el cierre de caja las usan). El resto de políticas de
--      `mesas` (select/update públicos que usa mesero.html) queda intacto.
--      Además crea las filas de las 30 mesas base que falten (el esquema
--      original solo sembró 1-15).
--
--   2) MESEROS — tabla nueva `meseros` (perfil que aparece en el login de
--      mesero.html). Se siembran los 4 de siempre con los mismos ids
--      (w1..w4), nombres y colores. Lectura pública (el login de mesero.html
--      es anónimo y necesita la lista); crear/editar solo admin. NO hay
--      DELETE: un mesero con historial de ventas/pedidos no se borra, se
--      DESACTIVA (active = false) y deja de aparecer en el login.
--
--   El PIN de cada mesero NO vive aquí: sigue en `mesero_pins` y se asigna
--   con la función set_mesero_pin() de migracion-seguridad-pines-sesiones.sql
--   (Ajustes la llama al crear el perfil). Un mesero SIN PIN propio acepta el
--   PIN compartido de respaldo — por eso Ajustes exige un PIN al crearlo.
--
-- Requiere haber corrido antes migracion-egresos-stock.sql (define
-- public.get_user_role()). Para asignar PIN desde Ajustes, además
-- migracion-seguridad-pines-sesiones.sql.
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta, el sistema sigue EXACTO como antes
-- (30 mesas y 4 meseros) y Ajustes avisa qué falta.
-- ══════════════════════════════════════════════════════════════════


-- ── 1. MESAS ─────────────────────────────────────────────────────────────────
alter table public.mesas add column if not exists zona text;

do $$ begin
  create policy "mesas_insert_admin" on public.mesas
    for insert with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

-- Solo mesas AGREGADAS (número > 30) y solo si están libres.
do $$ begin
  create policy "mesas_delete_admin_extra" on public.mesas
    for delete using (
      public.get_user_role() = 'admin'
      and numero_mesa > 30
      and estado = 'libre'
    );
exception when duplicate_object then null; end $$;


-- ── 1b. Las 30 mesas base como FILAS de la tabla ────────────────────────────
-- El esquema original (supabase-schema.sql) solo sembró las mesas 1 a 15; las
-- 16-30 existían únicamente en el código. Sin fila, `updateMesaEstado` no
-- encuentra qué actualizar y la ocupación de esa mesa no se comparte entre
-- meseros. Se crean las que falten (no toca las existentes). `mesas.id` es
-- TEXT ('table-1') en el esquema base y autogenerado en otras versiones — se
-- detecta cuál es. (Ajustes también puede crearlas con un clic si prefieres
-- no correr esto.)
do $$
declare
  id_type text;
begin
  select data_type into id_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'mesas' and column_name = 'id';

  if id_type in ('text', 'character varying') then
    insert into public.mesas (id, numero_mesa, estado)
    select 'table-' || n, n, 'libre' from generate_series(1, 30) as n
    on conflict do nothing;
  else
    insert into public.mesas (numero_mesa, estado)
    select n, 'libre' from generate_series(1, 30) as n
    on conflict do nothing;
  end if;
end $$;


-- ── 2. MESEROS ───────────────────────────────────────────────────────────────
create table if not exists public.meseros (
  id          text primary key,                       -- 'w1'..'w4' originales; 'w5', 'w6'… nuevos
  name        text not null,
  color       text not null default '#f5a623',        -- #RRGGBB
  initial     text,                                   -- letra del avatar (si es null: 1ª letra del nombre)
  active      boolean not null default true,          -- false = ya no aparece en el login
  sort_order  integer not null default 0,
  created_at  timestamptz default now()
);

-- Un nombre no puede repetirse: mesas.mesero_nombre identifica al mesero por nombre.
create unique index if not exists meseros_name_unique on public.meseros (lower(name));

insert into public.meseros (id, name, color, initial, active, sort_order) values
  ('w1', 'Carlos', '#f5a623', 'C', true, 1),
  ('w2', 'María',  '#e63946', 'M', true, 2),
  ('w3', 'Pedro',  '#3b9eff', 'P', true, 3),
  ('w4', 'Carmen', '#2ecc71', 'K', true, 4)
on conflict (id) do nothing;

alter table public.meseros enable row level security;

do $$ begin
  create policy "meseros_select_public" on public.meseros
    for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "meseros_insert_admin" on public.meseros
    for insert with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "meseros_update_admin" on public.meseros
    for update using (public.get_user_role() = 'admin')
    with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
-- A propósito NO hay política de DELETE — se desactivan, no se borran.

-- Realtime — para que un perfil nuevo o una mesa nueva llegue a mesero.html sin recargar.
do $$ begin
  alter publication supabase_realtime add table public.meseros;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.mesas;
exception when others then null; end $$;
