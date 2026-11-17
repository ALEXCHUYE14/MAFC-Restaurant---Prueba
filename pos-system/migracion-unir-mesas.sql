-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Unir mesas (grupos grandes que ocupan 2 o más mesas)
-- ══════════════════════════════════════════════════════════════════
-- Cómo funciona:
--   · Una mesa es la PRINCIPAL (la que tiene el pedido y la cuenta).
--   · Las otras quedan "unidas a" ella (columna mesas.unida_a): se ven
--     ocupadas y, al tocarlas, el mesero va directo a la mesa principal.
--   · Una mesa unida NO puede tener pedido propio (la base de datos lo
--     impide: 'MESA_UNIDA'), así no hay dos cuentas para el mismo grupo.
--   · Al liberar la mesa principal (cobro, anulación, cierre de turno),
--     sus mesas unidas se liberan SOLAS (trigger), desde cualquier app.
--
-- Seguridad / concurrencia:
--   · Solo se pueden unir mesas LIBRES y sin pedido abierto.
--   · Usa el mismo bloqueo por mesa que migracion-concurrencia-mesas.sql:
--     si alguien envía un pedido a una mesa justo mientras otro la une,
--     uno espera al otro y nunca quedan las dos cosas a la vez.
--   · La columna unida_a solo cambia por estas funciones (un UPDATE directo
--     desde la app no puede alterarla).
--
-- Seguro de ejecutar más de una vez. No modifica datos existentes.
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

alter table public.mesas add column if not exists unida_a integer;
create index if not exists idx_mesas_unida_a on public.mesas (unida_a) where unida_a is not null;

-- ── 1. Protección de la columna + liberar = separar ────────────────
create or replace function public._mesas_union_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.unida_a is distinct from old.unida_a
       and coalesce(current_setting('pos.union_rpc', true), '') <> '1' then
      new.unida_a := old.unida_a;            -- solo las funciones de abajo la cambian
    end if;
  elsif coalesce(current_setting('pos.union_rpc', true), '') <> '1' then
    new.unida_a := null;                     -- INSERT
  end if;
  if new.estado = 'libre' then
    new.unida_a := null;                     -- una mesa libre ya no está unida
  end if;
  return new;
end $$;
revoke all on function public._mesas_union_guard() from public, anon, authenticated;

drop trigger if exists trg_mesas_union_guard on public.mesas;
create trigger trg_mesas_union_guard
  before insert or update on public.mesas
  for each row execute function public._mesas_union_guard();

-- ── 2. Al liberar la principal, se liberan sus mesas unidas ────────
create or replace function public._mesas_union_cascade()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'libre' and old.estado is distinct from 'libre' then
    update public.mesas
       set estado = 'libre', mesero_nombre = null, mesero_color = null, ultima_actualizacion = now()
     where unida_a = new.numero_mesa;
  end if;
  return null;
end $$;
revoke all on function public._mesas_union_cascade() from public, anon, authenticated;

drop trigger if exists trg_mesas_union_cascade on public.mesas;
create trigger trg_mesas_union_cascade
  after update of estado on public.mesas
  for each row execute function public._mesas_union_cascade();

-- ── 3. Una mesa unida no puede abrir pedido propio ─────────────────
create or replace function public._orders_mesa_unida()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_p integer;
begin
  if coalesce(new.table_number, 0) <= 0 then return new; end if;
  if coalesce(new.status, 'pending') like 'Pagado%'
     or coalesce(new.status, 'pending') in ('paid', 'served', 'archivado', 'anulado') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('pos_mesa_abierta'), new.table_number);
  select unida_a into v_p from public.mesas where numero_mesa = new.table_number;
  if v_p is not null then
    raise exception 'MESA_UNIDA:%', v_p;
  end if;
  return new;
end $$;
revoke all on function public._orders_mesa_unida() from public, anon, authenticated;

drop trigger if exists trg_orders_mesa_unida on public.orders;
create trigger trg_orders_mesa_unida
  before insert on public.orders
  for each row execute function public._orders_mesa_unida();

-- ── 4. Unir ───────────────────────────────────────────────────────
create or replace function public.unir_mesas(p_principal integer, p_mesas integer[])
returns integer[]
language plpgsql security definer set search_path = public as $$
declare
  v_n      integer;
  v_all    integer[];
  v_sec    integer[];
  v_owner  text;
  v_color  text;
begin
  if p_principal is null or p_principal <= 0 or p_mesas is null then raise exception 'UNION_INVALID'; end if;
  v_sec := array(select distinct x from unnest(p_mesas) x where x is not null and x > 0 and x <> p_principal order by x);
  if cardinality(v_sec) = 0 or cardinality(v_sec) > 10 then raise exception 'UNION_INVALID'; end if;

  -- Bloqueos por mesa, siempre en el mismo orden (sin bloqueos cruzados)
  v_all := array(select distinct x from unnest(v_sec || p_principal) x order by x);
  foreach v_n in array v_all loop
    perform pg_advisory_xact_lock(hashtext('pos_mesa_abierta'), v_n);
  end loop;

  -- La principal debe estar ocupada (con su pedido) y no estar unida a otra
  select mesero_nombre, mesero_color into v_owner, v_color
    from public.mesas
   where numero_mesa = p_principal and estado = 'ocupada' and unida_a is null
   for update;
  if not found then raise exception 'UNION_PRINCIPAL'; end if;

  foreach v_n in array v_sec loop
    perform 1 from public.mesas
     where numero_mesa = v_n and estado = 'libre' and unida_a is null
     for update;
    if not found then raise exception 'MESA_NO_LIBRE:%', v_n; end if;
    if exists (select 1 from public.mesas where unida_a = v_n) then
      raise exception 'MESA_NO_LIBRE:%', v_n;
    end if;
    if exists (
      select 1 from public.orders o
       where o.table_number = v_n
         and coalesce(o.status, '') not like 'Pagado%'
         and coalesce(o.status, '') not in ('paid', 'served', 'archivado', 'anulado')
         and o.created_at > now() - interval '18 hours'
    ) then
      raise exception 'MESA_NO_LIBRE:%', v_n;
    end if;
  end loop;

  perform set_config('pos.union_rpc', '1', true);
  update public.mesas
     set unida_a = p_principal, estado = 'ocupada',
         mesero_nombre = v_owner, mesero_color = v_color, ultima_actualizacion = now()
   where numero_mesa = any(v_sec);
  perform set_config('pos.union_rpc', '', true);
  return v_sec;
end $$;
revoke all on function public.unir_mesas(integer, integer[]) from public;
grant execute on function public.unir_mesas(integer, integer[]) to anon, authenticated;

-- ── 5. Separar (todas, o solo una) ─────────────────────────────────
create or replace function public.separar_mesas(p_principal integer, p_mesa integer default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if p_principal is null then raise exception 'UNION_INVALID'; end if;
  perform set_config('pos.union_rpc', '1', true);
  update public.mesas
     set unida_a = null, estado = 'libre', mesero_nombre = null, mesero_color = null, ultima_actualizacion = now()
   where unida_a = p_principal and (p_mesa is null or numero_mesa = p_mesa);
  get diagnostics v_count = row_count;
  perform set_config('pos.union_rpc', '', true);
  return v_count;
end $$;
revoke all on function public.separar_mesas(integer, integer) from public;
grant execute on function public.separar_mesas(integer, integer) to anon, authenticated;

notify pgrst, 'reload schema';
