import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ReadingRuntime, emptySnapshot } from './runtime';
import { sameAccount, type ProviderProps, type ReadingAccess, type ReadingActions, type ReadingSnapshot } from './types';

type Context = { runtime: ReadingRuntime | null; access: ReadingAccess; snapshot: ReadingSnapshot };
const ReadingContext = createContext<Context | null>(null);
export function ReadingProvider(props: ProviderProps): ReactNode {
  const [runtime, setRuntime] = useState<ReadingRuntime | null>(null), [snapshot, setSnapshot] = useState(emptySnapshot);
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    let active = true;
    const instance = new ReadingRuntime(props.bridge, next => { if (active) setSnapshot(next); }, account => latest.current.onSessionExpired(account), ref => latest.current.lookupCover?.(ref));
    setRuntime(instance);
    void instance.start(latest.current.access).catch(error => { if (active) setSnapshot(old => ({ ...old, ready: false, error: String(error) })); });
    return () => { active = false; instance.dispose(); };
  }, [props.bridge]);
  useLayoutEffect(() => { if (runtime) void runtime.setAccess(props.access); }, [runtime, props.access]);
  // Immediate Privacy - Render filtering does not wait for an IndexedDB transaction or an old asynchronous projection.
  const visible = (ref: ReadingSnapshot['books'][number]['ref']) => ref.kind === 'local' || ('account' in props.access && props.access.kind !== 'logout' && sameAccount(ref.account, props.access.account));
  const projection = runtime?.projectionAccess;
  const currentProjection = projection?.kind === props.access.kind && (!('account' in props.access) || projection && 'account' in projection && sameAccount(projection.account, props.access.account));
  const resumeAccount = snapshot.resumeAccount && 'account' in props.access && !sameAccount(snapshot.resumeAccount, props.access.account) ? null : snapshot.resumeAccount;
  const filtered: ReadingSnapshot = { ...snapshot, deviceCopies: currentProjection ? snapshot.deviceCopies : undefined, offlineRecords: currentProjection && props.access.kind === 'authenticated' ? snapshot.offlineRecords : [], ready: snapshot.ready && currentProjection, resumeAccount, ...(!currentProjection ? { pendingCount: 0, sync: 'idle' as const, error: null, notice: null } : {}), books: snapshot.books.filter(book => visible(book.ref)), downloads: snapshot.downloads.filter(d => visible(d.ref)), ...(!('account' in props.access) || props.access.kind === 'logout' ? { pendingCount: 0, sync: 'idle' as const } : {}) };
  return <ReadingContext.Provider value={{ runtime, access: props.access, snapshot: filtered }}>{props.children}</ReadingContext.Provider>;
}
export function useReadingContext() { const context = useContext(ReadingContext); if (!context) throw new Error('ReadingProvider is required'); return context; }
const ignoreCover = async () => {};
export function useReading(): ReadingSnapshot & ReadingActions {
  const { runtime, snapshot } = useReadingContext();
  const requireRuntime = () => { if (!runtime) throw new Error('Reader storage is opening'); return runtime; };
  return { ...snapshot,
    decideOffline: (account, choices, decision) => requireRuntime().decideOffline(account, choices, decision),
    updateDownloadMetadata: (ref, metadata, cover) => requireRuntime().updateDownloadMetadata(ref, metadata, cover),
    saveToDevice: (ref, signal, metadata) => requireRuntime().saveToDevice(ref, signal, metadata),
    cacheCover: runtime?.cacheCover ?? ignoreCover,
    removeFromDevice: (ref, signal) => requireRuntime().removeFromDevice(ref, signal),
    readerCacheSummary: () => requireRuntime().readerCacheSummary(),
    clearReaderCache: () => requireRuntime().clearReaderCache(),
    replay: () => requireRuntime().replay(), applyUpdate: () => requireRuntime().applyUpdate(),
  };
}
