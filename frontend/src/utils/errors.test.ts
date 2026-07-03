import { describe, expect, it } from 'vitest';
import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('returns Error.message for Error instances', () => {
    expect(getErrorMessage(new Error('Boom'))).toBe('Boom');
  });

  it('prefers response.data.message over top-level message', () => {
    expect(
      getErrorMessage({
        message: 'Top-level message',
        response: {
          data: {
            message: 'Response message',
          },
        },
      })
    ).toBe('Response message');
  });

  it('falls back to top-level message when response.data.message is unavailable', () => {
    expect(
      getErrorMessage({
        message: 'Top-level message',
      })
    ).toBe('Top-level message');
  });

  it('uses the fallback for null, empty, and unknown values', () => {
    expect(getErrorMessage(null, 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage(undefined, 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage({}, 'Fallback message')).toBe('Fallback message');
    expect(getErrorMessage({ message: '   ' }, 'Fallback message')).toBe('Fallback message');
    expect(
      getErrorMessage(
        {
          response: {
            data: {
              message: '',
            },
          },
        },
        'Fallback message'
      )
    ).toBe('Fallback message');
  });
});
