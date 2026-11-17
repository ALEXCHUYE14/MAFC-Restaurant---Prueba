-- 1. Egresos — columna de archivado por cierre de caja
alter table public.egresos add column if not exists archived boolean not null default false;

-- 2. Estado global de caja — fila única (id=1), visible desde POS, Externos
--    y app mesero.html (en cualquier dispositivo)
create table if not exists public.caja_estado (
  id            int primary key default 1,
  is_open       boolean not null default false,
  opened_at     timestamptz,
  opened_by     text,
  fondo_inicial numeric(10,2),
  closed_at     timestamptz,
  updated_at    timestamptz not null default now(),
  constraint caja_estado_singleton check (id = 1)
);
insert into public.caja_estado (id, is_open) values (1, false)
  on conflict (id) do nothing;
alter table public.caja_estado enable row level security;

do $$ begin
  create policy "auth_caja_estado_select"
    on public.caja_estado for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "admin_caja_estado_modify"
    on public.caja_estado for update
    using (public.get_user_role() = 'admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.caja_estado;
exception when duplicate_object then null;
end $$;
