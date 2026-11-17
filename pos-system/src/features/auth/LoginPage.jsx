import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useBusiness, startBusinessSync, businessLocality } from '@/services/businessConfig'

/* ══════════════════════════════════════════════════════════════════
   LOGIN — Acceso administrativo
   ══════════════════════════════════════════════════════════════════
   Diseño basado en la propia marca: paleta tomada del logo (dorado de la
   llama + carbón de las letras) y el logo a tamaño completo sobre un fondo
   de su mismo tono, para que se funda sin recuadro.
   La LÓGICA es la misma de siempre: login(usuario, contraseña) → /admin.
   ══════════════════════════════════════════════════════════════════ */

export default function LoginPage() {
  // Localidad (p. ej. "Huaraz, Áncash") tomada de la dirección de Ajustes.
  // negocio_config es de lectura pública: se puede leer sin sesión.
  const { business } = useBusiness()
  const locality = businessLocality(business)
  useEffect(() => { startBusinessSync() }, [])

  const { login }   = useAuth()
  const navigate    = useNavigate()
  const [user,     setUser]     = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [errField, setErrField] = useState(null)   // 'user' | 'pass' | null — campo a resaltar
  const [loading,  setLoading]  = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [online,   setOnline]   = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))

  const userRef = useRef(null)
  const passRef = useRef(null)

  // Enfocar el usuario solo con mouse/teclado: en celular el teclado
  // cubriría la mitad de la pantalla apenas se abre la página.
  useEffect(() => {
    try {
      if (window.matchMedia?.('(pointer: fine)').matches) userRef.current?.focus()
    } catch { /* sin matchMedia: no se enfoca */ }
  }, [])

  // Aviso de "sin conexión" — antes el error recién aparecía al enviar
  useEffect(() => {
    const on  = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  function clearError() { if (error) { setError(''); setErrField(null) } }

  function detectCaps(e) {
    try { setCapsLock(!!e.getModifierState?.('CapsLock')) } catch { /* navegador sin soporte */ }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    if (!user.trim()) {
      setError('Escribe tu usuario para continuar.'); setErrField('user'); userRef.current?.focus(); return
    }
    if (!password) {
      setError('Escribe tu contraseña para continuar.'); setErrField('pass'); passRef.current?.focus(); return
    }
    setError(''); setErrField(null)
    setLoading(true)
    try {
      await login(user.trim(), password)
      navigate('/admin')
    } catch (err) {
      setError(err?.message || 'Usuario o contraseña incorrectos.')
      setErrField('pass')
      // Deja la contraseña seleccionada para reescribirla de inmediato
      // (tras re-habilitar el campo, que estaba deshabilitado mientras cargaba)
      setTimeout(() => { passRef.current?.focus(); passRef.current?.select?.() }, 60)
    } finally {
      setLoading(false)
    }
  }

  const year = new Date().getFullYear()
  const bizName = (business?.nombre || '').trim()

  return (
    <div className="lg-root">
      <style>{LG_CSS}</style>

      {/* ── Marca ─────────────────────────────────────────────── */}
      <aside className="lg-brand">
        <img
          className="lg-logo"
          src="/img/logo/logo.png"
          alt={bizName ? `Logo de ${bizName}` : 'Logo del restaurante'}
          width="1024" height="1024"
          decoding="async"
        />
        <div className="lg-brand-caption">
          <p className="lg-brand-role">Panel de administración</p>
          {locality && <p className="lg-brand-place">{locality}</p>}
        </div>
      </aside>

      {/* ── Formulario ─────────────────────────────────────────── */}
      <main className="lg-main">
        <div className="lg-form-wrap">
          <h1 className="lg-title">Bienvenido</h1>
          <p className="lg-lead">Inicia sesión para gestionar ventas, caja, stock y personal.</p>

          {!online && (
            <div className="lg-note" role="status">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>
              </svg>
              Sin conexión a internet. Conéctate para poder ingresar.
            </div>
          )}

          <form onSubmit={handleSubmit} className="lg-form" noValidate aria-busy={loading}>
            <div className="lg-group">
              <label className="lg-label" htmlFor="lg-user">Usuario</label>
              <input
                ref={userRef}
                id="lg-user"
                className={`lg-input${errField === 'user' ? ' is-invalid' : ''}`}
                type="text"
                placeholder="Ingresa tu usuario"
                value={user}
                onChange={e => { setUser(e.target.value); clearError() }}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={errField === 'user' || undefined}
                aria-describedby={error ? 'lg-error' : undefined}
                disabled={loading}
              />
            </div>

            <div className="lg-group">
              <label className="lg-label" htmlFor="lg-pass">Contraseña</label>
              <div className="lg-pass">
                <input
                  ref={passRef}
                  id="lg-pass"
                  className={`lg-input lg-input-pass${errField === 'pass' ? ' is-invalid' : ''}`}
                  type={showPass ? 'text' : 'password'}
                  placeholder="Tu contraseña"
                  value={password}
                  onChange={e => { setPassword(e.target.value); clearError() }}
                  onKeyDown={detectCaps}
                  onKeyUp={detectCaps}
                  onBlur={() => setCapsLock(false)}
                  autoComplete="current-password"
                  aria-invalid={errField === 'pass' || undefined}
                  aria-describedby={[error ? 'lg-error' : null, capsLock ? 'lg-caps' : null].filter(Boolean).join(' ') || undefined}
                  disabled={loading}
                />
                <button
                  type="button"
                  className="lg-eye"
                  onClick={() => setShowPass(v => !v)}
                  aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPass}
                  aria-controls="lg-pass"
                >
                  {showPass ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              {capsLock && (
                <p id="lg-caps" className="lg-hint">Bloq Mayús está activado.</p>
              )}
            </div>

            <div id="lg-error" className="lg-error-slot" aria-live="assertive">
              {error && (
                <p className="lg-error" role="alert">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>{error}</span>
                </p>
              )}
            </div>

            <button className="lg-btn" type="submit" disabled={loading}>
              {loading
                ? <><span className="lg-spinner" aria-hidden="true" /> Verificando…</>
                : 'Ingresar al sistema'}
            </button>
          </form>

          <p className="lg-help">
            ¿No puedes entrar?{' '}
            <a
              className="lg-link"
              href="https://wa.me/51924996961?text=Hola%2C+necesito+soporte+para+acceder+al+sistema+RESTAURANTE+POS"
              target="_blank"
              rel="noopener noreferrer"
            >
              Escribe a soporte por WhatsApp
            </a>
          </p>

          <p className="lg-foot">© {year}{bizName ? ` ${bizName}` : ''}</p>
        </div>
      </main>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════
   ESTILOS — paleta del logo · tipografía Archivo
══════════════════════════════════════════════════════════ */
const LG_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..800&display=swap');

.lg-root {
  --carbon:   #34332E;   /* letras del logo */
  --carbon-2: #1F1E1B;   /* hover del botón */
  --oro:      #B78C31;   /* llama del logo — foco y detalles */
  --oro-txt:  #7E5A14;   /* dorado oscuro legible para texto/enlaces */
  --papel:    #F9F8F4;   /* fondo del logo (tono de su centro) */
  --blanco:   #FFFFFF;
  --piedra:   #6A675F;   /* texto secundario */
  --borde:    #D9D6CE;
  --error:    #A8321F;

  display: flex;
  /* La app bloquea el scroll global (html/body/#root overflow:hidden),
     así que el login se desplaza por sí mismo: en pantallas bajas o
     con el teclado abierto nunca queda nada cortado. */
  height: 100vh; height: 100dvh;
  overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  font-family: 'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif;
  color: var(--carbon);
  background: var(--blanco);
  -webkit-font-smoothing: antialiased;
}

/* ── Marca ── */
.lg-brand {
  flex: 0 0 50%;
  background: var(--papel);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: 48px 40px 40px;
  position: relative;
}
.lg-logo {
  width: min(92%, 600px); height: auto;
  /* El fondo casi blanco del PNG se funde con el papel; el borde del
     archivo (que trae un leve degradado gris) se desvanece antes de
     llegar al recuadro, para que no se note ningún halo. */
  mix-blend-mode: multiply;
  -webkit-mask-image: radial-gradient(closest-side at 50% 50%, #000 58%, transparent 86%);
          mask-image: radial-gradient(closest-side at 50% 50%, #000 58%, transparent 86%);
  animation: lg-in .9s cubic-bezier(.2,.7,.2,1) both;
}
@keyframes lg-in { from { opacity: 0; transform: scale(.97); } to { opacity: 1; transform: none; } }

.lg-brand-caption {
  position: absolute; left: 40px; right: 40px; bottom: 36px;
  display: flex; justify-content: space-between; align-items: baseline; gap: 16px; flex-wrap: wrap;
}
.lg-brand-role, .lg-brand-place { margin: 0; font-size: 14px; line-height: 1.4; }
.lg-brand-role  { font-weight: 600; color: var(--carbon); }
.lg-brand-place { color: var(--piedra); }

/* ── Formulario ── */
.lg-main {
  flex: 1 1 50%;
  display: flex; align-items: center;
  padding: 48px clamp(24px, 6vw, 96px);
  border-left: 1px solid #ECEAE4;
}
.lg-form-wrap { width: 100%; max-width: 380px; }

.lg-title {
  margin: 0 0 10px;
  font-size: clamp(34px, 3.4vw, 44px); line-height: 1.05;
  font-weight: 760; font-stretch: 118%; font-variation-settings: 'wdth' 118;
  letter-spacing: -0.02em;
  color: var(--carbon);
}
.lg-lead { margin: 0 0 32px; font-size: 15.5px; line-height: 1.55; color: var(--piedra); max-width: 34ch; }

.lg-note {
  display: flex; align-items: center; gap: 10px;
  margin: -12px 0 24px; padding: 11px 14px;
  background: #FBF6EA; border: 1px solid #EAD9AE; border-radius: 10px;
  font-size: 14px; color: #5C4410;
}

.lg-form { width: 100%; }
.lg-group { margin-bottom: 20px; }
.lg-label { display: block; margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--carbon); }

.lg-input {
  display: block; width: 100%; box-sizing: border-box;
  height: 50px; padding: 0 14px;
  background: var(--blanco);
  border: 1px solid var(--borde); border-radius: 10px;
  font: 400 16px/1.2 'Archivo', system-ui, sans-serif;   /* 16px: evita el zoom automático de iOS */
  color: var(--carbon);
  outline: none;
  transition: border-color .15s, box-shadow .15s;
}
.lg-input::placeholder { color: #A29E94; }
.lg-input:hover:not(:disabled) { border-color: #B9B5AB; }
.lg-input:focus { border-color: var(--oro); box-shadow: 0 0 0 3px rgba(183,140,49,.25); }
.lg-input:disabled { background: #FAFAF8; color: var(--piedra); }
.lg-input.is-invalid { border-color: var(--error); }
.lg-input.is-invalid:focus { box-shadow: 0 0 0 3px rgba(168,50,31,.18); }

.lg-pass { position: relative; }
.lg-input-pass { padding-right: 52px; }
.lg-eye {
  position: absolute; top: 50%; right: 5px; transform: translateY(-50%);
  width: 40px; height: 40px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: none; cursor: pointer; color: var(--piedra);
  transition: background .15s, color .15s;
}
.lg-eye:hover { background: #F1EFEA; color: var(--carbon); }
.lg-eye:focus-visible { outline: 2px solid var(--oro); outline-offset: 0; }

.lg-hint { margin: 8px 0 0; font-size: 13.5px; color: var(--oro-txt); font-weight: 500; }

.lg-error-slot { min-height: 0; }
.lg-error {
  display: flex; align-items: flex-start; gap: 9px;
  margin: 0 0 18px; font-size: 14px; line-height: 1.45; color: var(--error);
}
.lg-error svg { flex-shrink: 0; margin-top: 1px; }

.lg-btn {
  width: 100%; height: 52px; margin-top: 4px;
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--carbon); color: #FFFFFF;
  border: none; border-radius: 10px; cursor: pointer;
  font: 600 16px 'Archivo', system-ui, sans-serif; letter-spacing: .005em;
  transition: background .15s, transform .1s;
}
.lg-btn:hover:not(:disabled) { background: var(--carbon-2); }
.lg-btn:active:not(:disabled) { transform: translateY(1px); }
.lg-btn:focus-visible { outline: 3px solid var(--oro); outline-offset: 3px; }
.lg-btn:disabled { cursor: progress; opacity: .85; }
.lg-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.3); border-top-color: #E3C27A;
  animation: lg-spin .7s linear infinite;
}
@keyframes lg-spin { to { transform: rotate(360deg); } }

.lg-help { margin: 28px 0 0; font-size: 14px; line-height: 1.5; color: var(--piedra); }
.lg-link {
  color: var(--oro-txt); font-weight: 600; text-decoration: underline;
  text-decoration-thickness: 1px; text-underline-offset: 3px;
}
.lg-link:hover { color: var(--carbon); }
.lg-link:focus-visible { outline: 2px solid var(--oro); outline-offset: 2px; border-radius: 3px; }

.lg-foot { margin: 40px 0 0; font-size: 13px; color: #8C887F; }

/* ── Tablet ── */
@media (max-width: 1023px) and (min-width: 769px) {
  .lg-brand { flex-basis: 44%; }
  .lg-brand-caption { left: 28px; right: 28px; }
}

/* ── Celular: la marca pasa a una franja superior ── */
/* La franja del logo CRECE para ocupar el espacio libre de arriba: el
   formulario baja y queda a la altura del pulgar, sin hueco vacío abajo.
   En pantallas bajas (o con el teclado abierto en Android) la franja se
   encoge a su tamaño mínimo y la página simplemente se desplaza. */
@media (max-width: 768px) {
  .lg-root { flex-direction: column; }
  .lg-brand {
    flex: 1 0 auto;
    flex-direction: column; justify-content: center; align-items: center; gap: 10px;
    padding: max(28px, env(safe-area-inset-top)) 16px 24px;
    border-bottom: 1px solid #ECEAE4;
    text-align: center;
  }
  .lg-logo { width: min(52vw, 220px); margin: -8px 0 -4px; }
  .lg-brand-caption { position: static; flex-direction: column; align-items: center; gap: 2px; }
  .lg-main {
    flex: 0 0 auto; align-items: flex-start; border-left: none;
    padding: 28px 16px max(32px, calc(env(safe-area-inset-bottom) + 20px));
  }
  .lg-form-wrap { max-width: 440px; margin: 0 auto; }
  .lg-lead { margin-bottom: 24px; }
  .lg-foot { margin-top: 28px; }
}
/* Celulares muy bajos (p. ej. iPhone SE): logo más chico para que el
   formulario siga entrando casi completo sin desplazarse. */
@media (max-width: 768px) and (max-height: 700px) {
  .lg-logo { width: min(36vw, 140px); }
  .lg-brand { padding-top: max(18px, env(safe-area-inset-top)); padding-bottom: 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .lg-logo { animation: none; }
  .lg-spinner { animation-duration: 1.6s; }
  .lg-input, .lg-btn, .lg-eye { transition: none; }
}
`
