// MENÚ FIJO — vacío a propósito.
// Los 17 platos originales (Brasas/Fast Food/Bebidas) se retiraron: sus
// fotos en img/ ya no existen en el repo (se borraron en el commit
// "Restaurante Mejoras", 9f6b5b2) y se decidió no mantener fichas fijas
// sin foto en POS/Externos/Stock. Mismo cambio ya aplicado en
// src-apps/mesero/main.jsx (su propia copia independiente del menú).
// El catálogo real ahora vive 100% en la tabla `menu_items` (Stock →
// "Agregar plato", con imagen subida a Supabase Storage) — InventoryContext
// ya lo combina con este arreglo (vacío) sin ningún cambio adicional.
// Si se quiere volver a un catálogo fijo con fotos, agregar objetos aquí
// con el mismo shape que antes (id, cat, img, name, price, portionTag,
// portionDesc, equivalence).
export const MENU = []

export const CATEGORIES = ['Todos', ...new Set(MENU.map(i => i.cat))]

// Referencias a componentes (no JSX, este archivo es .js) — AdminDashboard.jsx
// las instancia como <Icon size={..}/>. 'Todos' sirve de respaldo para
// cualquier categoría nueva sin ícono propio asignado.
import { UtensilsCrossed, Flame, Sandwich, CupSoda, Martini } from 'lucide-react'

export const CAT_ICONS = {
  Todos: UtensilsCrossed,
  Brasas: Flame,
  'Fast Food': Sandwich,
  Bebidas: CupSoda,
  Tragos: Martini,
}
