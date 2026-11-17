-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Correcciones de SEGURIDAD (auditoría del sistema)
-- ══════════════════════════════════════════════════════════════════
-- La clave pública (anon) del sistema viaja dentro de las apps del
-- mesero, la cocina y la carta: cualquiera puede leerla. Lo que protege
-- los datos son estos permisos de la base de datos. Esta migración
-- cierra 3 huecos encontrados en la auditoría:
--
--   1. CIERRE DE CAJA abierto a cualquiera
--      cerrar_caja_reset, cerrar_caja_y_reiniciar_dia,
--      cerrar_caja_y_reiniciar_jornada y ejecutar_cierre_caja_total
--      tenían permiso para el rol anónimo: cualquiera con la clave
--      pública podía archivar todos los pedidos, liberar todas las mesas
--      y BORRAR las ventas del día de los meseros. Ahora solo usuarios
--      con sesión iniciada (el panel admin, que es quien las usa).
--
--   2. PEDIDOS YA COBRADOS se podían modificar sin sesión
--      Un trigger impide que el acceso anónimo (mesero/cocina/carta):
--        · cambie total, productos o pago de un pedido cobrado/anulado,
--        · reabra un pedido cobrado (solo puede ARCHIVARLO, como hace
--          la cocina al cerrar sesión),
--        · marque un pedido como 'anulado' (solo el admin, con su función),
--        · cree pedidos que ya nazcan cobrados (inflaría las ventas).
--      Nada de lo que hacen hoy el mesero y la cocina queda bloqueado:
--      crear pedidos pendientes, agregar rondas, quitar productos, cobrar
--      un pedido ABIERTO, cambiar el estado de cocina y archivar.
--      También evita un caso real: que cocina, marcando una ronda justo
--      cuando el mesero cobra, devolviera el pedido a "listo".
--
--   3. inventory y tables se podían editar sin sesión
--      Solo el panel admin las edita: ahora exigen sesión iniciada.
--
-- El panel administrativo (con sesión) NO tiene ninguna restricción nueva.
-- Seguro de ejecutar más de una vez.
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Cierre de caja: solo con sesión iniciada ────────────────────
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.cerrar_caja_reset()',
    'public.cerrar_caja_y_reiniciar_dia()',
    'public.cerrar_caja_y_reiniciar_jornada()',
    'public.ejecutar_cierre_caja_total()'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon', fn);
      execute format('grant execute on function %s to authenticated', fn);
    end if;
  end loop;
end
$$;

-- ── 2. Guardia de pedidos para el acceso anónimo ───────────────────
create or replace function public._orders_guard_anon()
returns trigger
language plpgsql
as $$
declare
  v_role   text;
  v_closed boolean;
  v_new    jsonb;
  v_old    jsonb;
  k        text;
begin
  begin
    v_role := coalesce(auth.role(), '');
  exception when others then
    v_role := '';
  end;
  -- Solo aplica al acceso anónimo. Admin (authenticated), SQL Editor y
  -- funciones del servidor no tienen restricción nueva.
  if v_role <> 'anon' then
    return new;
  end if;

  -- Se compara vía jsonb: así funciona aunque alguna columna opcional
  -- (p. ej. payment_breakdown) no exista en esta base de datos.
  v_new := to_jsonb(new);

  if tg_op = 'INSERT' then
    if coalesce(new.status, 'pending') <> 'pending'
       or coalesce(v_new->>'paid_at', '') <> ''
       or jsonb_typeof(v_new->'payment_breakdown') = 'array' then
      raise exception 'ORDER_INSERT_NOT_ALLOWED: un pedido nuevo debe crearse como pendiente';
    end if;
    return new;
  end if;

  -- UPDATE
  v_old := to_jsonb(old);
  v_closed := coalesce(old.status, '') like 'Pagado%'
              or coalesce(old.status, '') in ('paid', 'anulado', 'archivado');

  if v_closed then
    -- Un pedido cerrado solo puede archivarse (o quedar igual)
    if new.status is distinct from old.status and new.status <> 'archivado' then
      raise exception 'ORDER_CLOSED: el pedido ya está cerrado';
    end if;
    foreach k in array array['total', 'items', 'payment_method', 'payment_breakdown', 'paid_at', 'table_number'] loop
      if (v_new -> k) is distinct from (v_old -> k) then
        raise exception 'ORDER_CLOSED: no se puede modificar un pedido ya cobrado';
      end if;
    end loop;
  else
    -- Anular es solo del administrador (función anular_pedido)
    if new.status = 'anulado' then
      raise exception 'NOT_ALLOWED: solo el administrador puede anular pedidos';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists trg_orders_guard_anon on public.orders;
