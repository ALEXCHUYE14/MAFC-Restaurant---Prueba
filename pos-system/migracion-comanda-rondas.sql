-- ══════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Comandas por RONDA (envío incremental e ilimitado a cocina)
-- ══════════════════════════════════════════════════════════════════
-- Qué resuelve:
--   Antes, cuando un mesero agregaba productos a una mesa que YA tenía
--   un pedido enviado a cocina, mesero.html reenviaba el carrito
--   COMPLETO (viejo + nuevo) y cocina.html mostraba todo de nuevo,
--   confundiendo al cocinero sobre qué es realmente nuevo. Además, si
--   cocina ya había marcado el pedido como "Listo", el sistema
--   BLOQUEABA por completo cualquier producto adicional para esa mesa.
--
--   Ahora cada pedido de mesa guarda un historial de RONDAS en la
--   columna `rounds` (una por cada vez que el mesero envía algo nuevo
--   a cocina):
--
--     rounds: [
--       { n: 1, status: 'listo',     items: [...], sentAt, startedAt, readyAt },
--       { n: 2, status: 'pendiente', items: [...], sentAt, startedAt: null, readyAt: null },
--       ...
--     ]
--
--   status de cada ronda: 'pendiente' | 'en_cocina' | 'listo'.
--
--   - mesero.html puede seguir agregando y enviando rondas nuevas de
--     forma ILIMITADA mientras la cuenta no esté pagada — incluso si
--     rondas anteriores ya están "Listas".
--   - cocina.html muestra y procesa SOLO las rondas activas (no
--     'listo'), cada una con su propio botón "Empezar Preparación" /
--     "Marcar Lista" — nunca vuelve a listar ítems ya despachados.
--   - `items` y `total` (las columnas que ya existían) SIGUEN siendo el
--     pedido COMPLETO acumulado de la mesa — AdminDashboard, Caja, el
--     cierre de caja y la pre-cuenta no cambian en absoluto: siguen
--     leyendo el total real de todo lo consumido.
--   - `status` (la columna que ya existía) sigue reflejando un resumen
--     agregado ('pending'/'preparing'/'ready') calculado a partir de
--     las rondas, así que toda la lógica existente que ya filtraba o
--     coloreaba por `status` sigue funcionando sin cambios.
--
-- Seguro de ejecutar más de una vez (IF NOT EXISTS).
-- Si esta migración NO se ejecuta, el sistema sigue funcionando
-- exactamente como antes de esta función (mesero.html y cocina.html
-- degradan automáticamente sin la columna `rounds` — no rompe nada),
-- solo que no se obtiene el envío por rondas hasta aplicarla.
--
-- NOTA: si en algún momento se aplicó una migración anterior que
-- agregaba `last_batch_items`, esa columna queda en desuso (ya no la
-- lee ni la escribe el código) — puede eliminarse opcionalmente, pero
-- dejarla no causa ningún problema.
-- ══════════════════════════════════════════════════════════════════

alter table public.orders
  add column if not exists rounds jsonb;

comment on column public.orders.rounds is
  'Historial de rondas enviadas a cocina para pedidos de mesa: [{n, status: pendiente|en_cocina|listo, items, sentAt, startedAt, readyAt}]. NULL/vacío = pedido legado sin rondas (se degrada al comportamiento de un solo envío).';
