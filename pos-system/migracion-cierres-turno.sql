-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Historial de cierres de caja por turno + cierre seguro
-- ══════════════════════════════════════════════════════════════════
-- Qué agrega:
--   1. Tabla cierres_caja: cada cierre de turno queda guardado (fondo,
--      ventas por método, egresos, efectivo esperado/contado, diferencia,
--      envases, anulados y los pedidos que cubrió). Solo el admin la lee.
--   2. estado_cierre_caja(): vista previa calculada en el SERVIDOR + lista
--      de pedidos sin cobrar (incluye los de días anteriores) y mesas
--      ocupadas sin pedido.
--   3. cerrar_turno_caja(): cierre ATÓMICO. Si hay algún pedido sin cobrar
--      NO cierra nada ('TURNO_CON_PEDIDOS_ABIERTOS'). Calcula los montos en
--      el servidor, guarda el cierre y hace la misma limpieza que
--      ejecutar_cierre_caja_total() (archivar pedidos, liberar mesas,
--      ventas_meseros del día, egresos activos).
--
-- Concurrencia: candado del cierre + LOCK TABLE orders IN EXCLUSIVE MODE
-- durante la transacción (milisegundos): mientras se cierra, nadie puede
-- crear ni cobrar un pedido (esperan y siguen al terminar). Las lecturas
-- no se bloquean. No se usan los candados por mesa: el candado de tabla
-- ya cubre todas las mesas y evita bloqueos cruzados.
--
-- Seguridad: todo exige rol admin (public.get_user_role()); nada para anon.
-- ejecutar_cierre_caja_total() NO se modifica (queda por compatibilidad).
--
-- Requiere: migracion-egresos-stock.sql (get_user_role).
-- Seguro de ejecutar más de una vez. No modifica datos existentes.
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Tabla de cierres ───────────────────────────────────────────
create table if not exists public.cierres_caja (
  id                uuid          primary key default gen_random_uuid(),
  opened_at         timestamptz,
  closed_at         timestamptz   not null default now(),
  opened_by         text,
  closed_by         text,
  closed_by_uid     uuid,
  fondo_inicial     numeric(10,2) not null default 0 check (fondo_inicial >= 0),
  pedidos_count     integer       not null default 0,
  total_ventas      numeric(10,2) not null default 0,
  por_metodo        jsonb         not null default '{}'::jsonb,
  efectivo_ventas   numeric(10,2) not null default 0,
  digital_ventas    numeric(10,2) not null default 0,
  total_egresos     numeric(10,2) not null default 0,
  efectivo_esperado numeric(10,2) not null default 0,
  efectivo_contado  numeric(10,2) not null default 0 check (efectivo_contado >= 0),
  diferencia        numeric(10,2) not null default 0,
  envases_count     integer       not null default 0,
  envases_total     numeric(10,2) not null default 0,
  anulados_count    integer       not null default 0,
  anulados_total    numeric(10,2) not null default 0,
  order_ids         uuid[]        not null default '{}'
);
create index if not exists idx_cierres_caja_closed on public.cierres_caja (closed_at desc);
alter table public.cierres_caja enable row level security;
do $$ begin
  create policy "cierres_caja_admin_select" on public.cierres_caja
    for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
-- Nadie escribe directo: solo cerrar_turno_caja()
revoke all on public.cierres_caja from anon;
revoke insert, update, delete on public.cierres_caja from authenticated;
grant select on public.cierres_caja to authenticated;

-- ── 2. Cálculo del turno (uso interno) ────────────────────────────
-- Pedidos COBRADOS y aún no archivados (los que el cierre va a archivar).
-- Columnas opcionales (payment_breakdown, packaging_*) se leen vía to_jsonb,
-- así funciona aunque alguna migración anterior no se haya ejecutado.
create or replace function public._resumen_turno_caja(p_fondo numeric)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Lima')) at time zone 'America/Lima';
  v_ids      uuid[];
  v_count    integer;
  v_total    numeric;
  v_env_c    integer;
  v_env_t    numeric;
  v_metodos  jsonb;
  v_ef       numeric;
  v_egr      numeric := 0;
  v_has_arch boolean;
  v_anu_c    integer;
  v_anu_t    numeric;
  v_fondo    numeric := round(coalesce(p_fondo, 0), 2);
