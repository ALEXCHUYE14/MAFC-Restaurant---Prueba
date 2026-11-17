-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: CRM de clientes + fidelidad (visitas y premios)
-- ══════════════════════════════════════════════════════════════════
-- Qué agrega:
--   · clientes            — ficha por celular (9 dígitos, empieza con 9)
--                           o DNI (8 dígitos). Consentimiento de marketing
--                           (Ley 29733 de Protección de Datos Personales).
--   · orders.cliente_id   — pedido ligado a la ficha (opcional, nunca
--                           obligatorio: no frena la venta).
--   · reservas.cliente_id — reserva ligada a la ficha (si existe la tabla).
--   · clientes_canjes     — premios canjeados (no se canjea dos veces).
--   · crm_config          — reglas: visitas para premio, premio, días de
--                           inactividad y plantillas de WhatsApp.
--
-- Reglas de fidelidad (las calcula SIEMPRE el servidor):
--   · Visita = día (hora de Lima) con al menos un pedido COBRADO de ese
--     cliente. Máximo 1 visita por día.
--   · Con N = visitas_premio (ej. 10): la visita N trae premio. Si el
--     cliente ya tiene N−1 visitas anteriores a hoy (desde su último
--     canje), HOY tiene premio disponible.
--   · Un canje cuyo pedido terminó ANULADO no cuenta (no se pierde).
--
-- Seguridad:
--   · La app del mesero (anónima) NO puede leer la tabla clientes. Solo
--     usa funciones que devuelven el primer nombre y el progreso de
--     puntos, con límite de consultas por minuto (evita "barrer" números).
--   · El administrador gestiona todo con su sesión (RLS por rol admin).
--   · Un pedido cobrado no puede cambiar de cliente desde la app anónima.
--
-- Requiere: migracion-egresos-stock.sql (get_user_role).
-- Seguro de ejecutar más de una vez. No modifica datos existentes.
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Clientes ───────────────────────────────────────────────────
create table if not exists public.clientes (
  id                  uuid        primary key default gen_random_uuid(),
  celular             text        unique check (celular ~ '^9[0-9]{8}$'),
  dni                 text        unique check (dni ~ '^[0-9]{8}$'),
  nombre              text        not null check (length(trim(nombre)) between 1 and 80),
  cumple_dia          smallint    check (cumple_dia between 1 and 31),
  cumple_mes          smallint    check (cumple_mes between 1 and 12),
  direccion           text        check (length(direccion) <= 200),
  notas               text        check (length(notas) <= 300),
  acepta_marketing    boolean     not null default false,
  acepta_marketing_at timestamptz,
  ultimo_contacto_at  timestamptz,
  created_by          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint clientes_doc_chk check (celular is not null or dni is not null)
);
create index if not exists idx_clientes_nombre on public.clientes (lower(nombre));
alter table public.clientes enable row level security;
do $$ begin
  create policy "clientes_admin_all" on public.clientes for all
    using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
revoke all on public.clientes from anon;

-- ── 2. Vínculos con pedidos y reservas ────────────────────────────
alter table public.orders add column if not exists cliente_id uuid references public.clientes(id) on delete set null;
create index if not exists idx_orders_cliente on public.orders (cliente_id, paid_at) where cliente_id is not null;

do $$ begin
  if to_regclass('public.reservas') is not null then
    alter table public.reservas add column if not exists cliente_id uuid references public.clientes(id) on delete set null;
    create index if not exists idx_reservas_cliente on public.reservas (cliente_id) where cliente_id is not null;
  end if;
end $$;

-- Un pedido cobrado/anulado/archivado no cambia de cliente desde la app anónima
create or replace function public._orders_cliente_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  begin v_role := coalesce(auth.role(), ''); exception when others then v_role := ''; end;
  if v_role = 'anon' and tg_op = 'UPDATE'
     and new.cliente_id is distinct from old.cliente_id
     and (coalesce(old.status, '') like 'Pagado%' or coalesce(old.status, '') in ('paid', 'anulado', 'archivado')) then
    new.cliente_id := old.cliente_id;
  end if;
  return new;
end $$;
revoke all on function public._orders_cliente_guard() from public, anon, authenticated;
drop trigger if exists trg_orders_cliente_guard on public.orders;
create trigger trg_orders_cliente_guard
  before update on public.orders
  for each row execute function public._orders_cliente_guard();

