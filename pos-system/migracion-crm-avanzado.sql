-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: CRM avanzado — importar clientes antiguos, unir fichas
-- duplicadas, aviso para mesero/cocina y encuestas de satisfacción
-- ══════════════════════════════════════════════════════════════════
-- Requiere: migracion-clientes-crm.sql (ejecutarla ANTES que esta).
--
--   1. crm_importar_clientes_antiguos(): convierte en fichas los teléfonos
--      que ya estaban en los pedidos de Delivery/Recojo/Para Llevar y liga
--      esos pedidos (y las reservas con el mismo teléfono). Se puede
--      ejecutar varias veces: no duplica nada. Sin consentimiento de
--      marketing (nadie lo dio todavía).
--   2. crm_unir_clientes(destino, origen): une dos fichas de la misma
--      persona (ej. una con celular y otra con DNI). Pedidos, reservas,
--      canjes y encuestas pasan a la ficha destino; la de origen se borra.
--   3. clientes.aviso_mesero: texto corto que el ADMIN decide compartir
--      con el mesero y cocina (ej. "Alergia al maní"). Las notas siguen
--      siendo solo del administrador.
--   4. encuestas: el admin genera un enlace único (se envía por WhatsApp);
--      el cliente califica de 1 a 5 y comenta. Un enlace = una respuesta,
--      vence a los 14 días, con límite de consultas.
--
-- Seguro de ejecutar más de una vez. No borra datos existentes.
-- ══════════════════════════════════════════════════════════════════

-- Verificación previa: si falta una migración anterior, se detiene aquí
-- con un mensaje claro (y no cambia nada).
do $$ begin
  if to_regprocedure('public.get_user_role()') is null then
    raise exception 'FALTA EJECUTAR ANTES: migracion-egresos-stock.sql';
  end if;
  if to_regclass('public.clientes') is null or to_regclass('public.clientes_canjes') is null
     or to_regprocedure('public._crm_rate_limit()') is null then
    raise exception 'FALTA EJECUTAR ANTES: migracion-clientes-crm.sql (luego vuelve a ejecutar este archivo)';
  end if;
end $$;

create extension if not exists pgcrypto;
set search_path = public, extensions;

-- ── 1. Aviso para mesero/cocina ───────────────────────────────────
alter table public.clientes add column if not exists aviso_mesero text check (length(aviso_mesero) <= 80);

-- Estadísticas + aviso (reemplaza la versión de migracion-clientes-crm.sql)
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
  v_aviso     text;
begin
  select visitas_premio, premio_texto, premio_categoria into v_n, v_premio, v_cat from public.crm_config where id = 1;
  v_n := coalesce(v_n, 10);
  select aviso_mesero into v_aviso from public.clientes where id = p_cliente;

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
    'visita_actual',     least(v_n, v_prog + 1),
    'premio_disponible', (v_prog >= v_n - 1) and not v_canje_hoy,
    'premio_texto',      v_premio,
    'premio_categoria',  v_cat,
    'canjes',            v_canjes,
    'aviso',             nullif(trim(coalesce(v_aviso, '')), '')
  );
end $$;
revoke all on function public._crm_stats(uuid) from public, anon, authenticated;

