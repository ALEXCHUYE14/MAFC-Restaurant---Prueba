-- 0. Función helper que faltaba: obtiene el rol del usuario autenticado
--    (requiere que public.users con columna "role" ya exista — así es en tu proyecto)
create or replace function public.get_user_role()
returns text language sql stable security definer as $$
  select role from public.users where id = auth.uid();
$$;

-- 1. Ampliar inventory con precio e imagen editables desde el AdminDashboard
--    (inventory ya está en supabase_realtime, no hace falta agregarla de nuevo)
alter table public.inventory add column if not exists price   numeric(10,2);
alter table public.inventory add column if not exists img_url text;

-- 2. Nueva tabla de Egresos / Gastos
create table if not exists public.egresos (
  id          uuid primary key default gen_random_uuid(),
  concepto    text not null,
  monto       numeric(10,2) not null,
  categoria   text not null default 'Otros',
  metodo_pago text,
  notas       text,
  created_by  text,
  fecha       timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
alter table public.egresos enable row level security;

create policy "admin_egresos_all"
  on public.egresos for all
  using (public.get_user_role() = 'admin');

alter publication supabase_realtime add table public.egresos;
