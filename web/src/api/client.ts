import createClient from 'openapi-fetch';
import type { paths, components, operations } from './schema.gen';
import { ReadingHTTPError, type Account, type ReadingBridge } from '../reading';
import { InvalidResponse, isMakeLibraryPlan, isAdminAutoImport, isAdminRestore, isStorageRoots, isStorageDirectories, isBackupPreview, isAdminLogs, isImportPreview, isImportResults, isAdminJob, isAdminJobs, isAdminSystem, isAdminUser, isAdminUsers, isCapabilities, isDevice, isDocument, isInsights, isMetadataMatches, isManagedDevice, isManagedDevices, isInsightActivity, isInsightProgress, isInsightRankings, isPage, isProblem, isSession, isState, validated } from './validate';

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
    if (expected === 204 && response.status === 204) return validated(null, guard);
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
    updatePreferences: (account: Account, timezone: string) => consume(() => client.PATCH('/api/v1/me/preferences', { body: { timezone }, parseAs: 'stream' }), isSession, 200, account),
    changePassword: (account: Account, body: S['PasswordChange']) => consume(() => client.POST('/api/v1/me/password', { body, parseAs: 'stream' }), isSession, 200, account),
    adminUsers: (account: Account, after: string, signal: AbortSignal) => consume(() => client.GET('/api/v1/admin/users', { signal, params: { query: { after } }, parseAs: 'stream' }), isAdminUsers, 200, account),
    createAdminUser: (account: Account, body: S['AdminUserCreate']) => consume(() => client.POST('/api/v1/admin/users', { body, parseAs: 'stream' }), isAdminUser, 201, account),
    updateAdminUser: (account: Account, id: string, body: S['AdminUserUpdate']) => consume(() => client.PATCH('/api/v1/admin/users/{id}', { params: path(id), body, parseAs: 'stream' }), isAdminUser, 200, account),
    deleteAdminUser: (account: Account, id: string) => consume(() => client.DELETE('/api/v1/admin/users/{id}', { params: path(id), parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    adminJobs: (account: Account, kind: S['AdminJob']['kind'], signal: AbortSignal) => consume(() => client.GET('/api/v1/admin/jobs', { params: { query: { kind } }, signal, parseAs: 'stream' }), isAdminJobs, 200, account),
    startAdminJob: (account: Account, kind: S['AdminJob']['kind'], options?: Omit<operations['startAdminJob']['requestBody']['content']['application/json'], 'kind'>) => consume(() => client.POST('/api/v1/admin/jobs', { body: { kind, ...options }, parseAs: 'stream' }), isAdminJob, 202, account),
    adminStorageRoots: (account: Account, signal?: AbortSignal) => consume(() => client.GET('/api/v1/admin/storage-roots', { signal, parseAs: 'stream' }), isStorageRoots, 200, account),
    saveAdminStorageRoot: (account: Account, body: S['AdminStorageRootInput']) => consume(() => client.PUT('/api/v1/admin/storage-roots', { body, parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    previewMakeLibrary: (account: Account, id: string, path: string, signal?: AbortSignal) => consume(() => client.GET('/api/v1/admin/storage-roots/make-library', { params: { query: { id, path } }, signal, parseAs: 'stream' }), isMakeLibraryPlan, 200, account),
    makeLibrary: (account: Account, body: S['MakeLibraryPlan']) => consume(() => client.POST('/api/v1/admin/storage-roots/make-library', { body, parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    adminAutoImports: (account: Account, signal?: AbortSignal) => consume(() => client.GET('/api/v1/admin/auto-import', { signal, parseAs: 'stream' }), isAdminAutoImport, 200, account),
    saveAdminAutoImport: (account: Account, body: S['AdminAutoImportSettings'], id?: string) => consume(() => client.PUT('/api/v1/admin/auto-import', { params: { query: { id } }, body, parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    queueAdminAutoImport: (account: Account, id: string) => consume(() => client.POST('/api/v1/admin/auto-import', { params: { query: { id } }, body: {}, parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    deleteAdminAutoImport: (account: Account, id: string) => consume(() => client.DELETE('/api/v1/admin/auto-import', { params: { query: { id } }, parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    adminStorageDirectories: (account: Account, path: string, signal?: AbortSignal) => consume(() => client.GET('/api/v1/admin/storage-directories', { signal, params: { query: { path } }, parseAs: 'stream' }), isStorageDirectories, 200, account),
    previewAdminBackup: (account: Account, signal?: AbortSignal) => consume(() => client.GET('/api/v1/admin/backup/preview', { signal, parseAs: 'stream' }), isBackupPreview, 200, account),
    previewAdminImport: (account: Account, root_id: string) => consume(() => client.GET('/api/v1/admin/import', { params: { query: { root_id } }, parseAs: 'stream' }), isImportPreview, 200, account),
    adminImportResults: (account: Account, job: string, signal: AbortSignal) => consume(() => client.GET('/api/v1/admin/import/results', { params: { query: { job } }, signal, parseAs: 'stream' }), isImportResults, 200, account),
    adminLogs: (account: Account, params: { cursor?: string; q?: string; level?: S['AdminLogLevel'] }, signal: AbortSignal) => consume(() => client.GET('/api/v1/admin/logs', { params: { query: params }, signal, parseAs: 'stream' }), isAdminLogs, 200, account),
    stageAdminRestore: (account: Account, file: File) => consume(() => client.POST('/api/v1/admin/restore', { body: file, bodySerializer: value => value, headers: { 'Content-Type': 'application/octet-stream' }, parseAs: 'stream' }), isAdminRestore, 200, account),
    applyAdminRestore: (account: Account, body: S['AdminRestoreApply']) => consume(() => client.PATCH('/api/v1/admin/restore', { body, parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    adminSystem: (account: Account, signal: AbortSignal) => consume(() => client.GET('/api/v1/admin/system', { signal, parseAs: 'stream' }), isAdminSystem, 200, account),
    devices: (account: Account, signal: AbortSignal) => consume(() => client.GET('/api/v1/me/devices', { signal, parseAs: 'stream' }), isManagedDevices, 200, account),
    updateDevice: (account: Account, id: string, body: S['DevicePreferences']) => consume(() => client.PATCH('/api/v1/me/devices/{id}', { params: path(id), body, parseAs: 'stream' }), isManagedDevice, 200, account),
    insights: (account: Account, signal: AbortSignal) => consume(() => client.GET('/api/v1/me/insights', { signal, parseAs: 'stream' }), isInsights, 200, account),
    insightActivity: (account: Account, query: { page?: number; day?: string; document?: string }, signal: AbortSignal) => consume(() => client.GET('/api/v1/me/insights/activity', { params: { query }, signal, parseAs: 'stream' }), isInsightActivity, 200, account),
    insightProgress: (account: Account, page: number, signal: AbortSignal) => consume(() => client.GET('/api/v1/me/insights/progress', { params: { query: { page } }, signal, parseAs: 'stream' }), isInsightProgress, 200, account),
    insightRankings: (account: Account, query: NonNullable<operations['listInsightRankings']['parameters']['query']>, signal: AbortSignal) => consume(() => client.GET('/api/v1/insights/rankings', { params: { query }, signal, parseAs: 'stream' }), isInsightRankings, 200, account),
    documents: async (account: Account, page: number, q: string, sort: 'title' | 'author' | 'added' | 'read', signal: AbortSignal, resumable = false) => {
      const result = await consume(() => client.GET('/api/v1/documents', { params: { query: { page, page_size: 24, sort, ...(resumable ? { resumable: true } : {}), ...(q ? { q } : {}) } }, signal, parseAs: 'stream' }), isPage, 200, account);
      if (result.page !== page || result.page_size !== 24) throw new InvalidResponse();
      return result;
    },
    uploadDocument: (account: Account, file: File, signal: AbortSignal) => consume(() => client.POST('/api/v1/documents', {
      body: file, bodySerializer: value => value, headers: { 'Content-Type': 'application/epub+zip' }, signal, parseAs: 'stream',
    }), isDocument, 200, account),
    editDocument: (account: Account, id: string, body: S['DocumentEdit'], signal: AbortSignal) => consume(() => client.PATCH('/api/v1/documents/{id}', { params: path(id), body, signal, parseAs: 'stream' }), isDocument, 200, account),
    deleteDocument: (account: Account, id: string, signal: AbortSignal) => consume(() => client.DELETE('/api/v1/documents/{id}', { params: path(id), signal, parseAs: 'stream' }), (value): value is null => value === null, 204, account),
    lookupMetadata: (account: Account, q: string, signal: AbortSignal) => consume(() => client.GET('/api/v1/metadata/search', { params: { query: { q } }, signal, parseAs: 'stream' }), isMetadataMatches, 200, account),
    document: (account: Account, id: string, signal: AbortSignal) => consume(() => client.GET('/api/v1/documents/{id}', { params: path(id), signal, parseAs: 'stream' }), isDocument, 200, account),
  };
  async function binary(account: Account, id: string, kind: 'file' | 'cover', signal: AbortSignal, etag?: string) {
    const epoch = gate.epoch();
    gate.assert(account, epoch);
    const response = await fetch(`${apiOrigin}/api/v1/documents/${encodeURIComponent(id)}/${kind}`, { credentials: 'same-origin', cache: 'no-store', signal, headers: etag ? { 'If-None-Match': etag } : undefined });
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
    fetchFile: (account, documentId, signal, etag) => binary(account, documentId, 'file', signal, etag),
    fetchCover: (account, documentId, signal) => binary(account, documentId, 'cover', signal),
    submitProgress: (account, event, signal) => deliver(account, event, 'progress', signal),
    submitActivity: (account, event, signal) => deliver(account, event, 'activity', signal),
  };
  return { ...api, bridge };
}
export type API = ReturnType<typeof createAPI>;
