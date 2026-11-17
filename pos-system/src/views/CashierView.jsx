/* ══════════════════════════════════════════════════════════════════
   ⚠️  NO USADO EN PRODUCCIÓN — no editar pensando que afecta la caja real.
   ══════════════════════════════════════════════════════════════════
   La caja real vive DENTRO del panel admin — pestaña "Caja" de
   AdminDashboard.jsx, que renderiza el mismo <CashierPanel/> que este
   archivo también usa. RoleSelector.jsx nunca navega a esta ruta
   (/cashier): la única puerta al panel de caja real es "Administración"
   → login → pestaña Caja. Esta vista independiente no se toca desde
   hace varios commits.

   Si necesitas cambiar algo de caja, el archivo correcto es
   src/views/AdminDashboard.jsx (pestaña 'cashier') o, si el cambio es
   al contenido de la caja en sí, src/features/cashier/CashierPanel.jsx
   (compartido por ambos, así que sí se refleja en el real).
   ══════════════════════════════════════════════════════════════════ */
import { useAuth } from '@/features/auth/AuthContext'
import CashierPanel from '@/features/cashier/CashierPanel'

export default function CashierView() {
  const { user, logout } = useAuth()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--ink)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        background: 'var(--ink1)', borderBottom: '1px solid var(--line)',
        padding: '0 16px', height: 52,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, position: 'relative',
      }} className="topline">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>💼</span>
          <div>
            <p style={{ fontFamily: 'var(--display)', fontSize: 18, color: 'var(--amber)', letterSpacing: 1, lineHeight: 1 }}>
              CAJA
            </p>
            <p style={{ fontSize: 9, color: 'var(--mist)', letterSpacing: 2, textTransform: 'uppercase' }}>
              Antojitos al Paso
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'rgba(22,163,74,.10)', border: '1px solid rgba(22,163,74,.30)',
            borderRadius: 20, padding: '4px 10px',
          }}>
            <span style={{ fontSize: 12 }}>{user?.avatar}</span>
            <span style={{ fontSize: 11, color: 'var(--mist)', fontWeight: 700 }}>{user?.name}</span>
          </div>
          <button
            onClick={logout}
            style={{
              background: 'var(--ink3)', border: '1px solid var(--line2)',
              borderRadius: 'var(--r2)', padding: '5px 10px',
              color: 'var(--fog)', fontSize: 11, cursor: 'pointer',
            }}
          >
            Salir
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <CashierPanel />
      </div>
    </div>
  )
}
