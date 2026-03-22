import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  getGetMeQueryKey,
  useLogin,
  useLogout,
  useGetMe,
  useRegister,
} from '../generated/anthoLumeAPIV1';

interface AuthState {
  isAuthenticated: boolean;
  user: { username: string; is_admin: boolean } | null;
  isCheckingAuth: boolean;
}

interface AuthContextType extends AuthState {
  login: (_username: string, _password: string) => Promise<void>;
  register: (_username: string, _password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    isCheckingAuth: true,
  });

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();

  const { data: meData, error: meError, isLoading: meLoading } = useGetMe();

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    setAuthState(prev => {
      if (meLoading) {
        return { ...prev, isCheckingAuth: true };
      } else if (meData?.data && meData.status === 200) {
        const userData = 'username' in meData.data ? meData.data : null;
        return {
          isAuthenticated: true,
          user: userData as { username: string; is_admin: boolean } | null,
          isCheckingAuth: false,
        };
      } else if (meError || (meData && meData.status === 401)) {
        return {
          isAuthenticated: false,
          user: null,
          isCheckingAuth: false,
        };
      }

      return { ...prev, isCheckingAuth: false };
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

        if (response.status !== 200 || !('username' in response.data)) {
          setAuthState({
            isAuthenticated: false,
            user: null,
            isCheckingAuth: false,
          });
          throw new Error('Login failed');
        }

        setAuthState({
          isAuthenticated: true,
          user: response.data as { username: string; is_admin: boolean },
          isCheckingAuth: false,
        });

        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate('/');
      } catch (_error) {
        setAuthState({
          isAuthenticated: false,
          user: null,
          isCheckingAuth: false,
        });
        throw new Error('Login failed');
      }
    },
    [loginMutation, navigate, queryClient]
  );

  const register = useCallback(
    async (username: string, password: string) => {
      try {
        const response = await registerMutation.mutateAsync({
          data: {
            username,
            password,
          },
        });

        if (response.status !== 201 || !('username' in response.data)) {
          setAuthState({
            isAuthenticated: false,
            user: null,
            isCheckingAuth: false,
          });
          throw new Error('Registration failed');
        }

        setAuthState({
          isAuthenticated: true,
          user: response.data as { username: string; is_admin: boolean },
          isCheckingAuth: false,
        });

        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate('/');
      } catch (_error) {
        setAuthState({
          isAuthenticated: false,
          user: null,
          isCheckingAuth: false,
        });
        throw new Error('Registration failed');
      }
    },
    [navigate, queryClient, registerMutation]
  );

  const logout = useCallback(() => {
    logoutMutation.mutate(undefined, {
      onSuccess: async () => {
        setAuthState({
          isAuthenticated: false,
          user: null,
          isCheckingAuth: false,
        });
        await queryClient.removeQueries({ queryKey: getGetMeQueryKey() });
        navigate('/login');
      },
    });
  }, [logoutMutation, navigate, queryClient]);

  return (
    <AuthContext.Provider value={{ ...authState, login, register, logout }}>
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
