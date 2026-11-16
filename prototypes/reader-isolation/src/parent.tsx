import React, { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IsolatedReader, lifecycle } from './controller';
let reader: IsolatedReader | undefined;
const observations: unknown[] = [];
const bundle = awaitBundle();
function awaitBundle() { return fetch('/viewer.js').then(response => { if (!response.ok) throw new Error('trusted bundle unavailable'); return response.text(); }); }
let trustedBundle = '';
let selectFixture: (name: string) => void;
let setMount: (value: boolean) => void;
(window as any).proof = {
  lifecycle, observations,
  get reader() { return reader; },
  fixture: (name: string) => selectFixture(name),
  mount: (value: boolean) => setMount(value)
};
function Viewer({ fixture }: { fixture: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('booting');
  useEffect(() => {
    let dead = false;
    let owned: IsolatedReader | undefined;
    owned = reader = new IsolatedReader(host.current!, trustedBundle, value => {
      observations.push(value); setStatus(JSON.stringify(value));
    });
    const session = owned;
    void fetch(`/fixtures/${fixture}.epub`).then(async response => {
      if (!response.ok) throw new Error('fixture unavailable');
      const bytes = await response.arrayBuffer();
      if (!dead) await session.open(bytes);
    });
    return () => { dead = true; owned?.dispose(); if (reader === owned) reader = undefined; };
  }, [fixture]);
  return <><p data-status>{status}</p><div ref={host} /></>;
}
function App() {
  const [fixture, setFixture] = useState('benign');
  const [mounted, mount] = useState(true);
  selectFixture = setFixture; setMount = mount;
  return <><p>Parent owns credentials. The preferred opaque topology is expected to fail EPUB.js DOM access. No unsafe fallback.</p><button onClick={() => mount(v => !v)}>Mount/unmount</button>{mounted && <Viewer fixture={fixture} />}</>;
}
// Wait Before React - The development effect replay exercises actual controller creation and disposal, not only an aborted fetch.
void bundle.then(code => { trustedBundle = code; createRoot(document.querySelector('#app')!).render(<StrictMode><App /></StrictMode>); });
