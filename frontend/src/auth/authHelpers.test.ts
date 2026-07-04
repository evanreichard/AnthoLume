import { describe, expect, it } from 'vitest';
import {
  getCheckingAuthState,
  getUnauthenticatedAuthState,
  resolveAuthStateFromMe,
  type AuthState,
} from './authHelpers';

const previousState: AuthState = {
  isAuthenticated: false,
  user: null,
  isCheckingAuth: true,
};

describe('authHelpers', () => {
  it('returns a checking state while preserving previous auth information', () => {
    expect(
      getCheckingAuthState({
        isAuthenticated: true,
        user: { username: 'evan', is_admin: false },
        isCheckingAuth: false,
      })
    ).toEqual({
      isAuthenticated: true,
      user: { username: 'evan', is_admin: false },
      isCheckingAuth: true,
    });
  });

  it('resolves auth state from a successful /auth/me response', () => {
    expect(
      resolveAuthStateFromMe({
        meData: { username: 'evan', is_admin: false },
        meError: undefined,
        meLoading: false,
        previousState,
      })
    ).toEqual({
      isAuthenticated: true,
      user: { username: 'evan', is_admin: false },
      isCheckingAuth: false,
    });
  });

  it('resolves auth state to unauthenticated when the me query errors (e.g. 401)', () => {
    expect(
      resolveAuthStateFromMe({
        meData: undefined,
        meError: new Error('failed'),
        meLoading: false,
        previousState,
      })
    ).toEqual(getUnauthenticatedAuthState());
  });

  it('keeps checking state while /auth/me is still loading', () => {
    expect(
      resolveAuthStateFromMe({
        meData: undefined,
        meError: undefined,
        meLoading: true,
        previousState: {
          isAuthenticated: true,
          user: { username: 'evan', is_admin: true },
          isCheckingAuth: false,
        },
      })
    ).toEqual({
      isAuthenticated: true,
      user: { username: 'evan', is_admin: true },
      isCheckingAuth: true,
    });
  });

  it('returns the previous state with checking disabled when there is no decisive me result', () => {
    expect(
      resolveAuthStateFromMe({
        meData: undefined,
        meError: undefined,
        meLoading: false,
        previousState: {
          isAuthenticated: false,
          user: null,
          isCheckingAuth: true,
        },
      })
    ).toEqual({
      isAuthenticated: false,
      user: null,
      isCheckingAuth: false,
    });
  });
});
