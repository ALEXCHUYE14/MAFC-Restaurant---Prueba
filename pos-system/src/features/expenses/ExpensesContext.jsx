import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { DEMO_MODE, DB } from '@/services/supabase'
import { startOfDay } from '@/utils/dates'
import { useAuth } from '@/features/auth/AuthContext'
import { InsumosDB } from '@/services/insumos'

export const EXPENSE_CATEGORIES = ['Insumos', 'Servicios', 'Personal', 'Alquiler', 'Mantenimiento', 'Otros']

/* ── Demo store (mismo patrón que Orders/Inventory) ────────────────────────── */
let _demoExp = []
let _demoExpListeners = new Set()
let _demoExpId = 100
function notifyExp() { _demoExpListeners.forEach(cb => cb([..._demoExp])) }

const DemoExpStore = {
  subscribe(cb) {
    _demoExpListeners.add(cb)
    cb([..._demoExp])
    return () => _demoExpListeners.delete(cb)
  },
  add(data) {
    const id = `demo-egreso-${++_demoExpId}`
    _demoExp = [{ id, ...data, createdAt: new Date().toISOString() }, ..._demoExp]
    notifyExp()
    return id
  },
  update(id, data) {
    _demoExp = _demoExp.map(e => e.id === id ? { ...e, ...data } : e)
    notifyExp()
  },
  remove(id) {
    _demoExp = _demoExp.filter(e => e.id !== id)
    notifyExp()
  },
  archiveAllActive() {
    _demoExp = _demoExp.map(e => e.archived ? e : { ...e, archived: true })
    notifyExp()
  },
}

const ExpensesCtx = createContext(null)