-- ── 3. Configuración ──────────────────────────────────────────────
create table if not exists public.crm_config (
  id                 integer     primary key default 1 check (id = 1),
  visitas_premio     integer     not null default 10 check (visitas_premio between 2 and 50),
  premio_texto       text        not null default 'Postre gratis' check (length(premio_texto) between 1 and 60),
  premio_categoria   text        not null default 'Postres' check (length(premio_categoria) between 1 and 60),
  dias_inactivo      integer     not null default 30 check (dias_inactivo between 7 and 365),
  plantilla_inactivo text        not null default 'Hola {nombre}, te extrañamos en {negocio}. Hoy tienes 10% de descuento. ¡Te esperamos!' check (length(plantilla_inactivo) <= 500),
  plantilla_cumple   text        not null default '¡Feliz cumpleaños, {nombre}! En {negocio} te esperamos con un detalle especial.' check (length(plantilla_cumple) <= 500),
  plantilla_premio   text        not null default 'Hola {nombre}, en tu próxima visita a {negocio} tienes {premio}. ¡Te esperamos!' check (length(plantilla_premio) <= 500),
  updated_at         timestamptz not null default now()
);
insert into public.crm_config (id) values (1) on conflict (id) do nothing;
alter table public.crm_config enable row level security;
do $$ begin
  create policy "crm_config_select" on public.crm_config for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "crm_config_admin" on public.crm_config for update
    using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

-- ── 4. Canjes de premios ──────────────────────────────────────────
create table if not exists public.clientes_canjes (
  id          uuid        primary key default gen_random_uuid(),
  cliente_id  uuid        not null references public.clientes(id) on delete cascade,
  order_id    uuid        references public.orders(id) on delete set null,
  premio      text        not null,
  producto    text,
  anulado     boolean     not null default false,
  created_by  text,
  created_at  timestamptz not null default now()
);
create unique index if not exists uq_canje_por_pedido on public.clientes_canjes (order_id) where order_id is not null and not anulado;
create index if not exists idx_canjes_cliente on public.clientes_canjes (cliente_id, created_at desc);
alter table public.clientes_canjes enable row level security;
do $$ begin
  create policy "canjes_admin_select" on public.clientes_canjes for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
revoke all on public.clientes_canjes from anon;
revoke insert, update, delete on public.clientes_canjes from authenticated;

-- Límite de consultas de la app anónima (anti "barrido" de números)
create table if not exists public.crm_consultas (
  id bigint generated always as identity primary key,
  at timestamptz not null default now()
);
create index if not exists idx_crm_consultas_at on public.crm_consultas (at);
alter table public.crm_consultas enable row level security;
revoke all on public.crm_consultas from anon, authenticated;

-- ── 5. Funciones internas ─────────────────────────────────────────
-- Fecha de hoy en Lima
create or replace function public._crm_hoy()
returns date language sql stable as $$ select (now() at time zone 'America/Lima')::date $$;

