import { useState, useMemo, useRef } from 'react'
import { useInventory } from './InventoryContext'
import { Skeleton } from '@/components/Loader'
import { IMG_PLACEHOLDER, handleImgError } from '@/utils/image'
import { uploadDishImage } from '@/services/storage'
import StockBackupModal from './StockBackupModal'
import StockMovementsModal from './StockMovementsModal'
import { formatPEN } from '@/utils/currency'
import { DEFAULT_VARIANTS, MAX_VARIANTS, normalizeVariants, minVariantPrice } from '@/utils/variants'
import {
  PlusCircle, AlertTriangle, X, Check, Pencil, Trash2, Loader2, Camera,
  Save, Archive, History,
} from 'lucide-react'

const EMPTY_FORM = { name: '', cat: '', newCat: '', price: '', imgUrl: '', description: '', available: true }

export default function InventoryPanel() {
  const {
    inventory, loading, unavailable, lowStock, effectiveMenu, effectiveCategories,
    hiddenStaticItems, menuItemsTableMissing,
    toggleAvailable, updateStock, updatePrice, updateImage, updateAlertAt, updateCost,
    addMenuItem, updateMenuItem, removeMenuItem, restoreMenuItem,
  } = useInventory()

  const [editStock, setEditStock]   = useState({})
  const [editAlert, setEditAlert]   = useState({})
  const [alertError, setAlertError] = useState({})
  const [editCost, setEditCost]     = useState({})
  const [costError, setCostError]   = useState({})
  const [catFilter, setCatFilter]   = useState('Todos')
  const [movTarget, setMovTarget]   = useState(undefined) // undefined = cerrado · null = todos · item = uno
  const [editPrice, setEditPrice]   = useState({})
  const [editImgUrl, setEditImgUrl] = useState({})
  const [imgError, setImgError]     = useState({})
  const [uploadingId, setUploadingId] = useState(null)
  const [search, setSearch]         = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [formOpen, setFormOpen]     = useState(false)
  const [editingItem, setEditingItem] = useState(null) // item de effectiveMenu (source:'custom') en edición, o null = creando
  const [backupOpen, setBackupOpen] = useState(false)  // Respaldo: exportar / importar .zip
  const fileInputRef    = useRef(null)
  const uploadTargetRef = useRef(null)

  const totalStock = useMemo(() => effectiveMenu.reduce((sum, item) => {
    const edited = editStock[item.id]
    const val = edited !== undefined ? Number(edited) : (item.stock ?? null)
    return sum + (val !== null && !isNaN(val) ? val : 0)
  }, 0), [effectiveMenu, editStock])

  // Si la categoría elegida desaparece (se borró o renombró su último
  // producto), se vuelve a "Todos" para no quedar con la lista vacía.
  const activeCat = effectiveCategories.includes(catFilter) ? catFilter : 'Todos'

  const filtered = effectiveMenu.filter(i =>
    (activeCat === 'Todos' || i.cat === activeCat) &&
    (!search || i.name.toLowerCase().includes(search.toLowerCase()))
  )

  // Valor del stock a precio de costo — solo productos con stock y costo
  // cargados (los "sin límite" o sin costo no se pueden valorizar).
  const stockValue = useMemo(() => effectiveMenu.reduce((sum, i) =>
    (i.stock !== null && i.stock !== undefined && i.cost !== null && i.cost !== undefined)
      ? sum + Number(i.stock) * Number(i.cost) : sum
  , 0), [effectiveMenu])

  const byCategory = filtered.reduce((acc, item) => {
    if (!acc[item.cat]) acc[item.cat] = []
    acc[item.cat].push(item)
    return acc
  }, {})

  function handleStockChange(id, val) { setEditStock(prev => ({ ...prev, [id]: val })) }
  function handleStockBlur(item) {
    if (editStock[item.id] !== undefined) {
      updateStock(item, editStock[item.id])
      setEditStock(prev => { const { [item.id]: _, ...rest } = prev; return rest })
    }
  }
  function handleStockKey(e) { if (e.key === 'Enter') e.target.blur() }

  function handleAlertChange(id, val) {
    setEditAlert(prev => ({ ...prev, [id]: val }))
    setAlertError(prev => ({ ...prev, [id]: null }))
  }
  async function handleAlertBlur(item) {
    if (editAlert[item.id] === undefined) return
    const val = editAlert[item.id]
    setEditAlert(prev => { const { [item.id]: _, ...rest } = prev; return rest })
    try {
      await updateAlertAt(item, val)
    } catch (err) {
      setAlertError(prev => ({ ...prev, [item.id]: err?.message || 'No se pudo guardar la alerta' }))
    }
  }

  function handleCostChange(id, val) {
    setEditCost(prev => ({ ...prev, [id]: val }))
    setCostError(prev => ({ ...prev, [id]: null }))
  }
  async function handleCostBlur(item) {
    if (editCost[item.id] === undefined) return
    const val = editCost[item.id]
    setEditCost(prev => { const { [item.id]: _, ...rest } = prev; return rest })
    try {
      await updateCost(item, val)
    } catch (err) {
      setCostError(prev => ({ ...prev, [item.id]: err?.message || 'No se pudo guardar el costo' }))
    }
  }

  function handlePriceChange(id, val) { setEditPrice(prev => ({ ...prev, [id]: val })) }
  function handlePriceBlur(item) {
    if (editPrice[item.id] !== undefined) {
      updatePrice(item, editPrice[item.id])
      setEditPrice(prev => { const { [item.id]: _, ...rest } = prev; return rest })
    }
  }
  function handlePriceKey(e) { if (e.key === 'Enter') e.target.blur() }

  function handleImgUrlChange(id, val) {
    setEditImgUrl(prev => ({ ...prev, [id]: val }))
    setImgError(prev => ({ ...prev, [id]: null }))
  }
  function commitImgUrl(item) {
    if (editImgUrl[item.id] === undefined) return
    updateImage(item, editImgUrl[item.id])
    setEditImgUrl(prev => { const { [item.id]: _, ...rest } = prev; return rest })
  }

  function openFilePicker(id) {
    uploadTargetRef.current = id
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0]
    const targetItem = filtered.find(i => i.id === uploadTargetRef.current) || effectiveMenu.find(i => i.id === uploadTargetRef.current)
    e.target.value = ''
    if (!file || !targetItem) return
    setImgError(prev => ({ ...prev, [targetItem.id]: null }))
    setUploadingId(targetItem.id)
    try {
      const imgUrl = await uploadDishImage(file, targetItem.id)
      await updateImage(targetItem, imgUrl)
    } catch (err) {
      setImgError(prev => ({ ...prev, [targetItem.id]: err?.message || 'No se pudo subir la imagen' }))
    } finally {
      setUploadingId(null)
    }
  }

  function quickAdjust(item, delta) {
    const cur = item.stock ?? 0
    updateStock(item, Math.max(0, cur + delta))
  }

  async function handleRemove(item) {
    const msg = item.source === 'custom'
      ? `¿Eliminar "${item.name}" del catálogo? Esta acción no se puede deshacer.`
      : `¿Eliminar "${item.name}"? Desaparecerá de POS, Externos y el mesero. Podrás restaurarlo luego desde "Productos eliminados".`
    if (!window.confirm(msg)) return
    try {
      await removeMenuItem(item)
    } catch (err) {
      alert('⚠ No se pudo eliminar: ' + (err?.message || 'error desconocido'))
    }
  }

  function stockColor(item) {
    if (item.stock === null) return 'var(--fog)'
    if (item.stock === 0)    return '#DC2626'
    if (item.alertAt != null && item.stock <= item.alertAt) return '#D97706'
    return '#16A34A'
  }
  function stockLabel(item) { return item.stock === null ? '∞' : String(item.stock) }

  function openAddForm() { setEditingItem(null); setFormOpen(true) }
  function openEditForm(item) { setEditingItem(item); setFormOpen(true) }
  function closeForm() { setFormOpen(false); setEditingItem(null) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileSelected} />

      {menuItemsTableMissing && (
        <div style={{
          margin: '10px 14px 0', padding: '10px 12px', flexShrink: 0,
          background: 'rgba(217,119,6,.1)', border: '1px solid rgba(217,119,6,.3)',
          borderRadius: 8, fontSize: 11, color: '#D97706', lineHeight: 1.5,
          display: 'flex', gap: 6,
        }}>
          <AlertTriangle size={13} style={{flexShrink:0, marginTop: 1}}/>
          <span>La tabla <strong>menu_items</strong> aún no existe en Supabase — puedes seguir editando
          precio/imagen/disponibilidad de los productos actuales, pero "Agregar producto" no funcionará
          hasta ejecutar la migración incluida al final de <code>src/services/supabase.js</code>.</span>
        </div>
      )}

      {/* Summary */}
      <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0, flexWrap: 'wrap' }}>
        {[
          { label: 'Total productos', val: effectiveMenu.length, color: 'var(--mist)' },
          { label: 'Disponibles',  val: effectiveMenu.length - unavailable.length, color: '#16A34A' },
          { label: 'Agotados',     val: unavailable.length, color: '#DC2626' },
          { label: 'Stock bajo',   val: lowStock.length, color: '#D97706' },
          ...(stockValue > 0 ? [{ label: 'Valor stock (costo)', val: formatPEN(stockValue), color: 'var(--amber)' }] : []),
        ].map(s => (
          <div key={s.label} style={{ flex: '1 1 80px', background: 'var(--ink3)', border: '1px solid var(--line)', borderRadius: 'var(--r2)', padding: '8px 10px', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--display)', fontSize: 22, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 9, color: 'var(--fog)', marginTop: 2, letterSpacing: .5 }}>{s.label.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* Búsqueda + agregar */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar producto..."
          style={{ flex: '1 1 180px', minWidth: 0, background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8, padding: '7px 12px', color: 'var(--snow)', fontSize: 13, outline: 'none' }}
        />
        <button onClick={openAddForm} style={{
          padding: '7px 14px', borderRadius: 8, border: 'none', flexShrink: 0,
          background: 'linear-gradient(135deg, var(--amber), var(--amber2))',
          color: '#fff', fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 5,
        }}><PlusCircle size={14}/> Agregar producto</button>
        <button onClick={() => setMovTarget(null)} title="Historial de movimientos de stock (ventas, compras y ajustes)" style={{
          padding: '7px 12px', borderRadius: 8, flexShrink: 0,
          border: '1px solid var(--line2)', background: 'transparent',
          color: 'var(--snow)', fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 5,
        }}><History size={14}/> Movimientos</button>
        <button onClick={() => setBackupOpen(true)} title="Exportar o importar un respaldo (.zip) de productos e imágenes" style={{
          padding: '7px 12px', borderRadius: 8, flexShrink: 0,
          border: '1px solid var(--line2)', background: 'transparent',
          color: 'var(--snow)', fontWeight: 800, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 5,
        }}><Archive size={14}/> Respaldo</button>
      </div>

      {backupOpen && <StockBackupModal onClose={() => setBackupOpen(false)} />}
      {movTarget !== undefined && <StockMovementsModal item={movTarget} onClose={() => setMovTarget(undefined)} />}

      {/* Filtro por categoría */}
      {effectiveCategories.length > 2 && (
        <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 6, overflowX: 'auto', flexShrink: 0 }}>
          {effectiveCategories.map(c => {
            const n = c === 'Todos' ? effectiveMenu.length : effectiveMenu.filter(i => i.cat === c).length
            const active = activeCat === c
            return (
              <button key={c} onClick={() => setCatFilter(c)} style={{
                padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', flexShrink: 0,
                fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap',
                background: active ? 'var(--amber)' : 'var(--ink3)',
                color: active ? '#fff' : 'var(--mist)',
              }}>{c} <span style={{ opacity: .7 }}>({n})</span></button>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 14, flexShrink: 0, flexWrap: 'wrap' }}>
        {[
          { color: '#16A34A', label: 'Stock normal' },
          { color: '#D97706', label: 'Stock bajo' },
          { color: '#DC2626', label: 'Agotado' },
          { color: 'var(--fog)', label: 'Sin límite (∞)' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: l.color }} />
            <span style={{ fontSize: 9, color: 'var(--fog)' }}>{l.label}</span>
          </div>
        ))}
      </div>

      {/* Item list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={54} />)}
          </div>
        ) : Object.keys(byCategory).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--fog)' }}>Sin resultados</div>
        ) : (
          Object.entries(byCategory).map(([cat, items]) => (
            <div key={cat} style={{ marginBottom: 20 }}>
              <h3 style={{ fontFamily: 'var(--display)', fontSize: 14, letterSpacing: 2, color: 'var(--amber)', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid var(--line)' }}>
                {cat.toUpperCase()}
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(item => {
                  const sc = stockColor(item)
                  const hasStock = item.stock !== null
                  const isLow   = hasStock && item.alertAt != null && item.stock <= item.alertAt && item.stock > 0
                  const isEmpty = hasStock && item.stock === 0
                  const isUploading = uploadingId === item.id
                  const isCustom = item.source === 'custom'

                  return (
                    <div key={item.id} style={{
                      display: 'flex', flexDirection: 'column', gap: 8,
                      background: isEmpty ? 'rgba(220,38,38,.05)' : isLow ? 'rgba(217,119,6,.04)' : 'var(--ink2)',
                      border: `1px solid ${isEmpty ? 'rgba(220,38,38,.25)' : isLow ? 'rgba(217,119,6,.2)' : 'var(--line)'}`,
                      borderLeft: `3px solid ${sc}`, borderRadius: 'var(--r2)', padding: '8px 10px', transition: 'all .15s',
                    }}>
                      {/* ── Fila 1: imagen · nombre · custom badge · disponible · eliminar ── */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, background: 'var(--ink3)', border: '1px solid var(--line2)', overflow: 'hidden', position: 'relative' }}>
                          <img
                            src={item.img || IMG_PLACEHOLDER}
                            loading="lazy" decoding="async"
                            alt={item.name}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={handleImgError}
                          />
                          {isUploading && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.55)', color: '#fff' }}><Loader2 size={14} style={{animation:'spin .8s linear infinite'}}/></div>
                          )}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{
                              fontSize: 12, fontWeight: 600,
                              color: item.available ? 'var(--snow)' : 'var(--fog)',
                              textDecoration: item.available ? 'none' : 'line-through',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>{item.name}</span>
                            {isCustom && (
                              <span style={{ fontSize: 8, fontWeight: 800, padding: '1px 6px', borderRadius: 8, background: 'rgba(37,99,235,.15)', color: 'var(--amber)', flexShrink: 0 }}>NUEVO</span>
                            )}
                          </div>
                          {isLow && <div style={{ fontSize: 9, color: '#D97706', marginTop: 1, display:'flex', alignItems:'center', gap:3 }}><AlertTriangle size={9}/> Stock bajo</div>}
                          {isEmpty && <div style={{ fontSize: 9, color: '#DC2626', marginTop: 1, display:'flex', alignItems:'center', gap:3 }}><X size={9}/> Sin stock</div>}
                          {costError[item.id] && <div style={{ fontSize: 9, color: '#DC2626', marginTop: 1, display:'flex', alignItems:'center', gap:3 }}><AlertTriangle size={9}/> {costError[item.id]}</div>}
                          {alertError[item.id] && <div style={{ fontSize: 9, color: '#DC2626', marginTop: 1, display:'flex', alignItems:'center', gap:3 }}><AlertTriangle size={9}/> {alertError[item.id]}</div>}
                          {imgError[item.id] && <div style={{ fontSize: 9, color: '#DC2626', marginTop: 1, display:'flex', alignItems:'center', gap:3 }}><AlertTriangle size={9}/> {imgError[item.id]}</div>}
                        </div>

                        <button onClick={() => toggleAvailable(item)} style={{
                          padding: '5px 10px', borderRadius: 20, border: 'none', fontWeight: 800, fontSize: 9, letterSpacing: .5,
                          cursor: 'pointer', transition: 'all .15s', flexShrink: 0,
                          background: item.available ? 'rgba(22,163,74,.15)' : 'rgba(220,38,38,.15)',
                          color: item.available ? '#16A34A' : '#DC2626',
                          display: 'flex', alignItems: 'center', gap: 3,
                        }}>{item.available ? <><Check size={10}/> DISP</> : <><X size={10}/> AGOT</>}</button>

                        {isCustom && (
                          <button onClick={() => setMovTarget(item)} title="Historial de movimientos" style={iconBtnStyle}><History size={13}/></button>
                        )}
                        {isCustom && (
                          <button onClick={() => openEditForm(item)} title="Editar producto" style={iconBtnStyle}><Pencil size={13}/></button>
                        )}
                        <button onClick={() => handleRemove(item)} title="Eliminar" style={{ ...iconBtnStyle, color: '#DC2626' }}><Trash2 size={13}/></button>
                      </div>

                      {/* ── Fila 2: stock · precio · imagen (url/subir) ── */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <div style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, background: sc + '18', border: `1px solid ${sc}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 700, color: sc }}>{stockLabel(item)}</span>
                          </div>
                          <button onClick={() => quickAdjust(item, -1)} style={smallBtnStyle('#DC2626')}>−</button>
                          <input
                            type="number" min="0" placeholder="∞"
                            value={editStock[item.id] !== undefined ? editStock[item.id] : (item.stock ?? '')}
                            onChange={e => handleStockChange(item.id, e.target.value)}
                            onBlur={() => handleStockBlur(item)}
                            onKeyDown={handleStockKey}
                            style={numInputStyle(sc, 44)}
                          />
                          <button onClick={() => quickAdjust(item, 1)} style={smallBtnStyle('#16A34A')}>+</button>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Avisar 'Stock bajo' cuando queden esta cantidad o menos (vacío = sin aviso)">
                          <AlertTriangle size={11} color="#D97706" />
                          <span style={{ fontSize: 9, color: 'var(--fog)', fontWeight: 700 }}>Avisar ≤</span>
                          <input
                            type="number" min="0" step="1" placeholder="—"
                            value={editAlert[item.id] !== undefined ? editAlert[item.id] : (item.alertAt ?? '')}
                            onChange={e => handleAlertChange(item.id, e.target.value)}
                            onBlur={() => handleAlertBlur(item)}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                            style={numInputStyle('#D97706', 40)}
                          />
                        </div>

                        {Array.isArray(item.variants) && item.variants.length > 0 ? (
                          // Con tamaños: precios por tamaño (se editan con el lápiz)
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }} title="Precios por tamaño — edítalos con el lápiz">
                            {item.variants.map(v => (
                              <span key={v.key} style={{
                                fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 6,
                                background: 'var(--ink3)', border: '1px solid var(--line2)', color: 'var(--amber)', whiteSpace: 'nowrap',
                              }}>{v.label} {formatPEN(v.price)}</span>
                            ))}
                          </div>
                        ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ fontSize: 10, color: 'var(--fog)', fontWeight: 700 }}>S/</span>
                          <input
                            type="number" min="0" step="0.10"
                            placeholder={item.price?.toFixed?.(2) ?? '0.00'}
                            value={editPrice[item.id] !== undefined ? editPrice[item.id] : (item.price ?? '')}
                            onChange={e => handlePriceChange(item.id, e.target.value)}
                            onBlur={() => handlePriceBlur(item)}
                            onKeyDown={handlePriceKey}
                            style={numInputStyle('var(--amber)', 60)}
                            title="Precio de venta"
                          />
                        </div>
                        )}

                        {isCustom && (() => {
                          const costVal = editCost[item.id] !== undefined ? editCost[item.id] : (item.cost ?? '')
                          const c = item.cost
                          const hasMargin = c !== null && c !== undefined && Number(item.price) > 0
                          const gain = hasMargin ? Number(item.price) - Number(c) : 0
                          const pct  = hasMargin ? Math.round((gain / Number(item.price)) * 100) : 0
                          return (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Precio de costo (lo que te cuesta a ti). Solo lo ve el administrador.">
                              <span style={{ fontSize: 9, color: 'var(--fog)', fontWeight: 700 }}>Costo S/</span>
                              <input
                                type="number" min="0" step="0.10" placeholder="—"
                                value={costVal}
                                onChange={e => handleCostChange(item.id, e.target.value)}
                                onBlur={() => handleCostBlur(item)}
                                onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                                style={numInputStyle('var(--mist)', 56)}
                              />
                              {hasMargin && (
                                <span style={{ fontSize: 9, fontWeight: 800, color: gain >= 0 ? '#16A34A' : '#DC2626', whiteSpace: 'nowrap' }}>
                                  {gain >= 0 ? 'Gana' : 'Pierde'} {formatPEN(Math.abs(gain))} ({pct}%)
                                </span>
                              )}
                            </div>
                          )
                        })()}

                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 160px', minWidth: 140 }}>
                          <input
                            type="text"
                            placeholder="🔗 URL de imagen"
                            value={editImgUrl[item.id] !== undefined ? editImgUrl[item.id] : (item.img && !item.img.startsWith('data:') && item.img !== IMG_PLACEHOLDER ? item.img : '')}
                            onChange={e => handleImgUrlChange(item.id, e.target.value)}
                            onBlur={() => commitImgUrl(item)}
                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                            style={{ flex: 1, minWidth: 0, background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 6, padding: '4px 8px', color: 'var(--snow)', fontSize: 10.5, outline: 'none' }}
                          />
                          <button onClick={() => openFilePicker(item.id)} disabled={isUploading} title="Subir foto desde el dispositivo" style={{ ...iconBtnStyle, cursor: isUploading ? 'wait' : 'pointer' }}>
                            {isUploading ? <Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> : <Camera size={13}/>}
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}

        {hiddenStaticItems.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setShowHidden(p => !p)} style={{
              background: 'transparent', border: 'none', color: 'var(--fog)', fontSize: 11,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0',
            }}>
              {showHidden ? '▾' : '▸'} Productos eliminados ({hiddenStaticItems.length})
            </button>
            {showHidden && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
                {hiddenStaticItems.map(h => (
                  <div key={h.invId} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    background: 'var(--ink3)', border: '1px solid var(--line)', borderRadius: 8,
                  }}>
                    <span style={{ flex: 1, fontSize: 11, color: 'var(--fog)', textDecoration: 'line-through' }}>{h.name}</span>
                    <span style={{ fontSize: 9, color: 'var(--fog)' }}>{h.cat}</span>
                    <button onClick={() => restoreMenuItem(h.invId)} style={{
                      padding: '3px 10px', borderRadius: 14, border: '1px solid rgba(22,163,74,.4)',
                      background: 'rgba(22,163,74,.1)', color: '#16A34A', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    }}>↺ Restaurar</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ height: 20 }} />
      </div>

      {formOpen && (
        <MenuItemFormModal
          item={editingItem}
          categories={effectiveCategories.filter(c => c !== 'Todos')}
          onAdd={addMenuItem}
          onUpdate={updateMenuItem}
          onClose={closeForm}
        />
      )}
    </div>
  )
}

// ── Modal de alta / edición de plato ───────────────────────────────────────────
function MenuItemFormModal({ item, categories, onAdd, onUpdate, onClose }) {
  const isEdit = !!item
  const [form, setForm] = useState(item ? {
    name: item.name, cat: item.cat, newCat: '',
    price: String(item.price ?? ''), imgUrl: item.img && item.img !== IMG_PLACEHOLDER ? item.img : '',
    description: item.description || '', available: item.available !== false,
  } : EMPTY_FORM)
  const [useNewCat, setUseNewCat] = useState(false)
  const [error, setError]     = useState('')
  const [saving, setSaving]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)

  // ── Tamaños (Fuente P./M./G.) ──────────────────────────────────────
  const hadSizes = Array.isArray(item?.variants) && item.variants.length > 0
  const [useSizes, setUseSizes] = useState(hadSizes)
  const [sizes, setSizes] = useState(() => hadSizes
    ? item.variants.map(v => ({ key: v.key, label: v.label, price: String(v.price) }))
    : DEFAULT_VARIANTS.map(v => ({ ...v, price: '' })))

  function setSize(i, field, val) {
    setSizes(prev => prev.map((sz, idx) => idx === i ? { ...sz, [field]: val } : sz))
    setError('')
  }
  function addSize() {
    setSizes(prev => {
      if (prev.length >= MAX_VARIANTS) return prev
      // clave nueva única (las existentes NO se cambian: identifican la línea vendida)
      let n = prev.length + 1
      let key = 'T' + n
      while (prev.some(sz => sz.key === key)) { n += 1; key = 'T' + n }
      return [...prev, { key, label: '', price: '' }]
    })
  }
  function removeSize(i) { setSizes(prev => prev.filter((_, idx) => idx !== i)); setError('') }

  function setField(key, val) { setForm(p => ({ ...p, [key]: val })); setError('') }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const imgUrl = await uploadDishImage(file, item?.id || 'nuevo')
      setField('imgUrl', imgUrl)
    } catch (err) {
      setError(err?.message || 'No se pudo procesar la imagen')
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    if (saving) return
    const name = form.name.trim()
    const cat  = (useNewCat ? form.newCat : form.cat).trim()
    if (!name)  { setError('El nombre es obligatorio'); return }
    if (!cat)   { setError('Selecciona o escribe una categoría'); return }

    // Tamaños: los que tienen precio (los vacíos se omiten)
    let variants = null
    if (useSizes) {
      const filled = sizes.filter(sz => String(sz.price).trim() !== '')
      if (filled.some(sz => !sz.label.trim())) { setError('Cada tamaño con precio necesita un nombre (ej: Fuente M.)'); return }
      if (filled.some(sz => !(Number(sz.price) > 0))) { setError('Los precios de los tamaños deben ser mayores a 0'); return }
      const labels = filled.map(sz => sz.label.trim().toLowerCase())
      if (new Set(labels).size !== labels.length) { setError('Hay dos tamaños con el mismo nombre'); return }
      variants = normalizeVariants(filled.map(sz => ({ key: sz.key, label: sz.label, price: Number(sz.price) })))
      if (variants.length < 2) { setError('Ingresa el precio de al menos 2 tamaños (o desactiva "Tiene tamaños")'); return }
    }
    const price = variants ? minVariantPrice(variants) : Number(form.price)
    if (!isFinite(price) || price <= 0) { setError('El precio debe ser un número mayor a 0'); return }

    setSaving(true)
    setError('')
    try {
      const payload = { name, cat, price, imgUrl: form.imgUrl, description: form.description, available: form.available }
      // Solo se envían tamaños si el producto los tiene o los tenía (para
      // quitarlos). Un producto de precio único nunca toca esa columna.
      if (variants) payload.variants = variants
      else if (hadSizes) payload.variants = []
      if (isEdit) await onUpdate(item, payload)
      else        await onAdd(payload)
      onClose()
    } catch (err) {
      setError(err?.message || 'No se pudo guardar el producto')
    } finally {
      setSaving(false)
    }
  }

  const previewImg = form.imgUrl || IMG_PLACEHOLDER

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 16,
        padding: '22px 20px', maxWidth: 420, width: '100%', maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 20px 60px rgba(15,23,42,.3)',
      }}>
        <h2 style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--amber)', letterSpacing: 1, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 7 }}>
          {isEdit ? <><Pencil size={15}/> Editar producto</> : <><PlusCircle size={15}/> Nuevo producto (plato / bebida)</>}
        </h2>

        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ width: 72, height: 72, borderRadius: 10, flexShrink: 0, background: 'var(--ink3)', border: '1px solid var(--line2)', overflow: 'hidden' }}>
            <img src={previewImg} alt="Vista previa" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={handleImgError} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              value={form.imgUrl}
              onChange={e => setField('imgUrl', e.target.value)}
              placeholder="🔗 URL de imagen (opcional)"
              style={inputStyle}
            />
            <button onClick={() => fileRef.current?.click()} disabled={uploading} style={{
              padding: '7px 10px', borderRadius: 8, border: '1px solid var(--line2)',
              background: 'var(--ink3)', color: 'var(--mist)', fontSize: 11, cursor: uploading ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}>{uploading ? <><Loader2 size={12} style={{animation:'spin .8s linear infinite'}}/> Procesando…</> : <><Camera size={12}/> Subir foto</>}</button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
          </div>
        </div>

        <label style={labelStyle}>Nombre *</label>
        <input value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Ej: Ceviche Mixto · Inca Kola 500 ml" style={{ ...inputStyle, marginBottom: 10 }} maxLength={80} />

        <label style={labelStyle}>Categoría *</label>
        {!useNewCat ? (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <select value={form.cat} onChange={e => setField('cat', e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">Selecciona…</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setUseNewCat(true)} style={{
              padding: '0 12px', borderRadius: 8, border: '1px solid var(--line2)',
              background: 'var(--ink3)', color: 'var(--mist)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>+ Nueva</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input value={form.newCat} onChange={e => setField('newCat', e.target.value)} placeholder="Nombre de la nueva categoría" style={{ ...inputStyle, flex: 1 }} maxLength={40} autoFocus />
            <button onClick={() => { setUseNewCat(false); setField('newCat', '') }} style={{
              padding: '0 12px', borderRadius: 8, border: '1px solid var(--line2)',
              background: 'var(--ink3)', color: 'var(--mist)', fontSize: 11, cursor: 'pointer',
            }}>Cancelar</button>
          </div>
        )}

        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={useSizes} onChange={e => { setUseSizes(e.target.checked); setError('') }} style={{ width: 15, height: 15 }} />
          <span style={{ textTransform: 'none', fontSize: 12, letterSpacing: 0 }}>Tiene tamaños con distinto precio (Fuente P. / M. / G.)</span>
        </label>

        {!useSizes ? (
          <>
            <label style={labelStyle}>Precio (S/) *</label>
            <input type="number" min="0" step="0.10" value={form.price} onChange={e => setField('price', e.target.value)} placeholder="0.00" style={{ ...inputStyle, marginBottom: 10 }} />
          </>
        ) : (
          <div style={{ marginBottom: 10, padding: '10px', borderRadius: 10, background: 'var(--ink3)', border: '1px solid var(--line2)' }}>
            <div style={{ fontSize: 11, color: 'var(--fog)', marginBottom: 8, lineHeight: 1.45 }}>
              Escribe el precio de cada tamaño. Deja vacío el que no ofreces (ej. Jalea solo M. y G.). Mínimo 2 tamaños.
            </div>
            {sizes.map((sz, i) => (
              <div key={sz.key} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input value={sz.label} onChange={e => setSize(i, 'label', e.target.value)} placeholder="Nombre (ej: Fuente M.)" maxLength={24} aria-label={'Nombre del tamaño ' + (i + 1)} style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--fog)', fontWeight: 700 }}>S/</span>
                <input type="number" min="0" step="0.10" value={sz.price} onChange={e => setSize(i, 'price', e.target.value)} placeholder="—" aria-label={'Precio de ' + (sz.label || 'tamaño ' + (i + 1))} style={{ ...inputStyle, width: 84, flexShrink: 0 }} />
                <button type="button" onClick={() => removeSize(i)} title="Quitar tamaño" disabled={sizes.length <= 2} style={{
                  width: 30, height: 30, flexShrink: 0, borderRadius: 7, border: '1px solid var(--line2)', background: 'var(--ink2)',
                  color: sizes.length <= 2 ? 'var(--fog)' : '#DC2626', cursor: sizes.length <= 2 ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: sizes.length <= 2 ? .4 : 1,
                }}><X size={13}/></button>
              </div>
            ))}
            {sizes.length < MAX_VARIANTS && (
              <button type="button" onClick={addSize} style={{
                marginTop: 2, padding: '6px 10px', borderRadius: 8, border: '1px dashed var(--line2)', background: 'transparent',
                color: 'var(--mist)', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}>+ Agregar tamaño</button>
            )}
          </div>
        )}

        <label style={labelStyle}>Descripción (opcional)</label>
        <input value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Breve descripción del producto…" style={{ ...inputStyle, marginBottom: 10 }} maxLength={160} />

        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.available} onChange={e => setField('available', e.target.checked)} style={{ width: 15, height: 15 }} />
          <span style={{ textTransform: 'none', fontSize: 12 }}>Disponible desde ya</span>
        </label>

        {error && (
          <div style={{ background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertTriangle size={13}/> {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: 11, background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 'var(--r2)', color: 'var(--fog)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving} style={{
            flex: 2, padding: 11, borderRadius: 'var(--r2)', border: 'none',
            background: saving ? 'var(--ink3)' : 'linear-gradient(135deg, var(--amber), var(--amber2))',
            color: saving ? 'var(--fog)' : '#fff', fontWeight: 800, fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>{saving ? <><Loader2 size={13} style={{animation:'spin .8s linear infinite'}}/> Guardando…</> : isEdit ? <><Save size={13}/> Guardar cambios</> : <><PlusCircle size={13}/> Crear producto</>}</button>
        </div>
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
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
}
function smallBtnStyle(color) {
  return {
    width: 22, height: 22, borderRadius: 6, border: `1px solid ${color}66`,
    background: color + '1a', color, fontWeight: 800, fontSize: 13, cursor: 'pointer', lineHeight: 1,
  }
}
function numInputStyle(color, width) {
  return {
    width, background: 'var(--ink3)', border: '1px solid var(--line2)',
    borderRadius: 6, padding: '4px 6px', color, fontSize: 11, textAlign: 'center',
    fontFamily: 'var(--mono)', fontWeight: 700, outline: 'none',
  }
}
