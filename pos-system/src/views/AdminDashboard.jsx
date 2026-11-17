import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useAuth } from '@/features/auth/AuthContext'
import { useOrders } from '@/features/orders/OrdersContext'
import { useTables } from '@/features/tables/TablesContext'
import { useInventory } from '@/features/inventory/InventoryContext'
import { useExpenses } from '@/features/expenses/ExpensesContext'
import { useCaja } from '@/features/cashier/CajaContext'
import { DB } from '@/services/supabase'
import OrderPanel from '@/features/orders/OrderPanel'
import TableMap from '@/features/tables/TableMap'
import InventoryPanel from '@/features/inventory/InventoryPanel'
import CashierPanel from '@/features/cashier/CashierPanel'
import DayReportPanel from '@/features/cashier/DayReportPanel'
import ClienteQuickPicker from '@/features/customers/ClienteQuickPicker'
import PremioPicker, { premioProducts } from '@/features/customers/PremioPicker'
import { crmErrorMessage } from '@/utils/crm'
import ExpensesPanel from '@/features/expenses/ExpensesPanel'
import StaffPanel from '@/features/staff/StaffPanel'
import AuditPanel from '@/features/audit/AuditPanel'
import CrmPanel from '@/features/customers/CrmPanel'
import CrmSettings from '@/features/customers/CrmSettings'
import ReservationsPanel from '@/features/reservations/ReservationsPanel'
import PurchasesPanel from '@/features/purchases/PurchasesPanel'
import InsumosPanel from '@/features/insumos/InsumosPanel'
import BusinessSettings from '@/features/settings/BusinessSettings'
import PrinterSettings from '@/features/settings/PrinterSettings'
import NetworkPrintersSettings from '@/features/settings/NetworkPrintersSettings'
import EnvasesSettings from '@/features/envases/EnvasesSettings'
import { usePackagingConfig } from '@/features/envases/usePackagingConfig'
import { clampPackaging, packagingTotal, PACKAGING_MAX } from '@/utils/packaging'
import TablesSettings from '@/features/settings/TablesSettings'
import WaitersSettings from '@/features/settings/WaitersSettings'
import DigitalMenuSettings from '@/features/settings/DigitalMenuSettings'
import KitchenAccessSettings from '@/features/settings/KitchenAccessSettings'
import { hasVariants, applyVariant, minVariantPrice } from '@/utils/variants'
import { useBusiness, startBusinessSync, getBusiness } from '@/services/businessConfig'
import { tryAutoReconnect } from '@/services/btPrinter'
import { groupTablesByZone } from '@/data/zones'
import { PAYMENT_METHODS, validateBreakdown, buildOrderPaymentFields, buildPayStatus, summarizeBreakdown } from '@/utils/payments'
import { CAT_ICONS } from '@/data/menu'
import { IMG_PLACEHOLDER, handleImgError } from '@/utils/image'
import { formatPEN } from '@/utils/currency'
import { formatFullDate } from '@/utils/dates'
import { escHtml, printReceipt } from '@/utils/print'
import { generateDailySalesReport } from '@/utils/pdf'
import {
  UtensilsCrossed, Bike, LayoutDashboard, ClipboardList, Map, CalendarDays,
  Package, Wallet, Users, Contact, ShoppingCart, Receipt, ShieldCheck, Settings,
  Store, Truck, Lock, Unlock, Printer, Banknote, CreditCard, Smartphone,
  X, Split, AlertTriangle, Check, Loader2, Flame, Moon, Sun,
  Inbox, Phone, MapPin, Clock, ShoppingBag, Trash2,
  Palette, ChefHat, Bluetooth, Info, Wrench, Carrot, Wifi,
  Bell, CheckCircle2, Armchair, Calculator, FileText, ChevronDown, LogOut, QrCode,
} from 'lucide-react'

