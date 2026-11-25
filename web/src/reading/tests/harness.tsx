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
import {
  ArchiveReader,
  blobSource,
  hashSource,
  sourceTask,
  sourceStats,
  sourceLimits,
  sourceScheduler,
} from '../source';
import { activityEvent } from '../activity';
import { zipFlags } from './zip-flags';
import { seedLegacyLibrary, legacyLibrary } from './legacy-library';
import { ReadingHTTPError } from '../types';
import type { ZipIndex } from '../source';
import { requireStableBody } from '../body-contract';
import { elementFromKO, primaryElementFromKO, koFromElement } from '../codec';
import { ReaderWakeLock } from '../wake-lock';
import { ReadingProvider, useReading } from '../provider';
import { ReaderScreen } from '../ReaderScreen';
import { SnackbarProvider } from '../../Snackbar';
import type { BookRef, Checkpoint, ReadingBridge, ReadingAccess, S } from '../types';
const root = createRoot(document.getElementById('root')!);
async function checkArchive(bytes: ArrayBuffer, signal?: AbortSignal) {
  const source = blobSource(new Blob([bytes])),
    index = await sourceTask<ZipIndex>(source, 'index', undefined, signal),
    reader = new ArchiveReader(source, index, signal);
  for (const entry of index.entries) await reader.bytes(entry.name);
  return reader;
}
function Projection() {
  const snapshot = useReading();
  return (
    <output id="projection">
      {JSON.stringify({
        titles: snapshot.books.map((b) => b.title),
        pending: snapshot.pendingCount,
        ready: snapshot.ready,
      })}
    </output>
  );
}
async function accountTurn(
  repo: Repository,
  ref: Extract<BookRef, { kind: 'server' }>,
  checkpoint?: Checkpoint,
  activity?: S['ActivityEvent'],
) {
  return repo.recordTurn(
    ref,
    { mode: 'account', deviceId: (await repo.device(ref.account)).id },
    checkpoint,
    activity,
    () => true,
  );
}
const testAPI = {
  seedLegacyLibrary,
  legacyLibrary,
  accountTurn,
  ReadingRuntime,
  stagingWorkers,
  ArchiveReader,
  blobSource,
  hashSource,
  sourceTask,
  sourceStats,
  sourceLimits,
  sourceScheduler,
  JSZip,
  zipFlags,
  activityEvent,
  ReadingHTTPError,
  ReaderController,
  lifecycle,
  validateEPUB,
  Repository,
  ReadingDB,
  Replay,
  checksum,
  checkArchive,
  requireStableBody,
  elementFromKO,
  primaryElementFromKO,
  koFromElement,
  ReaderWakeLock,
  unmount: () => root.render(null),
  project: (access: ReadingAccess, bridge: ReadingBridge) =>
    flushSync(() =>
      root.render(
        <ReadingProvider access={access} bridge={bridge} onSessionExpired={() => {}}>
          <Projection />
        </ReadingProvider>,
      ),
    ),
  mount: (bridge: ReadingBridge, book: BookRef, access: ReadingAccess = { kind: 'anonymous' }) =>
    root.render(
      <StrictMode>
        <ReadingProvider access={access} bridge={bridge} onSessionExpired={() => {}}>
          <SnackbarProvider>
            <ReaderScreen book={book} onClose={() => root.render(null)} />
          </SnackbarProvider>
        </ReadingProvider>
      </StrictMode>,
    ),
};
Object.assign(window, { readingTest: testAPI });
declare global {
  interface Window {
    readingTest: typeof testAPI;
  }
}
