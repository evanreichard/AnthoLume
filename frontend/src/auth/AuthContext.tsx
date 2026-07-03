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
import {
  type AuthState,
  getAuthenticatedAuthState,
  getUnauthenticatedAuthState,
  resolveAuthStateFromMe,
  validateAuthMutationResponse,
} from './authHelpers';

interface AuthContextType extends AuthState {
  login: (_username: string, _password: string) => Promise<void>;
  register: (_username: string, _password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const initialAuthState: AuthState = {
  isAuthenticated: false,
  user: null,
  isCheckingAuth: true,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>(initialAuthState);

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();

  const { data: meData, error: meError, isLoading: meLoading } = useGetMe();

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    setAuthState(prev =>
      resolveAuthStateFromMe({
        meData,
        meError,
        meLoading,
        previousState: prev,
      })
    );
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

        const user = validateAuthMutationResponse(response, 200);
        if (!user) {
          setAuthState(getUnauthenticatedAuthState());
          throw new Error('Login failed');
        }

        setAuthState(getAuthenticatedAuthState(user));

        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate('/');
      } catch (_error) {
        setAuthState(getUnauthenticatedAuthState());
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

        const user = validateAuthMutationResponse(response, 201);
        if (!user) {
          setAuthState(getUnauthenticatedAuthState());
          throw new Error('Registration failed');
        }

        setAuthState(getAuthenticatedAuthState(user));

        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate('/');
      } catch (_error) {
        setAuthState(getUnauthenticatedAuthState());
        throw new Error('Registration failed');
      }
    },
    [navigate, queryClient, registerMutation]
  );

  const logout = useCallback(() => {
    logoutMutation.mutate(undefined, {
      onSuccess: async () => {
        setAuthState(getUnauthenticatedAuthState());
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
