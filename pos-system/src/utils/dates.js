export function tsToDate(ts) {
  if (!ts) return new Date()
  if (ts instanceof Date) return ts
  if (typeof ts.toDate === 'function') return ts.toDate()
  return new Date(ts)
}

export function formatTime(ts) {
  const d = tsToDate(ts)
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export function formatDate(ts) {
  const d = tsToDate(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()
  const time = formatTime(d)
  if (isToday) return `Hoy ${time}`
  if (isYesterday) return `Ayer ${time}`
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) + ' ' + time
}

export function formatFullDate(ts) {
  const d = tsToDate(ts)
  return d.toLocaleDateString('es-PE', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
}

export function startOfDay(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function endOfDay(date = new Date()) {
  const d = new Date(date)
  d.setHours(23, 59, 59, 999)
  return d
}

export function msElapsed(ts) {
  return Date.now() - tsToDate(ts).getTime()
}

export function minutesElapsed(ts) {
  return Math.floor(msElapsed(ts) / 60000)
}