-- Estadísticas y fidelidad de un cliente
create or replace function public._crm_stats(p_cliente uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_n         integer;
  v_premio    text;
  v_cat       text;
  v_hoy       date := public._crm_hoy();
  v_vis_tot   integer;
  v_vis_prev  integer;
  v_canjes    integer;
  v_canje_hoy boolean;
  v_prog      integer;
  v_pedidos   integer;
  v_gastado   numeric;
  v_ultima    timestamptz;
begin
  select visitas_premio, premio_texto, premio_categoria into v_n, v_premio, v_cat from public.crm_config where id = 1;
  v_n := coalesce(v_n, 10);

  select count(distinct (o.paid_at at time zone 'America/Lima')::date),
         count(distinct (o.paid_at at time zone 'America/Lima')::date) filter (where (o.paid_at at time zone 'America/Lima')::date < v_hoy),
         count(*), coalesce(sum(coalesce(o.total, 0)), 0), max(o.paid_at)
    into v_vis_tot, v_vis_prev, v_pedidos, v_gastado, v_ultima
    from public.orders o
   where o.cliente_id = p_cliente and o.paid_at is not null and coalesce(o.status, '') <> 'anulado';

  select count(*), coalesce(bool_or((c.created_at at time zone 'America/Lima')::date = v_hoy), false)
    into v_canjes, v_canje_hoy
    from public.clientes_canjes c
    left join public.orders o on o.id = c.order_id
   where c.cliente_id = p_cliente and not c.anulado and coalesce(o.status, '') <> 'anulado';

  v_prog := greatest(0, v_vis_prev - v_canjes * v_n);
  return jsonb_build_object(
    'visitas',           v_vis_tot,
    'pedidos',           v_pedidos,
    'total_gastado',     round(v_gastado, 2),
    'ticket_promedio',   case when v_pedidos > 0 then round(v_gastado / v_pedidos, 2) else 0 end,
    'ultima_visita',     v_ultima,
    'meta',              v_n,
    -- visita de HOY dentro del ciclo (1..N)
    'visita_actual',     least(v_n, v_prog + 1),
    'premio_disponible', (v_prog >= v_n - 1) and not v_canje_hoy,
    'premio_texto',      v_premio,
    'premio_categoria',  v_cat,
    'canjes',            v_canjes
  );
end $$;
revoke all on function public._crm_stats(uuid) from public, anon, authenticated;

-- Límite para la app anónima: 60 consultas por minuto en total
create or replace function public._crm_rate_limit()
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role text;
begin
  begin v_role := coalesce(auth.role(), ''); exception when others then v_role := ''; end;
  if v_role <> 'anon' then return; end if;
  if (select count(*) from public.crm_consultas where at > now() - interval '1 minute') >= 60 then
    raise exception 'RATE_LIMIT';
  end if;
  insert into public.crm_consultas default values;
  delete from public.crm_consultas where at < now() - interval '1 hour';
end $$;
revoke all on function public._crm_rate_limit() from public, anon, authenticated;

-- Normaliza celular/DNI. Devuelve ('celular'|'dni', valor) o error.
create or replace function public._crm_doc(p_doc text, out tipo text, out valor text)
language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p_doc, ''), '[^0-9]', '', 'g');
begin
  if length(d) = 11 and left(d, 2) = '51' then d := substr(d, 3); end if;  -- +51 9xx xxx xxx
  if d ~ '^9[0-9]{8}$' then tipo := 'celular'; valor := d;
  elsif d ~ '^[0-9]{8}$' then tipo := 'dni'; valor := d;
  else raise exception 'DOC_INVALIDO';
  end if;
end $$;

