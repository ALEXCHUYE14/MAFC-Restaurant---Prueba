-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Un solo pedido abierto por mesa (concurrencia de meseros)
-- ══════════════════════════════════════════════════════════════════
-- Problema: si dos meseros enviaban la Ronda 1 de la MISMA mesa casi al
-- mismo tiempo, se creaban DOS pedidos para esa mesa (dos cuentas, dos
-- comandas, la mesa quedaba a nombre del último).
--
-- Solución: antes de crear un pedido de mesa, la base de datos verifica
-- que esa mesa no tenga ya un pedido ABIERTO. Usa un bloqueo por número
-- de mesa: si llegan dos envíos al mismo tiempo, el segundo espera al
-- primero y entonces ve que la mesa ya está tomada → se rechaza con
-- 'MESA_OCUPADA'. La app del mesero lo muestra claro y NO imprime nada.
--
-- · Solo aplica a pedidos de MESA (table_number > 0). Para llevar,
--   delivery y recojo (mesa 0) no cambian.
-- · Solo cuenta pedidos abiertos de las últimas 18 h: un pedido viejo que
--   quedó sin cerrar de otro día no bloquea la mesa hoy.
-- · No modifica datos existentes; solo valida los pedidos NUEVOS.
--
-- Seguro de ejecutar más de una vez.
-- Cómo ejecutarla: Supabase → SQL Editor → New query → pegar todo → Run.
-- ══════════════════════════════════════════════════════════════════

create or replace function public._orders_una_abierta_por_mesa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.table_number, 0) <= 0 then
    return new;                                   -- para llevar / externos: sin cambios
  end if;
  if coalesce(new.status, 'pending') like 'Pagado%'
     or coalesce(new.status, 'pending') in ('paid', 'served', 'archivado', 'anulado') then
    return new;                                   -- no es un pedido abierto
  end if;

  -- Bloqueo por mesa hasta el fin de la transacción: dos envíos simultáneos
  -- de la misma mesa se ejecutan uno detrás del otro, nunca a la vez.
  perform pg_advisory_xact_lock(hashtext('pos_mesa_abierta'), new.table_number);

  if exists (
    select 1 from public.orders o
     where o.table_number = new.table_number
       and o.id is distinct from new.id
       and coalesce(o.status, '') not like 'Pagado%'
       and coalesce(o.status, '') not in ('paid', 'served', 'archivado', 'anulado')
       and o.created_at > now() - interval '18 hours'
  ) then
    raise exception 'MESA_OCUPADA';
  end if;

  return new;
end
$$;
revoke all on function public._orders_una_abierta_por_mesa() from public, anon, authenticated;

drop trigger if exists trg_orders_una_abierta_por_mesa on public.orders;
create trigger trg_orders_una_abierta_por_mesa
  before insert on public.orders
  for each row execute function public._orders_una_abierta_por_mesa();

-- Índice para que la verificación sea instantánea aunque haya muchos pedidos
create index if not exists idx_orders_mesa_abierta
  on public.orders (table_number, created_at desc)
  where table_number > 0;

notify pgrst, 'reload schema';
