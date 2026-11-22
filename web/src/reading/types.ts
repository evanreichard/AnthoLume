import type { ReactNode } from 'react';
import type { components } from '../api/schema.gen';
export type S = components['schemas'];
export type Account = { origin: string; userId: string; readingGeneration?: string };
export type BookRef = { kind: 'local'; localId: string } | { kind: 'server'; account: Account; documentId: string };
export type ReadingAccess = { kind: 'loading' } | { kind: 'picker' } | { kind: 'anonymous' } | { kind: 'authenticated'; account: Account } | { kind: 'offline'; account: Account } | { kind: 'expired'; account: Account } | { kind: 'logout'; account: Account };
export type Checkpoint = { position: string | null; fraction: number | null };
export type StoredBook = { ref: BookRef; title: string | null; author: string | null; cover: Blob | null; pinned?: boolean; availability: 'available' | 'unavailable'; addedAt?: string; lastReadAt?: string; checkpoint: Checkpoint };
export type OfflineRecord = { id: string; scope: string; document: string; title: string; created: string; held?: true } & (
  { kind: 'progress'; checkpoint: { position: string; fraction: number } } | { kind: 'activity'; event: S['ActivityEvent'] }
);
export type ReviewDecision = 'upload' | 'keep' | 'discard';
export type OfflineChoice = { id: string; revision?: string };
export type SyncStatus = 'idle' | 'pending' | 'syncing' | 'auth-required' | 'retryable-error' | 'quota-error' | 'blocked';
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
  deviceCopies?: ReadonlyMap<string, 'cached' | 'saved'>;
  offlineRecords?: readonly OfflineRecord[];
  ready: boolean; resumeAccount: Account | null; books: readonly StoredBook[]; sync: SyncStatus; pendingCount: number; notice: string | null;
  downloads: readonly { ref: BookRef; receivedBytes: number; totalBytes: number | null; preparing?: boolean }[];
  workerError: string | null; error: string | null;
}
export type ReaderCacheSummary = { books: number; epubBytes: number; metadataBytes: number };
export interface ReadingActions {
  decideOffline(account: Account, choices: OfflineChoice[], decision: ReviewDecision): Promise<void>;
  forgetDrafts(account: Account): Promise<void>;
  cacheCover(ref: Extract<BookRef, { kind: 'server' }>, cover: Blob | null, mode?: 'backfill' | 'replace'): Promise<void>;
  removeFromDevice(ref: Extract<BookRef, { kind: 'server' }>, signal: AbortSignal): Promise<void>;
  saveToDevice(ref: Extract<BookRef, { kind: 'server' }>, signal: AbortSignal, metadata: Pick<StoredBook, 'title' | 'author'>): Promise<void>;
  readerCacheSummary(): Promise<ReaderCacheSummary>;
  clearReaderCache(): Promise<void>;
  replay(): Promise<void>;
  applyUpdate(): Promise<void>;
}
export type CoverLookup = (ref: Extract<BookRef, { kind: 'server' }>) => Blob | undefined;
export type ProviderProps = { access: ReadingAccess; bridge: ReadingBridge; lookupCover?: CoverLookup; onSessionExpired: (account: Account) => void; children: ReactNode };
// Separate UUID scopes from the older username scopes, even for usernames that look like UUIDs.
export function accountKey(account: Account): string { return JSON.stringify(['account', new URL(account.origin).origin, account.userId, ...(account.readingGeneration ? [account.readingGeneration] : [])]); }
export function refKey(ref: BookRef): string { return ref.kind === 'local' ? JSON.stringify(['local', ref.localId]) : JSON.stringify(['server', accountKey(ref.account), ref.documentId]); }
export function sameAccount(a: Account, b: Account) { return accountKey(a) === accountKey(b); }