-- ── 6. Funciones públicas ─────────────────────────────────────────
-- Identifica (y opcionalmente registra) a un cliente por celular o DNI.
-- Mesero (anon): solo recibe primer nombre + fidelidad.
-- Admin: recibe la ficha completa (para autocompletar formularios).
create or replace function public.crm_identificar(
  p_doc text, p_nombre text default null, p_acepta boolean default false,
  p_cumple_dia integer default null, p_cumple_mes integer default null,
  p_celular_extra text default null, p_creado_por text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tipo   text;
  v_valor  text;
  v_cli    public.clientes%rowtype;
  v_nuevo  boolean := false;
  v_admin  boolean := coalesce(public.get_user_role(), '') = 'admin';
  v_cel2   text;
  v_hoy    date := public._crm_hoy();
  v_nombre text := nullif(trim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g')), '');
begin
  perform public._crm_rate_limit();
  select tipo, valor into v_tipo, v_valor from public._crm_doc(p_doc);

  if v_tipo = 'celular' then select * into v_cli from public.clientes where celular = v_valor;
  else select * into v_cli from public.clientes where dni = v_valor; end if;

  if not found then
    if v_nombre is null then
      return jsonb_build_object('encontrado', false, 'tipo', v_tipo);
    end if;
    if length(v_nombre) > 80 then raise exception 'NOMBRE_INVALIDO'; end if;
    if p_cumple_dia is not null and (p_cumple_dia < 1 or p_cumple_dia > 31) then raise exception 'CUMPLE_INVALIDO'; end if;
    if p_cumple_mes is not null and (p_cumple_mes < 1 or p_cumple_mes > 12) then raise exception 'CUMPLE_INVALIDO'; end if;
    -- Celular adicional (si se registró con DNI) — opcional
    if v_tipo = 'dni' and nullif(trim(coalesce(p_celular_extra, '')), '') is not null then
      begin
        select valor into v_cel2 from public._crm_doc(p_celular_extra);
      exception when others then v_cel2 := null;   -- celular extra inválido: se ignora
      end;
      if v_cel2 is not null and v_cel2 !~ '^9[0-9]{8}$' then v_cel2 := null; end if;
      if v_cel2 is not null and exists (select 1 from public.clientes where celular = v_cel2) then v_cel2 := null; end if;
    end if;
    begin
      insert into public.clientes (celular, dni, nombre, cumple_dia, cumple_mes, acepta_marketing, acepta_marketing_at, created_by)
      values (case when v_tipo = 'celular' then v_valor else v_cel2 end,
              case when v_tipo = 'dni' then v_valor end,
              v_nombre, p_cumple_dia, p_cumple_mes, coalesce(p_acepta, false),
              case when coalesce(p_acepta, false) then now() end,
              left(nullif(trim(coalesce(p_creado_por, '')), ''), 60))
      returning * into v_cli;
      v_nuevo := true;
    exception when unique_violation then
      -- Otro equipo lo registró al mismo tiempo: se usa ese registro
      if v_tipo = 'celular' then select * into v_cli from public.clientes where celular = v_valor;
      else select * into v_cli from public.clientes where dni = v_valor; end if;
    end;
  end if;

  return jsonb_build_object(
    'encontrado',  true,
    'nuevo',       v_nuevo,
    'id',          v_cli.id,
    'nombre',      case when v_admin then v_cli.nombre else split_part(v_cli.nombre, ' ', 1) end,
    'cumple_hoy',  v_cli.cumple_dia = extract(day from v_hoy) and v_cli.cumple_mes = extract(month from v_hoy),
    'stats',       public._crm_stats(v_cli.id)
  ) || case when v_admin then jsonb_build_object(
    'nombre_completo', v_cli.nombre, 'celular', v_cli.celular, 'dni', v_cli.dni,
    'direccion', v_cli.direccion, 'notas', v_cli.notas, 'acepta_marketing', v_cli.acepta_marketing
  ) else '{}'::jsonb end;
end $$;
revoke all on function public.crm_identificar(text, text, boolean, integer, integer, text, text) from public;
grant execute on function public.crm_identificar(text, text, boolean, integer, integer, text, text) to anon, authenticated;

-- Fidelidad actual de un cliente ya identificado (sin datos personales)
create or replace function public.crm_estado_cliente(p_cliente uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._crm_rate_limit();
  if not exists (select 1 from public.clientes where id = p_cliente) then raise exception 'CLIENTE_NO_EXISTE'; end if;
  return public._crm_stats(p_cliente);
end $$;
revoke all on function public.crm_estado_cliente(uuid) from public;
grant execute on function public.crm_estado_cliente(uuid) to anon, authenticated;

-- Liga un pedido ABIERTO a un cliente (si se identificó después de enviarlo)
create or replace function public.crm_vincular_pedido(p_order uuid, p_cliente uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if p_cliente is not null and not exists (select 1 from public.clientes where id = p_cliente) then
    raise exception 'CLIENTE_NO_EXISTE';
  end if;
  select status into v_status from public.orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if coalesce(v_status, '') like 'Pagado%' or coalesce(v_status, '') in ('paid', 'anulado', 'archivado') then
    raise exception 'ORDER_CLOSED';
  end if;
  update public.orders set cliente_id = p_cliente, updated_at = now() where id = p_order;
end $$;
revoke all on function public.crm_vincular_pedido(uuid, uuid) from public;
grant execute on function public.crm_vincular_pedido(uuid, uuid) to anon, authenticated;

-- Canjea el premio. Mesero: exige un pedido abierto del cliente.
-- Admin: puede canjear antes de crear el pedido (p_order null) y ligarlo luego.
create or replace function public.crm_canjear_premio(p_cliente uuid, p_order uuid default null, p_producto text default null, p_por text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_stats  jsonb;
  v_status text;
  v_ocli   uuid;
  v_id     uuid;
  v_admin  boolean := coalesce(public.get_user_role(), '') = 'admin';
begin
  perform public._crm_rate_limit();
  if p_cliente is null then raise exception 'CLIENTE_NO_EXISTE'; end if;
  -- Un canje a la vez por cliente (dos celulares no canjean el mismo premio)
  perform pg_advisory_xact_lock(hashtext('crm_canje'), hashtext(p_cliente::text));
  if not exists (select 1 from public.clientes where id = p_cliente) then raise exception 'CLIENTE_NO_EXISTE'; end if;

  if p_order is null then
    if not v_admin then raise exception 'ORDER_REQUIRED'; end if;
  else
    select status, cliente_id into v_status, v_ocli from public.orders where id = p_order for update;
    if not found then raise exception 'ORDER_NOT_FOUND'; end if;
    if coalesce(v_status, '') like 'Pagado%' or coalesce(v_status, '') in ('paid', 'anulado', 'archivado') then
      raise exception 'ORDER_CLOSED';
    end if;
    if v_ocli is not null and v_ocli <> p_cliente then raise exception 'ORDER_OTRO_CLIENTE'; end if;
    if exists (select 1 from public.clientes_canjes where order_id = p_order and not anulado) then
      raise exception 'YA_CANJEADO';
    end if;
  end if;

  v_stats := public._crm_stats(p_cliente);
  if not coalesce((v_stats->>'premio_disponible')::boolean, false) then raise exception 'SIN_PREMIO'; end if;

  if p_order is not null and v_ocli is null then
    update public.orders set cliente_id = p_cliente, updated_at = now() where id = p_order;
  end if;
  insert into public.clientes_canjes (cliente_id, order_id, premio, producto, created_by)
  values (p_cliente, p_order, v_stats->>'premio_texto', left(nullif(trim(coalesce(p_producto, '')), ''), 80),
          left(nullif(trim(coalesce(p_por, '')), ''), 60))
  returning id into v_id;
  return jsonb_build_object('canje_id', v_id, 'premio', v_stats->>'premio_texto');
end $$;
revoke all on function public.crm_canjear_premio(uuid, uuid, text, text) from public;
grant execute on function public.crm_canjear_premio(uuid, uuid, text, text) to anon, authenticated;

-- Admin: liga un canje hecho antes de crear el pedido / lo anula
create or replace function public.crm_vincular_canje(p_canje uuid, p_order uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  update public.clientes_canjes set order_id = p_order where id = p_canje and order_id is null and not anulado;
end $$;
revoke all on function public.crm_vincular_canje(uuid, uuid) from public, anon;
grant execute on function public.crm_vincular_canje(uuid, uuid) to authenticated;

create or replace function public.crm_anular_canje(p_canje uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  update public.clientes_canjes set anulado = true where id = p_canje;
end $$;
revoke all on function public.crm_anular_canje(uuid) from public, anon;
grant execute on function public.crm_anular_canje(uuid) to authenticated;

-- Admin: lista de clientes con sus estadísticas (para el panel CRM)
-- (drop previo: si las columnas cambian en una versión futura, "create or
--  replace" no puede cambiar el tipo de retorno)
drop function if exists public.crm_resumen_clientes();
create or replace function public.crm_resumen_clientes()
returns table (
  id uuid, nombre text, celular text, dni text, cumple_dia smallint, cumple_mes smallint,
  direccion text, notas text, acepta_marketing boolean, ultimo_contacto_at timestamptz, created_at timestamptz,
  visitas bigint, pedidos bigint, total_gastado numeric, ultima_visita timestamptz,
  premio_disponible boolean
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  return query
  select c.id, c.nombre, c.celular, c.dni, c.cumple_dia, c.cumple_mes, c.direccion, c.notas,
         c.acepta_marketing, c.ultimo_contacto_at, c.created_at,
         count(distinct (o.paid_at at time zone 'America/Lima')::date),
         count(o.id),
         coalesce(sum(coalesce(o.total, 0)), 0),
         max(o.paid_at),
         coalesce((public._crm_stats(c.id)->>'premio_disponible')::boolean, false)
    from public.clientes c
    left join public.orders o
      on o.cliente_id = c.id and o.paid_at is not null and coalesce(o.status, '') <> 'anulado'
   group by c.id
   order by max(o.paid_at) desc nulls last, c.created_at desc;
end $$;
revoke all on function public.crm_resumen_clientes() from public, anon;
grant execute on function public.crm_resumen_clientes() to authenticated;

-- Admin: estadísticas de fidelidad de UN cliente (ficha)
create or replace function public.crm_stats_cliente(p_cliente uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  return public._crm_stats(p_cliente);
end $$;
revoke all on function public.crm_stats_cliente(uuid) from public, anon;
grant execute on function public.crm_stats_cliente(uuid) to authenticated;

notify pgrst, 'reload schema';
