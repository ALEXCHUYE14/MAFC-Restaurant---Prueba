import { useState, useEffect } from 'react'

/**
 * Detecta el estado de la red (online/offline).
 *
 * Nota: navigator.onLine puede dar falsos positivos (dice "online"
 * pero las peticiones fallan por proxy/firewall). Por eso este hook
 * se combina con el manejo de errores de red en cada operación.
 *
 * @returns {{ isOnline: boolean, wasOffline: boolean }}
 *   wasOffline — verdadero cuando acaba de recuperar la conexión
 *   (útil para disparar la sincronización)
 */
export function useNetworkStatus() {
  const [isOnline,   setIsOnline]   = useState(() => navigator.onLine)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setWasOffline(true)          // acabamos de reconectar
      setTimeout(() => setWasOffline(false), 100)
    }

    const handleOffline = () => {
      setIsOnline(false)
      setWasOffline(false)
    }

    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline, wasOffline }
}
