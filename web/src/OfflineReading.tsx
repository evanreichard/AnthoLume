import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryClient, session, useSession } from './session';
import type { OfflineProfile } from './reading';
import { useReading, type Account, type ReviewDecision, type OfflineChoice, type OfflineRecord } from './reading';
import { Dialog, ErrorNotice } from './ui';
import { Button } from './Controls';
import { OfflineStatusBar } from './OfflineStatusBar';
import { Brand } from './Brand';
import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

export function OfflinePicker() {
  const [forget, setForget] = useState<OfflineProfile>();
  const [error, setError] = useState<unknown>();
  const [manage, setManage] = useState(false);
  const { profiles: remembered } = useSession();
  return <main className={styles.picker}>
    <header><div className={styles.wordmark}><Brand /></div>
      <h1>Offline Profiles</h1><p>{remembered.length ? 'Choose a reader on this device.' : 'Reconnect to sign in and add a profile.'}</p>
    </header>
    <ul className={styles.profiles}>{remembered.map(p => <li key={JSON.stringify(p.account)}>
      <button className={styles.profile} onClick={() => session.chooseOffline(p.account)}>
        <span className={styles.avatar} aria-hidden="true">{Array.from(p.name)[0]?.toLocaleUpperCase()}</span>
        <strong>{p.name}</strong><Icon name="forward" size={18} />
      </button>{manage && <button className={styles.quiet} aria-label={`Forget ${p.name}`} onClick={() => { setError(null); setForget(p); }}><Icon name="trash" size={17} /></button>}
    </li>)}</ul>
    {!!remembered.length && <button className={styles.manage} aria-pressed={manage} onClick={() => setManage(!manage)}>{manage ? 'Done' : 'Manage Profiles'}</button>}
    <OfflineStatusBar />
    {forget && <Dialog title={`Forget ${forget.name}?`} onClose={() => setForget(undefined)}>
      <p>This removes the offline profile and its unsubmitted reading.</p><ErrorNotice error={error} />
      <Button onClick={async () => { try { await session.forgetOffline(forget.account); setForget(undefined); } catch (e) { setError(e); } }}>Forget on This Device</Button>
    </Dialog>}
  </main>;
}

