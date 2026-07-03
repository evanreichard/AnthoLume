import { createContext, useContext, ReactNode, useCallback, useMemo } from 'react';
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
  getUnauthenticatedAuthState,
  resolveAuthStateFromMe,
  authUserFromMutation,
} from './authHelpers';
import { getResponseError } from '../utils/errors';

interface AuthContextType extends AuthState {
  login: (_username: string, _password: string) => Promise<void>;
  register: (_username: string, _password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const unauthenticatedState = getUnauthenticatedAuthState();

export function AuthProvider({ children }: { children: ReactNode }) {
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();

  const { data: meData, error: meError, isLoading: meLoading } = useGetMe();

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const authState = useMemo(
    () =>
      resolveAuthStateFromMe({
        meData,
        meError,
        meLoading,
        previousState: unauthenticatedState,
      }),
    [meData, meError, meLoading]
  );

  const login = useCallback(
    async (username: string, password: string) => {
      try {
        const response = await loginMutation.mutateAsync({
          data: {
            username,
            password,
          },
        });

        const user = authUserFromMutation(response);
        if (!user) {
          throw new Error(getResponseError(response) ?? 'Login failed');
        }

        queryClient.setQueryData(getGetMeQueryKey(), response);
        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate('/');
      } catch (error) {
        queryClient.setQueryData(getGetMeQueryKey(), undefined);
        throw error instanceof Error ? error : new Error('Login failed');
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

        const user = authUserFromMutation(response);
        if (!user) {
          throw new Error(getResponseError(response) ?? 'Registration failed');
        }

        queryClient.setQueryData(getGetMeQueryKey(), response);
        await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
        navigate('/');
      } catch (error) {
        queryClient.setQueryData(getGetMeQueryKey(), undefined);
        throw error instanceof Error ? error : new Error('Registration failed');
      }
    },
    [navigate, queryClient, registerMutation]
  );

  const logout = useCallback(() => {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        queryClient.clear();
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