// ── Dark Mode — persiste en localStorage, transición suave vía clase CSS ──────
function useDarkMode() {
  const [dark, setDark] = useState(() => localStorage.getItem('antojitos_theme') === 'dark')
  const toggle = useCallback(() => {
    document.documentElement.classList.add('color-theme-in-transition')
    setDark(prev => {
      const next = !prev
      document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
      localStorage.setItem('antojitos_theme', next ? 'dark' : 'light')
      return next
    })
    setTimeout(() => document.documentElement.classList.remove('color-theme-in-transition'), 450)
  }, [])
  useEffect(() => {
    // Aplica el tema guardado al montar (sincroniza DOM con estado React)
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return [dark, toggle]
}

// El campo `icon` (emoji) de PAYMENT_METHODS sigue usándose en texto plano
// (resúmenes de pago, tickets) — este mapa es solo para los botones/tarjetas
// visuales (JSX) de los modales de cobro.
const PAYMENT_ICON_SVG = { efectivo: Banknote, tarjeta: CreditCard, yape: Smartphone, plin: Smartphone }

// Nombre legible por pestaña — solo para el mensaje del ErrorBoundary,
// no afecta la navegación ni el estado.
const TAB_LABELS = {
  pos: 'POS', external: 'Pedidos Externos', dashboard: 'Resumen',
  orders: 'Pedidos', tables: 'Mesas', reservations: 'Reservas', inventory: 'Stock', insumos: 'Insumos',
  cashier: 'Caja', staff: 'Personal', customers: 'Clientes', purchases: 'Compras', expenses: 'Egresos', audit: 'Auditoría', settings: 'Configuración',
}

// ── Reporte diario de ventas ──────────────────────────────────────────────────
// Usa el mismo generador PDF corporativo del Panel de Caja para mantener
// consistencia visual (logo, tablas, pie de página) en todos los reportes.
async function printDailyReport(todaySales) {
  try {
    await generateDailySalesReport(todaySales, new Date())
  } catch {
    // Fallback: si jsPDF falla (sin soporte del navegador), abrir versión imprimible
    const total = todaySales.reduce((s, o) => s + (o.total || 0), 0)
    const now   = new Date()
    const html  = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Reporte del Día</title>
      <style>
        @page{size:A4;margin:14mm 18mm}
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:Arial,sans-serif;font-size:11px;color:#111}
        .hdr{text-align:center;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;font-size:10px}
        th{background:#222;color:#fff;padding:5px 6px;text-align:left}
        td{padding:4px 6px;border-bottom:1px solid #eee}
        .footer{margin-top:14px;text-align:center;font-size:9px;color:#aaa}
      </style></head><body>
      <div class="hdr">
        <h1 style="font-size:20px">${escHtml(getBusiness().nombre.toUpperCase())}</h1>
        ${getBusiness().direccion ? `<div>${escHtml(getBusiness().direccion)}</div>` : ''}
        <div style="font-weight:bold;margin-top:6px">REPORTE DE VENTAS · ${now.toLocaleDateString('es-PE', { weekday:'long', year:'numeric', month:'long', day:'numeric' }).toUpperCase()}</div>
        <div style="font-size:10px;color:#666">Generado a las ${now.toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })}</div>
      </div>
      <p style="margin-bottom:8px"><strong>Total del día: S/${total.toFixed(2)}</strong> · ${todaySales.length} ventas</p>
      ${todaySales.length === 0 ? '<p style="color:#999">Sin ventas registradas hoy.</p>' : `
      <table>
        <thead><tr><th>#</th><th>Zona</th><th>Mesa</th><th>Mesero</th><th>Productos</th><th>Total</th><th>Pago</th></tr></thead>
        <tbody>${todaySales.map((o, i) => `<tr>
          <td>${i+1}</td><td>${escHtml(o.zone||'—')}</td><td>${o.table_number||'—'}</td>
          <td>${escHtml(o.waiter_name||'Admin')}</td>
          <td>${(o.items||[]).map(it=>`${escHtml(String(it.qty ?? ''))}× ${escHtml(it.name)}`).join(', ')}</td>
          <td>S/${(o.total||0).toFixed(2)}</td>
          <td>${escHtml(o.status||'—')}</td>
        </tr>`).join('')}</tbody>
      </table>`}
      <div class="footer">Sistema POS · ${escHtml(getBusiness().nombre)}</div>
      </body></html>`
    const win = window.open('', '_blank', 'width=920,height=700,toolbar=1,scrollbars=1')
    if (!win) return
    win.document.write(html)
    win.document.close()
    win.focus()
    win.onload = () => win.print()
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
const NAV = [
  { key: 'pos',       icon: UtensilsCrossed, label: 'POS'      },
  { key: 'external',  icon: Bike,            label: 'Externos' },
  { key: 'dashboard', icon: LayoutDashboard, label: 'Panel'    },
  { key: 'orders',    icon: ClipboardList,   label: 'Pedidos'  },
  { key: 'tables',    icon: Map,             label: 'Mesas'    },
  { key: 'reservations', icon: CalendarDays, label: 'Reservas' },
  { key: 'inventory', icon: Package,         label: 'Stock'    },
  { key: 'insumos',   icon: Carrot,          label: 'Insumos'  },
  { key: 'cashier',   icon: Wallet,          label: 'Caja'     },
  { key: 'dayreport', icon: FileText,        label: 'Reporte día' },
  { key: 'staff',     icon: Users,           label: 'Personal' },
  { key: 'customers', icon: Contact,         label: 'Clientes' },
  { key: 'purchases', icon: ShoppingCart,    label: 'Compras'  },
  { key: 'expenses',  icon: Receipt,         label: 'Egresos'  },
  { key: 'audit',     icon: ShieldCheck,     label: 'Auditoría' },
  { key: 'settings',  icon: Settings,        label: 'Ajustes' },
]

export default function AdminDashboard() {
  const { user, logout } = useAuth()
  const { orders, pending, inProgress, ready, todaySales } = useOrders()
  const { tables, available, occupied } = useTables()
  const { unavailable } = useInventory()
  const [darkMode, toggleDark] = useDarkMode()

  // Datos del negocio (Ajustes) y impresora Bluetooth: se cargan UNA vez al
  // abrir el panel para que el primer ticket ya salga con el nombre/RUC
  // vigentes y, si hay una impresora recordada, ya esté reconectada.
  // Ambas son idempotentes y "best-effort": si fallan, todo sigue como antes.
  useEffect(() => { startBusinessSync(); tryAutoReconnect() }, [])

  const [tab,         setTab]         = useState('pos')
  const bottomNavRef = useRef(null)

  // Barra inferior (celular): al cambiar de sección, desplazarla para que la
  // sección elegida quede visible (sin mover la página entera).
  useEffect(() => {
    const nav = bottomNavRef.current
    if (!nav || nav.scrollWidth <= nav.clientWidth) return
    const btn = nav.querySelector(`[data-tab="${tab}"]`)
    if (!btn) return
    const target = btn.offsetLeft - (nav.clientWidth - btn.offsetWidth) / 2
    try { nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' }) }
    catch { nav.scrollLeft = Math.max(0, target) }
  }, [tab])

  const totalRevenue = useMemo(() =>
    todaySales.reduce((s, o) => s + (o.total || 0), 0), [todaySales])
  const alertCount = pending.length + unavailable.length

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--ink)', overflow: 'hidden' }}>

      {/* ── Sidebar (oculto en móvil, visible en desktop) ── */}
      <nav className="admin-sidebar" style={{
        width: 64, flexShrink: 0, background: 'var(--ink1)',
        borderRight: '1px solid var(--line)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '12px 0', gap: 2, position: 'relative', zIndex: 10,
        // En tablet acostada no entran las 15 secciones: se desliza vertical
        overflowY: 'auto', overflowX: 'hidden',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: '50%', marginBottom: 8,
          background: 'radial-gradient(circle at 35% 35%, var(--amber), var(--flame) 60%, var(--crimson))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 12px rgba(37,99,235,.2)', flexShrink: 0,
        }}><Flame size={16} color="#fff" fill="#fff" strokeWidth={0}/></div>

        {NAV.map(n => {
          const badge = n.key === 'orders' ? pending.length : n.key === 'external' ? orders.filter(o => ['Delivery','Recojo en Local'].includes(o.zone) && o.status === 'pending').length : 0
          return (
            <button key={n.key} onClick={() => setTab(n.key)} title={n.label} style={{
              width: 48, height: 46, borderRadius: 'var(--r2)', flexShrink: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              justifyContent: 'center', gap: 2, border: 'none', cursor: 'pointer',
              transition: 'all .18s', position: 'relative',
              background: tab === n.key ? 'rgba(37,99,235,.12)' : 'transparent',
              borderLeft: `2px solid ${tab === n.key ? 'var(--amber)' : 'transparent'}`,
            }}>
              <n.icon size={17} strokeWidth={1.75}/>
              <span style={{ fontSize: 7, color: tab === n.key ? 'var(--amber)' : 'var(--fog)', fontWeight: 700 }}>
                {n.label.toUpperCase().substring(0, 5)}
              </span>
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: 3, right: 3,
                  background: 'var(--crimson)', color: '#fff',
                  fontSize: 8, fontWeight: 800, width: 14, height: 14,
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{badge}</span>
              )}
            </button>
          )
        })}
        {/* Cerrar sesión: desde el menú del usuario (chip de la cabecera) */}
      </nav>

      {/* ── Contenido ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{
          background: 'var(--ink1)', borderBottom: '1px solid var(--line)',
          padding: 'env(safe-area-inset-top, 0px) 16px 0',
          minHeight: 'calc(50px + env(safe-area-inset-top, 0px))',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, position: 'relative',
        }} className="topline">
          <div>
            <h1 style={{ fontFamily: 'var(--display)', fontSize: 16, color: 'var(--amber)', letterSpacing: 1, lineHeight: 1 }}>
              {NAV.find(n => n.key === tab)?.label?.toUpperCase()}
            </h1>
            <p style={{ fontSize: 9, color: 'var(--mist)', letterSpacing: 2 }}>
              {formatFullDate(new Date()).toUpperCase()}
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {alertCount > 0 && (
              <div className="anim-blink" style={{
                background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
                borderRadius: 20, padding: '3px 8px',
                fontSize: 10, fontWeight: 700, color: 'var(--crimson)',
              }}><AlertTriangle size={11} style={{verticalAlign:-2,marginRight:3}}/>{alertCount}</div>
            )}
            <button
              onClick={toggleDark}
              title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              style={{
                padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
                border: '1px solid var(--line2)',
                background: darkMode ? 'rgba(148,163,184,.1)' : 'transparent',
                color: darkMode ? 'var(--mist)' : 'var(--fog)',
                fontSize: 14, fontWeight: 700, transition: 'all .15s',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >{darkMode ? <Moon size={13}/> : <Sun size={13}/>} <span style={{ fontSize: 10 }}>{darkMode ? 'Oscuro' : 'Claro'}</span></button>
            <AdminUserMenu user={user} onLogout={logout} />
          </div>
        </div>

        <div className="admin-content-area">
          {/* ErrorBoundary por pestaña, con `key={tab}` — si una sección
              falla al renderizar, solo se rompe ESA pestaña; el header y
              la navegación siguen vivos y cambiar de pestaña limpia el
              error automáticamente (el key distinto remonta el boundary). */}
          <ErrorBoundary key={tab} label={TAB_LABELS[tab] || tab}>
            {tab === 'pos'       && <POSSection />}
            {tab === 'external'  && <ExternalOrdersSection />}
            {tab === 'dashboard' && (
              <DashboardOverview
                orders={orders} pending={pending} inProgress={inProgress}
                ready={ready} todaySales={todaySales} totalRevenue={totalRevenue}
                tables={tables} available={available} occupied={occupied} unavailable={unavailable}
              />
            )}
            {tab === 'orders'    && <OrderPanel role="admin" />}
            {tab === 'tables'    && <TableMap />}
            {tab === 'reservations' && <ReservationsPanel />}
            {tab === 'inventory' && <InventoryPanel />}
            {tab === 'cashier'   && <CashierPanel />}
            {tab === 'dayreport' && <DayReportPanel />}
            {tab === 'staff'     && <StaffPanel />}
            {tab === 'customers' && <CrmPanel />}
            {tab === 'purchases' && <PurchasesPanel />}
            {tab === 'insumos'   && <InsumosPanel />}
            {tab === 'expenses'  && <ExpensesPanel />}
            {tab === 'audit'     && <AuditPanel />}
            {tab === 'settings'  && <SettingsSection darkMode={darkMode} onToggleDark={toggleDark} />}
          </ErrorBoundary>
        </div>
      </div>

      {/* ── Bottom Nav (solo móvil, oculto en desktop) ── */}
      <nav ref={bottomNavRef} className="admin-bottomnav" aria-label="Secciones" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: 62, zIndex: 200,
        background: 'var(--ink1)',
        borderTop: '1px solid var(--line)',
        boxShadow: '0 -4px 20px rgba(0,0,0,.08)',
        // Se desliza con el dedo hacia los costados: con 15 secciones no
        // entran todas a lo ancho de un celular.
        justifyContent: 'flex-start', alignItems: 'stretch',
        overflowX: 'auto', overflowY: 'hidden',
        padding: '0 4px',
      }}>
        {NAV.map(n => {
          const badge = n.key === 'orders'
            ? pending.length
            : n.key === 'external'
              ? orders.filter(o => ['Delivery','Recojo en Local'].includes(o.zone) && o.status === 'pending').length
              : 0
          const isActive = tab === n.key
          return (
            <button
              key={n.key}
              data-tab={n.key}
              onClick={() => setTab(n.key)}
              title={n.label}
              aria-current={isActive ? 'page' : undefined}
              style={{
                flex: '0 0 auto', minWidth: 64, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 3,
                border: 'none', background: 'transparent', cursor: 'pointer',
                color: isActive ? 'var(--amber)' : 'var(--fog)',
                borderTop: `2px solid ${isActive ? 'var(--amber)' : 'transparent'}`,
                transition: 'all .15s',
                padding: '6px 2px 8px',
                position: 'relative',
                minHeight: 44,
              }}
            >
              <n.icon size={20} strokeWidth={1.75}/>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: .3,
                lineHeight: 1, textTransform: 'uppercase', whiteSpace: 'nowrap',
                color: isActive ? 'var(--amber)' : 'var(--fog)',
              }}>
                {n.label}
              </span>
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: 6, left: '50%',
                  transform: 'translateX(4px)',
                  background: 'var(--crimson)', color: '#fff',
                  fontSize: 8, fontWeight: 800,
                  width: 15, height: 15, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 0 2px var(--ink1)',
                }}>{badge > 9 ? '9+' : badge}</span>
              )}
            </button>
          )
        })}

        {/* Cerrar sesión en móvil: menú del usuario (arriba a la derecha) */}
      </nav>

    </div>
  )
}

// ── Menú del usuario (chip "Nombre · ADMIN" del header) ──────────────────────
// Al tocar el chip se despliega un panel con los datos de la sesión y el botón
// "Cerrar sesión". Pensado sobre todo para móvil, donde el botón SALIR del
// bottom nav queda al final de la barra desplazable y no se ve. Se cierra al
// tocar fuera, con Escape o al volver a tocar el chip.
function AdminUserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleLogout() {
    if (busy) return
    setBusy(true)
    try {
      await onLogout()
      // Al cerrar sesión la ruta protegida desmonta este componente.
    } catch (e) {
      console.error('[Admin] Error al cerrar sesión:', e)
      setBusy(false)
    }
  }

  const color = user?.color || '#2563EB'

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="admin-user-chip"
        onClick={() => setOpen(o => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Opciones de la cuenta"
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--ink3)',
          border: `1px solid ${open ? 'var(--amber)' : 'var(--line2)'}`,
          borderRadius: 30, padding: '3px 8px 3px 4px',
          cursor: 'pointer', color: 'inherit', font: 'inherit',
          transition: 'border-color .15s', maxWidth: '100%',
        }}
      >
        <div style={{
          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
          background: color + '22', color,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
        }}>{user?.avatar}</div>
        <span className="admin-user-name" style={{ fontSize: 11, fontWeight: 700 }}>{user?.name}</span>
        <span style={{ fontSize: 9, color: 'var(--amber)', fontWeight: 800, letterSpacing: 1, background: 'rgba(37,99,235,.1)', borderRadius: 10, padding: '1px 6px', flexShrink: 0 }}>
          ADMIN
        </span>
        <ChevronDown size={13} style={{
          flexShrink: 0, color: 'var(--fog)',
          transition: 'transform .2s', transform: open ? 'rotate(180deg)' : 'none',
        }}/>
      </button>

      {open && (
        <div role="menu" className="admin-user-menu" style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 300,
          width: 220, maxWidth: 'calc(100vw - 24px)',
          background: 'var(--ink1)', border: '1px solid var(--line2)',
          borderRadius: 14, boxShadow: '0 12px 32px rgba(0,0,0,.18)',
          padding: 8,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 10px', borderBottom: '1px solid var(--line)' }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              background: color + '22', color,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            }}>{user?.avatar}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.name || 'Administrador'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--fog)' }}>Administrador</div>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={busy}
            style={{
              marginTop: 8, width: '100%', minHeight: 42,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              borderRadius: 10, border: '1px solid rgba(220,38,38,.3)',
              background: 'rgba(220,38,38,.08)', color: 'var(--crimson)',
              fontSize: 13, fontWeight: 700,
              cursor: busy ? 'wait' : 'pointer', opacity: busy ? .7 : 1,
            }}
          >
            {busy ? <Loader2 size={15} className="anim-spin"/> : <LogOut size={15}/>}
            {busy ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// POS — Para Llevar
// ═══════════════════════════════════════════════════════════════════════════════
const TAKEAWAY_KEY = '__TAKEAWAY__'

// Stock vigente de un producto (del catálogo en vivo, no de la copia guardada
// en el carrito). null = sin límite (∞) → no se limita la cantidad.
function stockLimitOf(effectiveMenu, itemId) {
  const m = effectiveMenu.find(x => x.id === itemId)
  return m && m.stock !== null && m.stock !== undefined ? Number(m.stock) : null
}

// Cada línea del carrito se identifica por producto + tamaño (lineId). Un
// producto sin tamaños usa su propio id, igual que siempre.
function cartKeyOf(item) {
  return item?.lineId || String(item?.id)
}
// Unidades de un PRODUCTO en el carrito sumando todos sus tamaños (el stock
// es del producto: Fuente M. + Fuente G. del mismo plato comparten stock).
function productQtyInCart(cart, productId) {
  return Object.values(cart || {}).reduce((s, c) => s + (c && c.item && c.item.id === productId ? (c.qty || 0) : 0), 0)
}

// Envases descartables del carrito: cantidad válida mientras la opción esté
// activa (si se desactiva en Ajustes, cuenta como 0 — la base lo rechazaría).
function usePackagingState() {
  const cfg = usePackagingConfig()
  const [count, setCount] = useState(0)
  const enabled = !!cfg?.enabled
  const unit    = enabled ? cfg.unit : 0
  const n       = enabled ? clampPackaging(count) : 0
  return { enabled, unit, count: n, total: packagingTotal(n, unit), setCount }
}
// Suma en céntimos (sin errores de coma flotante)
const addMoney = (a, b) => Math.round((Number(a) || 0) * 100 + (Number(b) || 0) * 100) / 100

/* ── Cliente del pedido + premio de fidelidad (migracion-clientes-crm.sql) ──
   El premio se agrega como línea de cortesía a S/ 0 (cocina lo prepara y el
   stock se descuenta). El canje se registra en el servidor ANTES de crear el
   pedido (así nunca hay cortesía sin canje válido) y luego se liga al pedido;
   si el pedido no se pudo crear, el canje se anula. */
/* ── Descuento del pedido (migracion-descuentos-cupones.sql) ──
   Se aplica con el pedido YA creado (el carrito queda bloqueado), así el
   total definitivo es el que devuelve la base de datos. */
function useDescuentoPedido(orderId, notify) {
  const [descuento, setDescuento] = useState(null)   // { monto, total, label }
  const [busy, setBusy] = useState(false)
  async function aplicarCupon(code) {
    const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!orderId || busy || !c) return
    setBusy(true)
    try {
      const r = await DB.aplicarCupon(orderId, c)
      setDescuento({ monto: Number(r.descuento_monto) || 0, total: Number(r.total) || 0, label: `Cupón ${r.codigo}` })
    } catch (e) { notify(crmErrorMessage(e)) }
    finally { setBusy(false) }
  }
  async function manual() {
    if (!orderId || busy) return
    const v = window.prompt('Descuento manual: escribe un % (ej. 10%) o un monto en soles (ej. 5)')
    if (v === null) return
    const txt = String(v).trim().replace(',', '.')
    const isPct = txt.endsWith('%')
    const n = Number(txt.replace('%', ''))
    if (!(n > 0) || (isPct && n > 100)) { notify('Descuento no válido.'); return }
    const motivo = window.prompt('Motivo del descuento (obligatorio, queda registrado):')
    if (motivo === null) return
    if (!motivo.trim()) { notify('Escribe el motivo del descuento.'); return }
    setBusy(true)
    try {
      const r = await DB.aplicarDescuentoManual(orderId, { pct: isPct ? n : 0, fijo: isPct ? 0 : n, motivo: motivo.trim() })
      setDescuento({ monto: Number(r.descuento_monto) || 0, total: Number(r.total) || 0, label: motivo.trim().slice(0, 30) })
    } catch (e) { notify(crmErrorMessage(e)) }
    finally { setBusy(false) }
  }
  async function quitar() {
    if (!orderId || busy || !descuento) return
    setBusy(true)
    try { await DB.quitarDescuento(orderId); setDescuento(null) }
    catch (e) { notify(crmErrorMessage(e)) }
    finally { setBusy(false) }
  }
  return { descuento, setDescuento, busy, aplicarCupon, manual, quitar }
}

const CORTESIA_SUFFIX = '::cortesia'
function cortesiaEntry(prod) {
  const key = `${prod.id}${CORTESIA_SUFFIX}`
  return { key, entry: { item: { ...prod, lineId: key, name: `${prod.name} (Cortesía)`, price: 0, cortesia: true }, qty: 1 } }
}
const cartHasCortesia = cartObj => Object.values(cartObj || {}).some(c => c?.item?.cortesia && c.qty > 0)
function cartWithoutCortesia(cartObj) {
  return Object.fromEntries(Object.entries(cartObj || {}).filter(([, c]) => !c?.item?.cortesia))
}
const cortesiaName = cartObj => Object.values(cartObj || {}).find(c => c?.item?.cortesia)?.item?.name || null
// Línea del pedido para la base de datos (marca la cortesía)
const orderLineOf = c => ({
  id: c.item.id, name: c.item.name, price: c.item.price, qty: c.qty,
  ...(c.item.cortesia ? { cortesia: true, lineId: c.item.lineId } : {}),
})

function POSSection() {
  const { user } = useAuth()
  const { addOrder, updateOrder } = useOrders()
  const { deductStock, effectiveMenu } = useInventory()
  const { cajaAbierta }           = useCaja()

  const [cartsByTable,           setCartsByTable]           = useState({})
  const [showPayModal,           setShowPayModal]           = useState(false)
  const [mobileTab,              setMobileTab]              = useState('menu')
  const [successMsg,             setSuccessMsg]             = useState('')
  const [takeawayCustomerName,   setTakeawayCustomerName]   = useState('')
  const [takeawayNameError,      setTakeawayNameError]      = useState(false)
  const [takeawayKitchenOrderId, setTakeawayKitchenOrderId] = useState(null)

  const cart      = cartsByTable[TAKEAWAY_KEY] || {}
  const cartItems = Object.values(cart).filter(c => c.qty > 0)
  const cartTotal = cartItems.reduce((s, c) => s + c.item.price * c.qty, 0)
  const cartCount = cartItems.reduce((s, c) => s + c.qty, 0)

  // Envases descartables (precio fijo de Ajustes; no tocan el stock)
  const pack       = usePackagingState()
  const grandTotal = addMoney(cartTotal, pack.total)
  function changePack(delta) {
    if (takeawayKitchenOrderId) { lockedMsg(); return }
    pack.setCount(n => clampPackaging(n + delta))
  }

  // Descuento / cupón (con el pedido ya enviado)
  const desc = useDescuentoPedido(takeawayKitchenOrderId, m => { setSuccessMsg('⚠ ' + m); setTimeout(() => setSuccessMsg(''), 4000) })
  const payTotal = desc.descuento ? desc.descuento.total : grandTotal

  // Cliente del pedido (opcional) + premio de fidelidad
  const [cliente, setCliente]       = useState(null)
  const [showPremio, setShowPremio] = useState(false)
  const premioProds = cliente?.stats ? premioProducts(effectiveMenu, cliente.stats.premio_categoria) : []
  function onClienteChange(c) {
    if (takeawayKitchenOrderId) { lockedMsg(); return }
    if (!c) setCartsByTable(prev => ({ ...prev, [TAKEAWAY_KEY]: cartWithoutCortesia(prev[TAKEAWAY_KEY]) }))
    setCliente(c)
    if (c && !takeawayCustomerName.trim()) { setTakeawayCustomerName(String(c.nombre || '').slice(0, 60)); setTakeawayNameError(false) }
  }
  function pickPremio(prod) {
    setShowPremio(false)
    if (takeawayKitchenOrderId) { lockedMsg(); return }
    if (!cliente?.stats?.premio_disponible || cartHasCortesia(cart)) return
    const limit = stockLimitOf(effectiveMenu, prod.id)
    if (limit !== null && productQtyInCart(cart, prod.id) + 1 > limit) { warnStockLimit(prod.name, limit); return }
    const { key, entry } = cortesiaEntry(prod)
    setCartsByTable(prev => ({ ...prev, [TAKEAWAY_KEY]: { ...(prev[TAKEAWAY_KEY] || {}), [key]: entry } }))
  }

  function warnStockLimit(name, limit) {
    setSuccessMsg(limit > 0 ? `⚠ Solo quedan ${limit} de ${name} en stock` : `⚠ ${name} sin stock`)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  // Tras "Enviar a cocina" el carrito queda BLOQUEADO: lo que se cobra es
  // exactamente lo que cocina recibió (el cobro no actualiza los ítems del
  // pedido, así que cambiarlos después descuadraba el total guardado).
  function lockedMsg() {
    setSuccessMsg('⚠ Pedido ya enviado a cocina: no se puede modificar. Cóbralo y crea otro pedido para lo adicional.')
    setTimeout(() => setSuccessMsg(''), 4000)
  }

  function addToCart(item) {
    if (item.available === false) return // defensa extra — el grid ya bloquea el click
    if (takeawayKitchenOrderId) { lockedMsg(); return }
    // No vender más de lo que hay en Stock (productos con stock controlado)
    const key   = cartKeyOf(item)
    const limit = stockLimitOf(effectiveMenu, item.id)
    if (limit !== null && productQtyInCart(cart, item.id) + 1 > limit) { warnStockLimit(item.baseName || item.name, limit); return }
    setCartsByTable(prev => {
      const tc  = prev[TAKEAWAY_KEY] || {}
      if (limit !== null && productQtyInCart(tc, item.id) + 1 > limit) return prev
      const cur = tc[key]?.qty || 0
      return { ...prev, [TAKEAWAY_KEY]: { ...tc, [key]: { item, qty: cur + 1 } } }
    })
    if (mobileTab !== 'menu') setMobileTab('menu')
  }

  function changeQty(itemId, delta) {
    if (takeawayKitchenOrderId) { lockedMsg(); return }
    if (delta > 0 && cart[itemId]?.item?.cortesia) return   // la cortesía es 1 sola unidad
    // itemId = clave de la línea (producto + tamaño)
    const productId = cart[itemId]?.item?.id
    const limit = delta > 0 && productId != null ? stockLimitOf(effectiveMenu, productId) : null
    if (limit !== null && productQtyInCart(cart, productId) + delta > limit) {
      warnStockLimit(cart[itemId]?.item?.baseName || cart[itemId]?.item?.name || 'este producto', limit)
      return
    }
    setCartsByTable(prev => {
      const tc   = prev[TAKEAWAY_KEY] || {}
      const cur  = tc[itemId]?.qty || 0
      if (limit !== null && productQtyInCart(tc, productId) + delta > limit) return prev
      const next = Math.max(0, cur + delta)
      if (next === 0) {
        const { [itemId]: _, ...rest } = tc
        return { ...prev, [TAKEAWAY_KEY]: rest }
      }
      return { ...prev, [TAKEAWAY_KEY]: { ...tc, [itemId]: { ...tc[itemId], qty: next } } }
    })
  }

  async function clearCart() {
    if (takeawayKitchenOrderId && !window.confirm('Este pedido YA está en cocina y aún no se cobró.\n\nSi lo limpias, quedará pendiente en cocina: tendrás que cobrarlo o anularlo desde Pedidos.\n\n¿Limpiar de todos modos?')) return
    setCartsByTable(prev => { const { [TAKEAWAY_KEY]: _, ...rest } = prev; return rest })
    setTakeawayKitchenOrderId(null)
    setTakeawayCustomerName('')
    setTakeawayNameError(false)
    pack.setCount(0)
    setCliente(null)
    desc.setDescuento(null)
  }

  async function handleSendToKitchen() {
    // Defensa extra — el botón ya queda deshabilitado con caja cerrada,
    // pero esto cubre cualquier otra vía de invocación.
    if (!cajaAbierta) { setSuccessMsg('🔒 Caja Cerrada — se requiere abrir la caja para enviar el pedido a cocina'); return }
    if (cartItems.length === 0) { alert('Agrega al menos un producto al pedido'); return }
    if (!takeawayCustomerName.trim()) { setTakeawayNameError(true); return }
    if (takeawayKitchenOrderId) return  // ya enviado, no duplicar

    // Premio de fidelidad: se registra el canje antes de crear el pedido
    let canjeId = null
    if (cartHasCortesia(cart)) {
      if (!cliente) { setSuccessMsg('⚠ Quita la cortesía: el pedido no tiene cliente'); return }
      try {
        const r = await DB.crmCanjear({ clienteId: cliente.id, producto: cortesiaName(cart), por: user?.name || 'Admin' })
        canjeId = r?.canje_id || null
      } catch (e) {
        setSuccessMsg(`⚠ ${crmErrorMessage(e)} Quita la cortesía del pedido.`)
        return
      }
    }

    const orderId = await addOrder({
      table_number:   0,
      zone:           'Para Llevar',
      waiter_name:    null,
      items: cartItems.map(orderLineOf),
      ...(cliente ? { cliente_id: cliente.id } : {}),
      status:         'pending',
      kitchen_status: 'pending',
      total:          grandTotal,
      // Envases: la base recalcula el monto y el total (no se confía en la app)
      ...(pack.count > 0 ? { packaging_count: pack.count, packaging_unit: pack.unit, packaging_total: pack.total } : {}),
      payment_method: null,
      paid_at:        null,
      notes:          JSON.stringify({ customerName: takeawayCustomerName.trim() }),
    }).catch(() => null)

    if (!orderId) {
      if (canjeId) DB.crmAnularCanje(canjeId).catch(() => {})
      setSuccessMsg('⚠ Error al enviar a cocina — intenta de nuevo')
      return
    }
    if (canjeId) DB.crmVincularCanje(canjeId, orderId).catch(() => {})

    setTakeawayKitchenOrderId(orderId)
    const name = takeawayCustomerName.trim()
    setSuccessMsg(`✓ Enviado a cocina · ${name} — Ahora puedes cobrar`)
    setTimeout(() => setSuccessMsg(''), 5000)
  }

  async function handlePay(methodOrSplit) {
    const items = cartItems
    const total = payTotal
    // methodOrSplit: string (pago simple) o { mixto:true, legs } (pago dividido,
    // ya validado en el modal — se revalida igual aquí por si el total cambió
    // entre que se abrió el modal y se confirmó).
    const isSplit = methodOrSplit && typeof methodOrSplit === 'object'
    if (isSplit) {
      const check = validateBreakdown(methodOrSplit.legs, total)
      if (!check.ok) { setSuccessMsg(`⚠ ${check.message}`); return }
    }
    const { paymentMethod, paymentBreakdown } = isSplit
      ? buildOrderPaymentFields(methodOrSplit.legs)
      : { paymentMethod: methodOrSplit, paymentBreakdown: null }
    const payStatus = buildPayStatus(paymentMethod)

    if (!takeawayKitchenOrderId) return

    await updateOrder(takeawayKitchenOrderId, {
      status:             payStatus,
      payment_method:     paymentMethod,
      payment_breakdown:  paymentBreakdown,
      paid_at:            new Date().toISOString(),
    }).catch(() => {})

    deductStock(items.map(c => ({ id: c.item.id, qty: c.qty })))

    printReceipt({
      mesa: null, zone: 'Para Llevar', waiterName: null,
      items: items.map(c => ({ name: c.item.name, price: c.item.price, qty: c.qty })),
      total, paymentMethod,
      paymentBreakdown,
      packagingCount: pack.count, packagingUnit: pack.unit,
      descuentoMonto: desc.descuento?.monto || 0, descuentoLabel: desc.descuento?.label || null,
      customerName: takeawayCustomerName.trim() || null,
    })

    const name = takeawayCustomerName.trim()
    setCartsByTable(prev => { const { [TAKEAWAY_KEY]: _, ...rest } = prev; return rest })
    setTakeawayKitchenOrderId(null)
    setShowPayModal(false)
    setMobileTab('menu')
    setTakeawayCustomerName('')
    setTakeawayNameError(false)
    pack.setCount(0)
    setCliente(null)
    desc.setDescuento(null)
    setSuccessMsg(`✓ Cobrado · ${name ? name + ' · ' : ''}S/${total.toFixed(2)}`)
    setTimeout(() => setSuccessMsg(''), 3000)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Encabezado Para Llevar */}
      <div style={{
        background: 'var(--ink2)', borderBottom: '1px solid var(--line)',
        padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 5 }}><ShoppingBag size={14}/> Para Llevar</span>
        <div style={{ width: 1, height: 20, background: 'var(--line2)', margin: '0 4px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 320 }}>
          <input
            value={takeawayCustomerName}
            onChange={e => { setTakeawayCustomerName(e.target.value); setTakeawayNameError(false) }}
            placeholder="👤 Nombre del cliente (obligatorio)"
            style={{
              flex: 1,
              background: takeawayNameError ? 'rgba(220,38,38,.08)' : 'var(--ink3)',
              border: `1px solid ${takeawayNameError ? '#DC2626' : 'var(--line2)'}`,
              borderRadius: 20, padding: '5px 14px',
              color: 'var(--snow)', fontSize: 12, outline: 'none',
              fontFamily: 'var(--body)',
            }}
            maxLength={60}
          />
        </div>
        {successMsg && (
          <div style={{
            marginLeft: 'auto', background: 'rgba(22,163,74,.15)',
            border: '1px solid rgba(22,163,74,.35)', borderRadius: 20,
            padding: '3px 12px', fontSize: 11, fontWeight: 800, color: '#16A34A',
          }}>{successMsg}</div>
        )}
      </div>

      {/* Cliente del pedido (opcional — no frena la venta) */}
      <div style={{ background: 'var(--ink2)', borderBottom: '1px solid var(--line)', padding: '6px 14px', flexShrink: 0 }}>
        <ClienteQuickPicker
          value={cliente}
          onChange={onClienteChange}
          disabled={!!takeawayKitchenOrderId}
          onCanjear={() => setShowPremio(true)}
          canjeHecho={cartHasCortesia(cart)}
        />
      </div>
      {showPremio && (
        <PremioPicker
          products={premioProds}
          premioTexto={cliente?.stats?.premio_texto}
          categoria={cliente?.stats?.premio_categoria}
          onPick={pickPremio}
          onClose={() => setShowPremio(false)}
        />
      )}

      {/* Mobile tabs */}
      <div style={{ display: 'flex', background: 'var(--ink1)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {[
          { key: 'menu', icon: UtensilsCrossed, label: 'Menú' },
          { key: 'cart', icon: ShoppingCart, label: `Pedido${cartCount > 0 ? ` (${cartCount})` : ''}` },
        ].map(t => (
          <button key={t.key} onClick={() => setMobileTab(t.key)} style={{
            flex: 1, padding: '9px 4px', border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 11, transition: 'all .15s',
            background: mobileTab === t.key ? 'rgba(37,99,235,.08)' : 'transparent',
            color: mobileTab === t.key ? 'var(--amber)' : 'var(--fog)',
            borderBottom: `2px solid ${mobileTab === t.key ? 'var(--amber)' : 'transparent'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}><t.icon size={13}/>{t.label}</button>
        ))}
      </div>

      {/* 2 paneles */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* PANEL MENÚ */}
        <div style={{
          flex: 1, display: mobileTab === 'menu' ? 'flex' : 'none',
          flexDirection: 'column', overflow: 'hidden',
        }} className="pos-panel-menu">
          <MenuGrid cart={cart} onAdd={addToCart} />
        </div>

        {/* PANEL CARRITO */}
        <div style={{
          width: 280, flexShrink: 0,
          borderLeft: '1px solid var(--line)', background: 'var(--ink1)',
          display: mobileTab === 'cart' ? 'flex' : 'none',
          flexDirection: 'column', overflow: 'hidden',
        }} className="pos-panel-cart">
          <CartPanel
            cartItems={cartItems}
            cartTotal={payTotal}
            discount={desc}
            label="Para Llevar"
            subLabel={takeawayCustomerName || null}
            subColor="#7C3AED"
            onChangeQty={changeQty}
            onClear={clearCart}
            takeawayMode={true}
            kitchenSent={!!takeawayKitchenOrderId}
            cajaAbierta={cajaAbierta}
            packaging={pack.enabled ? { count: pack.count, unit: pack.unit, total: pack.total, onChange: changePack } : null}
            onSendToKitchen={handleSendToKitchen}
            onPay={() => {
              if (cartItems.length === 0) { alert('Agrega productos al pedido'); return }
              if (!takeawayCustomerName.trim()) { setTakeawayNameError(true); return }
              if (!takeawayKitchenOrderId) {
                alert('⚠ Primero debes enviar el pedido a cocina antes de proceder al cobro')
                return
              }
              setShowPayModal(true)
            }}
          />
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .pos-panel-menu { display: flex !important; }
          .pos-panel-cart { display: flex !important; }
        }
      `}</style>

      {showPayModal && (
        <PaymentModal
          mesa={null}
          zone="Para Llevar"
          waiter={null}
          customerName={takeawayCustomerName.trim() || null}
          total={payTotal}
          onConfirm={handlePay}
          onClose={() => setShowPayModal(false)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PEDIDOS EXTERNOS — Delivery + Recojo en Local
// ═══════════════════════════════════════════════════════════════════════════════
function ExternalOrdersSection() {
  const { user } = useAuth()
  const { orders, addOrder, updateOrder } = useOrders()
  const { deductStock, effectiveMenu }    = useInventory()
  const { cajaAbierta }                   = useCaja()

  const [orderType,      setOrderType]      = useState('delivery')
  const [form,           setForm]           = useState({ customerName: '', phone: '', address: '', pickupTime: '' })
  const [cart,           setCart]           = useState({})
  const [kitchenOrderId, setKitchenOrderId] = useState(null)  // null = aún no enviado a cocina
  const [showPayModal,   setShowPayModal]   = useState(false)
  const [error,          setError]          = useState('')
  const [mobileTab,      setMobileTab]      = useState('form')
  const [savedMsg,       setSavedMsg]       = useState('')

  const cartItems = Object.values(cart).filter(c => c.qty > 0)
  const cartTotal = cartItems.reduce((s, c) => s + c.item.price * c.qty, 0)
  const cartCount = cartItems.reduce((s, c) => s + c.qty, 0)

  // Envases descartables (precio fijo de Ajustes; no tocan el stock)
  const pack       = usePackagingState()
  const grandTotal = addMoney(cartTotal, pack.total)
  function changePack(delta) {
    if (kitchenOrderId) { lockedMsg(); return }
    pack.setCount(n => clampPackaging(n + delta))
  }

  // Descuento / cupón (con el pedido ya enviado)
  const desc = useDescuentoPedido(kitchenOrderId, m => { setSavedMsg('⚠ ' + m); setTimeout(() => setSavedMsg(''), 4000) })
  const payTotal = desc.descuento ? desc.descuento.total : grandTotal

  // Cliente del pedido (opcional) + premio de fidelidad
  const [cliente, setCliente]       = useState(null)
  const [showPremio, setShowPremio] = useState(false)
  const premioProds = cliente?.stats ? premioProducts(effectiveMenu, cliente.stats.premio_categoria) : []
  function onClienteChange(c) {
    if (kitchenOrderId) { lockedMsg(); return }
    if (!c) setCart(prev => cartWithoutCortesia(prev))
    setCliente(c)
    if (c) {
      // Autocompleta solo los campos vacíos (no pisa lo que ya se escribió)
      setForm(prev => ({
        ...prev,
        customerName: prev.customerName.trim() ? prev.customerName : String(c.nombre || '').slice(0, 80),
        phone:        prev.phone.trim() ? prev.phone : (c.celular || ''),
        address:      prev.address.trim() ? prev.address : (c.direccion || ''),
      }))
      setError('')
    }
  }
  function pickPremio(prod) {
    setShowPremio(false)
    if (kitchenOrderId) { lockedMsg(); return }
    if (!cliente?.stats?.premio_disponible || cartHasCortesia(cart)) return
    const limit = stockLimitOf(effectiveMenu, prod.id)
    if (limit !== null && productQtyInCart(cart, prod.id) + 1 > limit) { warnStockLimit(prod.name, limit); return }
    const { key, entry } = cortesiaEntry(prod)
    setCart(prev => ({ ...prev, [key]: entry }))
  }

  const pendingExternal = useMemo(() =>
    orders.filter(o => {
      const s = String(o.status || '')
      return (
        ['Delivery', 'Recojo en Local'].includes(o.zone) &&
        !s.startsWith('Pagado') &&
        o.status !== 'paid' &&
        !s.startsWith('archivado')
      )
    })
  , [orders])

  const typeConfig = {
    delivery: { icon: '🛵', label: 'Delivery', zone: 'Delivery',       color: '#2563EB' },
    pickup:   { icon: '🏪', label: 'Recojo',   zone: 'Recojo en Local', color: '#7C3AED' },
  }
  const cfg = typeConfig[orderType]

  function setField(key, val) {
    setForm(p => ({ ...p, [key]: val }))
    setError('')
  }

  function warnStockLimit(name, limit) {
    setSavedMsg(limit > 0 ? `⚠ Solo quedan ${limit} de ${name} en stock` : `⚠ ${name} sin stock`)
    setTimeout(() => setSavedMsg(''), 3000)
  }

  // Tras "Enviar a cocina" el carrito queda BLOQUEADO (ver POSSection)
  function lockedMsg() {
    setSavedMsg('⚠ Pedido ya enviado a cocina: no se puede modificar. Cóbralo y crea otro pedido para lo adicional.')
    setTimeout(() => setSavedMsg(''), 4000)
  }

  function addToCart(item) {
    if (item.available === false) return // defensa extra — el grid ya bloquea el click
    if (kitchenOrderId) { lockedMsg(); return }
    // No vender más de lo que hay en Stock (productos con stock controlado)
    const key   = cartKeyOf(item)
    const limit = stockLimitOf(effectiveMenu, item.id)
    if (limit !== null && productQtyInCart(cart, item.id) + 1 > limit) { warnStockLimit(item.baseName || item.name, limit); return }
    setCart(prev => {
      if (limit !== null && productQtyInCart(prev, item.id) + 1 > limit) return prev
      const cur = prev[key]?.qty || 0
      return { ...prev, [key]: { item, qty: cur + 1 } }
    })
    setMobileTab('form')
  }

  function changeQty(itemId, delta) {
    if (kitchenOrderId) { lockedMsg(); return }
    if (delta > 0 && cart[itemId]?.item?.cortesia) return   // la cortesía es 1 sola unidad
    // itemId = clave de la línea (producto + tamaño)
    const productId = cart[itemId]?.item?.id
    const limit = delta > 0 && productId != null ? stockLimitOf(effectiveMenu, productId) : null
    if (limit !== null && productQtyInCart(cart, productId) + delta > limit) {
      warnStockLimit(cart[itemId]?.item?.baseName || cart[itemId]?.item?.name || 'este producto', limit)
      return
    }
    setCart(prev => {
      const cur  = prev[itemId]?.qty || 0
      if (limit !== null && productQtyInCart(prev, productId) + delta > limit) return prev
      const next = Math.max(0, cur + delta)
      if (next === 0) { const { [itemId]: _, ...r } = prev; return r }
      return { ...prev, [itemId]: { ...prev[itemId], qty: next } }
    })
  }

  function validate() {
    if (!form.customerName.trim()) { setError('Ingresa el nombre del cliente'); return false }
    if (!form.phone.trim())        { setError('Ingresa el teléfono');           return false }
    const digits = form.phone.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) { setError('Teléfono inválido — ingresa entre 7 y 15 dígitos'); return false }
    if (orderType === 'delivery' && !form.address.trim()) { setError('Ingresa la dirección'); return false }
    if (cartItems.length === 0)    { setError('Agrega al menos un producto');   return false }
    return true
  }

  function clearForm() {
    setCart({})
    setForm({ customerName: '', phone: '', address: '', pickupTime: '' })
    setKitchenOrderId(null)
    setError('')
    pack.setCount(0)
    setCliente(null)
    desc.setDescuento(null)
  }

  // Paso 1 — Enviar a cocina (crea el pedido en Supabase con kitchen_status:'pending')
  async function handleSendToKitchen() {
    // Defensa extra — el botón ya queda deshabilitado con caja cerrada,
    // pero esto cubre cualquier otra vía de invocación.
    if (!cajaAbierta) { setError('🔒 Caja Cerrada — se requiere abrir la caja para enviar el pedido a cocina'); return }
    if (!validate()) { setMobileTab('form'); return }
    if (kitchenOrderId) return  // ya enviado, no duplicar

    // Premio de fidelidad: se registra el canje antes de crear el pedido
    let canjeId = null
    if (cartHasCortesia(cart)) {
      if (!cliente) { setError('Quita la cortesía: el pedido no tiene cliente'); return }
      try {
        const r = await DB.crmCanjear({ clienteId: cliente.id, producto: cortesiaName(cart), por: user?.name || 'Admin' })
        canjeId = r?.canje_id || null
      } catch (e) {
        setError(`${crmErrorMessage(e)} Quita la cortesía del pedido.`)
        return
      }
    }

    const notes = JSON.stringify({
      customerName: form.customerName,
      phone:        form.phone,
      address:      form.address || null,
      pickupTime:   form.pickupTime || null,
    })

    const orderId = await addOrder({
      table_number:   0,
      zone:           cfg.zone,
      waiter_name:    'Admin',
      items: cartItems.map(orderLineOf),
      ...(cliente ? { cliente_id: cliente.id } : {}),
      status:         'pending',
      kitchen_status: 'pending',
      total:          grandTotal,
      // Envases: la base recalcula el monto y el total (no se confía en la app)
      ...(pack.count > 0 ? { packaging_count: pack.count, packaging_unit: pack.unit, packaging_total: pack.total } : {}),
      payment_method: null,
      paid_at:        null,
      notes,
    }).catch(() => null)

    if (!orderId) {
      if (canjeId) DB.crmAnularCanje(canjeId).catch(() => {})
      setError('Error al enviar a cocina. Intenta de nuevo.')
      return
    }
    if (canjeId) DB.crmVincularCanje(canjeId, orderId).catch(() => {})

    setKitchenOrderId(orderId)
    setSavedMsg(`✓ Enviado a cocina · ${form.customerName}`)
    setTimeout(() => setSavedMsg(''), 4000)
  }

  // Paso 2 — Cobrar (actualiza el pedido ya existente en cocina)
  async function handleConfirm(method) {
    if (!kitchenOrderId) return  // guard — no debería llegar aquí

    const items = cartItems
    const total = payTotal
    const zone  = cfg.zone
    const isSplit = method && typeof method === 'object'
    if (isSplit) {
      const check = validateBreakdown(method.legs, total)
      if (!check.ok) { setSavedMsg(`⚠ ${check.message}`); return }
    }
    const { paymentMethod, paymentBreakdown } = isSplit
      ? buildOrderPaymentFields(method.legs)
      : { paymentMethod: method, paymentBreakdown: null }
    const payStatus = buildPayStatus(paymentMethod)

    // Solo actualiza status/pago — kitchen_status NO se toca (cocina lo ve hasta marcarlo 'Listo')
    await updateOrder(kitchenOrderId, {
      status:             payStatus,
      payment_method:     paymentMethod,
      payment_breakdown:  paymentBreakdown,
      paid_at:            new Date().toISOString(),
    }).catch(() => {})

    deductStock(items.map(c => ({ id: c.item.id, qty: c.qty })))

    printReceipt({
      mesa: null, zone, waiterName: null,
      items: items.map(c => ({ name: c.item.name, price: c.item.price, qty: c.qty })),
      total, paymentMethod,
      paymentBreakdown,
      packagingCount: pack.count, packagingUnit: pack.unit,
      descuentoMonto: desc.descuento?.monto || 0, descuentoLabel: desc.descuento?.label || null,
      customerName: form.customerName, customerPhone: form.phone,
    })

    const name = form.customerName
    clearForm()
    setShowPayModal(false)
    setMobileTab('orders')
    setSavedMsg(`✓ ${cfg.label} cobrado · ${name}`)
    setTimeout(() => setSavedMsg(''), 4000)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        background: 'var(--ink2)', borderBottom: '1px solid var(--line)',
        padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
      }}>
        {Object.entries(typeConfig).map(([key, c]) => {
          const TypeIcon = key === 'delivery' ? Bike : Store
          return (
            <button key={key} onClick={() => { setOrderType(key); setError('') }} style={{
              padding: '5px 16px', borderRadius: 20, fontWeight: 700, fontSize: 12,
              border: `1px solid ${orderType === key ? c.color : 'var(--line2)'}`,
              background: orderType === key ? c.color + '20' : 'transparent',
              color: orderType === key ? c.color : 'var(--fog)', cursor: 'pointer', transition: 'all .15s',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}><TypeIcon size={13}/> {c.label}</button>
          )
        })}
        {pendingExternal.length > 0 && (
          <div style={{
            background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
            borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: 'var(--crimson)',
          }}><Package size={11} style={{verticalAlign:-2,marginRight:3}}/>{pendingExternal.length} pendiente{pendingExternal.length !== 1 ? 's' : ''}</div>
        )}
        {savedMsg && (
          <div style={{
            marginLeft: 'auto', background: 'rgba(22,163,74,.15)',
            border: '1px solid rgba(22,163,74,.35)', borderRadius: 20,
            padding: '3px 12px', fontSize: 11, fontWeight: 800, color: '#16A34A',
          }}>{savedMsg}</div>
        )}
      </div>

      {/* Mobile tabs */}
      <div style={{ display: 'flex', background: 'var(--ink1)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {[
          { key: 'form',   icon: orderType === 'delivery' ? Bike : Store, label: cfg.label },
          { key: 'menu',   icon: UtensilsCrossed, label: 'Menú' },
          { key: 'cart',   icon: ShoppingCart, label: `Carrito${cartCount > 0 ? ` (${cartCount})` : ''}` },
          { key: 'orders', icon: Package, label: `Pedidos${pendingExternal.length > 0 ? ` (${pendingExternal.length})` : ''}` },
        ].map(t => (
          <button key={t.key} onClick={() => setMobileTab(t.key)} style={{
            flex: 1, padding: '9px 2px', border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 10, transition: 'all .15s',
            background: mobileTab === t.key ? 'rgba(37,99,235,.08)' : 'transparent',
            color: mobileTab === t.key ? 'var(--amber)' : 'var(--fog)',
            borderBottom: `2px solid ${mobileTab === t.key ? 'var(--amber)' : 'transparent'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
          }}><t.icon size={13}/>{t.label}</button>
        ))}
      </div>

      {/* Paneles */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT — Formulario + Menú */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--line)' }}>

          {/* Formulario */}
          <div style={{
            padding: '12px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0,
            display: mobileTab === 'form' || mobileTab === 'menu' ? 'block' : 'none',
          }} className="ext-form-panel">
            {/* Cliente (opcional): autocompleta nombre, teléfono y dirección */}
            <div style={{ marginBottom: 8 }}>
              <ClienteQuickPicker
                value={cliente}
                onChange={onClienteChange}
                disabled={!!kitchenOrderId}
                onCanjear={() => setShowPremio(true)}
                canjeHecho={cartHasCortesia(cart)}
              />
            </div>
            {showPremio && (
              <PremioPicker
                products={premioProds}
                premioTexto={cliente?.stats?.premio_texto}
                categoria={cliente?.stats?.premio_categoria}
                onPick={pickPremio}
                onClose={() => setShowPremio(false)}
              />
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={labelStyle}>Nombre del cliente *</label>
                <input
                  value={form.customerName}
                  onChange={e => setField('customerName', e.target.value)}
                  placeholder="Ej: Juan Pérez"
                  style={inputStyle}
                  maxLength={80}
                  autoComplete="off"
                />
              </div>
              <div>
                <label style={labelStyle}>Teléfono *</label>
                <input
                  value={form.phone}
                  onChange={e => setField('phone', e.target.value)}
                  placeholder="9XX XXX XXX"
                  style={inputStyle}
                  type="tel"
                  inputMode="numeric"
                  maxLength={15}
                />
              </div>
            </div>

            {orderType === 'delivery' && (
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Dirección de entrega *</label>
                <input
                  value={form.address}
                  onChange={e => setField('address', e.target.value)}
                  placeholder="Av. Principal 123, Catacaos"
                  style={inputStyle}
                  maxLength={150}
                  autoComplete="street-address"
                />
              </div>
            )}
            {orderType === 'pickup' && (
              <div style={{ marginBottom: 8 }}>
                <label style={labelStyle}>Hora estimada de llegada</label>
                <input
                  value={form.pickupTime}
                  onChange={e => setField('pickupTime', e.target.value)}
                  type="time"
                  style={inputStyle}
                />
              </div>
            )}

            {error && (
              <div style={{
                background: 'rgba(220,38,38,.12)', border: '1px solid rgba(220,38,38,.3)',
                borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 4,
                display: 'flex', alignItems: 'center', gap: 5,
              }}><AlertTriangle size={13}/>{error}</div>
            )}
          </div>

          {/* Grid menú */}
          <div style={{
            flex: 1, overflow: 'hidden',
            display: mobileTab === 'menu' || mobileTab === 'form' ? 'flex' : 'none',
            flexDirection: 'column',
          }} className="ext-menu-panel">
            <MenuGrid cart={cart} onAdd={addToCart} />
          </div>
        </div>

        {/* RIGHT — Carrito + Pedidos pendientes */}
        <div style={{
          width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', overflowX: 'hidden',
        }} className="ext-right-panel">

          {/* Carrito — minHeight garantiza que los platos agregados siempre sean visibles;
              maxHeight evita que crezca sin límite si se agregan muchos platos (scroll interno). */}
          <div style={{
            flexShrink: 0, minHeight: 420, maxHeight: 600,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            borderBottom: '1px solid var(--line)',
          }} className="ext-cart-panel">
            <CartPanel
              cartItems={cartItems}
              cartTotal={payTotal}
              discount={desc}
              label={cfg.label}
              subLabel={form.customerName || 'Sin nombre'}
              subColor={cfg.color}
              onChangeQty={changeQty}
              onClear={() => {
                if (kitchenOrderId && !window.confirm('Este pedido YA está en cocina y aún no se cobró.\n\nSi lo limpias, quedará pendiente en cocina: tendrás que cobrarlo o anularlo desde Pedidos.\n\n¿Limpiar de todos modos?')) return
                clearForm()
              }}
              takeawayMode={true}
              kitchenSent={!!kitchenOrderId}
              cajaAbierta={cajaAbierta}
              packaging={pack.enabled ? { count: pack.count, unit: pack.unit, total: pack.total, onChange: changePack } : null}
              onSendToKitchen={handleSendToKitchen}
              onPay={() => {
                if (!validate()) { setMobileTab('form'); return }
                if (!kitchenOrderId) {
                  alert('⚠ Primero debes enviar el pedido a cocina antes de proceder al cobro')
                  return
                }
                setShowPayModal(true)
              }}
            />
          </div>

          {/* Pedidos pendientes */}
          <div style={{
            flex: '1 1 auto', minHeight: 120, overflowY: 'auto',
            display: mobileTab === 'orders' || mobileTab === 'cart' ? 'block' : 'block',
          }} className="ext-orders-panel">
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--fog)', letterSpacing: 1.5 }}>
                PENDIENTES DE ENTREGA
              </span>
            </div>
            {pendingExternal.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--fog)', fontSize: 12 }}>
                <Inbox size={32} strokeWidth={1.5} style={{marginBottom: 8, opacity: .6}}/>
                Sin pedidos pendientes
              </div>
            ) : pendingExternal.map(order => {
              let info = {}
              try { info = JSON.parse(order.notes || '{}') } catch (_) {}
              return (
                <div key={order.id} style={{
                  margin: '8px 10px', padding: '10px 12px',
                  background: 'var(--ink2)', border: '1px solid var(--line)',
                  borderLeft: `3px solid ${order.zone === 'Delivery' ? '#2563EB' : '#7C3AED'}`,
                  borderRadius: 10,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 12, color: 'var(--snow)', display: 'flex', alignItems: 'center', gap: 5 }}>
                      {order.zone === 'Delivery' ? <Bike size={13}/> : <Store size={13}/>} {info.customerName || '—'}
                    </span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--amber)', fontWeight: 700 }}>
                      S/{(order.total || 0).toFixed(2)}
                    </span>
                  </div>
                  {info.phone && (
                    <div style={{ fontSize: 10, color: 'var(--mist)', display: 'flex', alignItems: 'center', gap: 4 }}><Phone size={10}/> {info.phone}</div>
                  )}
                  {info.address && (
                    <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={10}/> {info.address}</div>
                  )}
                  {info.pickupTime && (
                    <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={10}/> Llega: {info.pickupTime}</div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--fog)', marginTop: 4 }}>
                    {(order.items || []).map(i => `${i.qty}× ${i.name}`).join(', ')}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .ext-form-panel   { display: block !important; }
          .ext-menu-panel   { display: flex !important; }
          .ext-cart-panel   { display: flex !important; }
          .ext-orders-panel { display: block !important; }
          .ext-right-panel  { display: flex !important; }
        }
        @media (max-width: 767px) {
          .ext-right-panel  { width: 100% !important; position: absolute; inset: 0; top: auto; }
        }
      `}</style>

      {showPayModal && (
        <PaymentModal
          mesa={null}
          zone={cfg.zone}
          waiter={null}
          total={payTotal}
          customerName={form.customerName}
          externalType={orderType}
          onConfirm={handleConfirm}
          onClose={() => setShowPayModal(false)}
        />
      )}
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: 1.5,
  textTransform: 'uppercase', color: 'var(--fog)', marginBottom: 4,
}
const inputStyle = {
  width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
  borderRadius: 8, padding: '9px 12px', color: 'var(--snow)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
}

// ── MenuGrid — componente compartido entre POS y Externos ─────────────────────
// Consume effectiveMenu (InventoryContext): precio, imagen y disponibilidad
// que edita el admin en Stock se reflejan aquí al instante, sin recargar.
function MenuGrid({ cart, onAdd }) {
  const { effectiveMenu, effectiveCategories } = useInventory()
  const [cat,    setCat]    = useState('Todos')
  const [search, setSearch] = useState('')
  const [sizeFor, setSizeFor] = useState(null)   // producto con tamaños esperando que se elija uno

  const filtered = useMemo(() =>
    effectiveMenu.filter(m =>
      (cat === 'Todos' || m.cat === cat) &&
      (!search || m.name.toLowerCase().includes(search.toLowerCase()))
    ), [effectiveMenu, cat, search])

  // Si el admin borró/renombró la categoría seleccionada mientras el filtro
  // seguía activo, evita quedarse "atascado" mostrando 0 resultados.
  useEffect(() => {
    if (!effectiveCategories.includes(cat)) setCat('Todos')
  }, [effectiveCategories, cat])

  return (
    <>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="🔍 Buscar producto..."
          style={{
            width: '100%', background: 'var(--ink3)', border: '1px solid var(--line2)',
            borderRadius: 8, padding: '7px 12px', color: 'var(--snow)',
            fontSize: 13, outline: 'none', marginBottom: 8,
          }}
        />
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {effectiveCategories.map(c => (
            <button key={c} onClick={() => setCat(c)} style={{
              padding: '4px 12px', borderRadius: 20, border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap', transition: 'all .15s',
              background: cat === c ? 'var(--amber)' : 'var(--ink3)',
              color: cat === c ? '#000' : 'var(--mist)',
            }}>{(() => { const Icon = CAT_ICONS[c] || CAT_ICONS.Todos; return <Icon size={13} style={{verticalAlign:-2, marginRight:3}}/>; })()}{c}</button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          {filtered.map(item => {
            const qty = productQtyInCart(cart, item.id)   // todos sus tamaños
            const isAvailable = item.available !== false
            const sized = hasVariants(item)
            return (
              <div key={item.id} onClick={() => {
                if (!isAvailable) return
                if (sized) setSizeFor(item)               // elegir Fuente P./M./G.
                else onAdd(applyVariant(item, null))
              }} style={{
                background: qty > 0 ? 'rgba(37,99,235,.07)' : 'var(--ink2)',
                border: `1px solid ${qty > 0 ? 'rgba(37,99,235,.3)' : 'var(--line)'}`,
                borderRadius: 12, overflow: 'hidden', cursor: isAvailable ? 'pointer' : 'not-allowed',
                transition: 'all .15s', position: 'relative',
                opacity: isAvailable ? 1 : 0.6,
              }}>
                <div style={{ height: 90, overflow: 'hidden', position: 'relative' }}>
                  <img src={item.img || IMG_PLACEHOLDER} alt={item.name}
                    loading="lazy" decoding="async"
                    style={{
                      width: '100%', height: '100%', objectFit: 'cover',
                      filter: isAvailable ? 'none' : 'grayscale(75%)',
                    }}
                    onError={handleImgError}
                  />
                  <div style={{
                    position: 'absolute', top: 3, right: 3,
                    background: 'var(--ink4)', borderRadius: 4,
                    padding: '1px 5px', fontSize: 7, color: 'var(--amber)', fontFamily: 'var(--mono)', fontWeight: 700,
                  }}>{item.portionTag}</div>
                  {!isAvailable && (
                    <div style={{
                      position: 'absolute', inset: 0, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(15,23,42,.45)',
                    }}>
                      <span style={{
                        background: '#DC2626', color: '#fff', fontSize: 9, fontWeight: 800,
                        padding: '3px 9px', borderRadius: 6, letterSpacing: .5,
                      }}>AGOTADO</span>
                    </div>
                  )}
                </div>
                <div style={{ padding: '6px 8px 8px' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--snow)', lineHeight: 1.3, marginBottom: 3 }}>
                    {item.name}
                  </div>
                  {isAvailable && item.stock !== null && item.stock !== undefined && (() => {
                    const left = Math.max(0, Number(item.stock) - qty)
                    const low  = item.alertAt != null ? Number(item.stock) <= item.alertAt : left <= 3
                    return (
                      <div style={{ fontSize: 9, fontWeight: 700, marginBottom: 3, color: left === 0 ? '#DC2626' : low ? '#D97706' : 'var(--fog)' }}>
                        {left > 0 ? `Quedan ${left}` : qty > 0 ? 'Máximo en carrito' : 'Sin stock'}
                      </div>
                    )
                  })()}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--amber)', fontWeight: 700 }}>
                      {sized && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--fog)', fontFamily: 'inherit' }}>desde </span>}
                      S/{(sized ? minVariantPrice(item.variants, item.price) : Number(item.price) || 0).toFixed(2)}
                    </span>
                    {qty > 0 && (
                      <span style={{
                        background: 'var(--amber)', color: '#000',
                        borderRadius: '50%', width: 18, height: 18,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 800,
                      }}>{qty}</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {sizeFor && (
        <SizePickerModal
          item={sizeFor}
          onClose={() => setSizeFor(null)}
          onPick={v => { onAdd(applyVariant(sizeFor, v)); setSizeFor(null) }}
        />
      )}
    </>
  )
}

// ── Selector de tamaño (Fuente P./M./G.) ──────────────────────────────────────
function SizePickerModal({ item, onPick, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Tamaño de ${item.name}`} style={{
        background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 16,
        padding: '18px 16px', width: '100%', maxWidth: 340, boxShadow: '0 20px 60px rgba(15,23,42,.3)',
      }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--snow)', marginBottom: 2 }}>{item.name}</div>
        <div style={{ fontSize: 11, color: 'var(--fog)', marginBottom: 12 }}>Elige el tamaño</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {item.variants.map(v => (
            <button key={v.key} onClick={() => onPick(v)} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
              border: '1px solid var(--line2)', background: 'var(--ink3)', color: 'var(--snow)',
              fontSize: 14, fontWeight: 700,
            }}>
              <span>{v.label}</span>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--amber)' }}>S/{Number(v.price).toFixed(2)}</span>
            </button>
          ))}
        </div>
        <button onClick={onClose} style={{
          marginTop: 12, width: '100%', padding: '9px', borderRadius: 10, cursor: 'pointer',
          border: '1px solid var(--line2)', background: 'transparent', color: 'var(--fog)', fontSize: 12, fontWeight: 700,
        }}>Cancelar</button>
      </div>
    </div>
  )
}