begin
  select coalesce(array_agg(o.id), '{}'::uuid[]),
         count(*),
         coalesce(sum(coalesce(o.total, 0)), 0),
         coalesce(sum(case when jsonb_typeof(to_jsonb(o)->'packaging_count') = 'number'
                           then (to_jsonb(o)->>'packaging_count')::numeric else 0 end), 0)::integer,
         coalesce(sum(case when jsonb_typeof(to_jsonb(o)->'packaging_total') = 'number'
                           then (to_jsonb(o)->>'packaging_total')::numeric else 0 end), 0)
    into v_ids, v_count, v_total, v_env_c, v_env_t
    from public.orders o
   where coalesce(o.status, '') like 'Pagado%' or o.status = 'paid';

  -- Por método: un pago mixto se reparte entre sus tramos reales
  with paid as (
    select o.total, o.payment_method, to_jsonb(o)->'payment_breakdown' as bd
      from public.orders o
     where coalesce(o.status, '') like 'Pagado%' or o.status = 'paid'
  ), legs as (
    select coalesce(nullif(l->>'metodo', ''), 'efectivo') as metodo,
           case when jsonb_typeof(l->'monto') = 'number' then (l->>'monto')::numeric else 0 end as monto
      from paid p
      cross join lateral jsonb_array_elements(case when jsonb_typeof(p.bd) = 'array' then p.bd else '[]'::jsonb end) l
    union all
    select coalesce(nullif(p.payment_method, ''), 'efectivo'), coalesce(p.total, 0)
      from paid p
     where (case when jsonb_typeof(p.bd) = 'array' then jsonb_array_length(p.bd) else 0 end) = 0
  )
  select coalesce(jsonb_object_agg(metodo, round(s, 2)), '{}'::jsonb)
    into v_metodos
    from (select metodo, sum(monto) as s from legs group by metodo) x;
  v_ef := coalesce((v_metodos->>'efectivo')::numeric, 0);

  -- Egresos del turno: mismo criterio que el panel (activos y de hoy)
  if to_regclass('public.egresos') is not null then
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'egresos' and column_name = 'archived')
      into v_has_arch;
    execute 'select coalesce(sum(monto), 0) from public.egresos where fecha >= $1'
            || case when v_has_arch then ' and archived = false' else '' end
       into v_egr using v_day_start;
  end if;

  -- Anulados aún no archivados (informativo: el cierre los archiva)
  select count(*), coalesce(sum(coalesce(total, 0)), 0)
    into v_anu_c, v_anu_t
    from public.orders where status = 'anulado';

  return jsonb_build_object(
    'order_ids',         to_jsonb(v_ids),
    'pedidos_count',     v_count,
    'total_ventas',      round(v_total, 2),
    'por_metodo',        v_metodos,
    'efectivo_ventas',   round(v_ef, 2),
    'digital_ventas',    greatest(0, round(v_total - v_ef, 2)),
    'total_egresos',     round(v_egr, 2),
    'fondo_inicial',     v_fondo,
    'efectivo_esperado', round(v_fondo + v_ef - v_egr, 2),
    'envases_count',     v_env_c,
    'envases_total',     round(v_env_t, 2),
    'anulados_count',    v_anu_c,
    'anulados_total',    round(v_anu_t, 2)
  );
end $$;
revoke all on function public._resumen_turno_caja(numeric) from public, anon, authenticated;

-- ── 3. Pedidos sin cobrar (uso interno) ───────────────────────────
-- Abierto = no cobrado, no anulado, no archivado (incluye 'served' y
-- pedidos de días anteriores que quedaron sin cerrar).
create or replace function public._pedidos_abiertos_caja()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'table_number', o.table_number, 'zone', o.zone,
           'waiter_name', o.waiter_name, 'total', o.total, 'status', o.status,
           'created_at', o.created_at, 'notes', o.notes
         ) order by o.created_at), '[]'::jsonb)
    from public.orders o
   where coalesce(o.status, '') not like 'Pagado%'
     and coalesce(o.status, '') not in ('paid', 'anulado', 'archivado');
$$;
revoke all on function public._pedidos_abiertos_caja() from public, anon, authenticated;

