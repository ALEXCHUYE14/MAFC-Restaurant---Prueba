import { useState, useMemo } from 'react'
import { useExpenses, EXPENSE_CATEGORIES } from './ExpensesContext'
import { useOrders } from '@/features/orders/OrdersContext'
import { useAuth } from '@/features/auth/AuthContext'
import { formatPEN } from '@/utils/currency'
import { formatDate } from '@/utils/dates'
import { Skeleton } from '@/components/Loader'
import { AlertTriangle, Loader2, Save, PlusCircle, Receipt, Pencil, Trash2 } from 'lucide-react'

const PM_OPTIONS = [
  { value: '',          label: 'Sin especificar' },
  { value: 'efectivo',  label: '💵 Efectivo' },
  { value: 'yape',      label: '📱 Yape' },
  { value: 'plin',      label: '📱 Plin' },
  { value: 'tarjeta',   label: '💳 Tarjeta' },
]

const CAT_COLORS = {
  Insumos:       '#2563EB',
  Servicios:     '#7C3AED',
  Personal:      '#D97706',
  Alquiler:      '#DB2777',
  Mantenimiento: '#0891B2',
  Otros:         '#64748B',
}

const EMPTY_FORM = { concepto: '', monto: '', categoria: 'Insumos', metodoPago: '', notas: '' }

export default function ExpensesPanel() {
  const { expenses, loading, tableMissing, todayExpenses, totalToday, addExpense, updateExpense, deleteExpense } = useExpenses()
  const { todaySales } = useOrders()
  const { user } = useAuth()

  const [form, setForm]           = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)
  const [error, setError]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [savedMsg, setSavedMsg]   = useState('')
  const [search, setSearch]       = useState('')

  const ingresosHoy = useMemo(() =>
    todaySales.reduce((s, o) => s + (o.total || 0), 0), [todaySales])
  const netoHoy = ingresosHoy - totalToday

  const filtered = search
    ? expenses.filter(e => e.concepto.toLowerCase().includes(search.toLowerCase()))
    : expenses

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }))
    setError('')
  }

  function startEdit(expense) {
    setEditingId(expense.id)
    setForm({
      concepto:   expense.concepto,
      monto:      String(expense.monto),
      categoria:  expense.categoria,
      metodoPago: expense.metodoPago || '',
      notas:      expense.notas || '',
    })
    setError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setError('')
  }

  async function handleSubmit() {
    if (saving) return
    if (!form.concepto.trim()) { setError('Ingresa el concepto del gasto'); return }
    const monto = Number(form.monto)
    if (!isFinite(monto) || monto <= 0) { setError('Ingresa un monto válido mayor a 0'); return }

    setSaving(true)
    setError('')
    try {
      if (editingId) {
        await updateExpense(editingId, {
          concepto:   form.concepto.trim(),
          monto,
          categoria:  form.categoria,
          metodoPago: form.metodoPago || null,
          notas:      form.notas.trim() || null,
        })
        setSavedMsg('✓ Egreso actualizado')
      } else {
        await addExpense({
          concepto:   form.concepto,
          monto,
          categoria:  form.categoria,
          metodoPago: form.metodoPago,
          notas:      form.notas,
          createdBy:  user?.name || null,
        })
        setSavedMsg('✓ Egreso registrado')
      }
      setForm(EMPTY_FORM)
      setEditingId(null)
      setTimeout(() => setSavedMsg(''), 3000)
    } catch (err) {
      setError(err?.message || 'No se pudo guardar el egreso')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('¿Eliminar este egreso? Esta acción no se puede deshacer.')) return
    try {
      await deleteExpense(id)
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
          <span>La tabla <strong>egresos</strong> aún no existe en Supabase. Ejecuta el script SQL
          incluido al final de <code>src/services/supabase.js</code> (sección "Egresos / Gastos")
          en el SQL Editor de tu proyecto para activar este módulo.</span>
        </div>
      )}

      {/* Resumen financiero del día */}
      <div style={{
        display: 'flex', gap: 8, padding: '10px 14px',
        borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap',
      }}>
        {[
          { label: 'Ingresos hoy', val: formatPEN(ingresosHoy), color: '#16A34A' },
          { label: 'Egresos hoy',  val: formatPEN(totalToday),  color: '#DC2626' },
          { label: 'Neto del día', val: formatPEN(netoHoy),     color: netoHoy >= 0 ? '#16A34A' : '#DC2626' },
        ].map(s => (
          <div key={s.label} style={{
            flex: '1 1 120px', background: 'var(--ink3)', border: '1px solid var(--line)',
            borderRadius: 'var(--r2)', padding: '8px 10px', textAlign: 'center',
          }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 2, letterSpacing: .5 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Formulario */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <div>
            <label style={labelStyle}>Concepto *</label>
            <input
              value={form.concepto}
              onChange={e => setField('concepto', e.target.value)}
              placeholder="Ej: Compra de pollo, gas, etc."
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
          <div>
            <label style={labelStyle}>Categoría</label>
            <select value={form.categoria} onChange={e => setField('categoria', e.target.value)} style={inputStyle}>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
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
              background: saving ? 'var(--ink3)' : 'linear-gradient(135deg, #DC2626, #B91C1C)',
              color: saving ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 12,
              cursor: saving ? 'not-allowed' : 'pointer', letterSpacing: .3,
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {saving ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Guardando…</> : editingId ? <><Save size={13}/> Guardar cambios</> : <><PlusCircle size={13}/> Registrar Egreso</>}
          </button>
          {editingId && (
            <button onClick={cancelEdit} style={{
              padding: '9px 14px', borderRadius: 'var(--r2)', border: '1px solid var(--line2)',
              background: 'transparent', color: 'var(--fog)', fontSize: 12, cursor: 'pointer',
            }}>Cancelar</button>
          )}
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
          placeholder="🔍 Buscar egreso..."
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
            <Receipt size={32} strokeWidth={1.5} style={{opacity: .3, marginBottom: 8}}/>
            {tableMissing ? 'Módulo de egresos no configurado aún' : 'Sin egresos registrados'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(e => (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--ink2)', border: '1px solid var(--line)',
                borderLeft: `3px solid ${CAT_COLORS[e.categoria] || '#64748B'}`,
                borderRadius: 'var(--r2)', padding: '8px 10px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--snow)' }}>{e.concepto}</span>
                    <span style={{
                      fontSize: 8, fontWeight: 800, padding: '1px 7px', borderRadius: 10,
                      background: (CAT_COLORS[e.categoria] || '#64748B') + '22',
                      color: CAT_COLORS[e.categoria] || '#64748B', letterSpacing: .3,
                    }}>{e.categoria.toUpperCase()}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 2 }}>
                    {formatDate(e.fecha)}
                    {e.metodoPago && ` · ${PM_OPTIONS.find(p => p.value === e.metodoPago)?.label || e.metodoPago}`}
                    {e.notas && ` · ${e.notas}`}
                  </div>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color: '#DC2626', whiteSpace: 'nowrap' }}>
                  −{formatPEN(e.monto)}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button onClick={() => startEdit(e)} title="Editar" style={iconBtnStyle}><Pencil size={13}/></button>
                  <button onClick={() => handleDelete(e.id)} title="Eliminar" style={{ ...iconBtnStyle, color: '#DC2626' }}><Trash2 size={13}/></button>
                </div>
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
  background: 'var(--ink3)', color: 'var(--mist)', fontSize: 11, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
