-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Despensa de INSUMOS (limón, papa, aceite, pollo…)
-- ══════════════════════════════════════════════════════════════════
-- Qué agrega (SOLO tablas y funciones NUEVAS; no toca ventas, stock de
-- productos, carta, mesero ni cocina):
--
--   1. Tabla insumos — materia prima de la cocina. Separada de
--      menu_items a propósito: un insumo NUNCA aparece en el POS, la
--      carta ni el mesero. Solo el administrador la ve.
--
--   2. Tabla insumo_movimientos — historial (kardex) de cada entrada y
--      salida: compra, conteo, consumo, merma, anulación. Nadie puede
--      editarla ni borrarla desde la app.
--
--   3. Funciones (todas exigen rol admin y trabajan DENTRO de la base de
--      datos, en una sola operación, para que dos acciones al mismo
--      tiempo nunca se pisen):
--        · insumo_entrada(...)        → compra: suma stock y recalcula
--                                       el costo promedio por unidad
--        · insumo_salida(...)         → consumo o merma registrada a mano
--        · insumo_conteo_lote(...)    → conteo físico: "quedan X";
--                                       lo que falta es lo que se usó
--        · insumo_revertir_compra(..) → si se elimina una compra, se
--                                       resta lo que había sumado
--
-- Si NO se ejecuta, la app sigue funcionando igual: la pestaña Insumos
-- muestra un aviso pidiendo ejecutarla y Compras no ofrece insumos.
--
-- Requiere: migracion-egresos-stock.sql (public.get_user_role).
-- Seguro de ejecutar más de una vez.
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Insumos ─────────────────────────────────────────────────────
create table if not exists public.insumos (
  id             uuid          primary key default gen_random_uuid(),
  nombre         text          not null check (length(trim(nombre)) > 0),
  categoria      text,
  unidad         text          not null default 'kg',
  stock          numeric(12,3) not null default 0 check (stock >= 0),
  minimo         numeric(12,3) check (minimo is null or minimo >= 0),
  costo_unit     numeric(12,4) check (costo_unit is null or costo_unit >= 0),
  activo         boolean       not null default true,
  ultimo_conteo  timestamptz,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now()
);
create unique index if not exists insumos_nombre_uq on public.insumos (lower(trim(nombre)));

alter table public.insumos enable row level security;
do $$ begin
  create policy "admin_insumos_all" on public.insumos
    for all using (public.get_user_role() = 'admin')
    with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

-- ── 2. Movimientos (kardex) ────────────────────────────────────────
create table if not exists public.insumo_movimientos (
  id            uuid          primary key default gen_random_uuid(),
  insumo_id     uuid          not null references public.insumos(id) on delete cascade,
  insumo_nombre text,
  unidad        text,
  tipo          text          not null check (tipo in ('inicial','compra','conteo','consumo','merma','anulacion')),
  cambio        numeric(12,3) not null,          -- + entra · − sale
  antes         numeric(12,3),
  despues       numeric(12,3),
  costo_unit    numeric(12,4),                   -- costo por unidad en ese momento
  monto         numeric(12,2),                   -- S/ de la compra, o S/ de lo usado/perdido
  egreso_id     uuid,                            -- compra (egreso) que originó el movimiento
  nota          text,
  actor_id      uuid,
  actor_name    text,
  created_at    timestamptz   not null default now()
);
create index if not exists idx_insumo_mov_created on public.insumo_movimientos (created_at desc);
create index if not exists idx_insumo_mov_insumo  on public.insumo_movimientos (insumo_id, created_at desc);
create index if not exists idx_insumo_mov_egreso  on public.insumo_movimientos (egreso_id) where egreso_id is not null;

alter table public.insumo_movimientos enable row level security;
do $$ begin
  create policy "admin_insumo_mov_select" on public.insumo_movimientos
    for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
-- A propósito SIN insert/update/delete: solo escriben las funciones de abajo.

