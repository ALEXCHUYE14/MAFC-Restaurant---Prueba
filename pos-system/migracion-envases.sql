-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Envases descartables para llevar (cobro por envase)
-- ══════════════════════════════════════════════════════════════════
-- Qué hace:
--   · El carrito (panel admin y app del mesero) tiene un contador de
--     envases (+/−). Cada envase cuesta un PRECIO FIJO (Ajustes → Envases).
--   · NO toca el stock ni el catálogo de platos.
--   · Cada pedido guarda:
--       packaging_count  = cantidad de envases
--       packaging_unit   = precio por envase AL MOMENTO de agregarlo
--       packaging_total  = packaging_count × packaging_unit
--     y total = suma de los platos + packaging_total.
--
-- Integridad (anti-manipulación):
--   · packaging_unit, packaging_total y el total de los pedidos con envases
--     los CALCULA la base de datos (trigger), nunca se aceptan de la app.
--   · Todos los caminos que guardan el pedido (crear, nueva ronda, quitar
--     un plato, cobrar) recalculan bien el total, así el cierre de caja
--     cuadra exacto.
--   · Un pedido ya cobrado/anulado no puede cambiar sus envases.
--   · Los pedidos SIN envases no cambian en nada (el trigger no los toca).
--
-- Seguro de ejecutar más de una vez. No modifica pedidos existentes.
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Configuración (precio por envase) ──────────────────────────
create table if not exists public.envases_config (
  id          integer      primary key default 1 check (id = 1),
  activo      boolean      not null default true,
  precio      numeric(6,2) not null default 1.00 check (precio >= 0 and precio <= 50),
  updated_at  timestamptz  not null default now()
);
insert into public.envases_config (id) values (1) on conflict (id) do nothing;
alter table public.envases_config enable row level security;

do $$ begin
  create policy "envases_config_select" on public.envases_config for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "envases_config_admin" on public.envases_config for update
    using (public.get_user_role() = 'admin') with check (public.get_user_role() = 'admin');
exception when duplicate_object then null; end $$;

-- ── 2. Columnas del pedido ─────────────────────────────────────────
alter table public.orders add column if not exists packaging_count integer       not null default 0;
alter table public.orders add column if not exists packaging_unit  numeric(6,2);
alter table public.orders add column if not exists packaging_total numeric(10,2) not null default 0;
do $$ begin
  alter table public.orders add constraint orders_packaging_count_chk check (packaging_count between 0 and 99);
exception when duplicate_object then null; end $$;

-- ── 3. Cálculo en el servidor ─────────────────────────────────────
-- Se llama "trg_aa_…" para ejecutarse ANTES que los demás triggers del
-- pedido (los triggers BEFORE corren en orden alfabético): así la
-- validación del pago mixto compara contra el total YA correcto.
create or replace function public._orders_packaging()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_closed boolean := false;
  v_price  numeric;
  v_active boolean;
  v_food   numeric;
begin
  new.packaging_count := coalesce(new.packaging_count, 0);

  if tg_op = 'UPDATE' then
    v_closed := coalesce(old.status, '') like 'Pagado%'
                or coalesce(old.status, '') in ('paid', 'anulado', 'archivado');
    if v_closed then
      -- Pedido cerrado: los envases quedan como estaban
      new.packaging_count := old.packaging_count;
      new.packaging_unit  := old.packaging_unit;
      new.packaging_total := old.packaging_total;
      return new;
    end if;
  end if;

  if new.packaging_count < 0 or new.packaging_count > 99 then
    raise exception 'PACKAGING_INVALID';
  end if;

  if new.packaging_count = 0 then
    new.packaging_total := 0;
    -- Sin envases antes ni ahora: el pedido no se toca (comportamiento de siempre)
    if tg_op = 'INSERT' or coalesce(old.packaging_count, 0) = 0 then
      new.packaging_unit := case when tg_op = 'INSERT' then null else old.packaging_unit end;
      return new;
    end if;
    new.packaging_unit := old.packaging_unit;
  else
    -- Precio congelado: el del momento en que se agregó el primer envase
    if tg_op = 'UPDATE' and old.packaging_unit is not null then
      new.packaging_unit := old.packaging_unit;
    else
      select precio, activo into v_price, v_active from public.envases_config where id = 1;
      if not found or not v_active then
        raise exception 'PACKAGING_DISABLED';
      end if;
      new.packaging_unit := v_price;
    end if;
    new.packaging_total := round(new.packaging_count * new.packaging_unit, 2);
  end if;

  -- total = platos + envases (calculado aquí, no se acepta el de la app)
  select coalesce(sum(
           (case when jsonb_typeof(e->'price') = 'number' then (e->>'price')::numeric else 0 end)
         * (case when jsonb_typeof(e->'qty') = 'number' then (e->>'qty')::numeric
                 when jsonb_typeof(e->'quantity') = 'number' then (e->>'quantity')::numeric
                 else 0 end)
         ), 0)
    into v_food
    from jsonb_array_elements(case when jsonb_typeof(new.items) = 'array' then new.items else '[]'::jsonb end) e;
  new.total := round(v_food + new.packaging_total, 2);
  return new;
end $$;
revoke all on function public._orders_packaging() from public, anon, authenticated;

drop trigger if exists trg_aa_orders_packaging on public.orders;
create trigger trg_aa_orders_packaging
  before insert or update on public.orders
  for each row execute function public._orders_packaging();

notify pgrst, 'reload schema';
