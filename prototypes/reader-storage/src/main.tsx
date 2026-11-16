import React, { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReaderController, lifecycle, type ReaderSnapshot, type ReaderStatus } from './controller';
import { Repository, ReaderDB, accountScope, bookKey } from './storage';
import { ProgressTransportFake, ReceiptTransportFake } from './transport-fake';
import { validateEPUB } from './content-policy';
import { requireStableBody } from './body-contract';
import { SyncCoordinator } from './sync';
import { parseKO, elementFromKO, koFromElement } from './codec';
import { partialMD5, fullMD5 } from './identity';
import './style.css';

const repository = new Repository();
const progress = new ProgressTransportFake();
progress.propose({ ko: '/body/DocFragment[1]/body/p[1]', fraction: 0.8 }, '0');
const proof = { repository, Repository, ReaderDB, ReaderController, SyncCoordinator, accountScope, bookKey, ReceiptTransportFake, ProgressTransportFake, validateEPUB, requireStableBody, parseKO, elementFromKO, koFromElement, partialMD5, fullMD5, lifecycle, publications: [] as ReaderSnapshot[] };
declare global { interface Window { proof: typeof proof } }
window.proof = proof;

function Reader({ bytes, saved, documentId }: { bytes: ArrayBuffer; saved?: string; documentId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<ReaderController | null>(null);
  const [status, setStatus] = useState<ReaderStatus>({ state: 'opening', message: 'Opening' });
  useEffect(() => {
    const reader = new ReaderController(host.current!, setStatus, async location => {
      await repository.accept('local', documentId, location.ko);
      proof.publications.push(location);
    });
    controller.current = reader;
    void reader.open(bytes, saved);
    return () => { controller.current = null; void reader.dispose(); };
  }, [bytes, saved, documentId]);
  return <section>
    <p role="status" data-state={status.state}>{status.message}</p>
    <div className="controls">
      <button onClick={() => void controller.current?.previous()}>Previous page</button>
      <button onClick={() => void controller.current?.next()}>Next page</button>
      <button onClick={() => void controller.current?.reflow(150)}>Reflow 150%</button>
      <label>TOC <select aria-label="TOC" defaultValue="" onChange={event => void controller.current?.toc(event.target.value)}><option value="" disabled>Choose chapter</option>{status.toc?.map(item => <option key={item.href} value={item.href}>{item.label}</option>)}</select></label>
    </div>
    <code className="position" data-testid="position" data-cfi={status.location?.cfi}>{status.location?.ko || 'No position'}</code>
    <p>{status.location ? `${status.location.chapter} — page ${status.location.page}/${status.location.pages}` : ''}</p>
    <div className="reader-host" data-testid="reader-host" ref={host}/>
  </section>;
}
function App() {
  const [bytes, setBytes] = useState<ArrayBuffer>();
  const [documentId, setDocumentId] = useState('synthetic');
  const [mounted, setMounted] = useState(true);
  const [saved, setSaved] = useState<string>();
  const [message, setMessage] = useState('No book loaded');
  const [conflict, setConflict] = useState<Extract<ReturnType<ProgressTransportFake['propose']>, { state: 'choice-required' }>>();
  async function open(resume: boolean, invalid = false, selected = documentId) {
    try {
      const existing = await repository.db.books.get(bookKey('local', selected));
      const data = existing ? await existing.bytes.arrayBuffer() : await (await fetch(`/fixtures/${selected}.epub`)).arrayBuffer();
      if (!existing) await repository.importBook('local', selected, selected, data);
      const checkpoint = await repository.db.checkpoints.get(bookKey('local', selected));
      setSaved(invalid ? '/body/DocFragment[999]/body/p[1]' : resume ? checkpoint?.ko || undefined : undefined);
      setDocumentId(selected); setBytes(data); setMounted(true); setMessage('Bytes are persisted in Dexie. No authenticated request is needed to read.');
    } catch (error) { setMessage(String(error)); }
  }
  return <main>
    <h1>M2 reader / storage proof</h1>
    <p>Bounded contract harness, not a second application UI. React StrictMode is enabled. EPUB.js owns only the frame host. No service worker is registered.</p>
    <div className="controls"><button onClick={() => void open(false, false, 'synthetic')}>Open synthetic EPUB</button><button onClick={() => void open(false, false, 'representative')}>Open representative EPUB</button><button onClick={() => void open(false, false, 'alice')}>Open Alice</button><button onClick={() => setMounted(false)}>Unmount reader</button><button onClick={() => void open(true)}>Reopen checkpoint</button><button onClick={() => void open(false, true)}>Open invalid saved position</button></div>
    <p>{message}</p>
    {bytes && mounted && <Reader bytes={bytes} saved={saved} documentId={documentId}/>}
    <section><h2>Explicit stale progress choice (transport fake)</h2>
      <p>Local 20% versus server 80%: neither percentage nor clock selects a winner.</p>
      <button onClick={() => { const result = progress.propose({ ko: '/body/DocFragment[1]/body/p[2]', fraction: 0.2 }, '0'); if (result.state === 'choice-required') setConflict(result); }}>Stage stale local progress</button>
      {conflict && <div role="group" aria-label="Progress conflict"><p>Choice required. Local and server positions retained.</p>{(['local', 'server'] as const).map(choice => <button key={choice} onClick={() => { const result = progress.choose(choice, conflict); setMessage(JSON.stringify(result)); if (result.state !== 'choice-required') setConflict(undefined); else setConflict(result); }}>Use {choice} position</button>)}</div>}
    </section>
    <section><h2>Evidence and limits</h2><ul>
      <li>Playwright exercises real Chromium frames, IndexedDB transactions/reload, two-tab leases, logout and expired-session offline reads.</li>
      <li>Hardened single-origin reader: passive chapters, before-parse CSP, parsed CSS with rgb/media/packaged fonts, inline/packaged SVG, archive-only assets and controller-routed internal links. Active/external references reject; original bytes and body structure remain intact.</li>
      <li>Same-origin script-disabled sandbox is weaker than origin isolation. iOS, KOReader client, large archives, ZIP bombs, RTL/fixed layout and installed PWA behavior are not qualified.</li>
      <li>Receipt/revision transport is deterministic in-memory fake, not existing server semantics. No server/API changes, production activity publishing or full PWA claims.</li>
    </ul><p>See README and docs/evaluation/m2-reader-storage.md for commands, assertions and remaining gates. The <code>window.proof</code> harness exposes the proof boundaries for reproducible browser inspection, not a production API.</p></section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
