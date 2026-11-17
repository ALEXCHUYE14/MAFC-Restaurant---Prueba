-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Fotos de platos en Supabase Storage (no en la fila)
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   Cada foto de plato se guardaba como texto base64 (data-URI) DENTRO
--   de la columna img_url de `inventory`/`menu_items`. Eso infla cada
--   SELECT * y cada payload de Realtime de esas tablas, y fue la causa
--   raíz del bug de imágenes que se parchó una vez (Supabase Realtime
--   omite columnas TOAST grandes en los eventos UPDATE, así que un
--   toggle de disponibilidad podía borrar la foto en pantalla).
--
--   Esta migración crea el bucket público "menu-images". El código ya
--   fue actualizado (src/services/storage.js) para subir ahí la foto
--   comprimida y guardar solo su URL (un string corto) en la fila.
--
-- Compatibilidad con fotos YA subidas: total. img_url simplemente se
-- muestra en un <img src>, sin importar si es un data-URI viejo o una
-- URL nueva de Storage — las fotos existentes NO necesitan tocarse
-- para seguir funcionando. Solo las fotos que subas/reemplaces DE AQUÍ
-- EN ADELANTE usan el bucket.
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta, el sistema sigue funcionando EXACTO
-- como antes — src/services/storage.js detecta que el bucket no existe
-- y cae automáticamente al data-URI de siempre. Subir una foto nunca
-- se rompe por esto.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Bucket público — las fotos de platos son visibles para
--       cualquier cliente del local, igual que ya lo eran como
--       data-URI (no es información sensible). ────────────────────────
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;


-- ── 2. Políticas sobre storage.objects, acotadas a este bucket ──────────
-- Lectura pública (además de que el bucket ya es public=true).
do $$ begin
  create policy "menu_images_select_public"
    on storage.objects for select
    using (bucket_id = 'menu-images');
exception when duplicate_object then null; end $$;

-- Solo un ADMIN autenticado puede subir/reemplazar/borrar fotos —
-- coincide con quién sube fotos hoy (solo el AdminDashboard → Stock).
do $$ begin
  create policy "menu_images_insert_admin"
    on storage.objects for insert
    with check (bucket_id = 'menu-images' and public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "menu_images_update_admin"
    on storage.objects for update
    using (bucket_id = 'menu-images' and public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "menu_images_delete_admin"
    on storage.objects for delete
    using (bucket_id = 'menu-images' and public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;


-- ══════════════════════════════════════════════════════════════════
-- OPCIONAL — backfill de fotos YA subidas como base64
-- ══════════════════════════════════════════════════════════════════
-- No hace falta correr nada más: las fotos existentes siguen
-- funcionando tal como están. Si en algún momento quieres "aligerar"
-- las filas viejas (mover sus data-URI al bucket también), la forma
-- más simple es: entra a Stock en el AdminDashboard y vuelve a subir
-- la misma foto de cada plato que quieras migrar — eso solo la sube al
-- bucket y reemplaza el data-URI por la URL nueva, sin tocar SQL.
