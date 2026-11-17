-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Facturación electrónica SUNAT (MAFC Facturación)
-- ══════════════════════════════════════════════════════════════════
-- Qué hace:
--   · Crea la tabla `comprobantes_electronicos`: UNA boleta o factura por
--     pedido cobrado, con su número (B001-00000012), estado en SUNAT,
--     hash, QR y enlaces al PDF / ticket.
--   · La escribe SOLO la Edge Function `emitir-comprobante` (con la
--     service role). Desde la app (anon / usuario) solo se puede LEER.
--   · No toca ninguna tabla existente. Los pedidos no cambian.
--
-- Seguro de ejecutar más de una vez.
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

create table if not exists public.comprobantes_electronicos (
  id                uuid          primary key default gen_random_uuid(),
  order_id          uuid          not null references public.orders(id) on delete restrict,
  api_id            text          not null,          -- id del comprobante en MAFC Facturación
  tipo_doc          text          not null check (tipo_doc in ('01', '03')),  -- 01 factura · 03 boleta
  numero            text          not null,          -- F001-00000001 / B001-00000001
  estado            text          not null default 'pendiente',
  -- pendiente | aceptado | observado | rechazado | error | anulado
  sunat_codigo      text,
  sunat_descripcion text,
  cliente_tipo_doc  text,                            -- 0 sin doc · 1 DNI · 6 RUC
  cliente_numero    text,
  cliente_nombre    text,
  total             numeric(10,2) not null,
  hash              text,
  qr                text,
  enlace_pdf        text,                            -- enlace público firmado (A4)
  enlace_ticket     text,                            -- enlace público firmado (80 mm)
  enlaces_vencen    timestamptz,
  emitido_por       text,                            -- mesero o usuario admin
  created_at        timestamptz   not null default now(),
  updated_at        timestamptz   not null default now()
);

-- Un pedido = un comprobante (evita boletas duplicadas si se presiona dos veces)
create unique index if not exists comprobantes_electronicos_order_uidx
  on public.comprobantes_electronicos (order_id);
create index if not exists comprobantes_electronicos_created_idx
  on public.comprobantes_electronicos (created_at desc);

alter table public.comprobantes_electronicos enable row level security;

-- Lectura para la app (mesero usa la anon key; el panel admin, su sesión).
-- A PROPÓSITO no hay políticas de INSERT/UPDATE/DELETE: solo la Edge Function
-- (service role) puede escribir, así nadie inventa un número desde el navegador.
do $$ begin
  create policy "comprobantes_electronicos_select" on public.comprobantes_electronicos
    for select using (true);
exception when duplicate_object then null; end $$;

-- Tiempo real: el panel admin ve aparecer el número apenas se emite.
do $$ begin
  alter publication supabase_realtime add table public.comprobantes_electronicos;
exception when duplicate_object or undefined_object then null; end $$;

notify pgrst, 'reload schema';
