-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Descuentos y cupones (ej. "VUELVE10" = 10% de descuento)
-- ══════════════════════════════════════════════════════════════════
-- Requiere (ANTES que esta): migracion-envases.sql y migracion-clientes-crm.sql.
--
-- Cómo funciona:
--   · El admin crea cupones (Clientes → Cupones): código, % o monto fijo,
--     consumo mínimo, vencimiento, usos máximos y, opcional, solo para un
--     cliente (cupón personal para el WhatsApp "te extrañamos").
--   · El cupón se aplica a un pedido ABIERTO (mesero o caja). El
--     administrador además puede aplicar un descuento manual con motivo.
--   · El descuento se calcula SOLO sobre los platos (no sobre envases) y
--     nunca supera el total de los platos.
--   · total = platos + envases − descuento  →  lo calcula la BASE DE DATOS
--     en cada cambio del pedido (nuevas rondas, quitar platos, cobro), así
--     el cobro, el pago mixto y el cierre de caja cuadran exacto.
--
-- Seguridad (anti-fraude):
--   · Los campos de descuento SOLO se pueden cambiar con las funciones de
--     abajo (un UPDATE directo desde la app se ignora).
--   · Un cupón se valida en el servidor (activo, vigente, usos, mínimo,
--     cliente) y con bloqueo: dos pedidos no gastan el mismo último uso.
--   · Un pedido cobrado/anulado ya no cambia su descuento.
--   · Los pedidos sin envases ni descuento NO se tocan.
--
-- Seguro de ejecutar más de una vez. No modifica pedidos existentes.
-- ══════════════════════════════════════════════════════════════════

-- Verificación previa: si falta una migración anterior, se detiene aquí
-- con un mensaje claro (y no cambia nada).
do $$ begin
  if to_regprocedure('public.get_user_role()') is null then
    raise exception 'FALTA EJECUTAR ANTES: migracion-egresos-stock.sql';
  end if;
  if to_regclass('public.envases_config') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'orders' and column_name = 'packaging_count') then
    raise exception 'FALTA EJECUTAR ANTES: migracion-envases.sql (luego vuelve a ejecutar este archivo)';
  end if;
  if to_regclass('public.clientes') is null or to_regprocedure('public._crm_rate_limit()') is null then
    raise exception 'FALTA EJECUTAR ANTES: migracion-clientes-crm.sql (luego vuelve a ejecutar este archivo)';
  end if;
end $$;

-- ── 1. Columnas del pedido ────────────────────────────────────────
alter table public.orders add column if not exists descuento_pct    numeric(5,2)  not null default 0;
alter table public.orders add column if not exists descuento_fijo   numeric(10,2) not null default 0;
alter table public.orders add column if not exists descuento_monto  numeric(10,2) not null default 0;
alter table public.orders add column if not exists cupon_codigo     text;
alter table public.orders add column if not exists descuento_motivo text;
do $$ begin
  alter table public.orders add constraint orders_descuento_chk
    check (descuento_pct between 0 and 100 and descuento_fijo >= 0 and descuento_monto >= 0);
exception when duplicate_object then null; end $$;
create index if not exists idx_orders_cupon on public.orders (cupon_codigo) where cupon_codigo is not null;

-- ── 2. Cupones ────────────────────────────────────────────────────
create table if not exists public.cupones (
  id           uuid          primary key default gen_random_uuid(),
  codigo       text          not null unique check (codigo ~ '^[A-Z0-9]{3,20}$'),
  tipo         text          not null check (tipo in ('pct', 'monto')),
  valor        numeric(10,2) not null check (valor > 0),
  minimo       numeric(10,2) not null default 0 check (minimo >= 0),
  vence        date,
  usos_max     integer       check (usos_max is null or usos_max > 0),
  solo_cliente uuid          references public.clientes(id) on delete cascade,
  descripcion  text          check (length(descripcion) <= 120),
  activo       boolean       not null default true,
  created_by   text,
  created_at   timestamptz   not null default now(),
  constraint cupones_pct_chk check (tipo <> 'pct' or valor <= 100)
);
alter table public.cupones enable row level security;
do $$ begin
  create policy "cupones_admin_all" on public.cupones for all
    using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
revoke all on public.cupones from anon;

-- ── 3. Cálculo del total (reemplaza el de migracion-envases.sql) ──
-- Mismo comportamiento para envases + descuento. Se llama trg_aa_… para
-- ejecutarse antes que la validación del pago mixto.
create or replace function public._orders_packaging()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_closed boolean := false;
  v_price  numeric;
  v_active boolean;
  v_food   numeric;
  v_disc   numeric := 0;
  v_rpc    boolean := coalesce(current_setting('pos.descuento_rpc', true), '') = '1';
