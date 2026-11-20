import { StrictMode } from 'react';
import JSZip from 'jszip';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ReaderController, lifecycle } from '../controller';
import { validateEPUB } from '../content-policy';
import { Repository, ReadingDB, checksum } from '../repository';
import { Replay } from '../sync';
import { ReadingRuntime } from '../runtime';
import { stagingWorkers } from '../staging-writer';
import { ArchiveReader, blobSource, hashSource, sourceTask, sourceStats, sourceLimits, sourceScheduler } from '../source';
import { activityEvent } from '../activity';
import { zipFlags } from './zip-flags';
import { ReadingHTTPError } from '../types';
import type { ZipIndex } from '../source';
import { requireStableBody } from '../body-contract';
import { elementFromKO, primaryElementFromKO, koFromElement } from '../codec';
import { ReaderWakeLock } from '../wake-lock';
import { ReadingProvider, useReading } from '../provider';
import { ReaderScreen } from '../ReaderScreen';
import type { BookRef, ReadingBridge, ReadingAccess } from '../types';
const root = createRoot(document.getElementById('root')!);
async function checkArchive(bytes: ArrayBuffer, signal?: AbortSignal) { const source = blobSource(new Blob([bytes])), index = await sourceTask<ZipIndex>(source, 'index', undefined, signal), reader = new ArchiveReader(source, index, signal); for (const entry of index.entries) await reader.bytes(entry.name); return reader; }
function SyncProjection() { const reading = useReading(); return <><output id="sync-projection">{JSON.stringify({ ready: reading.ready, sync: reading.sync, pending: reading.pendingCount, conflicts: reading.conflicts, error: reading.error })}</output><button onClick={() => void reading.replay()}>Retry synchronization</button></>; }
function Projection() { const snapshot = useReading(); return <output id="projection">{JSON.stringify({ titles: snapshot.books.map(b => b.title), pending: snapshot.pendingCount, conflicts: snapshot.conflicts.length, ready: snapshot.ready })}</output>; }
const testAPI = { ReadingRuntime, stagingWorkers, ArchiveReader, blobSource, hashSource, sourceTask, sourceStats, sourceLimits, sourceScheduler, JSZip, zipFlags, activityEvent, ReadingHTTPError, ReaderController, lifecycle, validateEPUB, Repository, ReadingDB, Replay, checksum, checkArchive, requireStableBody, elementFromKO, primaryElementFromKO, koFromElement, ReaderWakeLock,
  unmount: () => root.render(null),
  showSync: (account: import('../types').Account, bridge: ReadingBridge) => root.render(<ReadingProvider access={{ kind: 'authenticated', account }} bridge={bridge} onSessionExpired={() => {}}><SyncProjection /></ReadingProvider>),
  project: (access: ReadingAccess, bridge: ReadingBridge) => flushSync(() => root.render(<ReadingProvider access={access} bridge={bridge} onSessionExpired={() => {}}><Projection /></ReadingProvider>)),
  mount: (bridge: ReadingBridge, book: BookRef, access: ReadingAccess = { kind: 'anonymous' }) => root.render(<StrictMode><ReadingProvider access={access} bridge={bridge} onSessionExpired={() => {}}><ReaderScreen book={book} onClose={() => root.render(null)} /></ReadingProvider></StrictMode>),
};
Object.assign(window, { readingTest: testAPI });
declare global { interface Window { readingTest: typeof testAPI } }
