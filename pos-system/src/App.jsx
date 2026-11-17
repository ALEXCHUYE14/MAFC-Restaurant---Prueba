import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }      from '@/features/auth/AuthContext'
import { OrdersProvider }    from '@/features/orders/OrdersContext'
import { TablesProvider }    from '@/features/tables/TablesContext'
import { InventoryProvider } from '@/features/inventory/InventoryContext'
import { ExpensesProvider }  from '@/features/expenses/ExpensesContext'
import { CajaProvider }      from '@/features/cashier/CajaContext'
import { OfflineProvider }   from '@/context/OfflineContext'
import OfflineIndicator      from '@/components/OfflineIndicator'
import ErrorBoundary         from '@/components/ErrorBoundary'
import ProtectedRoute        from '@/features/auth/ProtectedRoute'
import LoginPage             from '@/features/auth/LoginPage'
import AdminDashboard        from '@/views/AdminDashboard'
import WaiterView            from '@/views/WaiterView'
import KitchenView           from '@/views/KitchenView'
import CashierView           from '@/views/CashierView'
import RoleSelector          from '@/pages/RoleSelector'

export default function App() {
  return (
    <AuthProvider>
      {/*
        OfflineProvider envuelve todo para que useOffline() esté disponible
        en cualquier componente, incluidos OrdersProvider y TablesProvider.
        Orden de wrappers importa: OfflineProvider → Orders/Tables (que
        disparan eventos) → BrowserRouter (que renderiza vistas).
      */}
      <OfflineProvider>
        <OrdersProvider>
          <TablesProvider>
            <InventoryProvider>
              <ExpensesProvider>
                <CajaProvider>
                  <BrowserRouter>
                    <Routes>
                      <Route path="/"        element={<RoleSelector />} />
                      <Route path="/login"   element={<LoginPage />} />

                      <Route path="/admin" element={
                        <ProtectedRoute roles={['admin']}>
                          <ErrorBoundary label="Panel Admin">
                            <AdminDashboard />
                          </ErrorBoundary>
                        </ProtectedRoute>
                      } />

                      {/* /waiter, /kitchen, /cashier — NO forman parte del flujo real.
                          RoleSelector redirige "Mesero"/"Cocina" a /mesero.html y
                          /cocina.html directo, y "Caja" vive dentro de /admin (pestaña
                          Caja). Estas 3 rutas solo son alcanzables si alguien con rol
                          waiter/kitchen/cashier hiciera login por Supabase Auth en
                          /login — flujo que ninguno de los 3 roles reales usa. Se
                          conservan por compatibilidad; ver el aviso en cada archivo de
                          vista antes de tocarlas. */}
                      <Route path="/waiter" element={
                        <ProtectedRoute roles={['waiter']}>
                          <ErrorBoundary label="Mesero">
                            <WaiterView />
                          </ErrorBoundary>
                        </ProtectedRoute>
                      } />

                      <Route path="/kitchen" element={
                        <ProtectedRoute roles={['kitchen']}>
                          <ErrorBoundary label="Cocina">
                            <KitchenView />
                          </ErrorBoundary>
                        </ProtectedRoute>
                      } />

                      <Route path="/cashier" element={
                        <ProtectedRoute roles={['cashier']}>
                          <ErrorBoundary label="Caja">
                            <CashierView />
                          </ErrorBoundary>
                        </ProtectedRoute>
                      } />

                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </BrowserRouter>

                  {/* Banner de estado offline — visible en todas las rutas */}
                  <OfflineIndicator />
                </CajaProvider>
              </ExpensesProvider>
            </InventoryProvider>
          </TablesProvider>
        </OrdersProvider>
      </OfflineProvider>
    </AuthProvider>
  )
}
