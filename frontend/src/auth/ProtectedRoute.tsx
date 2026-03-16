import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isCheckingAuth } = useAuth();
  const location = useLocation();

  // Show loading while checking authentication status
  if (isCheckingAuth) {
    return <div className="text-gray-500 dark:text-white">Loading...</div>;
  }

  if (!isAuthenticated) {
    // Redirect to login with the current location saved
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
}