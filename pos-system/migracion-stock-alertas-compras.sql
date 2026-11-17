-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Alerta de stock bajo + Compras que suman al stock
-- ══════════════════════════════════════════════════════════════════
-- Qué agrega (SOLO agrega, no modifica ni borra nada existente):
--
--   1. Columna menu_items.alert_at (opcional, puede quedar vacía).
--      Es el umbral "avisar cuando queden X unidades". Con ella, el
--      contador "Stock bajo" del panel Stock funciona también para los
--      productos creados desde "Agregar plato" (bebidas, cervezas, etc.).
--
--   2. Función add_menu_stock(producto, cantidad) — usada por la pestaña
--      Compras para SUMAR unidades al stock de un producto en una sola
--      operación dentro de la base de datos (stock = stock + cantidad).
--      Así, si justo en ese instante se vende una unidad, no se pierde
--      ni la compra ni la venta. Solo la puede usar el administrador.
--      Si el producto estaba en 0 (agotado automáticamente), vuelve a
--      quedar "Disponible". Si estaba "sin límite (∞)", empieza a
--      controlarse desde la cantidad comprada.
--
-- Si NO se ejecuta esta migración, la app sigue funcionando igual que
-- antes: el campo "Alerta" muestra un aviso pidiendo ejecutarla y
-- Compras suma al stock con el método anterior (leer y guardar).
--
-- Requiere: migracion-catalogo-crud.sql (tabla menu_items) y
-- migracion-egresos-stock.sql (función public.get_user_role).
-- Seguro de ejecutar más de una vez.
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- 1. Umbral de alerta de stock bajo
alter table public.menu_items add column if not exists alert_at integer;

do $$ begin
  alter table public.menu_items
    add constraint menu_items_alert_at_check check (alert_at is null or alert_at >= 0);
exception when duplicate_object then null; end $$;

-- 2. Sumar stock de forma atómica (Compras)
create or replace function public.add_menu_stock(p_id uuid, p_qty integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.menu_items%rowtype;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_id is null or p_qty is null or p_qty < 1 or p_qty > 100000 then
    raise exception 'QTY_INVALID';
  end if;

  -- Etiqueta para el historial de movimientos (migracion-kardex-costos.sql).
  -- Si esa migración no se ejecutó, esta línea no tiene ningún efecto.
  perform set_config('app.stock_motivo', 'compra', true);

  update public.menu_items m
     set stock      = coalesce(m.stock, 0) + p_qty,
         available  = case when m.stock = 0 then true else m.available end,
         updated_at = now()
   where m.id = p_id
  returning m.* into v_row;

  if not found then raise exception 'ITEM_NOT_FOUND'; end if;

  return jsonb_build_object('id', v_row.id, 'name', v_row.name, 'stock', v_row.stock, 'available', v_row.available);
end
$$;
revoke all on function public.add_menu_stock(uuid, integer) from public, anon;
grant execute on function public.add_menu_stock(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
