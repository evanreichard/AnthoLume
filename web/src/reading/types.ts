import type { ReactNode } from 'react';
import type { components } from '../api/schema.gen';
export type S = components['schemas'];
export type Account = { origin: string; userId: string };
export type BookRef = { kind: 'local'; localId: string } | { kind: 'server'; account: Account; documentId: string };
export type ReadingAccess = { kind: 'loading' } | { kind: 'anonymous' } | { kind: 'authenticated'; account: Account } | { kind: 'expired'; account: Account } | { kind: 'logout'; account: Account };
export type Checkpoint = { position: string | null; fraction: number | null };
export type StoredBook = { ref: BookRef; title: string | null; author: string | null; cover: Blob | null; availability: 'available' | 'unavailable'; addedAt?: string; lastReadAt?: string; checkpoint: Checkpoint };
export type Conflict = { eventId: string; ref: BookRef; local: Checkpoint; server: S['ReadingState'] };
export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'auth-required' | 'retryable-error' | 'conflict' | 'quota-error' | 'blocked';
export interface ReadingBridge {
  registerDevice(account: Account, device: S['Device'], signal: AbortSignal): Promise<S['Device']>;
  getState(account: Account, documentId: string, signal: AbortSignal): Promise<S['ReadingState']>;
  fetchFile(account: Account, documentId: string, signal: AbortSignal, etag?: string): Promise<Response>;
  fetchCover(account: Account, documentId: string, signal: AbortSignal): Promise<Response>;
  submitProgress(account: Account, event: S['ProgressEvent'], signal: AbortSignal): Promise<Delivery>;
  submitActivity(account: Account, event: S['ActivityEvent'], signal: AbortSignal): Promise<Delivery>;
}
export type Delivery = { status: number; body: unknown };
export class ReadingHTTPError extends Error {
  constructor(readonly status: number, readonly problem: S['Problem']) { super(problem.detail); this.name = 'ReadingHTTPError'; }
}
export interface ReadingSnapshot {
  ready: boolean; resumeAccount: Account | null; books: readonly StoredBook[]; sync: SyncStatus; pendingCount: number; conflicts: readonly Conflict[];
  downloads: readonly { ref: BookRef; receivedBytes: number; totalBytes: number | null; preparing?: boolean }[];
  update: 'idle' | 'available' | 'blocked' | 'error'; error: string | null;
}
export type ReaderCacheSummary = { books: number; epubBytes: number; metadataBytes: number };
export interface ReadingActions {
  readerCacheSummary(): Promise<ReaderCacheSummary>;
  clearReaderCache(): Promise<void>;
  exportLocal(ref: Extract<BookRef, { kind: 'local' }>): Promise<Blob>;
  replay(): Promise<void>;
  applyUpdate(): Promise<void>;
  refreshConflict(eventId: string): Promise<Conflict>;
  resolveConflict(eventId: string, choice: 'local' | 'server', observedRevision: string): Promise<void>;
}
export type ProviderProps = { access: ReadingAccess; bridge: ReadingBridge; onSessionExpired: (account: Account) => void; children: ReactNode };
export function accountKey(account: Account): string { return JSON.stringify([new URL(account.origin).origin, account.userId]); }
export function refKey(ref: BookRef): string { return ref.kind === 'local' ? JSON.stringify(['local', ref.localId]) : JSON.stringify(['server', accountKey(ref.account), ref.documentId]); }
export function sameAccount(a: Account, b: Account) { return accountKey(a) === accountKey(b); }
