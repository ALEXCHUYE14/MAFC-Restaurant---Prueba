import { useState, useCallback, useRef } from 'react'

let _idCounter = 0

export default function useToast() {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current[id])
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((message, { type = 'info', duration = 3500 } = {}) => {
    const id = ++_idCounter
    setToasts(prev => [...prev.slice(-4), { id, message, type }])
    timers.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  const success = useCallback((msg, opts) => toast(msg, { type: 'success', ...opts }), [toast])
  const error   = useCallback((msg, opts) => toast(msg, { type: 'error',   ...opts }), [toast])
  const warn    = useCallback((msg, opts) => toast(msg, { type: 'warning', ...opts }), [toast])
  const info    = useCallback((msg, opts) => toast(msg, { type: 'info',    ...opts }), [toast])

  return { toasts, toast, success, error, warn, info, dismiss }
}
