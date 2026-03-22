export interface AuthUser {
  username: string;
  is_admin: boolean;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: AuthUser | null;
  isCheckingAuth: boolean;
}

interface ResponseLike {
  status?: number;
  data?: unknown;
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

export function normalizeAuthenticatedUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (!('username' in value) || typeof value.username !== 'string') {
    return null;
  }

  if (!('is_admin' in value) || typeof value.is_admin !== 'boolean') {
    return null;
  }

  return {
    username: value.username,
    is_admin: value.is_admin,
  };
}

export function resolveAuthStateFromMe(params: {
  meData?: ResponseLike;
  meError?: unknown;
  meLoading: boolean;
  previousState: AuthState;
}): AuthState {
  const { meData, meError, meLoading, previousState } = params;

  if (meLoading) {
    return getCheckingAuthState(previousState);
  }

  if (meData?.status === 200) {
    const user = normalizeAuthenticatedUser(meData.data);
    if (user) {
      return getAuthenticatedAuthState(user);
    }
  }

  if (meError || meData?.status === 401) {
    return getUnauthenticatedAuthState();
  }

  return {
    ...previousState,
    isCheckingAuth: false,
  };
}

export function validateAuthMutationResponse(
  response: ResponseLike,
  expectedStatus: number
): AuthUser | null {
  if (response.status !== expectedStatus) {
    return null;
  }

  return normalizeAuthenticatedUser(response.data);
}
