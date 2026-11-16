import { Repository, ReaderDB, accountScope, bookKey } from '../../reader-storage/src/storage';
import { SyncCoordinator } from '../../reader-storage/src/sync';
import type { Submission } from '../../reader-storage/src/wire';
import { proofClient } from '../../api-contract/client/client';
import { HTTPTransport } from './transport';

export type ServerState = {
  head: string; activities: number; seconds: number; opens: number; bytes: number; sha256: string; origin: string;
  receipts: { id: string; status: number; body: unknown }[];
  progress: { device: string; fraction: number; position: string }[];
  requests: { path: string; method: string; origin: string; cookie: boolean; csrf: boolean; status: number }[];
};

const repository = new Repository(new ReaderDB('antholume-m2-http-integration-v1'));
const scope = accountScope(location.origin, 'alice');
const transport = new HTTPTransport();
const coordinator = new SyncCoordinator(repository, transport, crypto.randomUUID(), Date.now);
const stamp = '2026-01-02T03:04:05Z';

async function control(key: string, operation: string, body: unknown = {}) {
  const response = await fetch(`/__fixture/${operation}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Fixture-Key': key }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Fixture ${operation}: ${response.status}`);
  return response;
}
async function boot(key: string) {
  const value: unknown = await (await control(key, 'session')).json();
  if (typeof value !== 'object' || value === null || !('account' in value) || value.account !== 'alice' || !('csrf' in value) || typeof value.csrf !== 'string' || !('origin' in value) || value.origin !== location.origin) throw new Error('Bad fixture bootstrap');
  transport.csrf = value.csrf;
  await repository.signIn(scope);
  return { origin: location.origin, scope };
}
async function hash(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
async function loadBook() {
  const client = proofClient(location.origin, transport.csrf);
  const listing = await client.documents();
  if (listing.response.status !== 200 || !listing.data) throw new Error('Authenticated list failed');
  const document = listing.data.items.find(item => item.id === 'book-a');
  if (!document) throw new Error('Synthetic document missing');
  const download = await client.download(document.id);
  if (download.response.status !== 200 || !download.data || download.data.type !== 'application/epub+zip') throw new Error('EPUB download failed');
  const bytes = await download.data.arrayBuffer();
  await repository.importBook(scope, document.id, document.title ?? 'Untitled', bytes);
  return { list: listing.data, bytes: bytes.byteLength, sha256: await hash(bytes), disposition: download.response.headers.get('Content-Disposition') };
}
function progressEvent(id: string, base: string, fraction: number, position: string): Submission {
  return { kind: 'progress', payload: { event_id: id, document_id: 'book-a', device_id: 'a-device', base_revision: base, fraction, position, observed_at: stamp } };
}
async function appendProgress(id: string, base: string, fraction: number, position = '/body/DocFragment[1]/body/p[1]') {
  await repository.accept(scope, 'book-a', position, progressEvent(id, base, fraction, position));
  return snapshot();
}
async function appendActivity(id: string) {
  const checkpoint = await repository.db.checkpoints.get(bookKey(scope, 'book-a'));
  await repository.accept(scope, 'book-a', checkpoint?.ko || '', { kind: 'activity', payload: {
    event_id: id, document_id: 'book-a', device_id: 'a-device', start_time: stamp,
    duration: 30, start_fraction: .2, end_fraction: .3,
  } });
  return snapshot();
}
async function snapshot() {
  return {
    events: (await repository.db.events.where('scope').equals(scope).sortBy('sequence')).map(event => ({ id: event.id, kind: event.kind, payload: event.payload })),
    access: await repository.db.access.get(scope),
    checkpoint: await repository.db.checkpoints.get(bookKey(scope, 'book-a')),
    deliveries: transport.deliveries.slice(),
  };
}
async function chooseLocal(oldID: string, newID: string, base: string, fraction: number, position: string) {
  const observed = transport.conflict;
  if (!observed || observed.id !== oldID || observed.revision !== base || oldID === newID) throw new Error('Explicit choice must name the observed conflict and a new ID');
  // Explicit Resolution - Repository currently exposes no resolution API. This harness-only transaction retires a chosen conflict, not an acknowledgement.
  await repository.db.transaction('rw', repository.db.books, repository.db.checkpoints, repository.db.events, repository.db.access, repository.db.leases, async () => {
    const event = await repository.db.events.get(oldID);
    const access = await repository.db.access.get(scope);
    const lease = await repository.db.leases.get(scope);
    if (!event || event.scope !== scope || event.kind !== 'progress' || !access?.authenticated || !access.visible || (lease && lease.until > Date.now())) throw new Error('Conflict missing, account paused or replay still leased');
    await repository.accept(scope, 'book-a', position, progressEvent(newID, base, fraction, position));
    await repository.db.events.delete(oldID);
    if (lease) await repository.db.leases.put({ ...lease, fence: lease.fence + 1, until: 0, ids: [] });
  });
  transport.conflict = undefined;
  return snapshot();
}
async function serverState(key: string): Promise<ServerState> {
  const response = await fetch('/__fixture/state', { headers: { 'X-Fixture-Key': key } });
  if (!response.ok) throw new Error(`Fixture state: ${response.status}`);
  return response.json();
}
async function openStored() {
  const book = await repository.open(scope, 'book-a');
  return { bytes: book.bytes.size, sha256: await hash(await book.bytes.arrayBuffer()) };
}
async function badCSRF() {
  const client = proofClient(location.origin, 'not-the-session-token');
  const event = progressEvent('bad-csrf', '0', .2, '/body/p[1]');
  if (event.kind !== 'progress') throw new Error('progress fixture');
  const result = await client.progress(event.payload);
  return { status: result.response.status, problem: result.error };
}

const integration = { boot, loadBook, appendProgress, appendActivity, replay: () => coordinator.replay(scope), snapshot, chooseLocal, serverState, control, openStored, badCSRF };
declare global { interface Window { integration: typeof integration } }
await repository.db.open();
window.integration = integration;
document.querySelector('#status')!.textContent = 'Actual Repository + SyncCoordinator + generated API client ready.';
