import { useState } from 'react';
import { useReading } from './reading';
import { session, useSession } from './session';
import { ErrorNotice } from './ui';
import styles from './App.module.css';

export function WorkerRecovery({ includeOffline = false }: { includeOffline?: boolean }) {
  const reading = useReading();
  const { access, error: sessionError, busy: sessionBusy } = useSession();
  const [busy, setBusy] = useState(false);
  const reconnect = !!sessionError || (includeOffline && access.kind === 'offline');
  if (!reading.workerError && !reconnect) return null;
  async function retry() {
    setBusy(true);
    try { await reading.applyUpdate(); } finally { setBusy(false); }
  }
  return <section className={styles.notice} aria-label="App update and recovery">
    {sessionError && <ErrorNotice error={sessionError} />}
    {reconnect && <button disabled={sessionBusy} onClick={() => void session.checkSession()}>Reconnect</button>}
    {reading.workerError && <><ErrorNotice error={reading.workerError} /><button disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry Update / Recovery'}</button></>}
  </section>;
}
