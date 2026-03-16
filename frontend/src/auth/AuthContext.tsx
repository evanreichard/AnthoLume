import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin, useLogout, useGetMe } from '../generated/anthoLumeAPIV1';

interface AuthState {
  isAuthenticated: boolean;
  user: { username: string; is_admin: boolean } | null;
  isCheckingAuth: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isCheckingAuth: true, // Start with checking state to prevent redirects during initial load
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  
  // Always call /me to check authentication status
  const { data: meData, error: meError, isLoading: meLoading } = useGetMe();

  const navigate = useNavigate();

  // Update auth state based on /me endpoint response
  useEffect(() => {
    if (meLoading) {
      // Still checking authentication
      setAuthState((prev) => ({ ...prev, isCheckingAuth: true }));
    } else if (meData?.data) {
      // User is authenticated
      setAuthState({
        isAuthenticated: true,
        user: meData.data,
        isCheckingAuth: false,
      });
    } else if (meError) {
      // User is not authenticated or error occurred
      setAuthState({
        isAuthenticated: false,
        user: null,
        isCheckingAuth: false,
      });
    }
  }, [meData, meError, meLoading]);

  const login = async (username: string, password: string) => {
    try {
      const response = await loginMutation.mutateAsync({
        data: {
          username,
          password,
        },
      });

      // The backend uses session-based authentication, so no token to store
      // The session cookie is automatically set by the browser
      setAuthState({
        isAuthenticated: true,
        user: response.data,
        isCheckingAuth: false,
      });

      navigate('/');
    } catch (err) {
      throw new Error('Login failed');
    }
  };

  const logout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        setAuthState({
          isAuthenticated: false,
          user: null,
          isCheckingAuth: false,
        });
        navigate('/login');
      },
    });
  };

  return (
    <AuthContext.Provider value={{ ...authState, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}