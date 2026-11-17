-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Reservas de mesa
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   No había forma de anotar una reserva de mesa — solo el mapa de
--   mesas en tiempo real (libre/ocupada AHORA). Esta migración agrega
--   una tabla independiente `reservas` que el panel admin gestiona
--   desde la pestaña "Reservas": crear, confirmar, cancelar o marcar
--   como completada.
--
--   A propósito NO se vincula por foreign key a `mesas` ni a `orders`
--   — una reserva es una intención a futuro, no un pedido ni bloquea
--   la mesa automáticamente (el mesero sigue abriendo la mesa como
--   siempre desde mesero.html cuando el cliente llega). Mezclar ambos
--   sistemas habría significado tocar la lógica de mesas que ya
--   funciona en producción — se prefirió mantenerlos separados.
--
--   Solo el panel admin escribe y lee aquí (RLS restringida a admin,
--   mismo patrón que audit_log / mesero_evaluaciones). mesero.html y
--   cocina.html no tocan esta tabla en esta primera versión.
--
-- Requiere haber corrido antes migracion-egresos-stock.sql (define
-- public.get_user_role(), reutilizada aquí).
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta, el sistema sigue funcionando EXACTO
-- como antes — la pestaña Reservas muestra un aviso claro en vez de
-- romperse (ver DB.getReservas() en src/services/supabase.js).
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.reservas (
  id             uuid primary key default gen_random_uuid(),
  cliente_nombre text not null,
  telefono       text,
  personas       integer not null default 1,
  fecha_hora     timestamptz not null,
  mesa_numero    integer,                  -- opcional — puede reservarse sin asignar mesa todavía
  notas          text,
  estado         text not null default 'pendiente'
                   check (estado in ('pendiente', 'confirmada', 'cancelada', 'completada')),
  created_by     text,                     -- nombre del admin que la creó
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table public.reservas enable row level security;

do $$ begin
  create policy "reservas_select" on public.reservas
    for select using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "reservas_insert" on public.reservas
    for insert with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "reservas_update" on public.reservas
    for update using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "reservas_delete" on public.reservas
    for delete using (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

create index if not exists idx_reservas_fecha_hora on public.reservas (fecha_hora);
create index if not exists idx_reservas_estado     on public.reservas (estado);
