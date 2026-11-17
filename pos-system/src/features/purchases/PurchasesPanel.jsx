import { useState, useMemo, useEffect, useCallback } from 'react'
import { useExpenses } from '@/features/expenses/ExpensesContext'
import { useAuth } from '@/features/auth/AuthContext'
import { useInventory } from '@/features/inventory/InventoryContext'
import { InsumosDB, fmtQty } from '@/services/insumos'
import { formatPEN } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import { Skeleton } from '@/components/Loader'
import { AlertTriangle, Loader2, ShoppingCart, Trash2 } from 'lucide-react'

/* ══════════════════════════════════════════════════════════════════
   COMPRAS — registro de insumos comprados para la preparación de platos
   ══════════════════════════════════════════════════════════════════
   NO es un sistema nuevo ni una tabla nueva — es una puerta de entrada
   especializada al mismo sistema de Egresos que ya existe y ya está
   probado: 'Insumos' es, desde siempre, la primera categoría de
   EXPENSE_CATEGORIES (ver ExpensesContext.jsx). Cada "compra" registrada
   aquí es, para la base de datos, un egreso normal con categoria:
   'Insumos' — por eso, automáticamente y sin código adicional:
     - Resta del neto de caja igual que cualquier otro egreso (ver
       DashboardOverview/CashierPanel, que ya restan `totalToday` de
       los ingresos).
     - Aparece también en la pestaña Egresos (junto a Servicios,
       Personal, etc.) — Compras es un ATAJO, no un catálogo aparte.
     - Queda auditado igual (DB.logAudit ya corre dentro de
       addExpense/deleteExpense).
     - Entra en el reporte PDF del día (generateDailySalesReport ya
       recibe `expenses` completo).
     - Se archiva igual al Cerrar Caja (archiveActive ya lo cubre).
   Lo único que agrega este panel es una FORMA más natural de cargar
   una compra de insumo (producto, proveedor, cantidad/unidad, monto)
   en vez del formulario genérico de "concepto/monto". Proveedor y
   cantidad no son columnas nuevas en la base de datos — se guardan
   como texto estructurado dentro del mismo campo `notas` que Egresos
   ya tiene, así que no hace falta ninguna migración para que esto
   funcione. ══════════════════════════════════════════════════════ */

const PM_OPTIONS = [
  { value: '',         label: 'Sin especificar' },
  { value: 'efectivo', label: '💵 Efectivo' },
  { value: 'yape',     label: '📱 Yape' },
  { value: 'plin',     label: '📱 Plin' },
  { value: 'tarjeta',  label: '💳 Tarjeta' },
]

const UNIT_OPTIONS = ['kg', 'g', 'L', 'mL', 'unidades', 'cajas', 'sacos', 'otro']

const EMPTY_FORM = { insumo: '', proveedor: '', cantidad: '', unidad: 'kg', monto: '', metodoPago: '', notas: '', stockItemId: '', stockUnits: '', despensaId: '' }

function buildNotas({ proveedor, cantidad, unidad, notas }) {
  const parts = []
  if (proveedor.trim()) parts.push(`Proveedor: ${proveedor.trim()}`)
  const cant = Number(cantidad)
  if (cantidad && isFinite(cant) && cant > 0) parts.push(`Cantidad: ${cant}${unidad ? ' ' + unidad : ''}`)
  if (notas.trim()) parts.push(notas.trim())
  return parts.join(' · ') || null
}

