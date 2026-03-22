export function getErrorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const errorWithResponse = error as {
      message?: unknown;
      response?: {
        data?: {
          message?: unknown;
        };
      };
    };

    const responseMessage = errorWithResponse.response?.data?.message;
    if (typeof responseMessage === 'string' && responseMessage.trim() !== '') {
      return responseMessage;
    }

    if (typeof errorWithResponse.message === 'string' && errorWithResponse.message.trim() !== '') {
      return errorWithResponse.message;
    }
  }

  return fallback;
}
