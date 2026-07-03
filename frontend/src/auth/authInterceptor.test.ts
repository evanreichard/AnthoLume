import { describe, expect, it } from 'vitest';
import { setupAuthInterceptors } from './authInterceptor';

describe('setupAuthInterceptors', () => {
  it('is a no-op when auth is handled by HttpOnly cookies', () => {
    const cleanup = setupAuthInterceptors();

    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });
});