begin
  new.packaging_count := coalesce(new.packaging_count, 0);

  if tg_op = 'UPDATE' then
    v_closed := coalesce(old.status, '') like 'Pagado%'
                or coalesce(old.status, '') in ('paid', 'anulado', 'archivado');
    if v_closed then
      -- Pedido cerrado: envases y descuento quedan como estaban
      new.packaging_count  := old.packaging_count;
      new.packaging_unit   := old.packaging_unit;
      new.packaging_total  := old.packaging_total;
      new.descuento_pct    := old.descuento_pct;
      new.descuento_fijo   := old.descuento_fijo;
      new.descuento_monto  := old.descuento_monto;
      new.cupon_codigo     := old.cupon_codigo;
      new.descuento_motivo := old.descuento_motivo;
      return new;
    end if;
  end if;

  -- El descuento solo lo cambian las funciones de cupón/descuento
  if not v_rpc then
    if tg_op = 'INSERT' then
      new.descuento_pct := 0; new.descuento_fijo := 0; new.cupon_codigo := null; new.descuento_motivo := null;
    else
      new.descuento_pct := old.descuento_pct; new.descuento_fijo := old.descuento_fijo;
      new.cupon_codigo := old.cupon_codigo; new.descuento_motivo := old.descuento_motivo;
    end if;
  end if;
  new.descuento_pct  := coalesce(new.descuento_pct, 0);
  new.descuento_fijo := coalesce(new.descuento_fijo, 0);

  if new.packaging_count < 0 or new.packaging_count > 99 then
    raise exception 'PACKAGING_INVALID';
  end if;

  -- Sin envases ni descuento, antes ni ahora: el pedido no se toca
  if new.packaging_count = 0 and new.descuento_pct = 0 and new.descuento_fijo = 0
     and (tg_op = 'INSERT' or (coalesce(old.packaging_count, 0) = 0
                               and coalesce(old.descuento_pct, 0) = 0
                               and coalesce(old.descuento_fijo, 0) = 0)) then
    new.packaging_total := 0;
    new.descuento_monto := 0;
    new.packaging_unit  := case when tg_op = 'INSERT' then null else old.packaging_unit end;
    return new;
  end if;

  -- Envases (precio congelado al primer envase)
  if new.packaging_count = 0 then
    new.packaging_total := 0;
    new.packaging_unit  := case when tg_op = 'INSERT' then null else old.packaging_unit end;
  else
    if tg_op = 'UPDATE' and old.packaging_unit is not null then
      new.packaging_unit := old.packaging_unit;
    else
      select precio, activo into v_price, v_active from public.envases_config where id = 1;
      if not found or not v_active then raise exception 'PACKAGING_DISABLED'; end if;
      new.packaging_unit := v_price;
    end if;
    new.packaging_total := round(new.packaging_count * new.packaging_unit, 2);
  end if;

  -- Platos
  select coalesce(sum(
           (case when jsonb_typeof(e->'price') = 'number' then (e->>'price')::numeric else 0 end)
         * (case when jsonb_typeof(e->'qty') = 'number' then (e->>'qty')::numeric
                 when jsonb_typeof(e->'quantity') = 'number' then (e->>'quantity')::numeric
                 else 0 end)
         ), 0)
    into v_food
    from jsonb_array_elements(case when jsonb_typeof(new.items) = 'array' then new.items else '[]'::jsonb end) e;
  v_food := greatest(0, v_food);

  -- Descuento sobre los platos (nunca mayor que los platos)
  if new.descuento_pct > 0 then
    v_disc := round(v_food * new.descuento_pct / 100, 2);
  elsif new.descuento_fijo > 0 then
    v_disc := new.descuento_fijo;
  end if;
  v_disc := least(greatest(v_disc, 0), round(v_food, 2));
  new.descuento_monto := v_disc;

  new.total := round(v_food + new.packaging_total - v_disc, 2);
  return new;
end $$;
revoke all on function public._orders_packaging() from public, anon, authenticated;

drop trigger if exists trg_aa_orders_packaging on public.orders;
create trigger trg_aa_orders_packaging
  before insert or update on public.orders
  for each row execute function public._orders_packaging();

-- ── 4. Funciones ──────────────────────────────────────────────────
-- Pedido abierto (bloqueado) o error
create or replace function public._orden_abierta(p_order uuid)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if coalesce(o.status, '') like 'Pagado%' or coalesce(o.status, '') in ('paid', 'anulado', 'archivado') then
    raise exception 'ORDER_CLOSED';
  end if;
  return o;
end $$;
revoke all on function public._orden_abierta(uuid) from public, anon, authenticated;

