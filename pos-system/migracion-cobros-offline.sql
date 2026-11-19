-- ═══════════════════════════════════════════════════════════════════════════
-- migracion-cobros-offline.sql
-- Cobros del mesero a prueba de cortes de internet.
--
-- 1) ventas_meseros.fecha_hora — la app del mesero SIEMPRE guarda y consulta
--    esta columna (turno, reporte, cierre de caja), pero el esquema base no la
--    creaba: en una base nueva TODAS las ventas de los meseros fallaban en
--    silencio. Se crea si falta; las filas existentes toman su created_at.
--
-- 2) ventas_meseros.client_op_id — identificador único que el celular genera
--    para cada cobro (uno por método en un pago dividido). Si la conexión se
--    corta a mitad del cobro y la app reintenta, la venta NO se duplica
--    (INSERT ... ON CONFLICT DO NOTHING). Las filas antiguas quedan en NULL
--    (un índice UNIQUE admite varios NULL).
--
-- Idempotente: se puede ejecutar varias veces sin problema.
-- Ejecutar en Supabase → SQL Editor DESPUÉS del esquema base.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. fecha_hora
alter table public.ventas_meseros add column if not exists fecha_hora timestamptz;
update public.ventas_meseros
   set fecha_hora = coalesce(created_at, now())
 where fecha_hora is null;
alter table public.ventas_meseros alter column fecha_hora set default now();
alter table public.ventas_meseros alter column fecha_hora set not null;

-- 2. client_op_id (anti-duplicados en reintentos)
alter table public.ventas_meseros add column if not exists client_op_id text;
create unique index if not exists ventas_meseros_client_op_id_key
  on public.ventas_meseros (client_op_id);

-- Validación mínima del formato (uuid + ":" + índice), solo si viene informado
do $$ begin
  alter table public.ventas_meseros
    add constraint ventas_meseros_client_op_id_chk
    check (client_op_id is null or (length(client_op_id) between 8 and 120 and client_op_id ~ '^[A-Za-z0-9-]+:[0-9]{1,2}$'));
exception when duplicate_object then null;
end $$;

-- 3. Índice para el turno / reportes (mesero + fecha)
create index if not exists idx_ventas_meseros_mesero_fecha
  on public.ventas_meseros (mesero_id, fecha_hora desc);
create index if not exists idx_ventas_meseros_fecha
  on public.ventas_meseros (fecha_hora);

-- Recargar el caché de PostgREST para que la API vea las columnas nuevas
notify pgrst, 'reload schema';
