import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { ReaderScreen } from '../reading/ReaderScreen';
import { useReading } from '../reading';
import { session, useSession } from '../session';
import { bookKey, bookPath } from '../library';
import { Icon } from '../Icon';
import { Dialog } from '../ui';
import { WorkerRecovery } from '../WorkerRecovery';
import { useSnackbar } from '../Snackbar';
import { useBookRef } from './bookRef';
import styles from '../App.module.css';
import readerStyles from '../reading/reader.module.css';

const reconnect = () => session.checkSession();

function RecoveryDetails() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={readerStyles.glass} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="warning" size={15} />
        App Recovery
      </button>
      {open &&
        createPortal(
          <Dialog title="App Recovery" onClose={() => setOpen(false)}>
            <WorkerRecovery includeOffline />
            <p>Updating the offline app does not delete books or pending progress.</p>
          </Dialog>,
          document.body,
        )}
    </>
  );
}

function ReaderConnection() {
  const { access, error, busy } = useSession();
  const { workerError } = useReading();
  const [checking, setChecking] = useState(false);
  const { show } = useSnackbar();
  const offline = access.kind === 'offline';
  async function checkConnection() {
    if (checking || busy) return;
    setChecking(true);
    try {
      await reconnect();
      const current = session.getSnapshot().access.kind;
      if (current === 'offline')
        show({ message: 'Still offline. You can keep reading.', icon: 'cloud-off', placement: 'reader' });
      if (current === 'authenticated') show({ message: 'Back online', icon: 'check', placement: 'reader' });
    } finally {
      setChecking(false);
    }
  }
  if (workerError || (!offline && error)) return <RecoveryDetails />;
  return (
    offline && (
      <button
        type="button"
        className={readerStyles.glass}
        disabled={busy || checking}
        onClick={() => void checkConnection()}
      >
        <Icon name="cloud-off" size={15} />
        <span>Offline</span>
        <i className={readerStyles.divider} aria-hidden="true" />
        {checking || busy ? 'Reconnecting…' : 'Reconnect'}
      </button>
    )
  );
}

export function Component() {
  const book = useBookRef();
  const { access } = useSession();
  const navigate = useNavigate();
  const account = book?.kind === 'server' ? book.account : null;
  useLayoutEffect(() => (account ? session.retainReader(account) : undefined), [account]);
  const toLibrary = () => {
    void navigate('/library', { replace: true });
  };
  if (!book)
    return (
      <main>
        <h1>Book not available for this account</h1>
        <Link to="/library">Return to Library</Link>
      </main>
    );
  return (
    <div className={styles.readerViewport}>
      <ReaderScreen
        key={bookKey(book)}
        book={book}
        recoveryControl={<ReaderConnection />}
        onReconnect={reconnect}
        onBackToLibrary={toLibrary}
        onClose={() => {
          if (access.kind === 'offline') toLibrary();
          else if (window.history.state?.idx > 0) navigate(-1);
          else navigate(bookPath(book), { replace: true });
        }}
      />
    </div>
  );
}