-- ── 2. Importar clientes antiguos ─────────────────────────────────
create or replace function public.crm_importar_clientes_antiguos()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r         record;
  v_notes   jsonb;
  v_tipo    text;
  v_val     text;
  v_id      uuid;
  v_nombre  text;
  v_creados integer := 0;
  v_ligados integer := 0;
  v_reserv  integer := 0;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  perform pg_advisory_xact_lock(hashtext('crm_importar'));

  for r in
    select o.id, o.notes from public.orders o
     where o.cliente_id is null and o.notes is not null and left(ltrim(o.notes), 1) = '{'
     order by o.created_at
  loop
    begin
      v_notes := r.notes::jsonb;
    exception when others then
      continue;                                   -- notas que no son JSON: se ignoran
    end;
    if jsonb_typeof(v_notes) <> 'object' or coalesce(v_notes->>'phone', '') = '' then continue; end if;
    begin
      select tipo, valor into v_tipo, v_val from public._crm_doc(v_notes->>'phone');
    exception when others then
      continue;                                   -- teléfono no válido: se ignora
    end;
    if v_tipo <> 'celular' then continue; end if;

    select id into v_id from public.clientes where celular = v_val;
    if not found then
      v_nombre := nullif(left(trim(regexp_replace(coalesce(v_notes->>'customerName', ''), '\s+', ' ', 'g')), 80), '');
      insert into public.clientes (celular, nombre, direccion, created_by)
      values (v_val, coalesce(v_nombre, 'Cliente ' || right(v_val, 4)),
              nullif(left(trim(coalesce(v_notes->>'address', '')), 200), ''), 'Importación')
      returning id into v_id;
      v_creados := v_creados + 1;
    end if;
    update public.orders set cliente_id = v_id where id = r.id and cliente_id is null;
    v_ligados := v_ligados + 1;
  end loop;

  -- Reservas con el mismo celular (solo las que aún no tienen ficha)
  if to_regclass('public.reservas') is not null then
    begin
      execute $q$
        update public.reservas rv set cliente_id = c.id
          from public.clientes c
         where rv.cliente_id is null
           and c.celular is not null
           and right(regexp_replace(coalesce(rv.telefono, ''), '[^0-9]', '', 'g'), 9) = c.celular
      $q$;
      get diagnostics v_reserv = row_count;
    exception when undefined_column then null;   -- falta la columna (migración base sin correr)
    end;
  end if;

  return jsonb_build_object('clientes_creados', v_creados, 'pedidos_ligados', v_ligados, 'reservas_ligadas', v_reserv);
end $$;
revoke all on function public.crm_importar_clientes_antiguos() from public, anon;
grant execute on function public.crm_importar_clientes_antiguos() to authenticated;

