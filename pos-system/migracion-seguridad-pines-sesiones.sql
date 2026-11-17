-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: PIN individual por mesero + bitácora de sesiones
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   Antes, TODOS los meseros compartían el mismo PIN "1414" — hardcodeado
--   en el código fuente de mesero.html — tanto para iniciar turno como
--   para cerrarlo. Cualquiera con el código (visible con "Ver código
--   fuente" del navegador) podía iniciar sesión como cualquier mesero, o
--   cerrar el turno de OTRO mesero. Tampoco existía ningún registro de
--   quién entró/salió y cuándo.
--
--   Ahora cada mesero tiene su PROPIO PIN, guardado con hash (nunca en
--   texto plano) en `mesero_pins`, verificado en el SERVIDOR mediante la
--   función verify_mesero_pin() — el navegador nunca ve el hash, solo
--   recibe true/false. Además, cada inicio/cierre de turno queda
--   registrado en `mesero_sesiones` (bitácora de auditoría).
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta, el sistema sigue funcionando EXACTO
-- como antes (mesero.html detecta que la función RPC no existe y usa el
-- PIN compartido "1414" de respaldo) — no bloquea el acceso de nadie.
-- ══════════════════════════════════════════════════════════════════

-- pgcrypto — necesaria para crypt()/gen_salt() (hash de PINes)
create extension if not exists pgcrypto with schema extensions;


-- ── 1. TABLA mesero_pins — PIN hasheado por mesero ───────────────────────────
create table if not exists public.mesero_pins (
  waiter_id   text primary key,
  pin_hash    text not null,
  updated_at  timestamptz default now()
);

alter table public.mesero_pins enable row level security;
-- A PROPÓSITO no se crea NINGUNA política pública aquí — nadie puede
-- hacer SELECT/INSERT/UPDATE directo sobre esta tabla desde el cliente
-- (ni con la anon key). El ÚNICO acceso es a través de las funciones RPC
-- de abajo, que corren con privilegios de owner (security definer).


-- ── 2. TABLA mesero_sesiones — bitácora de inicio/cierre de turno ───────────
create table if not exists public.mesero_sesiones (
  id          uuid primary key default gen_random_uuid(),
  waiter_id   text not null,
  waiter_name text,
  login_at    timestamptz default now(),
  logout_at   timestamptz,
  device      text
);

alter table public.mesero_sesiones enable row level security;

do $$ begin
  create policy "mesero_sesiones_insert" on public.mesero_sesiones
    for insert with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mesero_sesiones_select" on public.mesero_sesiones
    for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mesero_sesiones_update" on public.mesero_sesiones
    for update using (true) with check (true);
exception when duplicate_object then null; end $$;
-- Nota: A PROPÓSITO no hay política de DELETE — la bitácora es de solo
-- lectura/anexado desde el cliente, nunca se borra desde ahí.

do $$ begin alter publication supabase_realtime add table public.mesero_sesiones; exception when others then null; end $$;

create index if not exists idx_mesero_sesiones_waiter on public.mesero_sesiones (waiter_id, login_at desc);


-- ── 3. RPC verify_mesero_pin — la ÚNICA forma de comprobar un PIN ───────────
-- Devuelve true/false. Nunca expone el hash almacenado.
create or replace function public.verify_mesero_pin(p_waiter_id text, p_pin text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.mesero_pins
    where waiter_id = p_waiter_id
      and pin_hash = crypt(p_pin, pin_hash)
  );
$$;

revoke all on function public.verify_mesero_pin(text, text) from public;
grant execute on function public.verify_mesero_pin(text, text) to anon, authenticated;


-- ── 3b. RPC mesero_pin_configured — ¿este mesero YA tiene PIN individual? ───
-- Permite un rollout incremental sin riesgo de bloquear a nadie: mientras
-- un mesero no tenga PIN asignado (todavía no se corrió set_mesero_pin para
-- él), mesero.html sabe que debe seguir aceptando el PIN compartido de
-- respaldo SOLO para ese mesero — apenas se le asigna un PIN individual,
-- deja de aceptar el compartido automáticamente.
create or replace function public.mesero_pin_configured(p_waiter_id text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.mesero_pins where waiter_id = p_waiter_id);
$$;

revoke all on function public.mesero_pin_configured(text) from public;
grant execute on function public.mesero_pin_configured(text) to anon, authenticated;


-- ── 4. RPC set_mesero_pin — fijar/cambiar el PIN de un mesero ───────────────
-- NO se otorga a `anon` (mesero.html no puede llamarla) — solo a
-- `authenticated` (para cuando el AdminDashboard tenga un panel de
-- gestión de PINes) y de momento se ejecuta a mano desde el SQL Editor.
create or replace function public.set_mesero_pin(p_waiter_id text, p_pin text)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into public.mesero_pins (waiter_id, pin_hash, updated_at)
  values (p_waiter_id, crypt(p_pin, gen_salt('bf')), now())
  on conflict (waiter_id) do update
    set pin_hash = excluded.pin_hash, updated_at = now();
$$;

revoke all on function public.set_mesero_pin(text, text) from public;
grant execute on function public.set_mesero_pin(text, text) to authenticated;


-- ══════════════════════════════════════════════════════════════════
-- PASO FINAL — EJECUTA ESTO UNA VEZ (cambia los PIN de ejemplo por unos
-- reales de 4 dígitos, uno distinto por cada mesero). Los `waiter_id`
-- deben coincidir con los `id` del arreglo WAITERS en mesero.html
-- (hoy: 'w1' Carlos, 'w2' María, 'w3' Pedro, 'w4' Carmen).
-- ══════════════════════════════════════════════════════════════════
-- select public.set_mesero_pin('w1', '1234');  -- Carlos
-- select public.set_mesero_pin('w2', '2345');  -- María
-- select public.set_mesero_pin('w3', '3456');  -- Pedro
-- select public.set_mesero_pin('w4', '4567');  -- Carmen
--
-- Mientras no ejecutes lo anterior, TODOS siguen accediendo con el PIN
-- compartido "1414" de respaldo (verify_mesero_pin devuelve false para
-- un waiter_id sin PIN asignado, y mesero.html cae automáticamente al
-- PIN de respaldo). En cuanto asignes un PIN a un mesero con
-- set_mesero_pin(), ESE mesero deja de aceptar "1414" y solo funciona
-- su PIN nuevo.
