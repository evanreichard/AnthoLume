import type {
  getMeResponse,
  loginResponse,
  registerResponse,
} from '../generated/anthoLumeAPIV1';
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
  meData?: getMeResponse;
  meError?: unknown;
  meLoading: boolean;
  previousState: AuthState;
}): AuthState {
  const { meData, meError, meLoading, previousState } = params;

  if (meLoading) {
    return getCheckingAuthState(previousState);
  }

  if (meData?.status === 200) {
    return getAuthenticatedAuthState(meData.data);
  }

  if (meError || meData?.status === 401) {
    return getUnauthenticatedAuthState();
  }

  return {
    ...previousState,
    isCheckingAuth: false,
  };
}

export function authUserFromMutation(
  response: loginResponse | registerResponse
): AuthUser | null {
  return response.status === 200 || response.status === 201 ? response.data : null;
}
