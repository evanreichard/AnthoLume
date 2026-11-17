import createClient from 'openapi-fetch';
import type { paths, components } from './schema.gen';
import { ReadingHTTPError, type Account, type ReadingBridge } from '../reading';
import { InvalidResponse, isCapabilities, isDevice, isDocument, isPage, isProblem, isSession, isState, validated } from './validate';

type S = components['schemas'];
const configuredOrigin = new URL(import.meta.env.VITE_API_ORIGIN || window.location.origin);
export const apiOrigin = configuredOrigin.origin;
if (apiOrigin !== window.location.origin || configuredOrigin.pathname !== '/' || configuredOrigin.search || configuredOrigin.hash || configuredOrigin.username || configuredOrigin.password) throw new Error('VITE_API_ORIGIN must be the browser public origin. Configure the loopback proxy/PUBLIC_ORIGIN, not cross-origin credentials.');
export const sameAccount = (a: Account, b: Account) => a.origin === b.origin && a.userId === b.userId;
export interface SessionGate {
  token(): string | null;
  epoch(): number;
  assert(account: Account, epoch: number): void;
  expired(account: Account): void;
}

export function createAPI(gate: SessionGate) {
  const client = createClient<paths>({
    baseUrl: apiOrigin,
    credentials: 'same-origin',
    cache: 'no-store',
    fetch: (request: Request) => {
      if (!['GET', 'HEAD'].includes(request.method)) {
        const token = gate.token();
        if (!token) throw new Error('Connect to the server before signing in.');
        request.headers.set('X-CSRF-Token', token);
      }
      request.headers.set('Accept', 'application/json, application/problem+json');
      return fetch(request);
    },
  });
  async function consume<T>(pending: () => Promise<{ response: Response; error?: unknown }>, guard: (value: unknown) => value is T, expected: number, account?: Account, epoch = gate.epoch()): Promise<T> {
    if (account) gate.assert(account, epoch);
    const { response, error } = await pending();
    if (account) gate.assert(account, epoch);
    if (response.redirected) throw new InvalidResponse();
    const media = response.headers.get('content-type')?.split(';')[0].trim();
    if (media !== (response.ok ? 'application/json' : 'application/problem+json')) throw new InvalidResponse();
    let body: unknown;
    try { body = response.ok ? await response.json() : error; } catch { throw new InvalidResponse(); }
    if (account) gate.assert(account, epoch);
    if (!response.ok) {
      const problem = validated(body, isProblem);
      if (problem.status !== response.status) throw new InvalidResponse();
      if (response.status === 401 && problem.code === 'unauthenticated' && account) gate.expired(account);
      throw new ReadingHTTPError(response.status, problem);
    }
    if (response.status !== expected) throw new InvalidResponse();
    return validated(body, guard);
  }
  const path = (id: string) => ({ path: { id } });
  const api = {
    session: (signal?: AbortSignal) => consume(() => client.GET('/api/v1/session', { signal, parseAs: 'stream' }), isSession, 200),
    capabilities: (signal?: AbortSignal) => consume(() => client.GET('/api/v1/capabilities', { signal, parseAs: 'stream' }), isCapabilities, 200),
    login: (credentials: { username: string; password: string }) => consume(() => client.POST('/api/v1/session/login', { body: credentials, parseAs: 'stream' }), isSession, 200),
    register: (credentials: { username: string; password: string }) => consume(() => client.POST('/api/v1/session/register', { body: credentials, parseAs: 'stream' }), isSession, 201),
    logout: () => consume(() => client.POST('/api/v1/session/logout', { body: {}, parseAs: 'stream' }), isSession, 200),
    documents: async (account: Account, page: number, q: string, signal: AbortSignal) => {
      const result = await consume(() => client.GET('/api/v1/documents', { params: { query: { page, page_size: 24, ...(q ? { q } : {}) } }, signal, parseAs: 'stream' }), isPage, 200, account);
      if (result.page !== page || result.page_size !== 24) throw new InvalidResponse();
      return result;
    },
    document: (account: Account, id: string, signal: AbortSignal) => consume(() => client.GET('/api/v1/documents/{id}', { params: path(id), signal, parseAs: 'stream' }), isDocument, 200, account),
  };
  async function binary(account: Account, id: string, kind: 'file' | 'cover', signal: AbortSignal) {
    const epoch = gate.epoch();
    gate.assert(account, epoch);
    const response = await fetch(`${apiOrigin}/api/v1/documents/${encodeURIComponent(id)}/${kind}`, { credentials: 'same-origin', cache: 'no-store', signal });
    try { gate.assert(account, epoch); } catch (error) { await response.body?.cancel(); throw error; }
    if (response.status === 401 && !response.redirected && response.headers.get('content-type')?.split(';')[0].trim() === 'application/problem+json') {
      const problem: unknown = await response.clone().json().catch(() => null);
      gate.assert(account, epoch);
      if (isProblem(problem) && problem.status === response.status && problem.code === 'unauthenticated') gate.expired(account);
    }
    return response;
  }
  async function deliver(account: Account, event: S['ProgressEvent'] | S['ActivityEvent'], kind: 'progress' | 'activity', signal: AbortSignal) {
    const epoch = gate.epoch();
    gate.assert(account, epoch);
    const pending = kind === 'progress'
      ? client.POST('/api/v1/me/reading-progress', { body: event as S['ProgressEvent'], signal, parseAs: 'stream' })
      : client.POST('/api/v1/me/activity', { body: event as S['ActivityEvent'], signal, parseAs: 'stream' });
    const { response, error } = await pending;
    gate.assert(account, epoch);
    let body: unknown = null;
    try {
      if (!response.redirected && response.headers.get('content-type')?.split(';')[0].trim() === (response.ok ? 'application/json' : 'application/problem+json')) body = response.ok ? await response.json() : error;
    } catch { /* Untrusted Delivery - The reader must retain events on malformed acknowledgements. */ }
    gate.assert(account, epoch);
    return { status: response.status, body };
  }
  const bridge: ReadingBridge = {
    registerDevice: async (account, device, signal) => {
      const result = await consume(() => client.POST('/api/v1/me/devices', { body: device, signal, parseAs: 'stream' }), isDevice, 200, account);
      if (result.id !== device.id) throw new InvalidResponse();
      return result;
    },
    getState: async (account, documentId, signal) => {
      const result = await consume(() => client.GET('/api/v1/me/reading-state/{document_id}', { params: { path: { document_id: documentId } }, signal, parseAs: 'stream' }), isState, 200, account);
      if (result.document_id !== documentId) throw new InvalidResponse();
      return result;
    },
    fetchFile: (account, documentId, signal) => binary(account, documentId, 'file', signal),
    fetchCover: (account, documentId, signal) => binary(account, documentId, 'cover', signal),
    submitProgress: (account, event, signal) => deliver(account, event, 'progress', signal),
    submitActivity: (account, event, signal) => deliver(account, event, 'activity', signal),
  };
  return { ...api, bridge };
}
export type API = ReturnType<typeof createAPI>;
