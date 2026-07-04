// Extracts a display message from a caught error. The generated client throws ApiError (an Error
// subclass whose `message` is the server-provided message), so this covers both API and unexpected
// failures in a single catch path.
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
