-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Pago con Tarjeta + Pago Mixto (cobro dividido)
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   'tarjeta' y 'plin' YA eran valores válidos de payment_method en todo
--   el sistema (tickets, reporte PDF, caja, el selector de cobro de la
--   pestaña Caja) — solo faltaban como botón en los modales de cobro del
--   POS y de mesero.html. Eso se arregló en el código, sin tocar la base.
--
--   Lo que SÍ necesita esquema nuevo es el PAGO MIXTO (dividir una cuenta
--   entre dos o más métodos, ej. S/30 efectivo + S/20 Yape):
--
--   1) `orders.payment_breakdown` (jsonb, nullable) — el desglose:
--      [{ "metodo": "efectivo", "monto": 30.00 }, { "metodo": "yape", "monto": 20.00 }]
--      NULL en el 99% de los pedidos (pago simple, exactamente como
--      siempre). Cuando hay desglose, `payment_method` se guarda como
--      'mixto' — compatibilidad total con TODO el código existente que ya
--      lee payment_method como string (caja, reportes, tickets): un pedido
--      mixto simplemente aparece como método "mixto", y quien quiera el
--      detalle lee payment_breakdown.
--
--   2) Trigger `check_payment_breakdown` — validación de verdad en el
--      SERVIDOR (no solo en el cliente): si alguien intenta guardar un
--      desglose cuya suma no coincide con el total del pedido, Postgres
--      RECHAZA el UPDATE/INSERT con un error claro. Esto protege contra
--      los 3+ lugares del código que pueden escribir en `orders`
--      (mesero.html, POS del admin, Externos del admin) con una sola
--      regla, sin tener que confiar en que cada uno valide igual de bien.
--
--   `ventas_meseros` (registro personal de ventas del mesero) NO necesita
--   columna nueva: un pago mixto en mesero.html se guarda como UNA FILA
--   POR CADA MÉTODO usado (ej. una fila "efectivo S/30" y otra "yape
--   S/20" para la misma mesa) — así el reporte de turno y el panel
--   Personal, que ya suman por `metodo_pago`, siguen funcionando sin
--   ningún cambio.
--
-- Requiere haber corrido antes migracion-egresos-stock.sql (no usa
-- get_user_role(), pero sigue el mismo orden de las demás migraciones).
--
-- Seguro de ejecutar más de una vez.
-- Si esta migración NO se ejecuta: el pago con Tarjeta/Plin de un solo
-- método YA funciona igual (no depende de esta migración). Lo único que
-- no funciona sin ella es "Dividir pago" — el botón de pago mixto detecta
-- el error de Postgres (columna/función inexistente) y avisa con claridad
-- en vez de fallar en silencio; el cobro de un solo método no se ve afectado.
-- ══════════════════════════════════════════════════════════════════

alter table public.orders add column if not exists payment_breakdown jsonb;

create or replace function public.check_payment_breakdown()
returns trigger
language plpgsql
as $$
declare
  suma numeric(10,2);
begin
  if new.payment_breakdown is not null then
    if jsonb_typeof(new.payment_breakdown) <> 'array' or jsonb_array_length(new.payment_breakdown) < 2 then
      raise exception 'payment_breakdown debe ser un arreglo con al menos 2 métodos de pago';
    end if;

    select coalesce(sum(round((leg->>'monto')::numeric, 2)), 0)
      into suma
      from jsonb_array_elements(new.payment_breakdown) as leg;

    if round(suma, 2) <> round(coalesce(new.total, 0), 2) then
      raise exception 'El desglose de pago (S/ %) no coincide con el total del pedido (S/ %)', suma, new.total;
    end if;

    -- El agregado siempre se guarda como 'mixto' — ningún código deja de
    -- funcionar: todo lo que ya lee payment_method sigue viendo un string.
    new.payment_method := 'mixto';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_payment_breakdown on public.orders;
create trigger trg_check_payment_breakdown
  before insert or update on public.orders
  for each row execute function public.check_payment_breakdown();

create index if not exists idx_orders_payment_breakdown on public.orders using gin (payment_breakdown)
  where payment_breakdown is not null;