// ── TableGrid — compartido entre POS y Dashboard ──────────────────────────────
export function TableGrid({ tables, selected, onSelect }) {
  // Las zonas salen de las propias mesas (las 30 de siempre por rango + las
  // agregadas desde Ajustes con su zona) — ya no de una lista fija de 30.
  const zones = groupTablesByZone(tables)
  return (
    <div style={{ padding: 10 }}>
      {zones.map(zone => (
        <div key={zone.name} style={{ marginBottom: 14 }}>
          <div style={{
            fontSize: 9, fontWeight: 700, color: 'var(--fog)',
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6, paddingLeft: 2,
          }}>{zone.name}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5 }}>
            {zone.tables.map(tid => {
              const t     = tables.find(x => x.number === tid) || {}
              const isOcc = t.status === 'occupied'
              const isSel = selected === tid
              return (
                <button key={tid} onClick={() => onSelect?.(tid)} style={{
                  padding: '7px 2px', borderRadius: 7, border: 'none',
                  cursor: onSelect ? 'pointer' : 'default',
                  transition: 'all .15s', textAlign: 'center',
                  background: isSel ? 'rgba(37,99,235,.12)' : isOcc ? 'rgba(220,38,38,.08)' : 'rgba(22,163,74,.08)',
                  borderWidth: 2, borderStyle: 'solid',
                  borderColor: isSel ? 'var(--amber)' : isOcc ? 'rgba(220,38,38,.35)' : 'rgba(22,163,74,.3)',
                  boxShadow: isSel ? '0 0 0 2px rgba(37,99,235,.2)' : 'none',
                }}>
                  <div style={{
                    fontFamily: 'var(--display)', fontSize: 16, lineHeight: 1,
                    color: isSel ? 'var(--amber)' : isOcc ? '#DC2626' : '#16A34A',
                  }}>{tid}</div>
                  <div style={{ fontSize: 7, color: isSel ? 'var(--amber)' : isOcc ? '#DC2626' : 'var(--fog)', marginTop: 2, fontWeight: 700 }}>
                    {isSel ? 'SEL' : isOcc ? 'OCUP' : 'LIBRE'}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── CartPanel ─────────────────────────────────────────────────────────────────
// cajaAbierta por defecto true: si el llamador no lo pasa (p.ej. algún uso
// futuro del modo "Mesa a Mesa"), el carrito se comporta como siempre — sin
// bloqueo — en vez de quedar deshabilitado por un valor undefined/falsy.
function CartPanel({ cartItems, cartTotal, label, subLabel, subColor, onChangeQty, onClear, onPay, onSendToKitchen, takeawayMode, kitchenSent, cajaAbierta = true, packaging = null, discount = null }) {
  const [cuponInput, setCuponInput] = useState('')
  const bloqueadoPorCaja = takeawayMode && !cajaAbierta && !kitchenSent
  return (
    <>
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--snow)', display: 'flex', alignItems: 'center', gap: 5 }}><ShoppingCart size={13}/> {label}</div>
        {subLabel && (
          <div style={{ fontSize: 10, color: subColor || 'var(--mist)', marginTop: 2 }}>● {subLabel}</div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {cartItems.length === 0 ? (
          <div style={{ textAlign: 'center', paddingTop: 30 }}>
            <ShoppingCart size={32} strokeWidth={1.5} style={{opacity: .3}}/>
            <p style={{ fontSize: 12, color: 'var(--fog)', marginTop: 8 }}>Sin productos</p>
          </div>
        ) : cartItems.map(c => (
          <div key={c.item.lineId || c.item.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 0', borderBottom: '1px solid var(--line)',
          }}>
            <img src={c.item.img || IMG_PLACEHOLDER} alt={c.item.name} style={{
              width: 34, height: 34, borderRadius: 6, objectFit: 'cover', flexShrink: 0,
            }} onError={handleImgError} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--snow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.item.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)' }}>
                S/{(c.item.price * c.qty).toFixed(2)}
              </div>
            </div>
            {takeawayMode && kitchenSent ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--amber)', flexShrink: 0 }}>×{c.qty}</span>
            ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <button onClick={() => onChangeQty(c.item.lineId || String(c.item.id), -1)} style={qtyBtnStyle('#DC2626')}>−</button>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--amber)', minWidth: 16, textAlign: 'center' }}>
                {c.qty}
              </span>
              <button onClick={() => onChangeQty(c.item.lineId || String(c.item.id), 1)} style={qtyBtnStyle('#16A34A')}>+</button>
            </div>
            )}
          </div>
        ))}
      </div>

      {/* Envases descartables para llevar (precio fijo; no usan stock) */}
      {packaging && cartItems.length > 0 && (
        <div style={{
          margin: '6px 10px 0', padding: '7px 10px', borderRadius: 8, flexShrink: 0,
          background: 'var(--ink3)', border: '1px solid var(--line2)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Package size={14} style={{ color: 'var(--amber)', flexShrink: 0 }}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--snow)' }}>Envases para llevar</div>
            <div style={{ fontSize: 10, color: 'var(--fog)' }}>
              S/{packaging.unit.toFixed(2)} c/u{packaging.count > 0 ? ` · S/${packaging.total.toFixed(2)}` : ''}
            </div>
          </div>
          {kitchenSent ? (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--amber)' }}>×{packaging.count}</span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <button onClick={() => packaging.onChange(-1)} disabled={packaging.count <= 0} aria-label="Quitar envase"
                style={{ ...qtyBtnStyle('#DC2626'), opacity: packaging.count <= 0 ? .4 : 1 }}>−</button>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700, color: 'var(--amber)', minWidth: 16, textAlign: 'center' }}>
                {packaging.count}
              </span>
              <button onClick={() => packaging.onChange(1)} disabled={packaging.count >= PACKAGING_MAX} aria-label="Agregar envase"
                style={qtyBtnStyle('#16A34A')}>+</button>
            </div>
          )}
        </div>
      )}
      {takeawayMode && kitchenSent && (
        <div style={{
          margin: '6px 10px 0', padding: '7px 10px', borderRadius: 8, flexShrink: 0,
          background: 'rgba(22,163,74,.08)', border: '1px solid rgba(22,163,74,.3)',
          fontSize: 10.5, color: '#16A34A', lineHeight: 1.35, display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Lock size={12} style={{ flexShrink: 0 }}/> Pedido en cocina: ya no se modifica. Para algo adicional, cobra este y crea otro pedido.
        </div>
      )}

      <div style={{ padding: '10px 12px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>
        {cartItems.length > 0 && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>
                {cartItems.reduce((s, c) => s + c.qty, 0)} ítem(s)
                {packaging && packaging.count > 0 ? ` + ${packaging.count} envase${packaging.count !== 1 ? 's' : ''}` : ''}
              </span>
              <span style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--amber)', lineHeight: 1 }}>
                S/{cartTotal.toFixed(2)}
              </span>
            </div>

            {takeawayMode ? (
              /* Para Llevar — flujo de 2 pasos con validación visual */
              <>
                {/* Aviso — caja cerrada bloquea el envío a cocina (armar el
                    carrito sigue permitido; solo se bloquea este paso). */}
                {bloqueadoPorCaja && (
                  <div style={{
                    background: 'rgba(220,38,38,.1)', border: '1px solid rgba(220,38,38,.3)',
                    borderRadius: 8, padding: '8px 10px', marginBottom: 8,
                    fontSize: 10.5, color: '#DC2626', textAlign: 'center', lineHeight: 1.4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  }}>
                    <Lock size={12}/> Caja Cerrada — para enviar el pedido a cocina se requiere abrir la caja
                  </div>
                )}

                {/* Paso 1: Enviar a Cocina */}
                <button
                  onClick={(!kitchenSent && cajaAbierta) ? onSendToKitchen : undefined}
                  disabled={bloqueadoPorCaja}
                  style={{
                    width: '100%', padding: '12px', marginBottom: 6,
                    background: kitchenSent
                      ? 'rgba(22,163,74,.12)'
                      : bloqueadoPorCaja
                        ? 'var(--ink3)'
                        : 'linear-gradient(135deg, #7C3AED, #6D28D9)',
                    border: kitchenSent
                      ? '1px solid rgba(22,163,74,.35)'
                      : bloqueadoPorCaja ? '1px solid var(--line2)' : 'none',
                    borderRadius: 'var(--r2)',
                    color: kitchenSent ? '#16A34A' : bloqueadoPorCaja ? 'var(--fog)' : '#FFFFFF',
                    fontWeight: 800, fontSize: kitchenSent ? 12 : 14,
                    cursor: kitchenSent ? 'default' : bloqueadoPorCaja ? 'not-allowed' : 'pointer',
                    boxShadow: (kitchenSent || bloqueadoPorCaja) ? 'none' : '0 4px 16px rgba(124,58,237,.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                    letterSpacing: .3, opacity: kitchenSent ? 0.9 : 1,
                  }}
                >
                  {kitchenSent ? <><Check size={14}/> Enviado a Cocina</> : bloqueadoPorCaja ? <><Lock size={14}/> Caja Cerrada</> : <><Flame size={14}/> Enviar a Cocina</>}
                </button>

                {/* Descuento / cupón — solo con el pedido ya en cocina */}
                {kitchenSent && discount && (
                  <div style={{ marginBottom: 8, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--line2)', background: 'var(--ink3)' }}>
                    {discount.descuento ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span style={{ flex: 1, minWidth: 0, color: '#16A34A', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {discount.descuento.label}: −S/{Number(discount.descuento.monto).toFixed(2)}
                        </span>
                        <button onClick={discount.quitar} disabled={discount.busy} style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--line2)', background: 'var(--ink2)', color: '#DC2626', cursor: 'pointer' }}>Quitar</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 5 }}>
                        <input value={cuponInput} maxLength={20} placeholder="Cupón"
                          onChange={e => setCuponInput(e.target.value.toUpperCase())}
                          onKeyDown={e => { if (e.key === 'Enter') { discount.aplicarCupon(cuponInput); setCuponInput('') } }}
                          style={{ flex: 1, minWidth: 0, background: 'var(--ink2)', border: '1px solid var(--line2)', borderRadius: 6, padding: '5px 8px', color: 'var(--snow)', fontSize: 11.5, outline: 'none' }} />
                        <button onClick={() => { discount.aplicarCupon(cuponInput); setCuponInput('') }} disabled={discount.busy || !cuponInput.trim()}
                          style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 8px', borderRadius: 6, border: 'none', background: 'var(--amber)', color: '#fff', cursor: 'pointer' }}>Aplicar</button>
                        <button onClick={discount.manual} disabled={discount.busy} title="Descuento manual con motivo"
                          style={{ fontSize: 10.5, fontWeight: 800, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--line2)', background: 'var(--ink2)', color: 'var(--mist)', cursor: 'pointer' }}>%</button>
                      </div>
                    )}
                  </div>
                )}

                {/* Paso 2: Cobrar */}
                <button
                  onClick={onPay}
                  style={{
                    width: '100%', padding: '12px', marginBottom: 6,
                    background: kitchenSent
                      ? 'linear-gradient(135deg, var(--amber), var(--amber2))'
                      : 'var(--ink3)',
                    border: kitchenSent ? 'none' : '1px solid var(--line2)',
                    borderRadius: 'var(--r2)',
                    color: kitchenSent ? '#FFFFFF' : 'var(--fog)',
                    fontWeight: 800, fontSize: 14, cursor: 'pointer',
                    boxShadow: kitchenSent ? '0 4px 16px rgba(37,99,235,.2)' : 'none',
                    opacity: kitchenSent ? 1 : 0.55,
                    letterSpacing: .3,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}
                >
                  <CreditCard size={15}/> Cobrar S/{cartTotal.toFixed(2)}
                </button>

                {!kitchenSent && (
                  <div style={{
                    fontSize: 10, color: 'var(--fog)', textAlign: 'center',
                    padding: '2px 0 4px', lineHeight: 1.4,
                  }}>
                    ↑ Envía a cocina primero para habilitar el cobro
                  </div>
                )}
              </>
            ) : (
              /* Mesa a Mesa: "Enviar a Cocina" opcional + "Cobrar" */
              <>
                {onSendToKitchen && (
                  <button onClick={onSendToKitchen} style={{
                    width: '100%', padding: '11px', marginBottom: 6,
                    background: 'rgba(37,99,235,.12)',
                    border: '1px solid rgba(37,99,235,.35)',
                    borderRadius: 'var(--r2)',
                    color: 'var(--amber)', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    transition: 'all .15s',
                  }}>
                    <Flame size={14}/> Enviar a Cocina
                  </button>
                )}
                <button onClick={onPay} style={{
                  width: '100%', padding: '12px', marginBottom: 6,
                  background: 'linear-gradient(135deg, var(--amber), var(--amber2))',
                  border: 'none', borderRadius: 'var(--r2)',
                  color: '#FFFFFF', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(37,99,235,.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}>
                  <CreditCard size={15}/> Cobrar S/{cartTotal.toFixed(2)}
                </button>
              </>
            )}

            <button onClick={onClear} style={{
              width: '100%', padding: 9, background: 'transparent',
              border: '1px solid var(--line2)', borderRadius: 'var(--r2)',
              color: 'var(--fog)', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            }}><Trash2 size={13}/> Limpiar</button>
          </>
        )}
      </div>
    </>
  )
}

function qtyBtnStyle(color) {
  return {
    width: 22, height: 22, borderRadius: 5, border: `1px solid ${color}44`,
    background: color + '18', color, fontWeight: 800, fontSize: 14,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    lineHeight: 1,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AJUSTES DEL SISTEMA
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsSection({ darkMode, onToggleDark }) {
  const [printMsg, setPrintMsg] = useState('')
  const { business } = useBusiness()

  function handleTestPrint() {
    printReceipt({
      mesa:         null,
      zone:         'PRUEBA DE IMPRESIÓN',
      waiterName:   null,
      items: [
        { name: 'Pollo a la Brasa (1/4)', price: 22.00, qty: 1 },
        { name: 'Papas Fritas',           price:  8.00, qty: 2 },
        { name: 'Inca Kola 500ml',        price:  5.00, qty: 2 },
      ],
      total:         48.00,
      paymentMethod: 'efectivo',
      customerName:  'Ticket de Prueba',
    })
    setPrintMsg('✓ Ticket enviado — verifica la impresora')
    setTimeout(() => setPrintMsg(''), 4000)
  }

  const sCard = (title, children) => (
    <div style={{
      background: 'var(--ink1)', border: '1px solid var(--line)',
      borderRadius: 'var(--r)', padding: '20px 24px', marginBottom: 16,
      boxShadow: 'var(--shadow-card)',
    }}>
      <h3 style={{
        fontSize: 10, fontWeight: 800, letterSpacing: 2, color: 'var(--fog)',
        textTransform: 'uppercase', marginBottom: 14,
        paddingBottom: 10, borderBottom: '1px solid var(--line)',
      }}>{title}</h3>
      {children}
    </div>
  )

  const sRow = (label, desc, action) => (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '11px 0', borderBottom: '1px solid var(--line)',
    }}>
      <div style={{ flex: 1, paddingRight: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--snow)' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--fog)', marginTop: 2 }}>{desc}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{action}</div>
    </div>
  )

  const chip = (text, color) => (
    <span style={{
      fontSize: 10, fontWeight: 700, color,
      background: color + '18', padding: '3px 10px', borderRadius: 10,
    }}>{text}</span>
  )

  return (
    <div style={{ padding: '20px 16px', overflowY: 'auto', height: '100%' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{
            fontFamily: 'var(--display)', fontSize: 22, color: 'var(--snow)', letterSpacing: 1, lineHeight: 1,
          }}>Ajustes del Sistema</h2>
          <p style={{ fontSize: 11, color: 'var(--fog)', marginTop: 4 }}>
            Configuración del Panel Administrativo · {business.nombre}
          </p>
        </div>

        {sCard(<><Palette size={13} style={{verticalAlign:-2,marginRight:5}}/>Apariencia</>, <>
          {sRow(
            'Modo de Visualización',
            'Alterna entre tema claro y oscuro. El ajuste se guarda automáticamente.',
            <button
              onClick={onToggleDark}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 18px',
                borderRadius: 20, cursor: 'pointer',
                border: '1px solid var(--line2)',
                background: 'var(--ink3)', color: 'var(--snow)',
                fontSize: 13, fontWeight: 700, transition: 'all .2s',
              }}
            >{darkMode ? <><Moon size={14}/> Modo Oscuro</> : <><Sun size={14}/> Modo Claro</>}</button>
          )}
        </>)}

        {sCard(<><Store size={13} style={{verticalAlign:-2,marginRight:5}}/>Datos del Negocio y Yape</>, <BusinessSettings />)}

        {sCard(<><QrCode size={13} style={{verticalAlign:-2,marginRight:5}}/>Carta Digital y QR</>, <DigitalMenuSettings />)}

        {sCard(<><UtensilsCrossed size={13} style={{verticalAlign:-2,marginRight:5}}/>Mesas del Local</>, <TablesSettings />)}

        {sCard(<><ChefHat size={13} style={{verticalAlign:-2,marginRight:5}}/>Perfiles de Meseros</>, <WaitersSettings />)}

        {sCard(<><Lock size={13} style={{verticalAlign:-2,marginRight:5}}/>Acceso de Cocina</>, <KitchenAccessSettings />)}

        {sCard(<><Bluetooth size={13} style={{verticalAlign:-2,marginRight:5}}/>Impresora Bluetooth</>, <PrinterSettings />)}

        {sCard(<><Wifi size={13} style={{verticalAlign:-2,marginRight:5}}/>Impresoras de Red (Wi-Fi)</>, <NetworkPrintersSettings />)}

        {sCard(<><Package size={13} style={{verticalAlign:-2,marginRight:5}}/>Envases Para Llevar</>, <EnvasesSettings />)}

        {sCard(<><Users size={13} style={{verticalAlign:-2,marginRight:5}}/>Clientes y Fidelidad</>, <CrmSettings />)}

        {sCard(<><Printer size={13} style={{verticalAlign:-2,marginRight:5}}/>Impresión y Tickets</>, <>
          {sRow(
            'Prueba de Impresión',
            'Imprime un ticket de prueba con los datos del negocio: por Bluetooth si la impresora está conectada, si no por la ventana de impresión.',
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {printMsg && (
                <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {printMsg}
                </span>
              )}
              <button
                onClick={handleTestPrint}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 20, cursor: 'pointer',
                  background: 'var(--amber)', border: 'none',
                  color: '#fff', fontSize: 12, fontWeight: 800,
                  boxShadow: '0 2px 8px rgba(37,99,235,.3)',
                  transition: 'all .2s', whiteSpace: 'nowrap',
                }}
              ><Printer size={13}/> Imprimir Prueba</button>
            </div>
          )}
          {sRow(
            'Formato del Ticket',
            'Papel térmico 80mm · Fuente Courier New · IGV 18% incluido automáticamente.',
            chip('80 mm', 'var(--fog)')
          )}
        </>)}

        {sCard(<><Info size={13} style={{verticalAlign:-2,marginRight:5}}/>Información del Sistema</>, <>
          {sRow('Versión', `Panel Administrativo — ${business.nombre}`,
            chip('v2.0 Pro', 'var(--amber)')
          )}
          {sRow('Base de Datos', 'Supabase · PostgreSQL · Realtime activo',
            chip('● Conectado', '#16A34A')
          )}
          {sRow('Zona Horaria', 'América/Lima (UTC−5) · Formato 24h',
            chip('PE / PEN', 'var(--fog)')
          )}
          {sRow('Roles disponibles', 'Administrador, Mesero, Cocina, Caja',
            chip('4 roles', 'var(--sapphire)')
          )}
        </>)}

        {sCard(<><Wrench size={13} style={{verticalAlign:-2,marginRight:5}}/>Configuración Avanzada — Próximamente</>, (
          <div style={{ padding: '8px 0', lineHeight: 2.2 }}>
            {[
              '· Configuración de impresora por dirección IP (gateway TCP)',
              '· Personalización del logo en tickets',
              '· Horario de apertura y cierre de caja automático',
              '· Notificaciones push para meseros y cocina',
              '· Exportación y respaldo de datos (CSV / PDF)',
              '· Gestión de categorías y precios del menú',
            ].map((item, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--fog)' }}>{item}</div>
            ))}
          </div>
        ))}

      </div>
    </div>
  )
}

// ── PaymentModal ──────────────────────────────────────────────────────────────
// onConfirm recibe: un string ('efectivo'|'tarjeta'|'yape'|'plin' — pago simple,
// comportamiento de siempre) o { mixto: true, legs: [{metodo, monto}, ...] }
// (pago dividido — ver migracion-pago-mixto.sql). Quien llama decide qué
// columnas escribir en cada caso (ver buildOrderPaymentFields en utils/payments).
function PaymentModal({ mesa, zone, waiter, total, onConfirm, onClose, customerName, externalType }) {
  const [method,  setMethod]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [split,   setSplit]   = useState(false)       // "Dividir pago" activado
  const [legAmounts, setLegAmounts] = useState({})     // { efectivo: '30', yape: '20' }
  const [splitError, setSplitError] = useState('')
  const yapeColor = '#7C3AED'
  const { business } = useBusiness() // número/titular/QR de Yape — se editan en Ajustes

  const isTakeaway = !mesa || mesa === 0
  const title = mesa ? `Cobrar Mesa ${mesa}` : `Cobrar · ${zone}`

  const efectivoLabel = externalType === 'delivery' ? <><Package size={14}/> Cobrar al entregar</>
    : externalType === 'pickup'   ? <><Store size={14}/> Cobrar a la llegada</>
    : <><Check size={14}/> Confirmar pago en Efectivo</>

  const legs = Object.entries(legAmounts)
    .filter(([, v]) => v !== '' && v != null)
    .map(([metodo, monto]) => ({ metodo, monto: Number(monto) }))
  const splitSum = legs.reduce((s, l) => s + (Number(l.monto) || 0), 0)
  const splitCheck = legs.length ? validateBreakdown(legs, total) : { ok: false, message: '' }

  function toggleSplit() {
    setSplit(s => !s)
    setMethod(null)
    setSplitError('')
  }

  async function confirm() {
    if (split) {
      const check = validateBreakdown(legs, total)
      if (!check.ok) { setSplitError(check.message); return }
      setLoading(true)
      await onConfirm({ mixto: true, legs: check.legs })
      setLoading(false)
      return
    }
    if (!method) return
    setLoading(true)
    await onConfirm(method)
    setLoading(false)
  }

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      zIndex: 1000, backdropFilter: 'blur(4px)',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'var(--ink2)', border: '1px solid var(--line2)',
        borderRadius: '20px 20px 0 0', padding: '24px 20px 32px',
        width: '100%', maxWidth: 420,
        animation: 'slideUp .3s cubic-bezier(0.22,1,0.36,1)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ width: 36, height: 3, background: 'var(--line2)', borderRadius: 2, margin: '0 auto 20px' }} />

        <div style={{ fontFamily: 'var(--display)', fontSize: 20, color: 'var(--amber)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 7 }}>
          <CreditCard size={18}/> {title}
        </div>
        <div style={{ fontSize: 11, color: 'var(--mist)', marginBottom: 16 }}>
          {customerName ? `${customerName} · ${zone}` : (waiter ? `${zone} · ${waiter.name}` : zone)}
        </div>

        <div style={{
          background: 'rgba(37,99,235,.06)', border: '1px solid rgba(37,99,235,.18)',
          borderRadius: 12, padding: '12px 16px', marginBottom: 20,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700, letterSpacing: 1 }}>TOTAL</span>
          <span style={{ fontFamily: 'var(--display)', fontSize: 28, color: 'var(--amber)', lineHeight: 1 }}>
            S/ {total.toFixed(2)}
          </span>
        </div>

        {!split && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {PAYMENT_METHODS.map(m => (
              <div key={m.key} onClick={() => setMethod(m.key)} style={{
                flex: '1 1 40%', padding: '14px 8px', borderRadius: 12, textAlign: 'center', cursor: 'pointer',
                border: `2px solid ${method === m.key ? m.color : 'var(--line2)'}`,
                background: method === m.key ? m.color + '18' : 'var(--ink3)',
                transition: 'all .2s',
              }}>
                {(() => { const MIcon = PAYMENT_ICON_SVG[m.key]; return <MIcon size={26} strokeWidth={1.75} color={method === m.key ? m.color : 'var(--fog)'} />; })()}
                <div style={{ fontWeight: 800, fontSize: 12, marginTop: 5, color: method === m.key ? m.color : 'var(--snow)' }}>
                  {m.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Dividir pago — oculto para Para Llevar/Delivery/Recojo "cobrar al
            entregar/llegar" (externalType): ahí todavía no se cobra de verdad,
            solo se marca la intención — dividir no tiene sentido sin un cobro real. */}
        {!externalType && (
          <button
            onClick={toggleSplit}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              width: '100%', padding: '9px 0', marginBottom: 16, borderRadius: 10,
              border: `1px solid ${split ? 'var(--amber)' : 'var(--line2)'}`,
              background: split ? 'rgba(217,119,6,.10)' : 'transparent',
              color: split ? 'var(--amber)' : 'var(--mist)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}
          >{split ? <><X size={14}/> Cancelar pago dividido</> : <><Split size={14}/> Dividir pago entre varios métodos</>}</button>
        )}

        {split && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PAYMENT_METHODS.map(m => (
                <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 90, fontSize: 12, fontWeight: 700, color: 'var(--snow)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {(() => { const MIcon = PAYMENT_ICON_SVG[m.key]; return <MIcon size={13}/>; })()} {m.label}
                  </span>
                  <span style={{ color: 'var(--fog)', fontSize: 12 }}>S/</span>
                  <input
                    type="number" min="0" step="0.10" inputMode="decimal"
                    value={legAmounts[m.key] ?? ''}
                    onChange={e => { setLegAmounts(prev => ({ ...prev, [m.key]: e.target.value })); setSplitError('') }}
                    placeholder="0.00"
                    style={{
                      flex: 1, background: 'var(--ink3)', border: '1px solid var(--line2)', borderRadius: 8,
                      padding: '7px 10px', color: 'var(--snow)', fontSize: 13, outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginTop: 10, padding: '8px 12px',
              borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: splitCheck.ok ? 'rgba(22,163,74,.10)' : 'var(--ink3)',
              color: splitCheck.ok ? '#16A34A' : 'var(--mist)',
            }}>
              <span>Suma: S/ {splitSum.toFixed(2)}</span>
              <span>Total: S/ {total.toFixed(2)}</span>
            </div>
            {(splitError || (legs.length > 0 && !splitCheck.ok)) && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12}/> {splitError || splitCheck.message}</div>
            )}
          </div>
        )}

        {!split && method === 'yape' && (
          <div className="anim-scale-in" style={{
            background: 'rgba(124,58,237,.08)', border: '1px solid rgba(124,58,237,.3)',
            borderRadius: 12, padding: 14, marginBottom: 16, textAlign: 'center',
          }}>
            {business.yapeQrUrl ? (
              // QR real subido en Ajustes → Datos del Negocio y Yape
              <div style={{
                width: 200, height: 200, maxWidth: '100%', margin: '0 auto 10px', background: '#fff',
                borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 20px rgba(124,58,237,.2)',
              }}>
                <img
                  src={business.yapeQrUrl} alt="QR de Yape" onError={handleImgError}
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              </div>
            ) : (
            <div style={{
              width: 140, height: 140, margin: '0 auto 10px', background: '#fff',
              borderRadius: 10, padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(124,58,237,.2)',
            }}>
              <svg viewBox="0 0 100 100" width="124" height="124" xmlns="http://www.w3.org/2000/svg">
                <rect width="100" height="100" fill="white"/>
                <rect x="5"  y="5"  width="35" height="35" rx="3" fill="none" stroke="#7C3AED" strokeWidth="4"/>
                <rect x="13" y="13" width="19" height="19" rx="1" fill="#7C3AED"/>
                <rect x="60" y="5"  width="35" height="35" rx="3" fill="none" stroke="#7C3AED" strokeWidth="4"/>
                <rect x="68" y="13" width="19" height="19" rx="1" fill="#7C3AED"/>
                <rect x="5"  y="60" width="35" height="35" rx="3" fill="none" stroke="#7C3AED" strokeWidth="4"/>
                <rect x="13" y="68" width="19" height="19" rx="1" fill="#7C3AED"/>
                <rect x="60" y="60" width="8" height="8" fill="#7C3AED"/>
                <rect x="72" y="60" width="8" height="8" fill="#7C3AED"/>
                <rect x="84" y="60" width="8" height="8" fill="#7C3AED"/>
                <rect x="60" y="72" width="8" height="8" fill="#7C3AED"/>
                <rect x="84" y="72" width="8" height="8" fill="#7C3AED"/>
                <rect x="60" y="84" width="8" height="8" fill="#7C3AED"/>
                <rect x="72" y="84" width="8" height="8" fill="#7C3AED"/>
                <rect x="84" y="84" width="8" height="8" fill="#7C3AED"/>
                <rect x="44" y="5"  width="8" height="8" fill="#7C3AED"/>
                <rect x="44" y="17" width="8" height="8" fill="#7C3AED"/>
                <rect x="44" y="29" width="8" height="8" fill="#7C3AED"/>
                <rect x="5"  y="44" width="8" height="8" fill="#7C3AED"/>
                <rect x="17" y="44" width="8" height="8" fill="#7C3AED"/>
                <rect x="29" y="44" width="8" height="8" fill="#7C3AED"/>
                <rect x="44" y="44" width="8" height="8" fill="#7C3AED"/>
                <rect x="56" y="44" width="8" height="8" fill="#7C3AED"/>
              </svg>
            </div>
            )}
            {business.yapeNumero && (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 20, color: yapeColor, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Smartphone size={17}/> {business.yapeNumero}
              </div>
            )}
            {business.yapeTitular && (
              <div style={{ fontSize: 11, color: 'var(--mist)', marginTop: 4 }}>
                Titular: <strong style={{ color: 'var(--snow)' }}>{business.yapeTitular}</strong>
              </div>
            )}
            <div style={{ fontFamily: 'var(--display)', fontSize: 24, color: 'var(--amber)', marginTop: 8 }}>
              S/ {total.toFixed(2)}
            </div>
          </div>
        )}

        {(split ? legs.length > 0 : !!method) && (
          <button
            onClick={confirm}
            disabled={loading || (split && !splitCheck.ok)}
            style={{
              width: '100%', padding: 13, border: 'none', borderRadius: 12,
              cursor: (loading || (split && !splitCheck.ok)) ? 'not-allowed' : 'pointer',
              fontWeight: 800, fontSize: 14, marginBottom: 10,
              opacity: loading ? .7 : (split && !splitCheck.ok) ? .5 : 1,
              background: split
                ? 'linear-gradient(135deg, #D97706, #B45309)'
                : method === 'yape'
                  ? `linear-gradient(135deg, ${yapeColor}, #6D28D9)`
                  : 'linear-gradient(135deg, #16A34A, #15803D)',
              color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
          >
            {loading ? <><Loader2 size={16} style={{animation:'spin .8s linear infinite'}}/> Procesando...</>
              : split ? <><Check size={16}/> Confirmar pago dividido (S/ {splitSum.toFixed(2)})</>
              : method === 'yape' ? <><Check size={16}/> Pago por Yape confirmado</>
              : method === 'efectivo' ? efectivoLabel
              : <><Check size={16}/> Confirmar pago en {PAYMENT_METHODS.find(m => m.key === method)?.label}</>}
          </button>
        )}
        <button onClick={onClose} style={{
          width: '100%', padding: 11, background: 'transparent',
          border: '1px solid var(--line2)', borderRadius: 10,
          color: 'var(--fog)', fontSize: 13, cursor: 'pointer',
        }}>Cancelar</button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD OVERVIEW — Mobile First
// ═══════════════════════════════════════════════════════════════════════════════
function DashboardOverview({ orders, pending, inProgress, ready, todaySales, totalRevenue, tables, available, occupied, unavailable }) {
  const recentOrders = [...orders].slice(0, 6)
  const { totalToday: egresosHoy } = useExpenses()
  const netoHoy = totalRevenue - egresosHoy

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 12px' }}>
      <style>{`
        .dash-stat-grid  { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); margin-bottom: 16px; }
        .dash-two-col    { display: grid; gap: 14px; grid-template-columns: 1fr 1fr; }
        .dash-order-row  { display: flex; align-items: center; gap: 8px; padding: 8px 10px;
                           background: var(--ink2); border: 1px solid var(--line);
                           border-radius: 10px; }
        @media (max-width: 640px) {
          .dash-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .dash-two-col   { grid-template-columns: 1fr !important; }
          .dash-order-row { flex-wrap: wrap; }
        }
      `}</style>

      {/* Acciones rápidas */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button
          onClick={() => { printDailyReport(todaySales).catch(() => {}) }}
          style={{
            padding: '8px 16px', borderRadius: 20, border: '1px solid rgba(37,99,235,.3)',
            background: 'rgba(37,99,235,.08)', color: 'var(--amber)',
            fontWeight: 700, fontSize: 11, cursor: 'pointer', transition: 'all .15s',
            display: 'inline-flex', alignItems: 'center', gap: 5,
          }}
        ><FileText size={13}/> Reporte del Día ({todaySales.length} ventas)</button>
      </div>

      {/* Stats */}
      <div className="dash-stat-grid">
        <StatCard icon={Banknote}       label="Ventas hoy"     value={formatPEN(totalRevenue)} color="var(--amber)" />
        <StatCard icon={ClipboardList}  label="Pedidos"         value={orders.length}          color="var(--mist)"  />
        <StatCard icon={Bell}          label="Pendientes"      value={pending.length}         color="#D97706"      pulse={pending.length > 0} />
        <StatCard icon={ChefHat}       label="En preparación"  value={inProgress.length}      color="#EA580C"      pulse={inProgress.length > 0} />
        <StatCard icon={CheckCircle2}  label="Listos"           value={ready.length}           color="#2563EB"      />
        <StatCard icon={UtensilsCrossed} label="Mesas ocupadas"  value={`${occupied.length}/${tables.length}`} color="#DC2626"     />
        <StatCard icon={Armchair}      label="Mesas libres"    value={available.length}       color="#16A34A"      />
        <StatCard icon={AlertTriangle} label="Stock agotado"  value={unavailable.length}     color="#DC2626"      pulse={unavailable.length > 0} />
        <StatCard icon={Receipt}       label="Egresos hoy"     value={formatPEN(egresosHoy)}  color="#DC2626"      />
        <StatCard icon={Calculator}    label="Neto del día"    value={formatPEN(netoHoy)}     color={netoHoy >= 0 ? '#16A34A' : '#DC2626'} />
      </div>

      <div className="dash-two-col">
        {/* Actividad reciente */}
        <div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 2, color: 'var(--amber)', marginBottom: 10 }}>
            ACTIVIDAD RECIENTE
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentOrders.length === 0
              ? <p style={{ color: 'var(--fog)', fontSize: 13 }}>No hay actividad aún</p>
              : recentOrders.map(order => {
                let info = {}
                try { info = JSON.parse(order.notes || '{}') } catch (_) {}
                const isExternal = ['Para Llevar', 'Delivery', 'Recojo en Local'].includes(order.zone)
                return (
                  <div key={order.id} className="dash-order-row">
                    <div style={{
                      background: 'var(--ink3)', borderRadius: 6, padding: '2px 7px',
                      fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--amber)', fontWeight: 700,
                      whiteSpace: 'nowrap', display: 'flex', alignItems: 'center',
                    }}>
                      {isExternal
                        ? (order.zone === 'Delivery' ? <Bike size={13}/> : order.zone === 'Para Llevar' ? <ShoppingBag size={13}/> : <Store size={13}/>)
                        : `M${order.table_number || order.tableNumber}`}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: 'var(--snow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {info.customerName ? `${info.customerName} · ` : ''}
                        {(order.items || []).map(i => `${i.quantity || i.qty}× ${i.name}`).join(', ')}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--mist)', marginTop: 1 }}>
                        {order.waiterName || order.waiter_name || order.zone} · {formatPEN(order.total)}
                      </div>
                    </div>
                    <StatusBadge status={order.status} />
                  </div>
                )
              })
            }
          </div>
        </div>

        {/* Mesas en tiempo real */}
        <div>
          <h2 style={{ fontFamily: 'var(--display)', fontSize: 13, letterSpacing: 2, color: 'var(--amber)', marginBottom: 6 }}>
            MESAS · TIEMPO REAL
          </h2>
          <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: '#16A34A', fontWeight: 700 }}>{available.length} libres</span>
            <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 700 }}>{occupied.length} ocupadas</span>
          </div>
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            <TableGrid tables={tables} selected={null} onSelect={null} />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, color = 'var(--amber)', pulse }) {
  return (
    <div style={{ background: 'var(--ink2)', border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Icon size={18} color={color} strokeWidth={1.75}/>
        {pulse && <span className="anim-blink" style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />}
      </div>
      <div style={{ fontFamily: 'var(--display)', fontSize: 28, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--mist)', fontWeight: 600 }}>{label}</div>
    </div>
  )
}

function StatusBadge({ status }) {
  const map = {
    pending:           { c: '#D97706', l: 'PEND'    },
    in_progress:       { c: '#EA580C', l: 'COCINA'  },
    ready:             { c: '#2563EB', l: 'LISTO'   },
    served:            { c: '#7C3AED', l: 'SERV'    },
    paid:              { c: '#16A34A', l: 'PAGADO'  },
    'Pagado - Efectivo': { c: '#16A34A', l: 'EFECT' },
    'Pagado - Yape':     { c: '#7C3AED', l: 'YAPE'  },
  }
  const m = map[status] || { c: 'var(--mist)', l: (status || '—').substring(0, 6).toUpperCase() }
  return (
    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: .5, padding: '3px 7px', borderRadius: 12, background: m.c + '25', color: m.c, whiteSpace: 'nowrap' }}>
      {m.l}
    </div>
  )
}
