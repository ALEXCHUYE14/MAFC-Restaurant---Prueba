-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Auditoría — bitácora de acciones administrativas
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   Hasta ahora no había forma de saber quién cambió un precio, quién
--   abrió/cerró caja, o quién creó/editó/borró un egreso o un plato
--   del catálogo — ni cuándo. Esta migración agrega una tabla de solo
--   registro (`audit_log`).
--
--   El panel admin escribe aquí DESPUÉS de que la operación real ya
--   tuvo éxito — nunca antes, nunca la bloquea. Ver DB.logAudit() en
--   src/services/supabase.js: si el insert de auditoría falla (o esta
--   migración no se corrió y la tabla no existe), la operación
--   original YA SE GUARDÓ igual — auditar es best-effort, no una
--   transacción con la acción que audita.
--
--   Solo el panel admin escribe y lee aquí (requiere sesión real de
--   Supabase Auth vía public.get_user_role() = 'admin') — mesero.html
--   y cocina.html son anónimos por diseño y nunca tocan esta tabla.
--
-- Requiere haber corrido antes migracion-egresos-stock.sql (ahí se
-- define public.get_user_role(), reutilizada aquí).
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta, el sistema sigue funcionando EXACTO
-- como antes — DB.logAudit()/getAuditLog() detectan que la tabla no
-- existe y no hacen nada (la pestaña Auditoría queda vacía con un
-- aviso, en vez de romperse).
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,                        -- auth.uid() de quien hizo la acción
  actor_name  text,                        -- nombre legible al momento del hecho
  action      text not null,               -- 'price_change' · 'caja_open' · 'caja_close' ·
                                            -- 'expense_create'/'update'/'delete' ·
                                            -- 'menu_item_create'/'update'/'delete'
  entity      text,                        -- tabla afectada: 'inventory' · 'caja_estado' · 'egresos' · 'menu_items'
  entity_id   text,                        -- id de la fila afectada
  detail      jsonb default '{}'::jsonb,   -- contexto libre: { "antes": {...}, "despues": {...} }
  created_at  timestamptz default now()
);

alter table public.audit_log enable row level security;

do $$ begin
  create policy "audit_log_select" on public.audit_log
    for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "audit_log_insert" on public.audit_log
    for insert with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;
-- A propósito NO hay política de UPDATE ni DELETE — una bitácora que se
-- puede editar o borrar desde el cliente no sirve como auditoría.

create index if not exists idx_audit_log_created_at on public.audit_log (created_at desc);
create index if not exists idx_audit_log_action     on public.audit_log (action);