-- ── 3. Funciones ───────────────────────────────────────────────────

-- Registra un movimiento (uso interno de las funciones públicas)
create or replace function public._insumo_mov(
  p_ins public.insumos, p_tipo text, p_antes numeric, p_despues numeric,
  p_costo numeric, p_monto numeric, p_egreso uuid, p_nota text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid;
  v_name text;
begin
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;
  if v_uid is not null then
    select u.name into v_name from public.users u where u.id = v_uid;
  end if;
  insert into public.insumo_movimientos
    (insumo_id, insumo_nombre, unidad, tipo, cambio, antes, despues, costo_unit, monto, egreso_id, nota, actor_id, actor_name)
  values
    (p_ins.id, p_ins.nombre, p_ins.unidad, p_tipo, p_despues - p_antes, p_antes, p_despues,
     p_costo, p_monto, p_egreso, nullif(trim(coalesce(p_nota, '')), ''), v_uid, v_name);
end
$$;
revoke all on function public._insumo_mov(public.insumos, text, numeric, numeric, numeric, numeric, uuid, text) from public, anon, authenticated;

-- Compra: suma al stock y recalcula el costo promedio ponderado por unidad
create or replace function public.insumo_entrada(
  p_id uuid, p_cantidad numeric, p_monto numeric default null,
  p_egreso_id uuid default null, p_nota text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ins   public.insumos%rowtype;
  v_new   numeric;
  v_costo numeric;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_id is null or p_cantidad is null or p_cantidad <= 0 or p_cantidad > 1000000 then raise exception 'QTY_INVALID'; end if;
  if p_monto is not null and p_monto < 0 then raise exception 'AMOUNT_INVALID'; end if;

  select * into v_ins from public.insumos where id = p_id for update;
  if not found then raise exception 'INSUMO_NOT_FOUND'; end if;

  v_new := v_ins.stock + p_cantidad;
  v_costo := v_ins.costo_unit;
  if coalesce(p_monto, 0) > 0 then
    v_costo := case
      when v_ins.stock > 0 and v_ins.costo_unit is not null
        then (v_ins.stock * v_ins.costo_unit + p_monto) / v_new
      else p_monto / p_cantidad
    end;
  end if;

  update public.insumos
     set stock = v_new, costo_unit = v_costo, activo = true, updated_at = now()
   where id = p_id;

  perform public._insumo_mov(v_ins, 'compra', v_ins.stock, v_new,
    case when coalesce(p_monto, 0) > 0 then p_monto / p_cantidad else v_ins.costo_unit end,
    p_monto, p_egreso_id, p_nota);

  return jsonb_build_object('id', p_id, 'stock', v_new, 'costo_unit', v_costo);
end
$$;
revoke all on function public.insumo_entrada(uuid, numeric, numeric, uuid, text) from public, anon;
grant execute on function public.insumo_entrada(uuid, numeric, numeric, uuid, text) to authenticated;

-- Consumo o merma registrada a mano (nunca deja el stock en negativo)
create or replace function public.insumo_salida(
  p_id uuid, p_cantidad numeric, p_tipo text default 'consumo', p_nota text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ins public.insumos%rowtype;
  v_new numeric;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_tipo not in ('consumo', 'merma') then raise exception 'TYPE_INVALID'; end if;
  if p_id is null or p_cantidad is null or p_cantidad <= 0 or p_cantidad > 1000000 then raise exception 'QTY_INVALID'; end if;

  select * into v_ins from public.insumos where id = p_id for update;
  if not found then raise exception 'INSUMO_NOT_FOUND'; end if;

  v_new := greatest(0, v_ins.stock - p_cantidad);
  update public.insumos set stock = v_new, updated_at = now() where id = p_id;

  perform public._insumo_mov(v_ins, p_tipo, v_ins.stock, v_new, v_ins.costo_unit,
    case when v_ins.costo_unit is null then null else round((v_ins.stock - v_new) * v_ins.costo_unit, 2) end,
    null, p_nota);

  return jsonb_build_object('id', p_id, 'stock', v_new);
end
$$;
revoke all on function public.insumo_salida(uuid, numeric, text, text) from public, anon;
grant execute on function public.insumo_salida(uuid, numeric, text, text) to authenticated;

-- Conteo físico de uno o varios insumos a la vez: [{ id, queda, nota }, …]
-- "queda" es lo que hay realmente; la diferencia con el sistema es lo que
-- se usó (si falta) o un sobrante (si hay más). El primer conteo de un
-- insumo sin historial se registra como "inicial" (no cuenta como uso).
create or replace function public.insumo_conteo_lote(p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e       jsonb;
  v_ins   public.insumos%rowtype;
  v_queda numeric;
  v_tipo  text;
  v_out   jsonb := '[]'::jsonb;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'ITEMS_INVALID'; end if;

  for e in select * from jsonb_array_elements(p_items) loop
    -- coalesce(…, true): una línea sin id o sin cantidad se SALTA (nunca
    -- deja un valor nulo que haga fallar todo el conteo)
    if jsonb_typeof(e) <> 'object'
       or coalesce((e->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', true)
       or coalesce((e->>'queda') !~ '^[0-9]+(\.[0-9]+)?$', true) then
      continue;
    end if;
    v_queda := round((e->>'queda')::numeric, 3);
    if v_queda > 1000000 then continue; end if;

    select * into v_ins from public.insumos where id = (e->>'id')::uuid for update;
    if not found then continue; end if;

    v_tipo := case
      when not exists (select 1 from public.insumo_movimientos m where m.insumo_id = v_ins.id) then 'inicial'
      else 'conteo'
    end;

    update public.insumos
       set stock = v_queda, ultimo_conteo = now(), updated_at = now()
     where id = v_ins.id;

    perform public._insumo_mov(v_ins, v_tipo, v_ins.stock, v_queda, v_ins.costo_unit,
      case when v_ins.costo_unit is null or v_queda >= v_ins.stock then null
           else round((v_ins.stock - v_queda) * v_ins.costo_unit, 2) end,
      null, e->>'nota');

    v_out := v_out || jsonb_build_object('id', v_ins.id, 'antes', v_ins.stock, 'despues', v_queda, 'tipo', v_tipo);
  end loop;

  return v_out;
end
$$;
revoke all on function public.insumo_conteo_lote(jsonb) from public, anon;
grant execute on function public.insumo_conteo_lote(jsonb) to authenticated;

-- Al eliminar una compra (egreso), resta lo que esa compra había sumado.
-- Solo una vez por compra. Devuelve cuántos insumos se ajustaron.
create or replace function public.insumo_revertir_compra(p_egreso_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  m     record;
  v_ins public.insumos%rowtype;
  v_new numeric;
  v_n   integer := 0;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_egreso_id is null then return 0; end if;
  if exists (select 1 from public.insumo_movimientos where egreso_id = p_egreso_id and tipo = 'anulacion') then
    return 0;
  end if;

  for m in
    select * from public.insumo_movimientos
     where egreso_id = p_egreso_id and tipo = 'compra'
  loop
    select * into v_ins from public.insumos where id = m.insumo_id for update;
    if not found then continue; end if;
    v_new := greatest(0, v_ins.stock - m.cambio);
    update public.insumos set stock = v_new, updated_at = now() where id = v_ins.id;
    perform public._insumo_mov(v_ins, 'anulacion', v_ins.stock, v_new, m.costo_unit,
      case when m.monto is null then null else -m.monto end,
      p_egreso_id, 'Compra eliminada');
    v_n := v_n + 1;
  end loop;

  return v_n;
end
$$;
revoke all on function public.insumo_revertir_compra(uuid) from public, anon;
grant execute on function public.insumo_revertir_compra(uuid) to authenticated;

notify pgrst, 'reload schema';
