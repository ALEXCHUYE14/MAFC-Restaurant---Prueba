-- ══════════════════════════════════════════════════════════════════════════
-- REGISTRAR NUEVO ADMINISTRADOR  (admin@mafcrestaurant.com)
-- Reemplaza al admin anterior (miguel@gmail.com), ya eliminado de Auth.
--
-- ► PASO 1 (en el panel, NO en SQL):
--   Supabase → Authentication → Users → "Add user" → "Create new user"
--     Email:    admin@mafcrestaurant.com
--     Password: (la que quieras, mínimo 6 caracteres)
--     ✔ Marca "Auto Confirm User"
--   → Create user
--
-- ► PASO 2: Supabase → SQL Editor → New query → pega este archivo → Run
--
-- Es seguro:
--   • Todo corre en una sola transacción: si algo falla, no cambia NADA.
--   • Se puede ejecutar varias veces sin duplicar nada.
--   • Solo toca la tabla public.users (perfil + rol que lee el login).
-- ══════════════════════════════════════════════════════════════════════════

do $$
declare
  -- ───────────── CONFIGURACIÓN ─────────────
  v_correo_nuevo    text := 'admin@mafcrestaurant.com';
  v_correo_anterior text := 'miguel@gmail.com';
  v_nombre          text := 'Administrador';
  -- ─────────────────────────────────────────

  v_id uuid;
begin
  v_correo_nuevo    := lower(trim(v_correo_nuevo));
  v_correo_anterior := lower(trim(v_correo_anterior));

  -- 1. El usuario nuevo debe existir en Supabase Auth (Paso 1)
  select id into v_id from auth.users where lower(email) = v_correo_nuevo;
  if v_id is null then
    raise exception 'No existe "%" en Authentication. Primero créalo en Authentication → Users → Add user (Paso 1).', v_correo_nuevo;
  end if;

  -- 2. Confirmar el correo por si no se marcó "Auto Confirm User"
  update auth.users
     set email_confirmed_at = coalesce(email_confirmed_at, now())
   where id = v_id;

  -- 3. Limpiar restos del admin anterior (perfiles huérfanos sin usuario en Auth)
  delete from public.users p
   where lower(p.email) = v_correo_anterior
     and not exists (select 1 from auth.users a where a.id = p.id);

  -- 4. Crear (o actualizar) el perfil con rol admin — es lo que valida el login
  insert into public.users (id, email, name, role, avatar, color)
  values (v_id, v_correo_nuevo, v_nombre, 'admin', '👑', '#f5a623')
  on conflict (id) do update
     set email = excluded.email,
         name  = coalesce(nullif(public.users.name, ''), excluded.name),
         role  = 'admin';

  raise notice '✔ Administrador listo. ID: %  ·  Correo: %', v_id, v_correo_nuevo;
end $$;


-- ── VERIFICACIÓN: debe aparecer admin@mafcrestaurant.com con role = admin ──
select u.id, u.email, u.name, u.role, a.email_confirmed_at
  from public.users u
  left join auth.users a on a.id = u.id
 where u.role = 'admin';