-- Aplica un cupón a un pedido abierto (mesero o caja)
create or replace function public.aplicar_cupon(p_order uuid, p_codigo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o      public.orders%rowtype;
  c      public.cupones%rowtype;
  v_cod  text := upper(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
  v_usos integer;
  v_food numeric;
  v_hoy  date := (now() at time zone 'America/Lima')::date;
begin
  perform public._crm_rate_limit();
  if v_cod !~ '^[A-Z0-9]{3,20}$' then raise exception 'CUPON_INVALIDO'; end if;
  select * into c from public.cupones where codigo = v_cod for update;   -- un uso a la vez
  if not found or not c.activo then raise exception 'CUPON_INVALIDO'; end if;
  if c.vence is not null and c.vence < v_hoy then raise exception 'CUPON_VENCIDO'; end if;

  o := public._orden_abierta(p_order);
  if o.cupon_codigo is not null and o.cupon_codigo = v_cod then raise exception 'CUPON_YA_APLICADO'; end if;
  if c.solo_cliente is not null and o.cliente_id is distinct from c.solo_cliente then raise exception 'CUPON_OTRO_CLIENTE'; end if;

  if c.usos_max is not null then
    select count(*) into v_usos from public.orders
     where cupon_codigo = v_cod and id <> p_order and coalesce(status, '') <> 'anulado';
    if v_usos >= c.usos_max then raise exception 'CUPON_AGOTADO'; end if;
  end if;

  select coalesce(sum(
           (case when jsonb_typeof(e->'price') = 'number' then (e->>'price')::numeric else 0 end)
         * (case when jsonb_typeof(e->'qty') = 'number' then (e->>'qty')::numeric else 0 end)), 0)
    into v_food
    from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) e;
  if v_food < c.minimo then raise exception 'CUPON_MINIMO:%', c.minimo; end if;

  perform set_config('pos.descuento_rpc', '1', true);
  update public.orders set
    descuento_pct    = case when c.tipo = 'pct' then c.valor else 0 end,
    descuento_fijo   = case when c.tipo = 'monto' then c.valor else 0 end,
    cupon_codigo     = v_cod,
    descuento_motivo = 'Cupón ' || v_cod,
    updated_at       = now()
  where id = p_order
  returning * into o;
  perform set_config('pos.descuento_rpc', '', true);

  return jsonb_build_object('codigo', v_cod, 'tipo', c.tipo, 'valor', c.valor,
    'descuento_monto', o.descuento_monto, 'total', o.total);
end $$;
revoke all on function public.aplicar_cupon(uuid, text) from public;
grant execute on function public.aplicar_cupon(uuid, text) to anon, authenticated;

-- Quita el descuento de un pedido abierto
create or replace function public.quitar_descuento(p_order uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
begin
  perform public._crm_rate_limit();
  o := public._orden_abierta(p_order);
  perform set_config('pos.descuento_rpc', '1', true);
  update public.orders set descuento_pct = 0, descuento_fijo = 0, cupon_codigo = null, descuento_motivo = null, updated_at = now()
   where id = p_order returning * into o;
  perform set_config('pos.descuento_rpc', '', true);
  return jsonb_build_object('total', o.total);
end $$;
revoke all on function public.quitar_descuento(uuid) from public;
grant execute on function public.quitar_descuento(uuid) to anon, authenticated;

-- Admin: descuento manual con motivo (queda en el pedido)
create or replace function public.aplicar_descuento_manual(p_order uuid, p_pct numeric, p_fijo numeric, p_motivo text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_motivo text := nullif(left(trim(coalesce(p_motivo, '')), 120), '');
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if v_motivo is null then raise exception 'MOTIVO_REQUERIDO'; end if;
  if coalesce(p_pct, 0) < 0 or coalesce(p_pct, 0) > 100 or coalesce(p_fijo, 0) < 0 or coalesce(p_fijo, 0) > 100000 then
    raise exception 'DESCUENTO_INVALIDO';
  end if;
  if coalesce(p_pct, 0) > 0 and coalesce(p_fijo, 0) > 0 then raise exception 'DESCUENTO_INVALIDO'; end if;
  o := public._orden_abierta(p_order);
  perform set_config('pos.descuento_rpc', '1', true);
  update public.orders set descuento_pct = coalesce(p_pct, 0), descuento_fijo = coalesce(p_fijo, 0),
         cupon_codigo = null, descuento_motivo = v_motivo, updated_at = now()
   where id = p_order returning * into o;
  perform set_config('pos.descuento_rpc', '', true);
  return jsonb_build_object('descuento_monto', o.descuento_monto, 'total', o.total);
end $$;
revoke all on function public.aplicar_descuento_manual(uuid, numeric, numeric, text) from public, anon;
grant execute on function public.aplicar_descuento_manual(uuid, numeric, numeric, text) to authenticated;

-- Admin: cupones con sus usos (para el panel)
create or replace function public.cupones_con_usos()
returns table (id uuid, codigo text, tipo text, valor numeric, minimo numeric, vence date, usos_max integer,
               solo_cliente uuid, cliente_nombre text, descripcion text, activo boolean, created_at timestamptz, usos bigint)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  return query
  select c.id, c.codigo, c.tipo, c.valor, c.minimo, c.vence, c.usos_max, c.solo_cliente, cl.nombre, c.descripcion,
         c.activo, c.created_at,
         (select count(*) from public.orders o where o.cupon_codigo = c.codigo and coalesce(o.status, '') <> 'anulado')
    from public.cupones c
    left join public.clientes cl on cl.id = c.solo_cliente
   order by c.created_at desc;
end $$;
revoke all on function public.cupones_con_usos() from public, anon;
grant execute on function public.cupones_con_usos() to authenticated;

notify pgrst, 'reload schema';
