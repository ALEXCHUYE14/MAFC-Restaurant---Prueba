-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Historial de movimientos de stock (kardex) + Precio de costo
-- ══════════════════════════════════════════════════════════════════
-- Qué agrega (SOLO agrega; no borra ni cambia datos existentes):
--
--   1. Tabla stock_movimientos — cada vez que cambia el stock de un
--      producto (venta en POS, venta del mesero, compra, ajuste manual)
--      la base de datos guarda automáticamente: producto, stock antes,
--      stock después, cambio, motivo, quién y cuándo. Lo hace un
--      trigger, así que funciona para TODAS las vías sin depender de la
--      app. Si guardar el historial fallara, la venta/ajuste NO se
--      bloquea (solo se omite ese registro).
--      Solo el administrador puede leerla. Nadie puede editarla ni
--      borrarla desde la app.
--
--   2. Tabla menu_item_costos — precio de COSTO por producto, para ver
--      la ganancia. Va en una tabla aparte (no en menu_items) a
--      propósito: menu_items es pública (la lee la carta digital sin
--      iniciar sesión), y el costo no debe verlo ningún cliente.
--      Solo el administrador puede leerla y escribirla.
--
--   3. Etiqueta "venta" en el descuento automático de stock — SOLO si
--      ya ejecutaste migracion-descuento-stock.sql (se detecta solo; si
--      no, este paso se omite). La lógica del descuento queda idéntica.
--
-- Si NO se ejecuta, la app sigue funcionando igual: los paneles de
-- "Movimientos" y "Costo" muestran un aviso pidiendo ejecutarla.
--
-- Requiere: migracion-catalogo-crud.sql (menu_items) y
-- migracion-egresos-stock.sql (public.get_user_role).
-- Recomendado ejecutar antes: migracion-stock-alertas-compras.sql.
-- Seguro de ejecutar más de una vez, en cualquier orden.
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Historial de movimientos ────────────────────────────────────
create table if not exists public.stock_movimientos (
  id          uuid        primary key default gen_random_uuid(),
  item_id     uuid        not null,
  item_name   text,
  antes       integer,                 -- null = estaba "sin límite (∞)"
  despues     integer,                 -- null = quedó "sin límite (∞)"
  cambio      integer,                 -- despues − antes (null si alguno es ∞)
  motivo      text        not null default 'ajuste',
                                       -- venta_pos · venta_mesero · compra · ajuste · sistema
  actor_id    uuid,
  actor_name  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_stock_mov_created on public.stock_movimientos (created_at desc);
create index if not exists idx_stock_mov_item    on public.stock_movimientos (item_id, created_at desc);

alter table public.stock_movimientos enable row level security;
do $$ begin
  create policy "admin_stock_mov_select" on public.stock_movimientos
    for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
-- A propósito SIN políticas de insert/update/delete: solo escribe el trigger.

create or replace function public._log_stock_movimiento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_motivo text;
  v_uid    uuid;
  v_role   text;
  v_name   text;
begin
  if new.stock is not distinct from old.stock then
    return new;
  end if;

  begin
    v_uid  := auth.uid();
    v_role := coalesce(auth.role(), '');
  exception when others then
    v_uid := null; v_role := '';
  end;

  v_motivo := nullif(current_setting('app.stock_motivo', true), '');
  if v_motivo = 'venta' then
    v_motivo := case when v_role = 'anon' then 'venta_mesero' else 'venta_pos' end;
  elsif v_motivo is null then
    v_motivo := case
      when v_role = 'anon' then 'venta_mesero'
      when v_uid is null   then 'sistema'      -- SQL Editor / service role
      else 'ajuste'
    end;
  end if;

  begin
    if v_uid is not null then
      select u.name into v_name from public.users u where u.id = v_uid;
    end if;

    insert into public.stock_movimientos (item_id, item_name, antes, despues, cambio, motivo, actor_id, actor_name)
    values (
      new.id, new.name, old.stock, new.stock,
      case when old.stock is null or new.stock is null then null else new.stock - old.stock end,
      v_motivo, v_uid, v_name
    );
  exception when others then
    -- Nunca bloquear una venta o un ajuste por un fallo del historial.
    raise warning '[stock_movimientos] no se pudo registrar: %', sqlerrm;
  end;

  return new;
end
$$;
revoke all on function public._log_stock_movimiento() from public, anon, authenticated;

drop trigger if exists trg_menu_items_stock_mov on public.menu_items;
create trigger trg_menu_items_stock_mov
  after update of stock on public.menu_items
  for each row execute function public._log_stock_movimiento();

-- ── 2. Precio de costo (solo admin) ────────────────────────────────
create table if not exists public.menu_item_costos (
  item_id    uuid          primary key references public.menu_items(id) on delete cascade,
  cost       numeric(10,2) not null check (cost >= 0),
  updated_at timestamptz   not null default now()
);
alter table public.menu_item_costos enable row level security;
do $$ begin
  create policy "admin_menu_item_costos_all" on public.menu_item_costos
    for all using (public.get_user_role() = 'admin')
    with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

-- ── 3. Etiqueta "venta" en el descuento automático (si existe) ─────
-- Mismo cuerpo que en migracion-descuento-stock.sql + UNA línea
-- (set_config) que solo etiqueta el movimiento. Se aplica únicamente si
-- esa migración ya se ejecutó, para no crear funciones a medias.
do $outer$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_deduct_menu_items'
  ) then
    execute $fn$
      create or replace function public._deduct_menu_items(p_items jsonb)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_out jsonb;
      begin
        if p_items is null or jsonb_typeof(p_items) <> 'array' then return '[]'::jsonb; end if;

        perform set_config('app.stock_motivo', 'venta', true);

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
      $body$;
    $fn$;
    execute 'revoke all on function public._deduct_menu_items(jsonb) from public, anon, authenticated';
  end if;
end
$outer$;

-- ── 4. Etiqueta "compra" en add_menu_stock (si existe) ─────────────
-- Igual que en migracion-stock-alertas-compras.sql (que ya trae la
-- etiqueta). Se re-aplica aquí por si esa se ejecutó en una versión
-- anterior sin la etiqueta.
do $outer$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'add_menu_stock'
  ) then
    execute $fn$
      create or replace function public.add_menu_stock(p_id uuid, p_qty integer)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_row public.menu_items%rowtype;
      begin
        if coalesce(public.get_user_role(), '') <> 'admin' then
          raise exception 'NOT_ALLOWED';
        end if;
        if p_id is null or p_qty is null or p_qty < 1 or p_qty > 100000 then
          raise exception 'QTY_INVALID';
        end if;

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
      $body$;
    $fn$;
    execute 'revoke all on function public.add_menu_stock(uuid, integer) from public, anon';
    execute 'grant execute on function public.add_menu_stock(uuid, integer) to authenticated';
  end if;
end
$outer$;

notify pgrst, 'reload schema';
