-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Calificación de turno — evaluación de meseros
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   El panel "Personal" del AdminDashboard ya mide ventas, tiempo de
--   atención y horas de turno de forma automática (datos objetivos).
--   Esta migración agrega la pieza subjetiva: que el admin pueda
--   puntuar (1-5) y comentar el desempeño de un mesero — trato al
--   cliente, orden, actitud — algo que ningún dato de `orders` puede
--   medir por sí solo.
--
--   Tabla nueva `mesero_evaluaciones`, independiente de `orders` y de
--   `mesero_sesiones` — no se vincula a un turno específico por id
--   para mantenerla simple; basta con guardar cuándo se hizo. Solo el
--   panel admin escribe y lee aquí (RLS restringida a admin, mismo
--   patrón que audit_log). A propósito NO hay política de UPDATE ni
--   DELETE — una calificación ya dada no se edita ni se borra desde
--   el cliente; si hace falta corregir algo, se agrega una evaluación
--   nueva con el comentario de corrección.
--
-- Requiere haber corrido antes migracion-egresos-stock.sql (define
-- public.get_user_role(), reutilizada aquí).
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta, el sistema sigue funcionando EXACTO
-- como antes — DB.addEvaluacionMesero()/getEvaluacionesMesero() ya
-- degradan de forma segura (ver src/services/supabase.js): el botón
-- "Evaluar turno" muestra un error claro en vez de perder la
-- calificación en silencio, y el resto del panel Personal sigue
-- funcionando sin esta columna.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.mesero_evaluaciones (
  id           uuid primary key default gen_random_uuid(),
  waiter_id    text not null,
  waiter_name  text,
  rating       smallint not null check (rating between 1 and 5),
  comentario   text,
  evaluado_por text,                       -- nombre del admin que calificó
  created_at   timestamptz default now()
);

alter table public.mesero_evaluaciones enable row level security;

do $$ begin
  create policy "mesero_evaluaciones_select" on public.mesero_evaluaciones
    for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "mesero_evaluaciones_insert" on public.mesero_evaluaciones
    for insert with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

create index if not exists idx_mesero_evaluaciones_waiter on public.mesero_evaluaciones (waiter_id, created_at desc);
