import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

interface AdminRouteProps {
  children: React.ReactNode;
}

// Role Guard - Runs behind ProtectedRoute, so auth is already resolved and `user` is populated by the time this renders.
export function AdminRoute({ children }: AdminRouteProps) {
  const { user } = useAuth();

  if (!user?.is_admin) {
    return <Navigate to="/" replace />;
  }

  return children;
}
