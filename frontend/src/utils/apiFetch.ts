import type { ErrorResponse } from '../generated/model';

// Thrown by the generated API client for any non-2xx response. `body` is the parsed error payload
// (the API's ErrorResponse for documented failures); `message` is the server-provided message when
// present, so `error.message` is always display-ready.
export class ApiError<TBody = ErrorResponse> extends Error {
  readonly status: number;
  readonly body: TBody;

  constructor(status: number, body: TBody, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

const EMPTY_BODY_STATUSES = new Set([204, 205, 304]);

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body as { message?: unknown };
    if (typeof message === 'string' && message.trim() !== '') {
      return message;
    }
  }
  return fallback;
}

async function parseBody(response: Response): Promise<unknown> {
  if (EMPTY_BODY_STATUSES.has(response.status)) {
    return undefined;
  }

  const raw = await response.text();
  if (!raw) {
    return undefined;
  }

  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? JSON.parse(raw) : raw;
}

// Orval mutator - The generated client calls this for every request. Returns the parsed success
// body directly and throws ApiError on non-2xx, so React Query surfaces failures via isError/onError.
export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(response.status, body, messageFromBody(body, response.statusText || 'Request failed'));
  }

  return body as T;
}
