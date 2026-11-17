-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Devolución automática de stock de PRODUCTOS
-- ══════════════════════════════════════════════════════════════════
-- Corrige dos casos en los que el stock de productos (bebidas,
-- cervezas, platos con stock controlado) quedaba desfasado:
--
--   1. MESERO QUITA UN PRODUCTO YA ENVIADO A COCINA
--      Al enviar una ronda, el stock se descuenta (migracion-descuento-
--      stock.sql). Si luego el cliente cancela, por ejemplo, una cerveza y
--      el mesero la quita del pedido, ahora esa unidad VUELVE al stock.
--      → función return_order_item_stock(pedido, producto, cantidad)
--
--   2. SE ELIMINA UNA COMPRA QUE SUMÓ STOCK A UN PRODUCTO
--      Compras → "Sumar al stock de" (p. ej. +24 Inca Kola). Si se borra
--      esa compra (desde Compras o Egresos), ahora se RESTA lo que había
--      sumado. (Los insumos de la despensa ya lo hacían.)
--      → funciones add_menu_stock_compra(...) y revertir_compra_stock(...)
--
-- Seguridad:
--   · return_order_item_stock la usa el mesero (sin cuenta, por diseño),
--     igual que deduct_order_round_stock. Por eso tiene topes estrictos:
--     solo devuelve lo que REALMENTE se descontó para ese pedido y ese
--     producto (según las rondas registradas en stock_deducciones), menos
--     lo ya devuelto; solo con el pedido ABIERTO (pendiente / en
--     preparación / listo) y de las últimas 24 h. Nunca puede devolver
--     más de lo vendido, ni tocar precios, ni pedidos cobrados.
--   · add_menu_stock_compra y revertir_compra_stock exigen rol admin.
--   · Las tablas de registro no son accesibles desde la app (RLS sin
--     políticas): solo las escriben estas funciones.
--
-- Requiere: migracion-descuento-stock.sql (stock_deducciones) y
-- migracion-stock-alertas-compras.sql (add_menu_stock).
-- Si NO se ejecuta, todo funciona exactamente como antes.
-- Seguro de ejecutar más de una vez.
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Devolución al quitar un producto ya enviado ─────────────────
create table if not exists public.stock_devoluciones (
  order_id   uuid        not null,
  item_id    uuid        not null,
  qty        integer     not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (order_id, item_id)
);
alter table public.stock_devoluciones enable row level security;
-- (sin políticas a propósito)

create or replace function public.return_order_item_stock(p_order_id uuid, p_item_id uuid, p_qty integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status   text;
  v_rounds   jsonb;
  v_created  timestamptz;
  v_deducted integer;
  v_returned integer;
  v_n        integer;
  v_stock    integer;
begin
  if p_order_id is null or p_item_id is null or p_qty is null or p_qty < 1 or p_qty > 1000 then
    raise exception 'QTY_INVALID';
  end if;

  select status, rounds, created_at into v_status, v_rounds, v_created
    from public.orders where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Solo pedidos abiertos y recientes (nunca uno ya cobrado o archivado)
  if coalesce(v_status, '') not in ('pending', 'preparing', 'ready')
     or v_created < now() - interval '24 hours' then
    return jsonb_build_object('returned', 0, 'reason', 'ORDER_CLOSED');
  end if;

  -- Cuánto se descontó de ESTE producto en las rondas ya descontadas
  select coalesce(sum(
           case when (e->>'qty') ~ '^[0-9]+(\.[0-9]+)?$'
                then least(greatest(floor((e->>'qty')::numeric), 0), 1000)::int
                else 0 end
         ), 0)
    into v_deducted
    from jsonb_array_elements(case when jsonb_typeof(v_rounds) = 'array' then v_rounds else '[]'::jsonb end) r
    join public.stock_deducciones d
      on d.order_id = p_order_id
     and d.round_n  = case when (r->>'n') ~ '^[0-9]+$' then (r->>'n')::int end
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(r->'items') = 'array' then r->'items' else '[]'::jsonb end
    ) e
   where jsonb_typeof(e) = 'object'
     and lower(e->>'id') = lower(p_item_id::text);

  -- Lo ya devuelto antes (bloqueado para que dos llamadas no se pisen)
  insert into public.stock_devoluciones (order_id, item_id, qty)
  values (p_order_id, p_item_id, 0)
  on conflict do nothing;
  select qty into v_returned
    from public.stock_devoluciones
   where order_id = p_order_id and item_id = p_item_id
   for update;

  v_n := least(p_qty, v_deducted - v_returned);
  if v_n <= 0 then
    return jsonb_build_object('returned', 0, 'reason', 'NOTHING_TO_RETURN');
  end if;

  -- Etiqueta para el historial de movimientos (si existe el kardex)
  perform set_config('app.stock_motivo', 'devolucion', true);

  update public.menu_items m
     set stock      = m.stock + v_n,
         available  = case when m.stock = 0 then true else m.available end,
         updated_at = now()
   where m.id = p_item_id
     and m.stock is not null          -- "sin límite (∞)": no hay nada que devolver
  returning m.stock into v_stock;

  if not found then
    return jsonb_build_object('returned', 0, 'reason', 'UNLIMITED_OR_MISSING');
  end if;

  update public.stock_devoluciones
     set qty = qty + v_n, updated_at = now()
   where order_id = p_order_id and item_id = p_item_id;

  return jsonb_build_object('returned', v_n, 'stock', v_stock);
