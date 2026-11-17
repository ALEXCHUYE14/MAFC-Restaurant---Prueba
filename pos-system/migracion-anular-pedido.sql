-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Anular pedido (solo administrador)
-- ══════════════════════════════════════════════════════════════════
-- Agrega la función anular_pedido(pedido, motivo), que en UNA sola
-- operación (con el pedido bloqueado, así un cobro y una anulación al
-- mismo tiempo nunca se cruzan):
--
--   1. Verifica que el pedido NO esté cobrado, archivado ni ya anulado.
--   2. Devuelve al stock lo que se descontó por sus rondas enviadas a
--      cocina (descontando lo ya devuelto antes; nunca dos veces).
--      Los pedidos del POS/externos descuentan stock recién al cobrar,
--      así que si no se cobraron no hay nada que devolver.
--   3. Marca el pedido como 'anulado' (nunca se cuenta como venta: los
--      reportes, Caja y Personal solo cuentan pedidos "Pagado…").
--   4. Libera la mesa, salvo que tenga otro pedido abierto.
--
-- Seguridad: exige rol admin (public.get_user_role()). El mesero y la
-- cocina NO pueden anular pedidos.
--
-- Requiere: migracion-egresos-stock.sql (get_user_role).
-- Recomendado: migracion-descuento-stock.sql y
-- migracion-devoluciones-stock.sql (para la devolución de stock; si no
-- existen, el pedido igual se anula, solo que sin devolver stock).
-- Seguro de ejecutar más de una vez.
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- Registro de devoluciones (por si migracion-devoluciones-stock.sql no se ejecutó)
create table if not exists public.stock_devoluciones (
  order_id   uuid        not null,
  item_id    uuid        not null,
  qty        integer     not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  primary key (order_id, item_id)
);
alter table public.stock_devoluciones enable row level security;

create or replace function public.anular_pedido(p_order_id uuid, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ord      record;
  v_has_ded  boolean;
  r          record;
  v_ret      integer;
  v_n        integer;
  v_units    integer := 0;
  v_items    jsonb   := '[]'::jsonb;
  v_freed    boolean := false;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_order_id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  select id, status, rounds, table_number into v_ord
    from public.orders where id = p_order_id
    for update;                                   -- bloquea: cobro y anulación no se cruzan
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if coalesce(v_ord.status, '') like 'Pagado%'
     or coalesce(v_ord.status, '') in ('paid', 'archivado', 'anulado') then
    raise exception 'ORDER_CLOSED';
  end if;

  -- ── Devolver stock de lo descontado por sus rondas ──────────────
  v_has_ded := to_regclass('public.stock_deducciones') is not null;
  if v_has_ded and jsonb_typeof(v_ord.rounds) = 'array' then
    perform set_config('app.stock_motivo', 'devolucion', true);

    for r in
      select lower(e->>'id') as item_id,
             sum(case when (e->>'qty') ~ '^[0-9]+(\.[0-9]+)?$'
                      then least(greatest(floor((e->>'qty')::numeric), 0), 1000)::int
                      else 0 end)::int as qty
        from jsonb_array_elements(v_ord.rounds) rd
        join public.stock_deducciones d
          on d.order_id = p_order_id
         and d.round_n  = case when (rd->>'n') ~ '^[0-9]+$' then (rd->>'n')::int end
        cross join lateral jsonb_array_elements(
          case when jsonb_typeof(rd->'items') = 'array' then rd->'items' else '[]'::jsonb end
        ) e
       where jsonb_typeof(e) = 'object'
         and (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       group by 1
    loop
      insert into public.stock_devoluciones (order_id, item_id, qty)
      values (p_order_id, r.item_id::uuid, 0)
      on conflict do nothing;
      select qty into v_ret from public.stock_devoluciones
       where order_id = p_order_id and item_id = r.item_id::uuid
       for update;

      v_n := r.qty - coalesce(v_ret, 0);
      if v_n <= 0 then continue; end if;

      update public.menu_items m
         set stock      = m.stock + v_n,
             available  = case when m.stock = 0 then true else m.available end,
             updated_at = now()
       where m.id = r.item_id::uuid
         and m.stock is not null;
      if found then
        update public.stock_devoluciones
           set qty = qty + v_n, updated_at = now()
         where order_id = p_order_id and item_id = r.item_id::uuid;
        v_units := v_units + v_n;
        v_items := v_items || jsonb_build_object('id', r.item_id, 'qty', v_n);
      end if;
    end loop;
  end if;

  -- ── Marcar como anulado ─────────────────────────────────────────
  update public.orders
     set status = 'anulado', updated_at = now()
   where id = p_order_id;

  -- ── Liberar la mesa (solo si no tiene otro pedido abierto) ──────
  if coalesce(v_ord.table_number, 0) > 0
     and to_regclass('public.mesas') is not null
     and not exists (
       select 1 from public.orders o
        where o.table_number = v_ord.table_number
          and o.id <> p_order_id
          and coalesce(o.status, '') not like 'Pagado%'
          and coalesce(o.status, '') not in ('paid', 'served', 'archivado', 'anulado')
          and o.created_at > now() - interval '24 hours'
     ) then
    update public.mesas
       set estado = 'libre', mesero_nombre = null, mesero_color = null,
           ultima_actualizacion = now()
     where numero_mesa = v_ord.table_number;
    v_freed := found;
  end if;

  return jsonb_build_object(
    'id', p_order_id, 'returned_units', v_units, 'returned', v_items,
    'table_freed', v_freed, 'motivo', nullif(trim(coalesce(p_motivo, '')), '')
  );
end
$$;
revoke all on function public.anular_pedido(uuid, text) from public, anon;
grant execute on function public.anular_pedido(uuid, text) to authenticated;

notify pgrst, 'reload schema';