export function ExpensesProvider({ children }) {
  const { user } = useAuth()
  // allExpenses = todo lo que existe (incluye egresos de turnos ya cerrados,
  // marcados archived:true). `expenses` (expuesto) es SIEMPRE solo los
  // activos del turno en curso — así el panel "se reinicia a []" en cuanto
  // se archivan al Cerrar Caja, sin tocar el historial en la base de datos.
  const [allExpenses, setAllExpenses]   = useState([])
  const [loading, setLoading]           = useState(true)
  // true si la tabla `egresos` todavía no existe en Supabase (falta ejecutar
  // la migración) — el panel muestra un aviso en vez de fallar en silencio.
  const [tableMissing, setTableMissing] = useState(false)

  useEffect(() => {
    if (DEMO_MODE) {
      const unsub = DemoExpStore.subscribe(data => { setAllExpenses(data); setLoading(false) })
      return unsub
    }

    let mounted = true
    DB.getEgresos()
      .then(data => {
        if (!mounted) return
        setAllExpenses(data)
        setLoading(false)
      })
      .catch(err => {
        if (!mounted) return
        console.warn('[Expenses] tabla "egresos" no disponible:', err?.message)
        setTableMissing(true)
        setAllExpenses([])
        setLoading(false)
      })

    const unsub = DB.subscribeEgresos(
      added   => setAllExpenses(prev => prev.find(e => e.id === added.id) ? prev : [added, ...prev]),
      updated => setAllExpenses(prev => prev.map(e => e.id === updated.id ? updated : e)),
      removed => setAllExpenses(prev => prev.filter(e => e.id !== removed.id)),
    )

    return () => { mounted = false; unsub() }
  }, [])

  const addExpense = useCallback(async (input) => {
    const concepto = (input?.concepto || '').trim()
    if (!concepto) throw new Error('El concepto es obligatorio')
    const monto = Number(input?.monto)
    if (!isFinite(monto) || monto <= 0) throw new Error('El monto debe ser mayor a 0')

    const payload = {
      concepto,
      monto,
      categoria:   EXPENSE_CATEGORIES.includes(input.categoria) ? input.categoria : 'Otros',
      metodoPago:  input.metodoPago || null,
      notas:       (input.notas || '').trim() || null,
      createdBy:   input.createdBy || null,
      fecha:       input.fecha || new Date().toISOString(),
    }

    if (DEMO_MODE) return DemoExpStore.add(payload)

    // Optimista: se muestra de inmediato con id temporal, se reemplaza al confirmar.
    const tempId = `temp-${Date.now()}`
    setAllExpenses(prev => [{ id: tempId, ...payload, archived: false, createdAt: new Date().toISOString() }, ...prev])
    try {
      const id = await DB.addEgreso(payload)
      setAllExpenses(prev => prev.map(e => e.id === tempId ? { ...e, id } : e))
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'expense_create', entity: 'egresos', entityId: id, detail: payload })
      return id
    } catch (err) {
      setAllExpenses(prev => prev.filter(e => e.id !== tempId))
      throw err
    }
  }, [user])

  const updateExpense = useCallback(async (id, data) => {
    if ('monto' in data) {
      const monto = Number(data.monto)
      if (!isFinite(monto) || monto <= 0) throw new Error('El monto debe ser mayor a 0')
      data = { ...data, monto }
    }
    if ('concepto' in data && !data.concepto.trim()) throw new Error('El concepto es obligatorio')

    setAllExpenses(prev => prev.map(e => e.id === id ? { ...e, ...data } : e))
    if (DEMO_MODE) return DemoExpStore.update(id, data)
    try {
      const result = await DB.updateEgreso(id, data)
      DB.logAudit({ actorId: user?.uid, actorName: user?.name, action: 'expense_update', entity: 'egresos', entityId: id, detail: data })
      return result
    } catch (err) {
      console.error('updateExpense:', err)
      throw err
    }
  }, [user])

  const deleteExpense = useCallback(async (id) => {
    let removed = null
    setAllExpenses(prev => {
      removed = prev.find(e => e.id === id) || null
      return prev.filter(e => e.id !== id)
    })
    if (DEMO_MODE) return DemoExpStore.remove(id)
    try {
      await DB.deleteEgreso(id)
      // Si esta compra había sumado a la despensa de insumos, se resta.
      // Best-effort: nunca lanza error ni bloquea la eliminación (si no
      // había insumo vinculado o falta la migración, no hace nada).
      if (!removed || removed.categoria === 'Insumos') {
        InsumosDB.revertirCompra(id)
        DB.revertirCompraStock(id)   // stock de productos (bebidas, etc.) sumado por esta compra
      }
      DB.logAudit({
        actorId: user?.uid, actorName: user?.name, action: 'expense_delete',
        entity: 'egresos', entityId: id,
        detail: removed ? { concepto: removed.concepto, monto: removed.monto } : {},
      })
    } catch (err) {
      // Revertir si la eliminación remota falla
      if (removed) setAllExpenses(prev => [removed, ...prev])
      throw err
    }
  }, [user])

  // Cierre de Caja: archiva todos los egresos activos (no los borra — quedan
  // en el historial general). Best-effort — si la columna `archived` aún no
  // existe (migración pendiente), no debe bloquear el cierre de caja; el
  // llamador decide si continuar de todas formas.
  const archiveActive = useCallback(async () => {
    setAllExpenses(prev => prev.map(e => e.archived ? e : { ...e, archived: true }))
    if (DEMO_MODE) return DemoExpStore.archiveAllActive()
    await DB.archiveAllEgresos()
  }, [])

  const expenses       = allExpenses.filter(e => !e.archived)
  const todayStart      = startOfDay()
  const todayExpenses  = expenses.filter(e => new Date(e.fecha) >= todayStart)
  const totalToday     = todayExpenses.reduce((s, e) => s + (e.monto || 0), 0)
  const totalAll       = expenses.reduce((s, e) => s + (e.monto || 0), 0)

  return (
    <ExpensesCtx.Provider value={{
      expenses, loading, tableMissing,
      todayExpenses, totalToday, totalAll,
      addExpense, updateExpense, deleteExpense, archiveActive,
    }}>
      {children}
    </ExpensesCtx.Provider>
  )
}

export function useExpenses() {
  const ctx = useContext(ExpensesCtx)
  if (!ctx) throw new Error('useExpenses must be used inside ExpensesProvider')
  return ctx
}
