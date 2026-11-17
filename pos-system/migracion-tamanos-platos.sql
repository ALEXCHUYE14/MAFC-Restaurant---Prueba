-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Tamaños por plato (Fuente P. / Fuente M. / Fuente G. …)
-- ══════════════════════════════════════════════════════════════════
-- Agrega la columna opcional menu_items.variants: la lista de tamaños de
-- un producto, cada uno con su precio. Ejemplo:
--   [{"key":"P","label":"Fuente P.","price":15},
--    {"key":"M","label":"Fuente M.","price":20},
--    {"key":"G","label":"Fuente G.","price":25}]
--
-- · Vacía o nula → el producto funciona como siempre (un solo precio).
-- · Cada tamaño se vende como una línea propia ("Ceviche (Fuente M.)") pero
--   comparte el MISMO producto: el stock, su descuento, devolución y
--   anulación siguen funcionando igual.
-- · Solo el administrador puede editarla (política admin_menu_items_modify
--   que ya existe). La carta la lee igual que el precio.
--
-- Si NO se ejecuta, todo sigue funcionando como antes; el formulario de
-- productos avisa que falta ejecutarla al intentar guardar tamaños.
-- Seguro de ejecutar más de una vez.
--
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

alter table public.menu_items add column if not exists variants jsonb;

do $$ begin
  alter table public.menu_items
    add constraint menu_items_variants_check
    check (variants is null
           or (jsonb_typeof(variants) = 'array' and jsonb_array_length(variants) <= 6));
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
