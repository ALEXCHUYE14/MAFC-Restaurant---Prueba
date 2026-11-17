import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth }     from '@/features/auth/AuthContext'
import { useTables }   from '@/features/tables/TablesContext'
import { useBusiness, startBusinessSync, DEFAULT_BUSINESS } from '@/services/businessConfig'
import { ChefHat, NotebookPen, Settings, Zap, Lock, UtensilsCrossed } from 'lucide-react'

const ROLE_ROUTES = {
  admin:   '/admin',
  waiter:  '/waiter',
  kitchen: '/kitchen',
  cashier: '/cashier',
}

const CARDS = [
  {
    emoji:     ChefHat,
    title:     'Cocina',
    tag:       'Acceso directo',
    desc:      'Visualiza y gestiona comandas en tiempo real. Cambia estados y coordina tiempos de preparación.',
    accentBg:  'rgba(234,88,12,0.08)',
    accentBdr: 'rgba(234,88,12,0.28)',
    accentClr: '#EA580C',
    href:      '/cocina.html',
    external:  true,
  },
  {
    emoji:     NotebookPen,
    title:     'Mesero',
    tag:       'Acceso directo',
    desc:      'Toma de pedidos por mesa, cobros en Efectivo o Yape y control de turno personalizado.',
    accentBg:  'rgba(37,99,235,0.08)',
    accentBdr: 'rgba(37,99,235,0.28)',
    accentClr: '#2563EB',
    href:      '/mesero.html',
    external:  true,
  },
  {
    emoji:     Settings,
    title:     'Administración',
    tag:       'Requiere login',
    desc:      'Dashboard completo: pedidos activos, mapa de mesas, inventario y cierre de caja.',
    accentBg:  'rgba(124,58,237,0.08)',
    accentBdr: 'rgba(124,58,237,0.28)',
    accentClr: '#7C3AED',
    href:      '/login',
    external:  false,
  },
]

const FEATURES = [
  { icon: Zap, label: 'Tiempo real'    },
  { icon: Lock, label: 'Datos seguros'  },
  { icon: UtensilsCrossed, label: '30 mesas', key: 'mesas' }, // el número real se calcula en el componente
]

const WA_NUMBER  = '51924996961'
// El mensaje usa el nombre vigente del negocio (Ajustes) — se arma en el componente.
const waMessage  = nombre => encodeURIComponent(`Hola, necesito ayuda con el sistema POS de ${nombre}.`)

