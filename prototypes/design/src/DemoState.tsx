import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { books, type Book } from './data';

export type SyncState = 'pending' | 'auth' | 'quota' | 'conflict' | 'retry' | 'unavailable';
export type ReaderSession = {
  chapter: number;
  size: number;
  font: string;
  paper: string;
  chrome: boolean;
};
export const defaultReaderSession: ReaderSession = {
  chapter: 0,
  size: 20,
  font: 'serif',
  paper: 'auto',
  chrome: true,
};

type DemoState = {
  readerSessions: Record<string, ReaderSession>;
  updateReaderSession: (bookId: string, patch: Partial<ReaderSession>) => void;
  forgetReaderSession: (bookId: string) => void;
  memberRemoved: boolean;
  setMemberRemoved: (value: boolean) => void;
  signedIn: boolean;
  setSignedIn: (value: boolean) => void;
  downloads: string[];
  setDownloads: React.Dispatch<React.SetStateAction<string[]>>;
  items: Book[];
  setItems: React.Dispatch<React.SetStateAction<Book[]>>;
  sync: SyncState;
  setSync: (value: SyncState) => void;
  resolution: string;
  setResolution: (value: string) => void;
  notice: string;
  announce: (value: string) => void;
};
const Context = createContext<DemoState | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [readerSessions, setReaderSessions] = useState<Record<string, ReaderSession>>({});
  const [memberRemoved, setMemberRemoved] = useState(false);
  function updateReaderSession(bookId: string, patch: Partial<ReaderSession>) {
    setReaderSessions((current) => ({
      ...current,
      [bookId]: { ...(current[bookId] ?? defaultReaderSession), ...patch },
    }));
  }
  function forgetReaderSession(bookId: string) {
    setReaderSessions((current) => {
      const next = { ...current };
      delete next[bookId];
      return next;
    });
  }
  const [signedIn, setSignedIn] = useState(true);
  const [downloads, setDownloads] = useState(['tidal', 'ordinary']);
  const [items, setItems] = useState(books);
  const [sync, setSync] = useState<SyncState>('pending');
  const [resolution, setResolution] = useState('');
  const [notice, announce] = useState('');
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => announce(''), 6500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return (
    <Context.Provider
      value={{
        readerSessions,
        updateReaderSession,
        forgetReaderSession,
        memberRemoved,
        setMemberRemoved,
        signedIn,
        setSignedIn,
        downloads,
        setDownloads,
        items,
        setItems,
        sync,
        setSync,
        resolution,
        setResolution,
        notice,
        announce,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useDemo() {
  const state = useContext(Context);
  if (!state) throw new Error('DemoProvider is required');
  return state;
}
