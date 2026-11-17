-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Rondas de pedido ATÓMICAS (evita perder una ronda)
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   Mesero y cocina guardaban la lista COMPLETA de rondas (`orders.rounds`)
--   a partir de la copia que tenían en pantalla. Si en el mismo instante el
--   mesero agregaba la Ronda 2 y cocina marcaba "Lista" la Ronda 1 (con una
--   copia que aún no tenía la Ronda 2), cocina sobrescribía la lista y la
--   Ronda 2 DESAPARECÍA: no se preparaba ni se servía. Con muchos meseros y
--   pedidos, esa coincidencia de segundos se vuelve frecuente.
--
--   Estas dos funciones hacen el cambio DENTRO de la base de datos, en un
--   solo paso y con el pedido bloqueado (SELECT … FOR UPDATE): si dos
--   personas actúan a la vez, la segunda espera milisegundos y trabaja
--   sobre lo que guardó la primera. Ya no se puede pisar una ronda.
--
--   · append_order_round      → el mesero agrega una ronda nueva
--   · set_order_round_status  → cocina cambia el estado de UNA ronda
--
--   Misma lógica que tenía el código (número de ronda, estado agregado
--   pending/preparing/ready, bloqueo si el pedido ya fue pagado).
--
-- Seguridad: SECURITY INVOKER → se ejecutan con los MISMOS permisos de
-- quien llama (las mismas políticas RLS de `orders` de hoy). No abren
-- ningún acceso nuevo.
--
-- Seguro de ejecutar más de una vez. Si NO se ejecuta, la app sigue
-- funcionando como antes (detecta que las funciones no existen y usa el
-- método anterior).
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- Estado agregado de un pedido a partir de sus rondas (igual que
-- aggregateRoundsStatus en mesero/cocina).
create or replace function public.orders_rounds_status(p_rounds jsonb)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_rounds is null or jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) = 0 then 'pending'
    when exists (select 1 from jsonb_array_elements(p_rounds) r where r->>'status' = 'pendiente') then 'pending'
    when exists (select 1 from jsonb_array_elements(p_rounds) r where r->>'status' = 'en_cocina') then 'preparing'
    else 'ready'
  end
$$;

-- ── 1. Mesero: agregar una ronda a un pedido existente ─────────────────────
-- p_items = carrito COMPLETO acumulado (histórico + nuevo), como hasta hoy.
-- p_round = la ronda nueva (su número lo asigna la base de datos).
-- Devuelve { prev_status, round } (round incluye el número `n` definitivo).
create or replace function public.append_order_round(p_order_id uuid, p_items jsonb, p_round jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status text;
  v_rounds jsonb;
  v_round  jsonb;
  v_all    jsonb;
  v_total  numeric;
begin
  if p_order_id is null then raise exception 'ORDER_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'ITEMS_INVALID';
  end if;
  if p_round is null or jsonb_typeof(p_round) <> 'object' then raise exception 'ROUND_INVALID'; end if;

  -- Bloquea el pedido hasta terminar: nadie más puede cambiarlo a la vez
  select status, rounds into v_status, v_rounds
    from public.orders where id = p_order_id
    for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_status like 'Pagado%' or v_status in ('paid', 'served', 'archivado') then
    raise exception 'ORDER_PAID';
  end if;

  if v_rounds is null or jsonb_typeof(v_rounds) <> 'array' then v_rounds := '[]'::jsonb; end if;

  v_round := p_round || jsonb_build_object('n', jsonb_array_length(v_rounds) + 1);
  v_all   := v_rounds || jsonb_build_array(v_round);

  select coalesce(sum(coalesce((e->>'price')::numeric, 0) * coalesce((e->>'qty')::numeric, 0)), 0)
    into v_total
    from jsonb_array_elements(p_items) e;

  update public.orders set
    items       = p_items,
    total       = round(v_total, 2),
    is_modified = true,
    rounds      = v_all,
    status      = public.orders_rounds_status(v_all),
    updated_at  = now()
  where id = p_order_id;

  return jsonb_build_object('prev_status', v_status, 'round', v_round);
end
$$;

-- ── 2. Cocina: cambiar el estado de UNA ronda ──────────────────────────────
-- p_status: 'pendiente' | 'en_cocina' | 'listo'
-- Devuelve { rounds, status } ya guardados.
create or replace function public.set_order_round_status(p_order_id uuid, p_round_n integer, p_status text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_rounds jsonb;
  v_new    jsonb;
  v_now    jsonb := to_jsonb(to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  v_agg    text;
begin
  if p_order_id is null or p_round_n is null then raise exception 'ROUND_INVALID'; end if;
  if p_status not in ('pendiente', 'en_cocina', 'listo') then raise exception 'STATUS_INVALID'; end if;

  select rounds into v_rounds
    from public.orders where id = p_order_id
    for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_rounds is null or jsonb_typeof(v_rounds) <> 'array' then raise exception 'ROUND_NOT_FOUND'; end if;

  if not exists (
    select 1 from jsonb_array_elements(v_rounds) r
    where (r->>'n') ~ '^[0-9]+$' and (r->>'n')::int = p_round_n
  ) then
    raise exception 'ROUND_NOT_FOUND';
  end if;

  select jsonb_agg(
           case when (r->>'n') ~ '^[0-9]+$' and (r->>'n')::int = p_round_n then
             r
             || jsonb_build_object('status', p_status)
             || case when p_status = 'en_cocina'
                     then jsonb_build_object('startedAt', coalesce(nullif(r->'startedAt', 'null'::jsonb), v_now))
                     else '{}'::jsonb end
             || case when p_status = 'listo'
                     then jsonb_build_object('readyAt', v_now)
                     else '{}'::jsonb end
           else r end
           order by t.ord)
    into v_new
    from jsonb_array_elements(v_rounds) with ordinality as t(r, ord);

  v_agg := public.orders_rounds_status(v_new);

  update public.orders set
    rounds      = v_new,
    status      = v_agg,
    is_modified = false,
    updated_at  = now()
  where id = p_order_id;

  return jsonb_build_object('rounds', v_new, 'status', v_agg);
end
$$;

-- Mismos usuarios que hoy usan la tabla `orders` (mesero/cocina = anon,
-- panel admin = authenticated). Las políticas RLS siguen aplicando.
grant execute on function public.orders_rounds_status(jsonb)                     to anon, authenticated;
grant execute on function public.append_order_round(uuid, jsonb, jsonb)          to anon, authenticated;
grant execute on function public.set_order_round_status(uuid, integer, text)     to anon, authenticated;

-- Que la API (PostgREST) vea las funciones nuevas de inmediato
notify pgrst, 'reload schema';