const percent = (v: number | null) => v == null ? '—' : `${Math.round(v * 100)}%`;
const duration = (v: number) => v < 60 ? `${v}s` : `${Math.floor(v / 60)}m${v % 60 ? ` ${v % 60}s` : ''}`;
type Group = { document: string; title: string; progress?: Extract<OfflineRecord, {kind: 'progress'}>; activities: Extract<OfflineRecord, {kind: 'activity'}>[] };
function group(records: readonly OfflineRecord[]) {
  const books = new Map<string, Group>();
  for (const row of records) {
    const book: Group = books.get(row.document) ?? { activities: [], document: row.document, title: row.title };
    if (row.kind === 'activity') book.activities.push(row);
    else book.progress = row;
    books.set(row.document, book);
  }
  return [...books.values()].sort((a,b) => a.title.localeCompare(b.title)).map(book => ({
    ...book, activityKey: JSON.stringify(book.activities.map(r => r.id).sort()),
  }));
}
async function serverActivitySeconds(account: Account, document: string, activities: Extract<OfflineRecord, {kind: 'activity'}>[], timezone: string, signal: AbortSignal) {
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = new Set(activities.map(row => fmt.format(new Date(row.event.start_time))));
  let seconds = 0;
  for (const day of days) {
    let cursor: string | undefined;
    do {
      const page = await session.api.insightActivity(account, {document, day, cursor}, signal);
      seconds += page.items.reduce((n, entry) => n + entry.duration, 0);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  return seconds;
}

function ComparisonRow({ label, offline, server, checked, discard, onCheck, retry }: {
  label: 'Progress' | 'Activity'; offline: string; server?: string; checked: boolean; discard: boolean;
  onCheck(checked: boolean): void; retry?: () => void;
}) {
  return <>
    <label><span><input type="checkbox" aria-label={label} checked={checked} disabled={!discard && server === undefined}
      onChange={event => onCheck(event.target.checked)} />{label}</span><b>{offline}</b><span>{server ?? (retry ? 'Unavailable' : '…')}</span></label>
    {retry && !discard && <button onClick={retry}>Retry {label} Comparison</button>}
  </>;
}

function BookComparison({ account, book, timezone, discard, selected, select }: { discard: boolean; account: Account; book: Group & { activityKey: string }; timezone: string; selected: Map<string, OfflineChoice[]>; select(key: string, choices: OfflineChoice[], checked: boolean): void }) {
  const { progress, activities, activityKey } = book;
  const state = useQuery({ queryKey: ['offline-progress', account, book.document, progress?.id], enabled: !!progress && !discard, staleTime: 0,
    queryFn: ({signal}) => session.api.bridge.getState(account, book.document, signal) });
  const activity = useQuery({ queryKey: ['offline-activity', account, book.document, timezone, activityKey], enabled: activities.length > 0 && !discard, staleTime: 0,
    queryFn: ({signal}) => serverActivitySeconds(account, book.document, activities, timezone, signal) });
  return <section className={styles.reviewBook} role="group" aria-label={book.title}>
    <header><h3>{book.title}</h3><small>Offline</small><small>Server</small></header>
    {progress && <ComparisonRow label="Progress" discard={discard} offline={percent(progress.checkpoint.fraction)} server={state.data && percent(state.data.fraction)}
      checked={selected.has(progress.id)} onCheck={checked => select(progress.id, [{id: progress.id, revision: state.data?.revision}], checked)}
      retry={state.isError ? () => void state.refetch() : undefined} />}
    {!!activities.length && <ComparisonRow label="Activity" discard={discard} offline={duration(activities.reduce((sum, row) => sum + row.event.duration, 0))}
      server={activity.data === undefined ? undefined : duration(activity.data)} checked={selected.has(activityKey)}
      onCheck={checked => select(activityKey, activities.map(r => ({id: r.id})), checked)} retry={activity.isError ? () => void activity.refetch() : undefined} />}
  </section>;
}
export function OfflineReview({account}: {account: Account}) {
  const reading = useReading(), {session: current} = useSession();
  const [later, setLater] = useState(!reading.offlineRecords?.length), [discard, setDiscard] = useState(false);
  const [selected, setSelected] = useState(new Map<string, OfflineChoice[]>()), [busy,setBusy] = useState(false), [error,setError] = useState<unknown>();
  const records = reading.offlineRecords ?? [];
  const books = group(records);
  const rowKeys = new Set(books.flatMap(book => [book.progress?.id, book.activityKey]));
  const currentSelection = [...selected].filter(([key]) => rowKeys.has(key));
  if (currentSelection.length !== selected.size) setSelected(new Map(currentSelection));
  if (!records.length) return null;
  const choices = currentSelection.flatMap(([, items]) => items);
  function close() { if (!busy) { setLater(true); setSelected(new Map()); setDiscard(false); setError(null); } }
  async function submit(decision: ReviewDecision) {
    setBusy(true); setError(null);
    try {
      if (decision === 'upload') for (const choice of choices) {
        const record = records.find(r => r.id === choice.id)!;
        if (choice.revision !== undefined) {
          const state = await session.api.bridge.getState(account, record.document, AbortSignal.timeout(10000));
          if (state.revision !== choice.revision) {
            await queryClient.invalidateQueries({queryKey:['offline-progress',account,record.document]});
            throw new Error('Server progress changed. Select again.');
          }
        }
      }
      await reading.decideOffline(account, choices, decision);
      setLater(true);
    } catch (e) { setError(e); }
    finally { setSelected(new Map()); setBusy(false); setDiscard(false); }
  }
  if (later) return <button onClick={() => setLater(false)}>Review Offline Reading</button>;
  return <Dialog title="Offline Reading" onClose={close} layout="scroll-body" placement="mobile-sheet" footer={<div className={styles.reviewActions}>
    <button className={styles.quiet} disabled={busy} onClick={() => { if (discard) { setDiscard(false); setSelected(new Map()); } else close(); }}>{discard ? 'Cancel' : 'Keep Reading'}</button>
    {!discard && <button className={styles.quiet} title="Discard Records" aria-label="Discard Records" disabled={busy} onClick={() => { setSelected(new Map()); setDiscard(true); }}><Icon name="trash" size={17} /></button>}
    <Button tone={discard ? 'danger' : 'primary'} disabled={busy || !choices.length} onClick={() => void submit(discard ? 'discard' : 'upload')}>{discard ? 'Discard Selected' : 'Upload Selected'}</Button>
  </div>}><ErrorNotice error={error} />{discard ? <p>Select the local records to discard. This does not change the server.</p> : records.some(record => record.kind === 'progress') && <p>Turns made in a device-only reader stay here until you choose to upload them.</p>}{books.map(book => <BookComparison key={book.document} book={book} account={account} timezone={current?.user?.timezone ?? 'UTC'} discard={discard} selected={selected} select={(key, items, checked) => {
    if (busy) return;
    setSelected(previous => { const next = new Map(previous); if (checked) next.set(key, items); else next.delete(key); return next; });
  }} />)}</Dialog>;
}
