import { useEffect, useState } from 'react';
import { useReading } from './reading';
import { session, useSession } from './session';
import { Dialog, ErrorNotice } from './ui';
import styles from './App.module.css';

export function WorkerRecovery({ duringReading = false }: { duringReading?: boolean }) {
  const reading = useReading();
  const { access, error: sessionError, busy: sessionBusy } = useSession();
  const scope = JSON.stringify(access);
  const error = reading.workerError;
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => { setDetails(false); }, [scope]);
  const workerVisible = !!error;
  if (!workerVisible && !sessionError) return null;
  async function retry() {
    setBusy(true);
    try { await reading.applyUpdate(); } finally { setBusy(false); }
  }
  const workerLabel = 'Retry Update / Recovery';
  return <>
    <section className={duringReading ? styles.recoveryDock : styles.notice} aria-label="App update and recovery">
      {duringReading ? <>
        <span>{workerVisible ? 'App recovery' : 'Connection unavailable'}</span>
        {sessionError && <button disabled={sessionBusy} onClick={() => void session.checkSession()}>Reconnect</button>}
        {workerVisible && <button disabled={busy} aria-label={workerLabel} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry Update'}</button>}
        <button onClick={() => setDetails(true)} aria-haspopup="dialog">Recovery Details</button>
      </> : <>
        {sessionError && <><ErrorNotice error={sessionError} /><button disabled={sessionBusy} onClick={() => void session.checkSession()}>Reconnect</button></>}
        {workerVisible && <><ErrorNotice error={error} /><button disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : workerLabel}</button></>}
      </>}
    </section>
    {details && <Dialog title="App recovery details" onClose={() => setDetails(false)}>
      {sessionError && <ErrorNotice error={sessionError} />}
      {workerVisible && <ErrorNotice error={error} />}
      <p>Updating the offline app does not delete books or pending progress.</p>
      <button onClick={() => setDetails(false)}>Close Recovery Details</button>
    </Dialog>}
  </>;
}
