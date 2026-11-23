import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SnackbarProvider, useSnackbar } from '../../Snackbar';
import '../../tokens.css';

let stale: ReturnType<typeof useSnackbar> | undefined;

function Owner({ id, scope }: { id: string; scope?: string }) {
  const handle = useSnackbar(scope);
  const [actions, setActions] = useState(0);
  const message = `Notice ${id}${scope === undefined ? '' : ` / ${scope}`}`;
  return <fieldset><legend>Owner {id}</legend>
    <button onClick={() => handle.show({ message })}>Show Info {id}</button>
    <button onClick={() => handle.show({ message, placement: 'reader' })}>Show Reader {id}</button>
    <button onClick={() => handle.show({ message, tone: 'error', action: { label: 'Retry', onClick: () => setActions(count => count + 1) } })}>Show Action {id}</button>
    <button onClick={handle.dismiss}>Dismiss {id}</button>
    <button onClick={() => { stale = handle; }}>Remember {id}</button>
    <output aria-label={`Actions ${id}`}>{actions}</output>
  </fieldset>;
}

function Fixture() {
  const [scope, setScope] = useState('initial');
  const [mounted, setMounted] = useState(true);
  const [offline, setOffline] = useState(false);
  return <SnackbarProvider>
    <button onClick={() => setScope(scope === 'initial' ? 'next' : 'initial')}>Change Scope A</button>
    <button onClick={() => setMounted(false)}>Unmount A</button>
    <button onClick={() => stale?.dismiss()}>Dismiss From Old Handle</button>
    <button onClick={() => stale?.show({ message: 'Stale Notice' })}>Show From Old Handle</button>
    <button onClick={() => setOffline(true)}>Show Offline Bar</button>
    {mounted && <Owner id="A" scope={scope} />}
    <Owner id="B" />
    {offline && <section aria-label="Offline controls" style={{ position: 'fixed', inset: 'auto 0 0', height: 53 }} />}
  </SnackbarProvider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
