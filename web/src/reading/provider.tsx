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
    const instance = new ReadingRuntime(props.bridge, next => { if (active) setSnapshot(next); }, account => latest.current.onSessionExpired(account));
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
  const filtered: ReadingSnapshot = { ...snapshot, offlineRecords: currentProjection && props.access.kind === 'authenticated' ? snapshot.offlineRecords : [], ready: snapshot.ready && currentProjection, resumeAccount, ...(!currentProjection ? { pendingCount: 0, sync: 'idle' as const, error: null, notice: null } : {}), books: snapshot.books.filter(book => visible(book.ref)), downloads: snapshot.downloads.filter(d => visible(d.ref)), ...(!('account' in props.access) || props.access.kind === 'logout' ? { pendingCount: 0, sync: 'idle' as const } : {}) };
  return <ReadingContext.Provider value={{ runtime, access: props.access, snapshot: filtered }}>{props.children}</ReadingContext.Provider>;
}
export function useReadingContext() { const context = useContext(ReadingContext); if (!context) throw new Error('ReadingProvider is required'); return context; }
export function useReading(): ReadingSnapshot & ReadingActions {
  const { runtime, snapshot } = useReadingContext();
  const requireRuntime = () => { if (!runtime) throw new Error('Reader storage is opening'); return runtime; };
  return { ...snapshot,
    decideOffline: (account, choices, discard) => requireRuntime().decideOffline(account, choices, discard),
    forgetDrafts: account => requireRuntime().forgetDrafts(account),
    setPinned: (ref, pinned, signal, metadata) => requireRuntime().setPinned(ref, pinned, signal, metadata),
    readerCacheSummary: () => requireRuntime().readerCacheSummary(),
    clearReaderCache: () => requireRuntime().clearReaderCache(),
    replay: () => requireRuntime().replay(), applyUpdate: () => requireRuntime().applyUpdate(),
  };
}
