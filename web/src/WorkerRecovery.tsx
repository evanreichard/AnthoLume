import { useEffect, useState } from 'react';
import { useReading } from './reading';
import { session, useSession } from './session';
import { Dialog, ErrorNotice } from './ui';
import styles from './App.module.css';

export function WorkerRecovery({ duringReading = false }: { duringReading?: boolean }) {
  const reading = useReading();
  const { access, error: sessionError, busy: sessionBusy } = useSession();
  const scope = JSON.stringify(access);
  const [failure, setFailure] = useState<{ scope: string; error: unknown } | null>(null);
  const error = failure?.scope === scope ? failure.error : null;
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    if (reading.update === 'error' && reading.error) setFailure({ scope, error: reading.error });
  }, [reading.update, reading.error, scope]);
  useEffect(() => { setDetails(false); }, [scope]);
  const workerVisible = reading.update === 'error' || !!error;
  if (!workerVisible && !sessionError) return null;
  async function retry() {
    setBusy(true);
    setFailure(null);
    try { await reading.applyUpdate(); } catch (error) { setFailure({ scope, error }); } finally { setBusy(false); }
  }
  const message = 'The old offline worker could not be checked for retirement. You can still read online and save your progress.';
  const workerLabel = 'Retry update / recovery';
  return <>
    <section className={duringReading ? styles.recoveryDock : styles.notice} aria-label="App update and recovery">
      {duringReading ? <>
        <span>{workerVisible ? 'App recovery' : 'Connection unavailable'}</span>
        {sessionError && <button disabled={sessionBusy} onClick={() => void session.checkSession()}>Reconnect</button>}
        {workerVisible && <button disabled={busy} aria-label={workerLabel} onClick={() => void retry()}>{busy ? 'Retrying…' : 'Retry update'}</button>}
        <button onClick={() => setDetails(true)} aria-haspopup="dialog">Recovery details</button>
      </> : <>
        {sessionError && <><ErrorNotice error={sessionError} /><button disabled={sessionBusy} onClick={() => void session.checkSession()}>Reconnect</button></>}
        {workerVisible && <><p>{message}</p><ErrorNotice error={error} /><button disabled={busy} onClick={() => void retry()}>{busy ? 'Retrying…' : workerLabel}</button></>}
      </>}
    </section>
    {details && <Dialog title="App recovery details" onClose={() => setDetails(false)}>
      {sessionError && <ErrorNotice error={sessionError} />}
      {workerVisible && <><p>{message}</p><ErrorNotice error={error} /></>}
      <p>Retiring the offline worker does not delete books or pending progress.</p>
      <button onClick={() => setDetails(false)}>Close recovery details</button>
    </Dialog>}
  </>;
}