create trigger trg_orders_guard_anon
  before insert or update on public.orders
  for each row execute function public._orders_guard_anon();

-- ── 3. inventory y tables: solo con sesión iniciada ────────────────
do $$ begin
  if to_regclass('public.inventory') is not null then
    drop policy if exists "inventory_update" on public.inventory;
    create policy "inventory_update" on public.inventory
      for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
  if to_regclass('public.tables') is not null then
    drop policy if exists "tables_update" on public.tables;
    create policy "tables_update" on public.tables
      for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;

-- ── 4. PIN del mesero: límite de intentos ──────────────────────────
-- verify_mesero_pin no limitaba los intentos: con 10.000 PIN posibles,
-- un programa podía probarlos todos en minutos. Ahora: 5 fallos seguidos
-- bloquean ESE perfil 5 minutos (un acierto reinicia el contador).
-- Misma firma y mismo resultado (true/false); bloqueado → error PIN_LOCKED.
-- Solo se aplica si ya existe la tabla de PINs (migracion-seguridad-pines-sesiones.sql).
create table if not exists public.mesero_pin_intentos (
  waiter_id     text        primary key,
  fallos        integer     not null default 0,
  bloqueado_hasta timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.mesero_pin_intentos enable row level security;
-- (sin políticas a propósito: solo la escribe verify_mesero_pin)

do $outer$
begin
  if to_regclass('public.mesero_pins') is not null then
    execute $fn$
      create or replace function public.verify_mesero_pin(p_waiter_id text, p_pin text)
      returns boolean
      language plpgsql
      security definer
      set search_path = public, extensions   -- crypt() de pgcrypto, esté donde esté instalada
      as $body$
      declare
        v_ok    boolean;
        v_lock  timestamptz;
      begin
        if p_waiter_id is null or p_pin is null or length(p_pin) > 20 then
          return false;
        end if;

        insert into public.mesero_pin_intentos (waiter_id) values (p_waiter_id)
        on conflict do nothing;
        select bloqueado_hasta into v_lock
          from public.mesero_pin_intentos where waiter_id = p_waiter_id
          for update;
        if v_lock is not null and v_lock > now() then
          raise exception 'PIN_LOCKED';
        end if;

        select exists (
          select 1 from public.mesero_pins
           where waiter_id = p_waiter_id
             and pin_hash = crypt(p_pin, pin_hash)
        ) into v_ok;

        if v_ok then
          update public.mesero_pin_intentos
             set fallos = 0, bloqueado_hasta = null, updated_at = now()
           where waiter_id = p_waiter_id;
        else
          update public.mesero_pin_intentos
             set fallos = fallos + 1,
                 bloqueado_hasta = case when fallos + 1 >= 5 then now() + interval '5 minutes' else null end,
                 updated_at = now()
           where waiter_id = p_waiter_id;
          update public.mesero_pin_intentos
             set fallos = 0
           where waiter_id = p_waiter_id and bloqueado_hasta is not null;   -- reinicia el conteo tras bloquear
        end if;

        return v_ok;
      end
      $body$;
    $fn$;
    execute 'revoke all on function public.verify_mesero_pin(text, text) from public';
    execute 'grant execute on function public.verify_mesero_pin(text, text) to anon, authenticated';
  end if;
end
$outer$;

notify pgrst, 'reload schema';
