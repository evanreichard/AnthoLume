import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogin, useLogout, useGetMe } from '../generated/anthoLumeAPIV1';

interface AuthState {
  isAuthenticated: boolean;
  user: { username: string; is_admin: boolean } | null;
  token: string | null;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'antholume_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    token: null,
  });

  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  const { data: meData } = useGetMe(authState.isAuthenticated ? {} : undefined);

  const navigate = useNavigate();

  // Check for existing token on mount
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      setAuthState((prev) => ({ ...prev, token, isAuthenticated: true }));
    }
  }, []);

  // Fetch user data when authenticated
  useEffect(() => {
    if (meData?.data && authState.isAuthenticated) {
      setAuthState((prev) => ({
        ...prev,
        user: meData.data,
      }));
    }
  }, [meData, authState.isAuthenticated]);

  const login = async (username: string, password: string) => {
    try {
      loginMutation.mutate({
        data: {
          username,
          password,
        },
      }, {
        onSuccess: () => {
          const token = localStorage.getItem(TOKEN_KEY) || 'authenticated';
          localStorage.setItem(TOKEN_KEY, token);
          
          setAuthState({
            isAuthenticated: true,
            user: null,
            token,
          });
          
          navigate('/');
        },
        onError: () => {
          throw new Error('Login failed');
        },
      });
    } catch (err) {
      throw err;
    }
  };

  const logout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        localStorage.removeItem(TOKEN_KEY);
        setAuthState({
          isAuthenticated: false,
          user: null,
          token: null,
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