end
$$;
revoke all on function public.return_order_item_stock(uuid, uuid, integer) from public;
grant execute on function public.return_order_item_stock(uuid, uuid, integer) to anon, authenticated;

-- ── 2. Compras que suman stock a un producto (con vínculo) ─────────
create table if not exists public.compra_stock_items (
  egreso_id  uuid        not null,
  item_id    uuid        not null,
  qty        integer     not null check (qty > 0),
  revertido  boolean     not null default false,
  created_at timestamptz not null default now(),
  primary key (egreso_id, item_id)
);
alter table public.compra_stock_items enable row level security;
-- (sin políticas a propósito)

-- Igual que add_menu_stock, pero recuerda qué compra sumó cuánto
create or replace function public.add_menu_stock_compra(p_id uuid, p_qty integer, p_egreso_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res jsonb;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_egreso_id is null then raise exception 'EGRESO_INVALID'; end if;

  v_res := public.add_menu_stock(p_id, p_qty);   -- valida cantidad y suma (atómico)

  insert into public.compra_stock_items (egreso_id, item_id, qty)
  values (p_egreso_id, p_id, p_qty)
  on conflict (egreso_id, item_id)
  do update set qty = public.compra_stock_items.qty + excluded.qty;

  return v_res;
end
$$;
revoke all on function public.add_menu_stock_compra(uuid, integer, uuid) from public, anon;
grant execute on function public.add_menu_stock_compra(uuid, integer, uuid) to authenticated;

-- Al eliminar la compra: resta lo que sumó (una sola vez). Devuelve cuántos productos ajustó.
create or replace function public.revertir_compra_stock(p_egreso_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  l   record;
  v_n integer := 0;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_egreso_id is null then return 0; end if;

  perform set_config('app.stock_motivo', 'anulacion_compra', true);

  for l in
    select * from public.compra_stock_items
     where egreso_id = p_egreso_id and not revertido
     for update
  loop
    update public.menu_items m
       set stock      = greatest(0, m.stock - l.qty),
           available  = case when m.stock - l.qty <= 0 then false else m.available end,
           updated_at = now()
     where m.id = l.item_id and m.stock is not null;
    update public.compra_stock_items set revertido = true
     where egreso_id = l.egreso_id and item_id = l.item_id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end
$$;
revoke all on function public.revertir_compra_stock(uuid) from public, anon;
grant execute on function public.revertir_compra_stock(uuid) to authenticated;

notify pgrst, 'reload schema';
