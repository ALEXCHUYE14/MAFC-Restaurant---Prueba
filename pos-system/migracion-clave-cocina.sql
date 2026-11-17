-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Clave de COCINA verificada en el servidor
-- ══════════════════════════════════════════════════════════════════
-- Antes, el usuario y la clave de cocina estaban escritos dentro de la
-- app (cocina.html): cualquiera podía leerlos con las herramientas del
-- navegador. Ahora:
--
--   · La clave se guarda CIFRADA (bcrypt) en la base de datos.
--   · La app de cocina solo pregunta "¿es correcta?" y recibe sí/no;
--     nunca ve la clave ni su cifrado.
--   · 5 intentos fallidos bloquean el acceso 5 minutos (evita probar
--     todas las combinaciones con un programa).
--   · El administrador la cambia desde Ajustes → "Acceso de Cocina".
--
-- Arranca con las MISMAS credenciales de siempre (usuario "comanda",
-- clave "2026") para que la cocina no quede afuera. CÁMBIALA desde
-- Ajustes apenas ejecutes esta migración.
--
-- Requiere: migracion-egresos-stock.sql (get_user_role).
-- Seguro de ejecutar más de una vez (no pisa una clave ya cambiada).
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
-- crypt()/gen_salt() viven en "extensions" en Supabase (o en "public" en otras instalaciones)
set search_path = public, extensions;

create table if not exists public.cocina_acceso (
  id              integer     primary key default 1 check (id = 1),  -- una sola fila
  usuario         text        not null,
  clave_hash      text        not null,
  fallos          integer     not null default 0,
  bloqueado_hasta timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.cocina_acceso enable row level security;
-- (sin políticas a propósito: nadie la lee ni escribe desde la app;
--  solo las funciones de abajo)

-- Credenciales iniciales = las de siempre (no pisa una clave ya cambiada)
insert into public.cocina_acceso (id, usuario, clave_hash)
values (1, 'comanda', crypt('2026', gen_salt('bf')))
on conflict (id) do nothing;

-- ── ¿Usuario y clave correctos? (lo usa la app de cocina, sin sesión) ──
create or replace function public.verify_cocina_login(p_usuario text, p_clave text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.cocina_acceso%rowtype;
  v_ok  boolean;
begin
  if p_usuario is null or p_clave is null
     or length(p_usuario) > 60 or length(p_clave) > 100 then
    return false;
  end if;

  select * into v_row from public.cocina_acceso where id = 1 for update;
  if not found then return false; end if;

  if v_row.bloqueado_hasta is not null and v_row.bloqueado_hasta > now() then
    raise exception 'LOGIN_LOCKED';
  end if;

  v_ok := lower(trim(p_usuario)) = lower(v_row.usuario)
          and v_row.clave_hash = crypt(p_clave, v_row.clave_hash);

  if v_ok then
    update public.cocina_acceso
       set fallos = 0, bloqueado_hasta = null
     where id = 1;
  else
    update public.cocina_acceso
       set fallos = case when fallos + 1 >= 5 then 0 else fallos + 1 end,
           bloqueado_hasta = case when fallos + 1 >= 5 then now() + interval '5 minutes' else null end
     where id = 1;
  end if;

  return v_ok;
end
$$;
revoke all on function public.verify_cocina_login(text, text) from public;
grant execute on function public.verify_cocina_login(text, text) to anon, authenticated;

-- ── Usuario actual (para mostrarlo en Ajustes; solo admin) ──────────
create or replace function public.get_cocina_usuario()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario text;
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  select usuario into v_usuario from public.cocina_acceso where id = 1;
  return v_usuario;
end
$$;
revoke all on function public.get_cocina_usuario() from public, anon;
grant execute on function public.get_cocina_usuario() to authenticated;

-- ── Cambiar usuario y clave (solo admin) ────────────────────────────
create or replace function public.set_cocina_acceso(p_usuario text, p_clave text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_usuario text := lower(trim(coalesce(p_usuario, '')));
begin
  if coalesce(public.get_user_role(), '') <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  if length(v_usuario) < 3 or length(v_usuario) > 30 or v_usuario !~ '^[a-z0-9._-]+$' then
    raise exception 'USER_INVALID';
  end if;
  if p_clave is null or length(p_clave) < 4 or length(p_clave) > 100 then
    raise exception 'PASS_INVALID';
  end if;

  insert into public.cocina_acceso (id, usuario, clave_hash, fallos, bloqueado_hasta, updated_at)
  values (1, v_usuario, crypt(p_clave, gen_salt('bf')), 0, null, now())
  on conflict (id) do update
     set usuario = excluded.usuario,
         clave_hash = excluded.clave_hash,
         fallos = 0, bloqueado_hasta = null, updated_at = now();
end
$$;
revoke all on function public.set_cocina_acceso(text, text) from public, anon;
grant execute on function public.set_cocina_acceso(text, text) to authenticated;

notify pgrst, 'reload schema';
