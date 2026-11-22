import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { queryClient, session, useSession } from './session';
import { profiles, type OfflineProfile } from './offlineProfiles';
import { useReading, type Account, type OfflineChoice, type OfflineRecord } from './reading';
import { Dialog, ErrorNotice } from './ui';
import { Button } from './Controls';
import { Brand } from './Brand';
import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

export function OfflinePicker() {
  const [forget, setForget] = useState<OfflineProfile>();
  const [error, setError] = useState<unknown>();
  const [manage, setManage] = useState(false);
  const reading = useReading(), navigate = useNavigate(), remembered = profiles();
  return <main className={styles.picker}>
    <header><div className={styles.wordmark}><Brand /></div>
      <h1>Offline Profiles</h1><p>{remembered.length ? 'Choose a reader on this device.' : 'Reconnect to sign in and add a profile.'}</p>
    </header>
    <ul className={styles.profiles}>{remembered.map(p => <li key={JSON.stringify(p.account)}>
      <button className={styles.profile} onClick={() => { session.chooseOffline(p.account); navigate('/library', {replace:true}); }}>
        <span className={styles.avatar} aria-hidden="true">{Array.from(p.name)[0]?.toLocaleUpperCase()}</span>
        <strong>{p.name}</strong><Icon name="forward" size={18} />
      </button>{manage && <button className={styles.quiet} aria-label={`Forget ${p.name}`} onClick={() => { setError(null); setForget(p); }}><Icon name="trash" size={17} /></button>}
    </li>)}</ul>
    <footer><button className={styles.quiet} onClick={() => void session.checkSession()}><Icon name="refresh" size={16} /> Reconnect</button>
      {!!remembered.length && <button className={styles.quiet} aria-pressed={manage} onClick={() => setManage(!manage)}>{manage ? 'Done' : 'Manage profiles'}</button>}</footer>
    {forget && <Dialog title={`Forget ${forget.name}?`} onClose={() => setForget(undefined)}>
      <p>This removes the offline profile and its unsubmitted reading.</p><ErrorNotice error={error} />
      <Button onClick={async () => { try { await reading.forgetDrafts(forget.account); session.forgetOffline(forget.account); setForget(undefined); } catch (e) { setError(e); } }}>Forget on this device</Button>
    </Dialog>}
  </main>;
}

