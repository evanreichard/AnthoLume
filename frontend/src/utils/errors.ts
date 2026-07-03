export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message.trim() !== '') {
      return message;
    }
  }

  return fallback;
}

export interface ApiResponseLike {
  status: number;
  data: unknown;
}

/**
 * Non-2xx Check - The generated client resolves non-2xx instead of throwing; this returns the
 * extracted error message for failure responses, or null for success (2xx) so callers can branch.
 */
export function getResponseError(response: ApiResponseLike): string | null {
  if (response.status >= 200 && response.status < 300) {
    return null;
  }

  return getErrorMessage(response.data, 'Request failed');
}
