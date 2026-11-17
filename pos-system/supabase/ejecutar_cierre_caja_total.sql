-- ═══════════════════════════════════════════════════════════════════════════
-- ANTOJITOS AL PASO — RPC: ejecutar_cierre_caja_total()
--
-- INSTRUCCIONES: Ejecutar en Supabase Dashboard → SQL Editor → New query → Run
--
-- QUÉ HACE (en orden estricto para respetar Foreign Keys):
--   1. Nullifica tables.current_order_id  ← evita FK violation contra orders
--   2. Resetea tabla 'tables' (admin)     ← libera mesas del panel admin
--   3. Archiva todos los pedidos          ← UPDATE (no DELETE) preserva historial
--   4. Libera tabla 'mesas' (mesero)      ← libera mesas del app mesero.html
--   5. Elimina ventas del turno del día   ← ventas_meseros para nueva jornada
--
-- TABLAS INTACTAS (maestras): users, inventory, menu, categorías, auth.*
--
-- SECURITY DEFINER: corre con privilegios del owner (postgres),
-- bypasa RLS y ejecuta todo en una sola transacción atómica.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.ejecutar_cierre_caja_total()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN

  -- ── 1. Liberar FK ANTES de archivar orders ─────────────────────────────────
  -- tables.current_order_id → orders(id) es una FK que viola integridad
  -- si se intenta DELETE en orders sin nullificarla primero.
  -- Wrapped en bloque para no romper si la tabla 'tables' no existe aún.
  BEGIN
    UPDATE public.tables
    SET
      current_order_id = NULL,
      status           = 'available',
      waiter_id        = NULL,
      waiter_name      = NULL,
      opened_at        = NULL,
      updated_at       = NOW()
    WHERE
      current_order_id IS NOT NULL
      OR status <> 'available';
  EXCEPTION
    WHEN undefined_table THEN NULL; -- tabla no existe: ignorar
  END;

  -- ── 2. Archivar TODOS los pedidos operativos ───────────────────────────────
  -- UPDATE en lugar de DELETE para:
  --   · No violar FK desde otras tablas que referencien orders(id).
  --   · Preservar historial para reportes futuros si se necesita.
  --   · El frontend filtra .neq('status','archivado') automáticamente → quedan
  --     invisibles en tiempo real sin necesidad de borrar filas.
  UPDATE public.orders
  SET
    status     = 'archivado',
    updated_at = NOW()
  WHERE
    status <> 'archivado';

  -- ── 3. Liberar TODAS las mesas del app Mesero (mesero.html) ───────────────
  -- Tabla 'mesas' usa campo 'estado' TEXT ('libre'/'ocupada'/'pendiente').
  -- Wrapped por si la tabla no existe en algún entorno.
  BEGIN
    UPDATE public.mesas
    SET
      estado               = 'libre',
      mesero_nombre        = NULL,
      mesero_color         = NULL,
      ultima_actualizacion = NOW()
    WHERE
      estado <> 'libre';
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

  -- ── 4. Limpiar ventas del turno (nueva jornada limpia) ────────────────────
  -- Elimina los registros de ventas_meseros del día actual para que cada
  -- mesero comience el siguiente turno con historial en cero.
  -- Si prefieres archivar en lugar de eliminar, comenta este bloque y
  -- usa UPDATE ventas_meseros SET archivado = true WHERE ...
  BEGIN
    DELETE FROM public.ventas_meseros
    WHERE fecha_hora >= date_trunc('day', NOW() AT TIME ZONE 'America/Lima');
  EXCEPTION
    WHEN undefined_table THEN NULL;
  END;

END;
$$;

-- ── Permisos de ejecución ─────────────────────────────────────────────────────
-- SECURITY DEFINER ya garantiza que corra con privilegios elevados,
-- pero se otorgan explícitamente los roles que pueden invocar la función
-- a través de supabase.rpc('ejecutar_cierre_caja_total').
REVOKE ALL   ON FUNCTION public.ejecutar_cierre_caja_total() FROM PUBLIC, anon;
-- (antes: GRANT ... TO anon — inseguro; ver migracion-seguridad-auditoria.sql)
GRANT EXECUTE ON FUNCTION public.ejecutar_cierre_caja_total() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ejecutar_cierre_caja_total() TO service_role;

-- ── Verificación (opcional — ejecutar por separado para confirmar) ────────────
-- SELECT proname, prosecdef, proacl
-- FROM   pg_proc
-- WHERE  proname = 'ejecutar_cierre_caja_total';