const percent = (v: number | null) => v == null ? '—' : `${Math.round(v * 100)}%`;
const duration = (v: number) => v < 60 ? `${v}s` : `${Math.floor(v / 60)}m${v % 60 ? ` ${v % 60}s` : ''}`;
type Group = { rows: OfflineRecord[]; document: string; title: string };
function group(records: readonly OfflineRecord[]) {
  const books = new Map<string, Group>();
  for (const row of records) {
    const book = books.get(row.document) ?? { rows: [], document: row.document, title: row.title };
    book.rows.push(row); books.set(row.document, book);
  }
  return [...books.values()].sort((a,b) => a.title.localeCompare(b.title));
}
async function comparison(account: Account, book: Group, timezone: string, signal: AbortSignal) {
  const progress = book.rows.some(r => r.kind === 'progress') ? await session.api.bridge.getState(account, book.document, signal) : null;
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = new Set(book.rows.flatMap(row => row.kind === 'activity' ? [fmt.format(new Date(row.event.start_time))] : []));
  let seconds = 0;
  for (const day of days) {
    let cursor: string | undefined;
    do {
      const page = await session.api.insightActivity(account, {document: book.document, day, cursor}, signal);
      seconds += page.items.reduce((n, entry) => n + entry.duration, 0);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }
  return { progress, seconds };
}

function BookComparison({ account, book, timezone, selected, select }: { account: Account; book: Group; timezone: string; selected: Map<string, OfflineChoice>; select(choices: OfflineChoice[], checked: boolean): void }) {
  const ids = book.rows.map(r => r.id).sort();
  const query = useQuery({ queryKey: ['offline-comparison', account, book.document, timezone, ids], staleTime: 0,
    queryFn: ({signal}) => comparison(account, book, timezone, signal) });
  const progress = book.rows.find(r => r.kind === 'progress');
  const activities = book.rows.filter(r => r.kind === 'activity');
  return <section className={styles.reviewBook} role="group" aria-label={book.title}>
    <header><h3>{book.title}</h3><small>Offline</small><small>Server</small></header>
    {progress && <label><span><input aria-label="Progress" type="checkbox" disabled={!query.data?.progress} checked={selected.has(progress.id)} onChange={e => select([{id: progress.id, revision: query.data?.progress?.revision}], e.target.checked)} />Progress</span><b>{percent(progress.checkpoint.fraction)}</b><span>{query.data ? percent(query.data.progress?.fraction ?? null) : '…'}</span></label>}
    {!!activities.length && <label><span><input aria-label="Activity" type="checkbox" disabled={!query.data} checked={activities.every(r => selected.has(r.id))} onChange={e => select(activities.map(r => ({id:r.id})), e.target.checked)} />Activity</span><b>{duration(activities.reduce((n,r) => n + r.event.duration,0))}</b><span>{query.data ? duration(query.data.seconds) : '…'}</span></label>}
    {query.isError && <button onClick={() => void query.refetch()}>Retry comparison</button>}
  </section>;
}
export function OfflineReview({account}: {account: Account}) {
  const reading = useReading(), {session: current} = useSession();
  const [later, setLater] = useState(false), [discard, setDiscard] = useState(false);
  const [selected, setSelected] = useState(new Map<string, OfflineChoice>()), [busy,setBusy] = useState(false), [error,setError] = useState<unknown>();
  const records = reading.offlineRecords ?? [];
  if (!records.length) return null;
  const choices = records.flatMap(r => selected.get(r.id) ?? []);
  function close() { if (!busy) { setLater(true); setSelected(new Map()); setDiscard(false); setError(null); } }
  async function submit(remove: boolean) {
    setBusy(true); setError(null);
    try {
      if (!remove) for (const choice of choices) {
        const record = records.find(r => r.id === choice.id)!;
        if (choice.revision !== undefined) {
          const state = await session.api.bridge.getState(account, record.document, AbortSignal.timeout(10000));
          if (state.revision !== choice.revision) {
            await queryClient.invalidateQueries({queryKey:['offline-comparison',account,record.document]});
            throw new Error('Server progress changed. Select again.');
          }
        }
      }
      await reading.decideOffline(account, choices, remove);
      setLater(true);
    } catch (e) { setError(e); }
    finally { setSelected(new Map()); setBusy(false); setDiscard(false); }
  }
  if (later) return <button onClick={() => setLater(false)}>Review offline reading</button>;
  return <Dialog title="Offline Reading" onClose={close} layout="scroll-body" placement="mobile-sheet" footer={<div className={styles.reviewActions}>
    <button className={styles.quiet} disabled={busy} onClick={() => discard ? setDiscard(false) : close()}>{discard ? 'Cancel' : 'Not now'}</button>
    {!discard && <button className={styles.quiet} title="Discard selected records" aria-label="Discard selected records" disabled={busy || !choices.length} onClick={() => setDiscard(true)}><Icon name="trash" size={17} /></button>}
    <Button tone={discard ? 'danger' : 'primary'} disabled={busy || !choices.length} onClick={() => void submit(discard)}>{discard ? 'Discard selected' : 'Upload selected'}</Button>
  </div>}><ErrorNotice error={error} />{group(records).map(book => <BookComparison key={book.document} book={book} account={account} timezone={current?.user?.timezone ?? 'UTC'} selected={selected} select={(items, checked) => {
    if (busy) return;
    setDiscard(false); setSelected(previous => { const next = new Map(previous); for (const item of items) { if (checked) next.set(item.id,item); else next.delete(item.id); } return next; });
  }} />)}</Dialog>;
}
