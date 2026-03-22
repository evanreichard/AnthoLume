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
        console.log('[AuthContext] Checking authentication status...');
        return { ...prev, isCheckingAuth: true };
      } else if (meData?.data && meData.status === 200) {
        // User is authenticated - check that response has valid data
        console.log('[AuthContext] User authenticated:', meData.data);
        const userData = 'username' in meData.data ? meData.data : null;
        return {
          isAuthenticated: true,
          user: userData as { username: string; is_admin: boolean } | null,
          isCheckingAuth: false,
        };
      } else if (meError || (meData && meData.status === 401)) {
        // User is not authenticated or error occurred
        console.log('[AuthContext] User not authenticated:', meError?.message || String(meError));
        return {
          isAuthenticated: false,
          user: null,
          isCheckingAuth: false,
        };
      }
      console.log('[AuthContext] Unexpected state - checking...');
      return { ...prev, isCheckingAuth: false }; // Assume not authenticated if we can't determine
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
          user:
            'username' in response.data
              ? (response.data as { username: string; is_admin: boolean })
              : null,
          isCheckingAuth: false,
        });

        navigate('/');
      } catch (_error) {
        console.error('[AuthContext] Login failed:', _error);
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
