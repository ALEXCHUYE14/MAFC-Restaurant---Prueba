-- 1. "Eliminar" un plato del catálogo estático (se oculta, no se borra del código)
alter table public.inventory add column if not exists hidden boolean not null default false;

-- 2. Nueva tabla de platos/bebidas creados desde el AdminDashboard
create table if not exists public.menu_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  cat         text not null,
  price       numeric(10,2) not null check (price >= 0),
  img_url     text,
  description text,
  available   boolean not null default true,
  stock       integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.menu_items enable row level security;

do $$ begin
  create policy "auth_menu_items_select"
    on public.menu_items for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "admin_menu_items_modify"
    on public.menu_items for all
    using (public.get_user_role() = 'admin');
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.menu_items;
exception when duplicate_object then null;
end $$;
