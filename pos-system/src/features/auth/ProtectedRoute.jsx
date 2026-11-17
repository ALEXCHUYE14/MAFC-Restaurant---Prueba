import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import Loader from '@/components/Loader'

export default function ProtectedRoute({ children, roles }) {
  const { user, loading } = useAuth()

  if (loading) return <Loader fullscreen />

  if (!user) return <Navigate to="/login" replace />

  if (roles && !roles.includes(user.role)) {
    const redirects = { admin: '/admin', waiter: '/waiter', kitchen: '/kitchen', cashier: '/cashier' }
    return <Navigate to={redirects[user.role] || '/login'} replace />
  }

  return children
}