export default function RoleSelector() {
  const { user, loading } = useAuth()
  const { tables } = useTables() // cuántas mesas tiene el local hoy (30 de base + las agregadas en Ajustes)
  const navigate = useNavigate()
  // Nombre del negocio editable desde Ajustes del admin. La fila
  // `negocio_config` es de lectura pública, así que se puede cargar aquí
  // sin sesión. startBusinessSync es idempotente (una sola carga + realtime
  // por pestaña). Sin la tabla, cae al valor guardado en este dispositivo
  // o al valor por defecto — nunca queda vacío.
  const { business } = useBusiness()
  const businessName = (business?.nombre || '').trim() || DEFAULT_BUSINESS.nombre
  const businessAddress = (business?.direccion || '').trim() // vacío → se oculta la línea

  useEffect(() => { startBusinessSync() }, [])

  useEffect(() => {
    if (loading || !user) return
    navigate(ROLE_ROUTES[user.role] || '/login', { replace: true })
  }, [user, loading, navigate])

  function handleSelect(card) {
    if (card.external) {
      window.location.href = card.href
    } else {
      navigate(card.href)
    }
  }

  if (loading || user) {
    return (
      <>
        <style>{CSS}</style>
        <div className="rs-splash">
          <div className="rs-spinner" />
        </div>
      </>
    )
  }

  return (
    <>
      <style>{CSS}</style>

      <div className="rs-page">

        {/* ── Header ───────────────────────────────────── */}
        <header className="rs-header">
          <img
            src="/img/logo/logo.png"
            alt={businessName}
            className="rs-logo"
            draggable="false"
          />
          <h1 className="rs-brand">{businessName.toUpperCase()}</h1>
          <p className="rs-brand-sub">Sistema de Punto de Venta · v2.0</p>
        </header>

        {/* ── Main ─────────────────────────────────────── */}
        <main className="rs-main">

          {/* Intro */}
          <div className="rs-intro">
            <h2 className="rs-intro-title">Selecciona tu perfil</h2>
            <p className="rs-intro-sub">¿Desde qué rol accedes hoy?</p>
          </div>

          {/* Role cards */}
          <div className="rs-grid">
            {CARDS.map(card => (
              <button
                key={card.title}
                className="rs-card"
                onClick={() => handleSelect(card)}
                style={{
                  '--card-bdr': card.accentBdr,
                  '--card-clr': card.accentClr,
                  '--card-bg':  card.accentBg,
                }}
              >
                <div className="rs-icon-wrap" style={{ background: card.accentBg }}>
                  <span className="rs-icon-emoji" style={{ color: card.accentClr }}><card.emoji/></span>
                </div>

                <div className="rs-card-body">
                  <div className="rs-card-title-row">
                    <span className="rs-card-title">{card.title}</span>
                    <span className="rs-tag" style={{ background: card.accentBg, color: card.accentClr }}>
                      {card.tag}
                    </span>
                  </div>
                  <p className="rs-card-desc">{card.desc}</p>
                </div>

                <div className="rs-cta" style={{ color: card.accentClr }}>
                  <span>Ingresar</span>
                  <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                    <path d="M2.5 7.5h10M9 3.5l4 4-4 4"
                      stroke="currentColor" strokeWidth="1.6"
                      strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </button>
            ))}
          </div>

            {/* ── Feature chips ─────────────────────────── */}
          <div className="rs-features">
            {FEATURES.map(f => (f.key === 'mesas' ? { ...f, label: `${tables.length} mesas` } : f)).map(f => (
              <div key={f.label} className="rs-feat">
                <span className="rs-feat-icon"><f.icon/></span>
                <span className="rs-feat-label">{f.label}</span>
              </div>
            ))}
          </div>

          {/* ── Ayuda / WhatsApp ──────────────────────── */}
          <a
            href={`https://wa.me/${WA_NUMBER}?text=${waMessage(businessName)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rs-help"
          >
            <div className="rs-help-left">
              <div className="rs-help-avatar">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="#fff" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
              </div>
              <div className="rs-help-text">
                <p className="rs-help-title">¿Necesitas ayuda?</p>
                <p className="rs-help-desc">
                  Si tienes alguna duda o inconveniente, contacta al administrador del sistema.
                </p>
              </div>
            </div>
            <div className="rs-help-cta">
              <span>Escribir</span>
              <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true">
                <path d="M2.5 7.5h10M9 3.5l4 4-4 4"
                  stroke="currentColor" strokeWidth="1.6"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </a>

          {/* ── Footer info — dentro de main para que siempre sea visible ── */}
          <div className="rs-footer-inline">
            {businessAddress && <>
            <div className="rs-footer-address">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round"
                style={{ flexShrink: 0 }} aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                <circle cx="12" cy="10" r="3"/>
              </svg>
              <span>{businessAddress}</span>
            </div>
            <span className="rs-footer-sep" aria-hidden="true">·</span>
            </>}
            <span className="rs-footer-version">Sistema POS v2.0</span>
          </div>

        </main>

      </div>
    </>
  )
}

/* ─── CSS ─────────────────────────────────────────────────── */
const CSS = `
  /* Spinner */
  @keyframes rs-spin { to { transform: rotate(360deg); } }

  .rs-splash {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ink, #F8FAFC);
  }
  .rs-spinner {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    border: 3px solid var(--line, #E2E8F0);
    border-top-color: #2563EB;
    animation: rs-spin 0.75s linear infinite;
  }

  /* Page shell */
  .rs-page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--ink, #F8FAFC);
    font-family: 'Outfit', 'Inter', system-ui, sans-serif;
    overflow-y: auto;
  }

  /* ── Header ─────────────────────────────────────────── */
  .rs-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1.75rem 1.25rem 1.25rem;
    border-bottom: 1px solid var(--line, #E2E8F0);
    text-align: center;
  }
  .rs-logo {
    width: 76px;
    height: 76px;
    object-fit: cover;
    border-radius: 50%;
    margin-bottom: 0.625rem;
    user-select: none;
    -webkit-user-drag: none;
  }
  .rs-brand {
    margin: 0;
    font-size: 1.375rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--snow, #0F172A);
    max-width: 100%;
    overflow-wrap: anywhere;
    text-align: center;
  }
  .rs-brand-sub {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    color: var(--fog, #94A3B8);
    letter-spacing: 0.01em;
  }

  /* ── Main — scrollable para que todo el contenido sea alcanzable ── */
  .rs-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: 1.25rem 0.875rem 1.25rem;
    gap: 1rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  @media (min-width: 600px) {
    .rs-main {
      justify-content: center;
      padding: 2rem 1.5rem;
      gap: 1.5rem;
    }
  }

  /* Intro */
  .rs-intro { text-align: center; }
  .rs-intro-title {
    margin: 0;
    font-size: 1.0625rem;
    font-weight: 700;
    color: var(--snow, #0F172A);
  }
  .rs-intro-sub {
    margin: 0.2rem 0 0;
    font-size: 0.8125rem;
    color: var(--fog, #94A3B8);
  }

  /* ── Grid: móvil 3 col, tablet/desktop completo ─────── */
  .rs-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
    width: 100%;
    max-width: 960px;
  }
  @media (min-width: 600px) { .rs-grid { gap: 0.875rem; } }
  @media (min-width: 900px) { .rs-grid { gap: 1rem; } }

  /* ── Card: compacto en móvil ─────────────────────────── */
  .rs-card {
    background: var(--ink2, #FFFFFF);
    border: 1.5px solid var(--card-bdr, #E2E8F0);
    border-radius: 12px;
    padding: 0.875rem 0.625rem;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
    font-family: inherit;
    -webkit-tap-highlight-color: transparent;
    min-width: 0;
  }
  .rs-card:hover, .rs-card:focus-visible {
    transform: translateY(-4px) scale(1.02);
    box-shadow: 0 12px 32px rgba(0,0,0,0.10), 0 0 0 1.5px var(--card-bdr, #E2E8F0);
    border-color: var(--card-clr, #2563EB);
    outline: none;
  }
  .rs-card:active { transform: translateY(-2px) scale(1.01); }

  .rs-icon-wrap {
    width: 36px;
    height: 36px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .rs-icon-emoji { display: flex; }
  .rs-icon-emoji svg { width: 1.125rem; height: 1.125rem; }

  .rs-card-body { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-width: 0; }
  .rs-card-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem; }
  .rs-card-title {
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--snow, #0F172A);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Ocultar tag y desc en móvil */
  .rs-tag      { display: none; }
  .rs-card-desc { display: none; }

  .rs-cta {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    margin-top: auto;
  }

  /* Tablet/Desktop: contenido completo */
  @media (min-width: 600px) {
    .rs-card       { border-radius: 16px; padding: 1.5rem; gap: 0.875rem; }
    .rs-icon-wrap  { width: 48px; height: 48px; border-radius: 12px; }
    .rs-icon-emoji svg { width: 1.5rem; height: 1.5rem; }
    .rs-card-title { font-size: 1rem; white-space: normal; overflow: visible; }
    .rs-tag        { display: inline-block; font-size: 0.6rem; font-weight: 700; padding: 2px 8px; border-radius: 100px; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; }
    .rs-card-desc  { display: block; margin: 0; font-size: 0.875rem; color: var(--mist, #475569); line-height: 1.55; }
    .rs-cta        { font-size: 0.875rem; gap: 0.375rem; }
  }
  @media (min-width: 900px) {
    .rs-card       { padding: 1.75rem; gap: 1rem; }
    .rs-icon-wrap  { width: 52px; height: 52px; border-radius: 13px; }
    .rs-icon-emoji svg { width: 1.625rem; height: 1.625rem; }
    .rs-card-title { font-size: 1.075rem; }
  }

  /* ── Feature chips ───────────────────────────────────── */
  .rs-features {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    width: 100%;
    max-width: 960px;
  }
  .rs-feat {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: var(--ink2, #FFFFFF);
    border: 1px solid var(--line, #E2E8F0);
    border-radius: 100px;
    padding: 0.375rem 0.875rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--mist, #475569);
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
  }
  .rs-feat-icon { display: inline-flex; }
  .rs-feat-icon svg { width: 0.875rem; height: 0.875rem; }
  .rs-feat-label { white-space: nowrap; }

  /* ── Help / WhatsApp card ────────────────────────────── */
  .rs-help {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.875rem;
    width: 100%;
    max-width: 960px;
    background: var(--ink2, #FFFFFF);
    border: 1.5px solid rgba(37,211,102,0.30);
    border-radius: 14px;
    padding: 1rem 1.125rem;
    text-decoration: none;
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .rs-help:hover, .rs-help:focus-visible {
    border-color: #25D366;
    box-shadow: 0 8px 24px rgba(37,211,102,0.15);
    transform: translateY(-2px);
    outline: none;
  }
  .rs-help:active { transform: translateY(-1px); }

  .rs-help-left {
    display: flex;
    align-items: center;
    gap: 0.875rem;
    min-width: 0;
    flex: 1;
  }
  .rs-help-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: #25D366;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(37,211,102,0.35);
  }
  .rs-help-text { min-width: 0; }
  .rs-help-title {
    margin: 0;
    font-size: 0.875rem;
    font-weight: 700;
    color: var(--snow, #0F172A);
  }
  .rs-help-desc {
    margin: 0.125rem 0 0;
    font-size: 0.75rem;
    color: var(--mist, #475569);
    line-height: 1.45;
  }
  .rs-help-cta {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8125rem;
    font-weight: 700;
    color: #16A34A;
    flex-shrink: 0;
    white-space: nowrap;
  }

  /* ── Footer inline (dentro de main, siempre visible) ── */
  .rs-footer-inline {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: 0.375rem 0.625rem;
    width: 100%;
    max-width: 960px;
    padding: 0.75rem 0.5rem;
    border-top: 1px solid var(--line, #E2E8F0);
    margin-top: auto;
  }
  .rs-footer-address {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.75rem;
    color: var(--mist, #475569);
    font-weight: 500;
  }
  .rs-footer-sep {
    font-size: 0.75rem;
    color: var(--ghost, #CBD5E1);
  }
  .rs-footer-version {
    font-size: 0.6875rem;
    color: var(--fog, #94A3B8);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  /* ── Tablet tweaks ───────────────────────────────────── */
  @media (min-width: 600px) {
    .rs-logo   { width: 88px; height: 88px; }
    .rs-brand  { font-size: 1.625rem; }
    .rs-header { padding: 2.25rem 2rem 1.75rem; }
    .rs-feat   { font-size: 0.8125rem; padding: 0.4rem 1rem; }
    .rs-help   { padding: 1.125rem 1.375rem; }
    .rs-help-title { font-size: 0.9375rem; }
    .rs-help-desc  { font-size: 0.8125rem; }
  }

  /* ── Desktop tweaks ──────────────────────────────────── */
  @media (min-width: 900px) {
    .rs-logo   { width: 96px; height: 96px; }
    .rs-brand  { font-size: 1.75rem; }
    .rs-header { padding: 2.5rem 3rem 2rem; }
    .rs-main   { padding: 3rem 2rem; gap: 2rem; }
    .rs-intro-title { font-size: 1.25rem; }
  }

  /* ── Dark mode ───────────────────────────────────────── */
  [data-theme="dark"] .rs-card,
  [data-theme="dark"] .rs-feat,
  [data-theme="dark"] .rs-help {
    background: var(--ink2, #1E293B);
  }
  [data-theme="dark"] .rs-card:hover,
  [data-theme="dark"] .rs-card:focus-visible {
    box-shadow: 0 14px 36px rgba(0,0,0,0.35), 0 0 0 1.5px var(--card-bdr, #334155);
  }
  [data-theme="dark"] .rs-help:hover,
  [data-theme="dark"] .rs-help:focus-visible {
    box-shadow: 0 8px 24px rgba(37,211,102,0.12);
  }
`
