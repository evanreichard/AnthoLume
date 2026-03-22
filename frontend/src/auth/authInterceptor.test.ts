import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupAuthInterceptors, TOKEN_KEY } from './authInterceptor';

type RequestConfig = {
  headers?: Record<string, string>;
};

type ResponseValue = {
  status?: number;
  data?: unknown;
};

type ResponseError = {
  response?: {
    status?: number;
  };
};

function createMockAxiosInstance() {
  let nextRequestId = 1;
  let nextResponseId = 1;

  const requestHandlers = new Map<
    number,
    [(config: RequestConfig) => RequestConfig, (error: unknown) => Promise<never>]
  >();
  const responseHandlers = new Map<
    number,
    [(response: ResponseValue) => ResponseValue, (error: ResponseError) => Promise<never>]
  >();

  return {
    interceptors: {
      request: {
        use: vi.fn((fulfilled, rejected) => {
          const id = nextRequestId++;
          requestHandlers.set(id, [fulfilled, rejected]);
          return id;
        }),
        eject: vi.fn((id: number) => {
          requestHandlers.delete(id);
        }),
      },
      response: {
        use: vi.fn((fulfilled, rejected) => {
          const id = nextResponseId++;
          responseHandlers.set(id, [fulfilled, rejected]);
          return id;
        }),
        eject: vi.fn((id: number) => {
          responseHandlers.delete(id);
        }),
      },
    },
    getRequestHandler(id = 1) {
      return requestHandlers.get(id);
    },
    getResponseHandler(id = 1) {
      return responseHandlers.get(id);
    },
  };
}

describe('setupAuthInterceptors', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('registers request and response interceptors and adds the auth header when a token exists', () => {
    const axiosInstance = createMockAxiosInstance();

    setupAuthInterceptors(axiosInstance as never);

    expect(axiosInstance.interceptors.request.use).toHaveBeenCalledTimes(1);
    expect(axiosInstance.interceptors.response.use).toHaveBeenCalledTimes(1);

    localStorage.setItem(TOKEN_KEY, 'token-123');

    const requestHandler = axiosInstance.getRequestHandler()?.[0];
    const config: { headers: Record<string, string> } = { headers: {} };
    const nextConfig = requestHandler?.(config);

    expect(nextConfig).toBe(config);
    expect(config.headers.Authorization).toBe('Bearer token-123');
  });

  it('clears the auth token on 401 responses', async () => {
    const axiosInstance = createMockAxiosInstance();
    setupAuthInterceptors(axiosInstance as never);

    localStorage.setItem(TOKEN_KEY, 'token-123');

    const responseErrorHandler = axiosInstance.getResponseHandler()?.[1];

    await expect(responseErrorHandler?.({ response: { status: 401 } })).rejects.toEqual({
      response: { status: 401 },
    });
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('ejects previous interceptors before installing a new set', () => {
    const firstInstance = createMockAxiosInstance();
    const secondInstance = createMockAxiosInstance();

    const cleanup = setupAuthInterceptors(firstInstance as never);
    setupAuthInterceptors(secondInstance as never);

    expect(firstInstance.interceptors.request.eject).toHaveBeenCalledWith(1);
    expect(firstInstance.interceptors.response.eject).toHaveBeenCalledWith(1);

    cleanup();
    expect(firstInstance.interceptors.request.eject).toHaveBeenCalledWith(1);
    expect(firstInstance.interceptors.response.eject).toHaveBeenCalledWith(1);
  });
});
