import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin, useLogout, useGetMe } from '../generated/anthoLumeAPIV1';

interface AuthState {
  isAuthenticated: boolean;
  user: { username: string; is_admin: boolean } | null;
  isCheckingAuth: boolean;
}

interface AuthContextType extends AuthState {
  login: (_username: string, _password: string) => Promise<void>;
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
    setAuthState(prev => {
      if (meLoading) {
        // Still checking authentication
        return { ...prev, isCheckingAuth: true };
      } else if (meData?.data) {
        // User is authenticated
        return {
          isAuthenticated: true,
          user: meData.data,
          isCheckingAuth: false,
        };
      } else if (meError) {
        // User is not authenticated or error occurred
        return {
          isAuthenticated: false,
          user: null,
          isCheckingAuth: false,
        };
      }
      return prev;
    });
  }, [meData, meError, meLoading]);

  const login = useCallback(
    async (username: string, password: string) => {
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
      } catch (_error) {
        throw new Error('Login failed');
      }
    },
    [loginMutation, navigate]
  );

  const logout = useCallback(() => {
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
  }, [logoutMutation, navigate]);

  return (
    <AuthContext.Provider value={{ ...authState, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
