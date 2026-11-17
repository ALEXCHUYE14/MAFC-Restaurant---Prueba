-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Impresión por red Wi-Fi / LAN (cola de impresión + agente)
-- ══════════════════════════════════════════════════════════════════
-- Por qué así: el sistema se abre con HTTPS y los navegadores BLOQUEAN que
-- una página segura envíe datos directo a una impresora de la red local
-- (http://192.168.x.x). Por eso los celulares no imprimen "directo":
--
--   1. El mesero ENCOLA el ticket en Supabase (función encolar_impresion).
--   2. Un AGENTE de impresión (agente-impresion.js, en una PC del local)
--      toma los trabajos y los envía a la tiketera por la red (puerto 9100).
--
-- Ventajas: sin límite de distancia (el mesero puede estar en cualquier
-- parte con internet), si la tiketera está apagada el trabajo ESPERA en
-- cola y se imprime al volver, y queda historial.
--
-- Seguridad:
--   · Los celulares solo pueden ENCOLAR (función con límites: tamaño del
--     texto, impresora activa, y un máximo de trabajos por minuto para que
--     nadie pueda gastar el papel enviando basura).
--   · El agente NO usa una cuenta de administrador: usa un TOKEN propio
--     (se genera en Ajustes) que solo sirve para tomar y cerrar trabajos de
--     impresión. Se guarda cifrado (SHA-256): nadie puede leerlo de vuelta.
--   · Las tablas no son accesibles directamente desde la app: solo por estas
--     funciones (y el administrador puede ver/editar impresoras y la cola).
--
-- Requiere: migracion-egresos-stock.sql (get_user_role).
-- Seguro de ejecutar más de una vez.
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
set search_path = public, extensions;

-- ── 1. Impresoras de red ───────────────────────────────────────────
create table if not exists public.impresoras_red (
  id          uuid        primary key default gen_random_uuid(),
  nombre      text        not null check (length(trim(nombre)) between 1 and 40),
  ip          text        not null check (ip ~ '^(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3}$'),
  puerto      integer     not null default 9100 check (puerto between 1 and 65535),
  ancho_cols  integer     not null default 48 check (ancho_cols in (32, 42, 48)),
  activa      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.impresoras_red enable row level security;

-- Lectura: cualquiera con la app (el mesero necesita la lista para elegir).
-- Son IPs de la red INTERNA del local (no se pueden usar desde internet).
do $$ begin
  create policy "impresoras_red_select" on public.impresoras_red for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "impresoras_red_admin" on public.impresoras_red for all
    using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

-- ── 2. Cola de trabajos ────────────────────────────────────────────
create table if not exists public.print_jobs (
  id            uuid        primary key default gen_random_uuid(),
  impresora_id  uuid        not null references public.impresoras_red(id) on delete cascade,
  tipo          text        not null default 'comanda' check (tipo in ('comanda','precuenta','ticket','prueba')),
  -- Ticket ESC/POS codificado en base64 (puede llevar bytes de control que
  -- un texto normal no admite). Máx. 16000 caracteres (~12 KB de ticket).
  contenido     text        not null check (length(contenido) between 4 and 16000 and contenido ~ '^[A-Za-z0-9+/]+={0,2}$'),
  origen        text,
  estado        text        not null default 'pendiente' check (estado in ('pendiente','imprimiendo','impreso','error')),
  intentos      integer     not null default 0,
  ultimo_error  text,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  printed_at    timestamptz
);
create index if not exists idx_print_jobs_pendientes on public.print_jobs (created_at) where estado in ('pendiente','imprimiendo');
create index if not exists idx_print_jobs_created on public.print_jobs (created_at desc);
alter table public.print_jobs enable row level security;
do $$ begin
  create policy "print_jobs_admin_select" on public.print_jobs for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
-- (sin insert/update/delete directos: solo por las funciones de abajo)

-- ── 3. Token del agente + último contacto ──────────────────────────
create table if not exists public.print_agente (
  id               integer     primary key default 1 check (id = 1),
  token_sha256     text,
  ultimo_contacto  timestamptz,
  nombre_equipo    text,
  updated_at       timestamptz not null default now()
);
alter table public.print_agente enable row level security;
-- (sin políticas: solo las funciones la leen/escriben)

-- ── 4. Encolar (celulares / panel) ─────────────────────────────────
create or replace function public.encolar_impresion(p_impresora uuid, p_tipo text, p_contenido text, p_origen text default null)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if p_impresora is null or p_contenido is null or length(p_contenido) < 4 or length(p_contenido) > 16000
     or p_contenido !~ '^[A-Za-z0-9+/]+={0,2}$' then
    raise exception 'PRINT_INVALID';
  end if;
  if coalesce(p_tipo, '') not in ('comanda','precuenta','ticket','prueba') then raise exception 'PRINT_INVALID'; end if;
  if not exists (select 1 from public.impresoras_red where id = p_impresora and activa) then
    raise exception 'PRINTER_NOT_FOUND';
  end if;
  -- Límite anti-abuso: máx. 40 trabajos por minuto por impresora y 120 en total
  if (select count(*) from public.print_jobs where impresora_id = p_impresora and created_at > now() - interval '1 minute') >= 40
     or (select count(*) from public.print_jobs where created_at > now() - interval '1 minute') >= 120 then
    raise exception 'PRINT_RATE_LIMIT';
  end if;

  insert into public.print_jobs (impresora_id, tipo, contenido, origen)
  values (p_impresora, p_tipo, p_contenido, left(nullif(trim(coalesce(p_origen, '')), ''), 60))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.encolar_impresion(uuid, text, text, text) from public;
grant execute on function public.encolar_impresion(uuid, text, text, text) to anon, authenticated;

-- ── 5. Agente: verificar token (uso interno) ───────────────────────
create or replace function public._print_agente_ok(p_token text, p_equipo text)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ok boolean;
begin
  if p_token is null or length(p_token) < 32 or length(p_token) > 200 then return false; end if;
  select token_sha256 = encode(digest(p_token, 'sha256'), 'hex') into v_ok
    from public.print_agente where id = 1;
  -- "Último contacto" se actualiza como mucho cada 15 s (el agente consulta
  -- cada 1.5 s: no hace falta escribir en cada consulta)
  if coalesce(v_ok, false) then
    update public.print_agente
       set ultimo_contacto = now(), nombre_equipo = left(coalesce(p_equipo, nombre_equipo), 60)
     where id = 1
       and (ultimo_contacto is null or ultimo_contacto < now() - interval '15 seconds');
  end if;
  return coalesce(v_ok, false);
end $$;
revoke all on function public._print_agente_ok(text, text) from public, anon, authenticated;

-- ── 6. Agente: tomar trabajos (los marca "imprimiendo") ────────────
-- FOR UPDATE SKIP LOCKED: aunque hubiera dos agentes, un trabajo nunca se
-- toma dos veces. Un trabajo "imprimiendo" hace más de 2 min (el agente se
-- cayó a la mitad) vuelve a tomarse.
create or replace function public.print_agente_tomar(p_token text, p_equipo text default null, p_max integer default 10)
returns table (id uuid, ip text, puerto integer, ancho_cols integer, tipo text, contenido text, intentos integer)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if not public._print_agente_ok(p_token, p_equipo) then raise exception 'AGENT_NOT_ALLOWED'; end if;
  return query
  with sel as (
    select j.id from public.print_jobs j
     where (j.estado = 'pendiente'
            or (j.estado = 'imprimiendo' and j.claimed_at < now() - interval '2 minutes'))
       and j.created_at > now() - interval '6 hours'      -- no imprime tickets muy viejos
     order by j.created_at
     limit greatest(1, least(coalesce(p_max, 10), 25))
     for update skip locked
  ), upd as (
    update public.print_jobs j
       set estado = 'imprimiendo', claimed_at = now(), intentos = j.intentos + 1
      from sel where j.id = sel.id
    returning j.id, j.impresora_id, j.tipo, j.contenido, j.intentos
  )
  select u.id, r.ip, r.puerto, r.ancho_cols, u.tipo, u.contenido, u.intentos
    from upd u join public.impresoras_red r on r.id = u.impresora_id;
end $$;
revoke all on function public.print_agente_tomar(text, text, integer) from public;
grant execute on function public.print_agente_tomar(text, text, integer) to anon, authenticated;

-- ── 7. Agente: informar resultado ──────────────────────────────────
-- Si falla, vuelve a la cola (hasta 5 intentos); luego queda en "error".
create or replace function public.print_agente_resultado(p_token text, p_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public._print_agente_ok(p_token, null) then raise exception 'AGENT_NOT_ALLOWED'; end if;
  if p_ok then
    update public.print_jobs set estado = 'impreso', printed_at = now(), ultimo_error = null
     where id = p_id and estado = 'imprimiendo';
  else
    update public.print_jobs
       set estado = case when intentos >= 5 then 'error' else 'pendiente' end,
           ultimo_error = left(coalesce(p_error, 'Error de impresión'), 200)
     where id = p_id and estado = 'imprimiendo';
  end if;
end $$;
revoke all on function public.print_agente_resultado(text, uuid, boolean, text) from public;
grant execute on function public.print_agente_resultado(text, uuid, boolean, text) to anon, authenticated;

-- ── 8. Admin: generar un token nuevo (se muestra UNA vez) ──────────
create or replace function public.generar_token_agente()
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_token text;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  v_token := encode(gen_random_bytes(24), 'hex');           -- 48 caracteres aleatorios
  insert into public.print_agente (id, token_sha256, updated_at)
  values (1, encode(digest(v_token, 'sha256'), 'hex'), now())
  on conflict (id) do update set token_sha256 = excluded.token_sha256, ultimo_contacto = null, updated_at = now();
  return v_token;
end $$;
revoke all on function public.generar_token_agente() from public, anon;
grant execute on function public.generar_token_agente() to authenticated;

-- ── 9. Admin: estado del agente y de la cola ───────────────────────
create or replace function public.estado_impresion_red()
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v jsonb;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  select jsonb_build_object(
    'token_configurado', coalesce((select token_sha256 is not null from public.print_agente where id = 1), false),
    'ultimo_contacto',   (select ultimo_contacto from public.print_agente where id = 1),
    'equipo',            (select nombre_equipo from public.print_agente where id = 1),
    'pendientes',        (select count(*) from public.print_jobs where estado in ('pendiente','imprimiendo')),
    'errores_hoy',       (select count(*) from public.print_jobs where estado = 'error' and created_at > now() - interval '24 hours'),
    'impresos_hoy',      (select count(*) from public.print_jobs where estado = 'impreso' and created_at > now() - interval '24 hours')
  ) into v;
  return v;
end $$;
revoke all on function public.estado_impresion_red() from public, anon;
grant execute on function public.estado_impresion_red() to authenticated;

-- ¿El agente está en línea? (para el mesero: solo sí/no, ningún dato más)
create or replace function public.agente_impresion_activo()
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select ultimo_contacto > now() - interval '1 minute' from public.print_agente where id = 1), false);
$$;
revoke all on function public.agente_impresion_activo() from public;
grant execute on function public.agente_impresion_activo() to anon, authenticated;

-- Limpieza: trabajos de más de 7 días (se llama sola desde el agente cada hora)
create or replace function public.print_agente_limpiar(p_token text)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_n integer;
begin
  if not public._print_agente_ok(p_token, null) then raise exception 'AGENT_NOT_ALLOWED'; end if;
  delete from public.print_jobs where created_at < now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.print_agente_limpiar(text) from public;
grant execute on function public.print_agente_limpiar(text) to anon, authenticated;

notify pgrst, 'reload schema';