-- ── 4. Vista previa para el panel (admin) ─────────────────────────
create or replace function public.estado_cierre_caja(p_fondo numeric default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_huerfanas jsonb := '[]'::jsonb;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_fondo is null or p_fondo < 0 or p_fondo > 1000000 then raise exception 'FONDO_INVALIDO'; end if;

  -- Mesas marcadas ocupadas sin ningún pedido abierto (solo aviso)
  if to_regclass('public.mesas') is not null then
    select coalesce(jsonb_agg(m.numero_mesa order by m.numero_mesa), '[]'::jsonb)
      into v_huerfanas
      from public.mesas m
     where m.estado <> 'libre'
       and (to_jsonb(m)->>'unida_a') is null
       and not exists (
         select 1 from public.orders o
          where o.table_number = m.numero_mesa
            and coalesce(o.status, '') not like 'Pagado%'
            and coalesce(o.status, '') not in ('paid', 'anulado', 'archivado'));
  end if;

  return jsonb_build_object(
    'resumen',          public._resumen_turno_caja(p_fondo),
    'pedidos_abiertos', public._pedidos_abiertos_caja(),
    'mesas_huerfanas',  v_huerfanas
  );
end $$;
revoke all on function public.estado_cierre_caja(numeric) from public, anon;
grant execute on function public.estado_cierre_caja(numeric) to authenticated;

-- ── 5. Cierre atómico del turno (admin) ───────────────────────────
create or replace function public.cerrar_turno_caja(
  p_fondo            numeric,
  p_efectivo_contado numeric,
  p_opened_at        timestamptz default null,
  p_opened_by        text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_res      jsonb;
  v_open     integer;
  v_id       uuid;
  v_name     text;
  v_esperado numeric;
  v_dif      numeric;
  v_contado  numeric;
  v_now      timestamptz := now();
  v_has_arch boolean;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_fondo is null or p_fondo < 0 or p_fondo > 1000000 then raise exception 'FONDO_INVALIDO'; end if;
  if p_efectivo_contado is null or p_efectivo_contado < 0 or p_efectivo_contado > 1000000 then
    raise exception 'EFECTIVO_INVALIDO';
  end if;
  v_contado := round(p_efectivo_contado, 2);

  -- Un solo cierre a la vez, y nadie crea/cobra pedidos mientras se cierra
  perform pg_advisory_xact_lock(hashtext('pos_cierre_caja'));
  lock table public.orders in exclusive mode;

  -- Regla: no se cierra con pedidos sin cobrar
  select count(*) into v_open
    from public.orders o
   where coalesce(o.status, '') not like 'Pagado%'
     and coalesce(o.status, '') not in ('paid', 'anulado', 'archivado');
  if v_open > 0 then
    raise exception 'TURNO_CON_PEDIDOS_ABIERTOS:%', v_open;
  end if;

  -- Montos calculados en el servidor
  v_res      := public._resumen_turno_caja(p_fondo);
  v_esperado := (v_res->>'efectivo_esperado')::numeric;
  v_dif      := round(v_contado - v_esperado, 2);
  select name into v_name from public.users where id = auth.uid();

  insert into public.cierres_caja (
    opened_at, closed_at, opened_by, closed_by, closed_by_uid,
    fondo_inicial, pedidos_count, total_ventas, por_metodo,
    efectivo_ventas, digital_ventas, total_egresos, efectivo_esperado,
    efectivo_contado, diferencia, envases_count, envases_total,
    anulados_count, anulados_total, order_ids
  ) values (
    case when p_opened_at is not null and p_opened_at <= v_now then p_opened_at end,
    v_now, left(nullif(trim(coalesce(p_opened_by, '')), ''), 80), left(v_name, 80), auth.uid(),
    (v_res->>'fondo_inicial')::numeric, (v_res->>'pedidos_count')::integer, (v_res->>'total_ventas')::numeric, v_res->'por_metodo',
    (v_res->>'efectivo_ventas')::numeric, (v_res->>'digital_ventas')::numeric, (v_res->>'total_egresos')::numeric, v_esperado,
    v_contado, v_dif, (v_res->>'envases_count')::integer, (v_res->>'envases_total')::numeric,
    (v_res->>'anulados_count')::integer, (v_res->>'anulados_total')::numeric,
    array(select jsonb_array_elements_text(v_res->'order_ids')::uuid)
  ) returning id into v_id;

  -- ── Limpieza: la misma de ejecutar_cierre_caja_total() ──
  begin
    update public.tables
       set current_order_id = null, status = 'available', waiter_id = null,
           waiter_name = null, opened_at = null, updated_at = now()
     where current_order_id is not null or status <> 'available';
  exception when undefined_table or undefined_column then null;
  end;

  update public.orders set status = 'archivado', updated_at = now()
   where status <> 'archivado';

  begin
    update public.mesas
       set estado = 'libre', mesero_nombre = null, mesero_color = null, ultima_actualizacion = now()
     where estado <> 'libre';
  exception when undefined_table or undefined_column then null;
  end;

  begin
    delete from public.ventas_meseros
     where fecha_hora >= date_trunc('day', now() at time zone 'America/Lima');
  exception when undefined_table or undefined_column then null;
  end;

  -- Egresos activos del turno → archivados (el panel también lo hace; es idempotente)
  if to_regclass('public.egresos') is not null then
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'egresos' and column_name = 'archived')
      into v_has_arch;
    if v_has_arch then
      execute 'update public.egresos set archived = true where archived = false';
    end if;
  end if;

  return v_res || jsonb_build_object(
    'id',               v_id,
    'closed_at',        v_now,
    'opened_at',        case when p_opened_at is not null and p_opened_at <= v_now then p_opened_at end,
    'opened_by',        p_opened_by,
    'closed_by',        v_name,
    'efectivo_contado', v_contado,
    'diferencia',       v_dif
  );
end $$;
revoke all on function public.cerrar_turno_caja(numeric, numeric, timestamptz, text) from public, anon;
grant execute on function public.cerrar_turno_caja(numeric, numeric, timestamptz, text) to authenticated;

notify pgrst, 'reload schema';
