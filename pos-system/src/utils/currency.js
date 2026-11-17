export function formatPEN(amount) {
  return `S/ ${Number(amount ?? 0).toFixed(2)}`
}

export function parsePEN(str) {
  return parseFloat(String(str).replace(/[^0-9.]/g, '')) || 0
}
