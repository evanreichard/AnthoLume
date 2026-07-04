import type { LoginResponse } from '../generated/model';

export type AuthUser = LoginResponse;

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isCheckingAuth: boolean;
}

export function getUnauthenticatedAuthState(): AuthState {
  return {
    isAuthenticated: false,
    user: null,
    isCheckingAuth: false,
  };
}

export function getCheckingAuthState(previousState?: AuthState): AuthState {
  return {
    isAuthenticated: previousState?.isAuthenticated ?? false,
    user: previousState?.user ?? null,
    isCheckingAuth: true,
  };
}

export function getAuthenticatedAuthState(user: AuthUser): AuthState {
  return {
    isAuthenticated: true,
    user,
    isCheckingAuth: false,
  };
}

export function resolveAuthStateFromMe(params: {
  meData?: LoginResponse;
  meError?: unknown;
  meLoading: boolean;
  previousState: AuthState;
}): AuthState {
  const { meData, meError, meLoading, previousState } = params;

  if (meLoading) {
    return getCheckingAuthState(previousState);
  }

  if (meData) {
    return getAuthenticatedAuthState(meData);
  }

  if (meError) {
    return getUnauthenticatedAuthState();
  }

  return {
    ...previousState,
    isCheckingAuth: false,
  };
}
