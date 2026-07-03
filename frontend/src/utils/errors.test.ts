import { describe, expect, it } from 'vitest';
import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(getErrorMessage(new Error('Boom'))).toBe('Boom');
  });

  it('reads the top-level message from API error bodies', () => {
    expect(getErrorMessage({ code: 401, message: 'Unauthorized' })).toBe('Unauthorized');
  });

  it('uses the fallback for null, empty, and unknown values', () => {
    expect(getErrorMessage(null, 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage(undefined, 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage({}, 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage({ message: '   ' }, 'Fallback message')).toBe('Fallback message');
  });
});
