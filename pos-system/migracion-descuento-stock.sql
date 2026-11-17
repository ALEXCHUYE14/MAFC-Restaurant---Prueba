-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Descuento de stock ATÓMICO (admin) + ventas del MESERO
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   1. Las ventas del mesero NO descontaban stock (solo el POS del admin),
--      así que con muchos pedidos las cantidades de Stock se desfasaban.
--   2. El descuento del admin calculaba el stock nuevo con el número que
--      tenía en pantalla ("había 10, vendí 2 → guardo 8"). Si dos ventas
--      coincidían, una se perdía.
--
--   Ahora el descuento se hace DENTRO de la base de datos en una sola
--   operación (stock = stock − cantidad): si dos ventas coinciden, se
--   restan ambas. Nunca baja de 0, y al llegar a 0 el producto queda
--   "Agotado" para todos al instante (Realtime ya lo propaga).
--   Solo se descuentan productos con stock controlado (stock no nulo);
--   los "sin límite (∞)" no se tocan.
--
--   · deduct_menu_stock(items)                → POS del admin (solo admin)
--   · deduct_order_round_stock(pedido, ronda) → mesero, al enviar cada
--     ronda a cocina. Descuenta EXACTAMENTE lo que quedó guardado en esa
--     ronda del pedido (no lo que diga el celular) y UNA sola vez por
--     ronda aunque se reintente (tabla stock_deducciones).
--
-- Seguridad:
--   · deduct_menu_stock exige rol admin (public.get_user_role()).
--   · deduct_order_round_stock la usa el mesero (anónimo por diseño), por
--     eso corre con permisos elevados PERO solo puede restar las
--     cantidades de una ronda real ya guardada, una única vez. No permite
--     fijar stock, precios ni nada más.
--   · La tabla stock_deducciones no es accesible desde la app (RLS sin
--     políticas): solo la escriben estas funciones.
--
-- Requiere: migracion-egresos-stock.sql (public.get_user_role) y la
-- columna orders.rounds (migracion-comanda-rondas.sql).
-- Seguro de ejecutar más de una vez. Si NO se ejecuta, todo funciona
-- como antes (el mesero simplemente no descuenta).
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- Registro de rondas ya descontadas (evita descontar dos veces)
create table if not exists public.stock_deducciones (
  order_id   uuid        not null,
  round_n    integer     not null,
  created_at timestamptz not null default now(),
  primary key (order_id, round_n)
);
alter table public.stock_deducciones enable row level security;
-- (sin políticas a propósito: la app no la lee ni la escribe directamente)

-- ── Núcleo interno: resta cantidades de forma atómica ──────────────────────
-- p_items: [{ id, qty }, …] — ids que no sean uuid (menú estático) se ignoran.
-- Devuelve los productos actualizados: [{ id, name, stock }].
create or replace function public._deduct_menu_items(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return '[]'::jsonb; end if;

  with req as (
    select lower(e->>'id') as id,
           sum(least(greatest(floor(coalesce((e->>'qty')::numeric, 0)), 0), 1000))::int as qty
      from jsonb_array_elements(p_items) e
     where jsonb_typeof(e) = 'object'
       and (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and (e->>'qty') ~ '^[0-9]+(\.[0-9]+)?$'
     group by 1
  ), upd as (
    update public.menu_items m
       set stock      = greatest(0, m.stock - r.qty),
           available  = case when m.stock - r.qty <= 0 then false else m.available end,
           updated_at = now()
      from req r
     where m.id = r.id::uuid
       and m.stock is not null
       and r.qty > 0
    returning m.id, m.name, m.stock
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'stock', stock)), '[]'::jsonb)
    into v_out
    from upd;

  return v_out;
end
$$;
revoke all on function public._deduct_menu_items(jsonb) from public, anon, authenticated;

-- ── 1. Admin (POS / pedidos externos) ──────────────────────────────────────
create or replace function public.deduct_menu_stock(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then
    raise exception 'NOT_ALLOWED';
  end if;
  return public._deduct_menu_items(p_items);
end
$$;
revoke all on function public.deduct_menu_stock(jsonb) from public, anon;
grant execute on function public.deduct_menu_stock(jsonb) to authenticated;

-- ── 2. Mesero: descontar UNA ronda ya guardada de un pedido ───────────────
-- Devuelve { already: true } si esa ronda ya se había descontado, o
-- { already: false, items: [{id,name,stock}] } con lo que se descontó.
create or replace function public.deduct_order_round_stock(p_order_id uuid, p_round_n integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rounds jsonb;
  v_round  jsonb;
begin
  if p_order_id is null or p_round_n is null or p_round_n < 1 then raise exception 'ROUND_INVALID'; end if;

  -- Una sola vez por ronda: si ya existe el registro, no se descuenta de nuevo
  insert into public.stock_deducciones (order_id, round_n)
  values (p_order_id, p_round_n)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('already', true);
  end if;

  select rounds into v_rounds from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_rounds is null or jsonb_typeof(v_rounds) <> 'array' then raise exception 'ROUND_NOT_FOUND'; end if;

  select r into v_round
    from jsonb_array_elements(v_rounds) r
   where (r->>'n') ~ '^[0-9]+$' and (r->>'n')::int = p_round_n
   limit 1;
  if v_round is null then raise exception 'ROUND_NOT_FOUND'; end if;

  return jsonb_build_object('already', false, 'items', public._deduct_menu_items(v_round->'items'));
end
$$;
revoke all on function public.deduct_order_round_stock(uuid, integer) from public;
grant execute on function public.deduct_order_round_stock(uuid, integer) to anon, authenticated;

notify pgrst, 'reload schema';
