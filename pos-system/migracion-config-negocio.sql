-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Configuración del negocio (nombre, RUC/DNI, Yape + QR)
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   El nombre del negocio, su RUC, la dirección y los datos de Yape
--   (número, titular) estaban escritos a mano en varios archivos del
--   código (tickets, reportes, modal de cobro del admin y del mesero).
--   Cambiarlos exigía editar código. Además el "QR de Yape" que se
--   mostraba al cobrar era un dibujo de relleno, no un QR real.
--
--   Esta migración crea UNA fila de configuración (id = 1, mismo
--   patrón que `caja_estado`) que el admin edita desde Ajustes y que
--   el admin y mesero.html leen. El QR real se sube como imagen al
--   bucket público "menu-images" (migracion-storage-imagenes.sql) y
--   aquí solo se guarda su URL.
--
--   Lectura pública (mesero.html es anónimo por diseño y necesita el
--   nombre/RUC para sus tickets y el QR para cobrar por Yape — son
--   datos que de todos modos se imprimen en el ticket del cliente).
--   Escritura SOLO admin (public.get_user_role() = 'admin').
--   No hay política de INSERT ni DELETE: la fila se siembra aquí una
--   sola vez y el cliente solo la actualiza.
--
-- Los valores sembrados son EXACTAMENTE los que estaban fijos en el
-- código — el sistema se ve igual hasta que el admin los cambie.
--
-- Requiere haber corrido antes migracion-egresos-stock.sql (define
-- public.get_user_role()).
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta, el sistema sigue funcionando igual:
-- el código usa los mismos valores por defecto, y Ajustes guarda los
-- cambios solo en el dispositivo del admin (con un aviso claro) hasta
-- que se corra esta migración.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.negocio_config (
  id                 integer primary key default 1 check (id = 1),
  nombre             text    not null default 'Antojitos al Paso',
  tipo_documento     text    not null default 'RUC' check (tipo_documento in ('RUC', 'DNI')),
  documento          text,                       -- RUC (11 dígitos) o DNI (8 dígitos)
  direccion          text,
  yape_numero        text,
  yape_titular       text,
  yape_qr_url        text,                       -- URL pública del QR subido (bucket menu-images)
  updated_at         timestamptz default now(),
  updated_by         text
);

insert into public.negocio_config
  (id, nombre, tipo_documento, documento, direccion, yape_numero, yape_titular)
values
  (1, 'Antojitos al Paso', 'RUC', '10456789012',
   'Jr. Zepita #349 - Catacaos, Piura', '982 936 262', 'Leonidas Juarez S.')
on conflict (id) do nothing;

alter table public.negocio_config enable row level security;

do $$ begin
  create policy "negocio_config_select_public" on public.negocio_config
    for select using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "negocio_config_update_admin" on public.negocio_config
    for update using (public.get_user_role() = 'admin')
    with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

-- Realtime — para que un cambio en Ajustes llegue a los meseros sin recargar.
do $$ begin
  alter publication supabase_realtime add table public.negocio_config;
exception when others then null; end $$;