export default function PurchasesPanel() {
  const { expenses, loading, tableMissing, addExpense, deleteExpense } = useExpenses()
  const { user } = useAuth()
  const { effectiveMenu, addStock } = useInventory()

  const [form, setForm]         = useState(EMPTY_FORM)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [search, setSearch]     = useState('')

  // Despensa de insumos (migracion-insumos.sql). Si la tabla no existe o
  // falla la carga, simplemente no se ofrece la opción — Compras sigue igual.
  const [despensa, setDespensa] = useState([])
  const loadDespensa = useCallback(async () => {
    try {
      const r = await InsumosDB.list()
      setDespensa(r.missing ? [] : r.rows.filter(i => i.activo))
    } catch (e) {
      console.warn('[Compras] despensa no disponible:', e?.message)
      setDespensa([])
    }
  }, [])
  useEffect(() => { loadDespensa() }, [loadDespensa])

  // Compras = egresos activos (no archivados) con categoria 'Insumos'.
  // El resto de categorías (Servicios, Personal, etc.) sigue viviendo
  // solo en la pestaña Egresos — esta vista es a propósito solo insumos.
  const compras = useMemo(() => expenses.filter(e => e.categoria === 'Insumos'), [expenses])

  const filtered = search
    ? compras.filter(c => c.concepto.toLowerCase().includes(search.toLowerCase()) || (c.notas || '').toLowerCase().includes(search.toLowerCase()))
    : compras

  const totalHoy = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0)
    return compras.filter(c => new Date(c.fecha) >= start).reduce((s, c) => s + (c.monto || 0), 0)
  }, [compras])

  function setField(key, val) { setForm(p => ({ ...p, [key]: val })); setError('') }

  // Productos del catálogo (Stock) a los que se les puede sumar lo comprado,
  // ordenados por categoría y nombre para encontrarlos rápido en la lista.
  const stockProducts = useMemo(() => [...effectiveMenu].sort((a, b) =>
    String(a.cat).localeCompare(String(b.cat)) || String(a.name).localeCompare(String(b.name))
  ), [effectiveMenu])
  const stockItem = form.stockItemId ? stockProducts.find(p => String(p.id) === form.stockItemId) || null : null

  const despensaItem = form.despensaId ? despensa.find(i => i.id === form.despensaId) || null : null

  function handleDespensaChange(id) {
    const ins = id ? despensa.find(i => i.id === id) : null
    setForm(p => ({
      ...p,
      despensaId: id,
      // Despensa y stock de producto son excluyentes (una compra va a uno)
      ...(id ? { stockItemId: '', stockUnits: '' } : {}),
      insumo: !p.insumo.trim() && ins ? ins.nombre : p.insumo,
    }))
    setError('')
  }

  function handleStockItemChange(id) {
    const prod = id ? stockProducts.find(p => String(p.id) === id) : null
    setForm(p => ({
      ...p,
      ...(id ? { despensaId: '' } : {}),
      stockItemId: id,
      // Si aún no escribió qué compró, se usa el nombre del producto
      insumo: !p.insumo.trim() && prod ? prod.name : p.insumo,
    }))
    setError('')
  }

  async function handleSubmit() {
    if (saving) return
    const insumo = form.insumo.trim()
    if (!insumo) { setError('Ingresa qué insumo/producto compraste'); return }
    const monto = Number(form.monto)
    if (!isFinite(monto) || monto <= 0) { setError('Ingresa un monto válido mayor a 0'); return }

    // Opcional: sumar lo comprado al stock de un producto del catálogo
    let units = null
    if (form.stockItemId) {
      if (!stockItem) { setError('El producto elegido para sumar al stock ya no existe — elige otro'); return }
      units = Number(form.stockUnits)
      if (!Number.isInteger(units) || units < 1 || units > 100000) {
        setError('Ingresa cuántas unidades entran al stock (número entero mayor a 0)')
        return
      }
    }

    // Opcional: sumar lo comprado a la despensa de insumos
    let despQty = null
    if (form.despensaId) {
      if (!despensaItem) { setError('El insumo elegido ya no está en la despensa — elige otro'); return }
      despQty = Number(String(form.cantidad).replace(',', '.'))
      if (!isFinite(despQty) || despQty <= 0 || despQty > 1000000) {
        setError(`Ingresa la cantidad comprada en ${despensaItem.unidad} (mayor a 0)`)
        return
      }
    }

    setSaving(true)
    setError('')
    let egresoId = null
    try {
      egresoId = await addExpense({
        concepto:   insumo,
        monto,
        categoria:  'Insumos',
        metodoPago: form.metodoPago,
        notas:      buildNotas({
          ...form,
          unidad: despensaItem ? despensaItem.unidad : form.unidad,
          notas: [
            form.notas.trim(),
            units ? `Stock +${units} ${stockItem.name}` : '',
            despQty ? `Despensa +${fmtQty(despQty)} ${despensaItem.unidad} ${despensaItem.nombre}` : '',
          ].filter(Boolean).join(' · '),
        }),
        createdBy:  user?.name || null,
      })
    } catch (err) {
      setError(err?.message || 'No se pudo guardar la compra')
      setSaving(false)
      return
    }

    // La compra (egreso) ya quedó guardada. El stock se suma aparte: si
    // fallara, NO se borra la compra — se avisa para ajustarlo a mano.
    let msg = '✓ Compra registrada'
    if (units) {
      try {
        // Se pasa el número de la compra para poder restar este stock si
        // la compra se elimina después (id temporal = aún sin confirmar → sin vínculo)
        const linkId = egresoId && !String(egresoId).startsWith('temp-') ? egresoId : null
        const newStock = await addStock(stockItem, units, linkId)
        msg = `✓ Compra registrada · ${stockItem.name}: stock ${newStock}`
      } catch (err) {
        setError(`La compra se guardó, pero no se pudo sumar al stock de ${stockItem.name} (${err?.message || 'error'}). Ajústalo a mano en la pestaña Stock.`)
        msg = '✓ Compra registrada (stock sin actualizar)'
      }
    }
    if (despQty) {
      try {
        if (!egresoId || String(egresoId).startsWith('temp-')) throw new Error('la compra no devolvió su número')
        const r = await InsumosDB.entrada(despensaItem.id, despQty, monto, egresoId, form.proveedor.trim() ? `Proveedor: ${form.proveedor.trim()}` : null)
        msg = `✓ Compra registrada · ${despensaItem.nombre}: ahora hay ${fmtQty(r?.stock)} ${despensaItem.unidad}`
      } catch (err) {
        setError(`La compra se guardó, pero no se pudo sumar a la despensa (${err?.message || 'error'}). Haz un conteo de ${despensaItem.nombre} en la pestaña Insumos.`)
        msg = '✓ Compra registrada (despensa sin actualizar)'
      }
      loadDespensa()
    }
    setSavedMsg(msg)
    setForm(EMPTY_FORM)
    setTimeout(() => setSavedMsg(''), 4000)
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar esta compra? Esta acción no se puede deshacer.\n\nSi la compra sumó a la despensa de insumos o al stock de un producto, esa cantidad también se restará.')) return
    try {
      await deleteExpense(id)
      setTimeout(loadDespensa, 800) // refleja la reversión en la despensa
    } catch (err) {
      alert('⚠ No se pudo eliminar: ' + (err?.message || 'error desconocido'))
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {tableMissing && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 12px', flexShrink: 0,
          background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
          borderRadius: 8, fontSize: 11, color: '#D97706', lineHeight: 1.5,
          display: 'flex', gap: 6,
        }}>
          <AlertTriangle size={13} style={{flexShrink:0, marginTop: 1}}/>
          <span>La tabla <strong>egresos</strong> aún no existe en Supabase (Compras usa la misma
          tabla que Egresos). Ejecuta el script SQL incluido al final de
          <code> src/services/supabase.js</code> (sección "Egresos / Gastos") en el SQL Editor.</span>
        </div>
      )}

      {/* Resumen */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Gastado en insumos hoy', val: formatPEN(totalHoy),     color: '#DC2626' },
          { label: 'Compras registradas',    val: compras.length,          color: 'var(--amber)' },
        ].map(s => (
          <div key={s.label} style={{
            flex: '1 1 140px', background: 'var(--ink3)', border: '1px solid var(--line)',
            borderRadius: 'var(--r2)', padding: '8px 10px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 2, letterSpacing: .5 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Formulario */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>Insumo / producto comprado *</label>
            <input
              value={form.insumo}
              onChange={e => setField('insumo', e.target.value)}
              placeholder="Ej: Pollo, Papa, Aceite, Gas..."
              style={inputStyle}
              maxLength={120}
            />
          </div>
          <div>
            <label style={labelStyle}>Monto (S/) *</label>
            <input
              type="number" min="0" step="0.10"
              value={form.monto}
              onChange={e => setField('monto', e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>Proveedor (opcional)</label>
            <input
              value={form.proveedor}
              onChange={e => setField('proveedor', e.target.value)}
              placeholder="Ej: Pollería San Juan"
              style={inputStyle}
              maxLength={80}
            />
          </div>
          <div>
            <label style={labelStyle}>{despensaItem ? `Cantidad (${despensaItem.unidad}) *` : 'Cantidad (opcional)'}</label>
            <input
              type="number" min="0" step="0.01"
              value={form.cantidad}
              onChange={e => setField('cantidad', e.target.value)}
              placeholder="0"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Unidad</label>
            {despensaItem ? (
              <div style={{ ...inputStyle, color: 'var(--fog)' }} title="Es la unidad con la que se cuenta este insumo">{despensaItem.unidad}</div>
            ) : (
              <select value={form.unidad} onChange={e => setField('unidad', e.target.value)} style={inputStyle}>
                {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            )}
          </div>
        </div>

        {despensa.length > 0 && (
          <div style={{
            marginBottom: 8, padding: '8px 10px', borderRadius: 8,
            background: despensaItem ? 'rgba(217,119,6,.07)' : 'transparent',
            border: `1px dashed ${despensaItem ? 'rgba(217,119,6,.45)' : 'var(--line2)'}`,
          }}>
            <label style={labelStyle}>Sumar a la despensa de insumos (opcional)</label>
            <select value={form.despensaId} onChange={e => handleDespensaChange(e.target.value)} style={inputStyle}>
              <option value="">— No sumar a la despensa —</option>
              {despensa.map(i => (
                <option key={i.id} value={i.id}>{i.nombre} (hay {fmtQty(i.stock)} {i.unidad})</option>
              ))}
            </select>
            {despensaItem && (() => {
              const q = Number(String(form.cantidad).replace(',', '.'))
              const ok = isFinite(q) && q > 0
              const m = Number(form.monto)
              return (
                <div style={{ fontSize: 10, color: 'var(--fog)', lineHeight: 1.4, marginTop: 6 }}>
                  {despensaItem.nombre}: {fmtQty(despensaItem.stock)} → <strong style={{ color: '#16A34A' }}>{ok ? fmtQty(despensaItem.stock + q) : '…'} {despensaItem.unidad}</strong>
                  {ok && isFinite(m) && m > 0 && <> · {formatPEN(m / q)} por {despensaItem.unidad}</>}
                  {!ok && ' · escribe la cantidad arriba'}
                </div>
              )
            })()}
          </div>
        )}

        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8,
          padding: '8px 10px', borderRadius: 8,
          opacity: despensaItem ? .5 : 1,
          background: stockItem ? 'rgba(22,163,74,.06)' : 'transparent',
          border: `1px dashed ${stockItem ? 'rgba(22,163,74,.4)' : 'var(--line2)'}`,
        }}>
          <div>
            <label style={labelStyle}>Sumar al stock de (opcional)</label>
            <select value={form.stockItemId} onChange={e => handleStockItemChange(e.target.value)} style={inputStyle} disabled={!!despensaItem} title={despensaItem ? 'Esta compra ya va a la despensa de insumos' : undefined}>
              <option value="">— No sumar al stock —</option>
              {stockProducts.map(p => (
                <option key={p.id} value={String(p.id)}>
                  {p.cat} · {p.name} (actual: {p.stock === null || p.stock === undefined ? '∞' : p.stock})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Unidades que entran</label>
            <input
              type="number" min="1" step="1"
              value={form.stockUnits}
              onChange={e => setField('stockUnits', e.target.value)}
              placeholder="Ej: 24"
              disabled={!stockItem}
              style={{ ...inputStyle, opacity: stockItem ? 1 : .5 }}
            />
          </div>
          {stockItem && (
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--fog)', lineHeight: 1.4 }}>
              {(() => {
                const cur = stockItem.stock ?? null
                const u = Number(form.stockUnits)
                const ok = Number.isInteger(u) && u > 0
                const desde = cur === null ? '∞ (sin límite)' : cur
                const hasta = ok ? (cur ?? 0) + u : '…'
                return <>Stock de <strong style={{ color: 'var(--snow)' }}>{stockItem.name}</strong>: {desde} → <strong style={{ color: '#16A34A' }}>{hasta}</strong>
                  {cur === null && ' · desde ahora se controlará su stock'}
                  {cur === 0 && ' · volverá a quedar disponible'}</>
              })()}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>Método de pago</label>
            <select value={form.metodoPago} onChange={e => setField('metodoPago', e.target.value)} style={inputStyle}>
              {PM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Notas (opcional)</label>
            <input
              value={form.notas}
              onChange={e => setField('notas', e.target.value)}
              placeholder="Detalle adicional…"
              style={inputStyle}
              maxLength={200}
            />
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
            borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 8,
            display: 'flex', alignItems: 'center', gap: 5,
          }}><AlertTriangle size={13}/> {error}</div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handleSubmit}
            disabled={saving}
            style={{
              padding: '9px 18px', borderRadius: 'var(--r2)', border: 'none',
              background: saving ? 'var(--ink3)' : 'linear-gradient(135deg, #D97706, #B45309)',
              color: saving ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 12,
              cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: .3,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {saving ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Guardando…</> : <><ShoppingCart size={13}/> Registrar Compra</>}
          </button>
          {savedMsg && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#16A34A' }}>{savedMsg}</span>
          )}
        </div>
      </div>

      {/* Búsqueda */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar compra..."
          style={{
            width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 8, padding: '7px 12px', color: 'var(--snow)',
            fontSize: 13, outline: 'none',
          }}
        />
      </div>

      {/* Historial */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={50} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>
            <ShoppingCart size={32} strokeWidth={1.5} style={{opacity: .3, marginBottom: 8}}/>
            {tableMissing ? 'Módulo de compras no configurado aún' : 'Sin compras de insumos registradas'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--ink2)', border: '1px solid var(--line)',
                borderLeft: '3px solid #D97706',
                borderRadius: 'var(--r2)', padding: '8px 10px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--snow)' }}>{c.concepto}</span>
                  <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>
                    {formatDate(c.fecha)}
                    {c.metodoPago && ` · ${PM_OPTIONS.find(p => p.value === c.metodoPago)?.label || c.metodoPago}`}
                    {c.notas && ` · ${c.notas}`}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: '#DC2626', whiteSpace: 'nowrap' }}>
                  −{formatPEN(c.monto)}
                </div>
                <button onClick={() => handleDelete(c.id)} title="Eliminar" style={iconBtnStyle}><Trash2 size={13}/></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  textTransform: 'uppercase', color: 'var(--fog)', marginBottom: 4,
}

const inputStyle = {
  width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '8px 10px', color: 'var(--snow)',
  fontSize: 12, outline: 'none', boxSizing: 'border-box',
}

const iconBtnStyle = {
  width: 26, height: 26, borderRadius: 6, border: '1px solid var(--line2)',
  background: 'var(--ink3)', color: '#DC2626', fontSize: 11, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
