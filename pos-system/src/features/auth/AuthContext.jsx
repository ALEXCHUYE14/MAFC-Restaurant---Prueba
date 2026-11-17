import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { loginWithEmail, signOut, subscribeAuth, DEMO_MODE, supabase } from '@/services/supabase'
import { setMonitoringUser } from '@/services/monitoring'

const AuthCtx = createContext(null)

// localStorage persiste entre sesiones (el usuario no pierde acceso al cerrar la pestaña)
const SESSION_KEY = 'pos_user_session'

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) } catch { return null }
}
function saveSession(u) {
  if (u) localStorage.setItem(SESSION_KEY, JSON.stringify(u))
  else   localStorage.removeItem(SESSION_KEY)
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(loadSession)
  const [loading, setLoading] = useState(!DEMO_MODE && !!supabase)

  useEffect(() => {
    // Safety timer: si getSession() no responde en 15 s (red caída, Supabase down),
    // desbloquear la UI pero SIN tocar el usuario — el panel permanece abierto.
    const safetyTimer = setTimeout(() => setLoading(false), 15000)

    const unsub = subscribeAuth(supabaseUser => {
      clearTimeout(safetyTimer)
      if (supabaseUser === null) {
        // Solo llega aquí cuando Supabase emite SIGNED_OUT (cierre manual)
        // o cuando getSession() confirma que no existe ninguna sesión activa.
        setUser(null)
        saveSession(null)
        setMonitoringUser(null)
        setLoading(false)
      } else {
        setUser(supabaseUser)
        saveSession(supabaseUser)
        setMonitoringUser(supabaseUser)
        setLoading(false)
      }
    })

    return () => {
      clearTimeout(safetyTimer)
      unsub()
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const u = await loginWithEmail(email, password)
    setUser(u)
    saveSession(u)
    setMonitoringUser(u)
    return u
  }, [])

  // Cierre de sesión SIEMPRE manual y explícito:
  // 1. Supabase invalida el token → dispara SIGNED_OUT en el listener
  // 2. Limpiamos estado local y localStorage
  const logout = useCallback(async () => {
    // Si Supabase no responde (sin red), igual se cierra la sesión en este
    // dispositivo — el usuario nunca debe quedar "atrapado" sin poder salir.
    try { await signOut() }
    catch (e) { console.warn('[Auth] signOut falló, se cierra la sesión local:', e?.message) }
    setUser(null)
    saveSession(null)
    setMonitoringUser(null)
  }, [])

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export const ROLE_LABELS = {
  admin:   'Administrador',
  waiter:  'Mesero',
  kitchen: 'Cocina',
  cashier: 'Cajero',
}

export const ROLE_COLORS = {
  admin:   '#2563EB',
  waiter:  '#2563EB',
  kitchen: '#EA580C',
  cashier: '#16A34A',
}