-- ── 3. Unir fichas duplicadas ─────────────────────────────────────
create or replace function public.crm_unir_clientes(p_destino uuid, p_origen uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d public.clientes%rowtype;
  o public.clientes%rowtype;
  v_ped integer := 0;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if p_destino is null or p_origen is null or p_destino = p_origen then raise exception 'UNION_INVALIDA'; end if;
  -- Bloquea ambas fichas en orden fijo (sin bloqueos cruzados)
  perform 1 from public.clientes where id in (p_destino, p_origen) order by id for update;
  select * into d from public.clientes where id = p_destino;
  if not found then raise exception 'CLIENTE_NO_EXISTE'; end if;
  select * into o from public.clientes where id = p_origen;
  if not found then raise exception 'CLIENTE_NO_EXISTE'; end if;
  if d.celular is not null and o.celular is not null and d.celular <> o.celular then raise exception 'CELULARES_DISTINTOS'; end if;
  if d.dni is not null and o.dni is not null and d.dni <> o.dni then raise exception 'DNI_DISTINTOS'; end if;

  update public.orders set cliente_id = p_destino where cliente_id = p_origen;
  get diagnostics v_ped = row_count;
  update public.clientes_canjes set cliente_id = p_destino where cliente_id = p_origen;
  if to_regclass('public.reservas') is not null then
    begin
      execute 'update public.reservas set cliente_id = $1 where cliente_id = $2' using p_destino, p_origen;
    exception when undefined_column then null;
    end;
  end if;
  if to_regclass('public.encuestas') is not null then
    update public.encuestas set cliente_id = p_destino where cliente_id = p_origen;
  end if;

  -- Se borra la ficha de origen ANTES de pasar su celular/DNI (únicos)
  delete from public.clientes where id = p_origen;
  update public.clientes set
    celular            = coalesce(d.celular, o.celular),
    dni                = coalesce(d.dni, o.dni),
    cumple_dia         = coalesce(d.cumple_dia, o.cumple_dia),
    cumple_mes         = case when d.cumple_dia is not null then d.cumple_mes else o.cumple_mes end,
    direccion          = coalesce(d.direccion, o.direccion),
    notas              = left(concat_ws(' · ', d.notas, o.notas), 300),
    aviso_mesero       = coalesce(d.aviso_mesero, o.aviso_mesero),
    acepta_marketing   = d.acepta_marketing or o.acepta_marketing,
    acepta_marketing_at = case when d.acepta_marketing then d.acepta_marketing_at
                               when o.acepta_marketing then o.acepta_marketing_at end,
    ultimo_contacto_at = greatest(d.ultimo_contacto_at, o.ultimo_contacto_at),
    created_at         = least(d.created_at, o.created_at),
    updated_at         = now()
  where id = p_destino;
  return jsonb_build_object('pedidos_movidos', v_ped);
end $$;
revoke all on function public.crm_unir_clientes(uuid, uuid) from public, anon;
grant execute on function public.crm_unir_clientes(uuid, uuid) to authenticated;

-- ── 4. Encuestas de satisfacción ──────────────────────────────────
create table if not exists public.encuestas (
  id            uuid        primary key default gen_random_uuid(),
  token         text        not null unique check (token ~ '^[0-9a-f]{32}$'),
  cliente_id    uuid        references public.clientes(id) on delete cascade,
  order_id      uuid        references public.orders(id) on delete set null,
  puntaje       smallint    check (puntaje between 1 and 5),
  comentario    text        check (length(comentario) <= 500),
  created_by    text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '14 days',
  respondida_at timestamptz
);
create index if not exists idx_encuestas_cliente on public.encuestas (cliente_id, created_at desc);
create index if not exists idx_encuestas_respondida on public.encuestas (respondida_at desc) where respondida_at is not null;
alter table public.encuestas enable row level security;
do $$ begin
  create policy "encuestas_admin_select" on public.encuestas for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
revoke all on public.encuestas from anon;
revoke insert, update, delete on public.encuestas from authenticated;

-- Admin: crea un enlace de encuesta para el cliente (su último pedido cobrado)
create or replace function public.crm_crear_encuesta(p_cliente uuid, p_por text default null)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
  v_order uuid;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if not exists (select 1 from public.clientes where id = p_cliente) then raise exception 'CLIENTE_NO_EXISTE'; end if;
  select id into v_order from public.orders
   where cliente_id = p_cliente and paid_at is not null and coalesce(status, '') <> 'anulado'
   order by paid_at desc limit 1;
  v_token := encode(gen_random_bytes(16), 'hex');
  insert into public.encuestas (token, cliente_id, order_id, created_by)
  values (v_token, p_cliente, v_order, left(nullif(trim(coalesce(p_por, '')), ''), 60));
  return v_token;
end $$;
revoke all on function public.crm_crear_encuesta(uuid, text) from public, anon;
grant execute on function public.crm_crear_encuesta(uuid, text) to authenticated;

-- Público (página encuesta.html): ¿el enlace es válido?
create or replace function public.encuesta_info(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e public.encuestas%rowtype;
  v_nombre text;
begin
  perform public._crm_rate_limit();
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then return jsonb_build_object('estado', 'invalida'); end if;
  select * into e from public.encuestas where token = p_token;
  if not found then return jsonb_build_object('estado', 'invalida'); end if;
  if e.respondida_at is not null then return jsonb_build_object('estado', 'respondida'); end if;
  if e.expires_at < now() then return jsonb_build_object('estado', 'vencida'); end if;
  select split_part(nombre, ' ', 1) into v_nombre from public.clientes where id = e.cliente_id;
  return jsonb_build_object('estado', 'ok', 'nombre', v_nombre);
end $$;
revoke all on function public.encuesta_info(text) from public;
grant execute on function public.encuesta_info(text) to anon, authenticated;

-- Público: responde una sola vez
create or replace function public.encuesta_responder(p_token text, p_puntaje integer, p_comentario text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  perform public._crm_rate_limit();
  if p_token is null or p_token !~ '^[0-9a-f]{32}$' then raise exception 'ENCUESTA_INVALIDA'; end if;
  if p_puntaje is null or p_puntaje < 1 or p_puntaje > 5 then raise exception 'PUNTAJE_INVALIDO'; end if;
  update public.encuestas
     set puntaje = p_puntaje,
         comentario = nullif(left(trim(coalesce(p_comentario, '')), 500), ''),
         respondida_at = now()
   where token = p_token and respondida_at is null and expires_at >= now();
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'ENCUESTA_NO_DISPONIBLE'; end if;
  return true;
end $$;
revoke all on function public.encuesta_responder(text, integer, text) from public;
grant execute on function public.encuesta_responder(text, integer, text) to anon, authenticated;

notify pgrst, 'reload schema';
