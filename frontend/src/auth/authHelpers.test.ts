import { describe, expect, it } from 'vitest';
import {
  getCheckingAuthState,
  getUnauthenticatedAuthState,
  normalizeAuthenticatedUser,
  resolveAuthStateFromMe,
  validateAuthMutationResponse,
  type AuthState,
} from './authHelpers';

const previousState: AuthState = {
  isAuthenticated: false,
  user: null,
  isCheckingAuth: true,
};

describe('authHelpers', () => {
  it('normalizes a valid authenticated user payload', () => {
    expect(normalizeAuthenticatedUser({ username: 'evan', is_admin: true })).toEqual({
      username: 'evan',
      is_admin: true,
    });
  });

  it('rejects invalid authenticated user payloads', () => {
    expect(normalizeAuthenticatedUser(null)).toBeNull();
    expect(normalizeAuthenticatedUser({ username: 'evan' })).toBeNull();
    expect(normalizeAuthenticatedUser({ username: 123, is_admin: true })).toBeNull();
    expect(normalizeAuthenticatedUser({ username: 'evan', is_admin: 'yes' })).toBeNull();
  });

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
        meData: {
          status: 200,
          data: { username: 'evan', is_admin: false },
        },
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

  it('resolves auth state to unauthenticated on 401 or query error', () => {
    expect(
      resolveAuthStateFromMe({
        meData: {
          status: 401,
        },
        meError: undefined,
        meLoading: false,
        previousState,
      })
    ).toEqual(getUnauthenticatedAuthState());

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
        meData: {
          status: 204,
        },
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

  it('validates auth mutation responses by expected status and payload shape', () => {
    expect(
      validateAuthMutationResponse(
        {
          status: 200,
          data: { username: 'evan', is_admin: false },
        },
        200
      )
    ).toEqual({ username: 'evan', is_admin: false });

    expect(
      validateAuthMutationResponse(
        {
          status: 201,
          data: { username: 'evan', is_admin: false },
        },
        200
      )
    ).toBeNull();

    expect(
      validateAuthMutationResponse(
        {
          status: 200,
          data: { username: 'evan' },
        },
        200
      )
    ).toBeNull();
  });
});
