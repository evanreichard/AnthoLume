import { useEffect, useState } from 'react';
import { useDemo, type SyncState } from './DemoState';
import { back, Link } from './navigation';
import { Badge, Confirm, Icon, PageHeading } from './ui';

const scenarios: [SyncState, string][] = [
  ['pending', 'Pending'],
  ['auth', 'Auth required'],
  ['quota', 'Storage full'],
  ['conflict', 'Conflict'],
  ['retry', 'Retryable error'],
  ['unavailable', 'Download missing'],
];

export function Sync({ params }: { params: URLSearchParams }) {
  const { signedIn, sync, setSync, resolution, setResolution, announce } = useDemo();
  const [choice, setChoice] = useState<'local' | 'server' | null>(null);
  const scenario = params.get('state');
  useEffect(() => {
    if (signedIn && scenarios.some(([key]) => key === scenario)) setSync(scenario as SyncState);
  }, [scenario, setSync, signedIn]);
  if (!signedIn)
    return (
      <section className="sync-page">
        <button className="back-link" onClick={() => back('/more')}>
          <Icon name="back" />
          Back
        </button>
        <PageHeading eyebrow="Explicitly logged out · demo" title="Synchronization" />
        <div className="notice">
          <h2>Account events paused</h2>
          <p>
            Retained account data is hidden. Pending work stays with its original account and cannot
            be replayed for anyone else.
          </p>
          <Link className="button" to="/more">
            Sign in to the same demo account
          </Link>
          <p>
            Local-only books remain readable. No real queue, authentication, or storage is
            implemented here.
          </p>
        </div>
        <Link className="button" to="/offline">
          Open local books
        </Link>
      </section>
    );
  return (
    <section className="sync-page">
      <button className="back-link" onClick={() => back('/more')}>
        <Icon name="back" />
        Back
      </button>
      <PageHeading eyebrow="Separate from book availability" title="Synchronization" />
      <div className="scenario-picker">
        <label htmlFor="scenario">Demo scenario</label>
        <select
          id="scenario"
          value={sync}
          onChange={(event) => {
            setSync(event.target.value as SyncState);
            setResolution('');
          }}
        >
          {scenarios.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <span>No real queue, storage, or server</span>
      </div>
      <div className="sync-account">
        <span className="avatar">AR</span>
        <div>
          <b>Alex Rowan · synthetic account</b>
          <p>2 events in the illustrative queue</p>
        </div>
        <Badge tone="warning">Demo state</Badge>
      </div>
      {sync === 'pending' && (
        <div className="status-panel">
          <span className="status-number">02</span>
          <div>
            <p className="eyebrow">Waiting, not confirmed</p>
            <h2>Reading can continue.</h2>
            <p>
              In a real app, device-committed events would wait for a validated server receipt. An
              internet connection alone is not confirmation.
            </p>
            <div className="notice">
              <b>Demo: 1 progress update + 1 activity event</b>
              <p>
                These are illustrative records, not durable writes. Existing forward-page-turn/WPM
                credit rules are unchanged.
              </p>
            </div>
            {resolution && (
              <p className="resolution" role="status">
                {resolution}
              </p>
            )}
            <button
              onClick={() => {
                setSync('retry');
                announce('Demo: retryable network failure. No events were delivered.');
              }}
            >
              Simulate delivery failure
            </button>
          </div>
        </div>
      )}
      {sync === 'auth' && (
        <div className="status-panel">
          <Icon name="book" />
          <div>
            <p className="eyebrow">Session expired · delivery paused</p>
            <h2>Sign in to synchronize.</h2>
            <p>
              Session expiry does not lock previously authorized offline samples. Unlike explicit
              logout, those downloads remain visible. Pending events stay with the original account.
            </p>
            <div className="inline-actions">
              <Link className="button primary" to="/more">
                Reauthenticate demo account
              </Link>
              <Link className="button" to="/offline">
                Keep reading offline
              </Link>
            </div>
          </div>
        </div>
      )}
      {sync === 'quota' && (
        <div className="status-panel">
          <Icon name="offline" />
          <div>
            <p className="eyebrow">Storage full · simulated failure</p>
            <h2>Download stopped. Not available.</h2>
            <p>
              No incomplete download is marked available. Never evict local originals or pending
              events automatically to make room.
            </p>
            <p className="muted">
              This is a scenario preview; no quota was measured or bytes written. Existing demo
              downloads are unchanged.
            </p>
            <Link className="button primary" to="/offline">
              Manage account downloads
            </Link>
          </div>
        </div>
      )}
      {sync === 'retry' && (
        <div className="status-panel">
          <Icon name="offline" />
          <div>
            <p className="eyebrow">Retryable delivery failure</p>
            <h2>No server receipt yet.</h2>
            <p>
              A lost response is not an acknowledgement. Real retries must keep the same event
              identity to avoid duplicate activity credit.
            </p>
            <button
              className="primary"
              onClick={() => {
                setSync('pending');
                announce('Demo: returned to pending. Nothing sent.');
              }}
            >
              Simulate retry → pending
            </button>
          </div>
        </div>
      )}
      {sync === 'unavailable' && (
        <div className="status-panel">
          <Icon name="offline" />
          <div>
            <p className="eyebrow">Download unavailable · simulated eviction</p>
            <h2>Restore the downloaded copy.</h2>
            <p>
              When bytes are missing, the real app must recheck availability and offer a new
              download. A missing local original instead needs re-import from your exported file.
              Retain pending events if their stored records survive.
            </p>
            <Link className="button" to="/books/tidal">
              Review book
            </Link>
            <p className="small muted">
              This scenario changes no actual file or demo availability.
            </p>
          </div>
        </div>
      )}
      {sync === 'conflict' && (
        <section className="conflict-panel">
          <p className="eyebrow">The Tidal Atlas · proposed conflict interaction</p>
          <h2>Where would you like to resume?</h2>
          <p>
            Both positions are kept until you choose. The higher percentage does not win
            automatically. Choosing an earlier position is valid.
          </p>
          <div className="conflict-options">
            <div>
              <Badge>This device</Badge>
              <strong>
                24<span>%</span>
              </strong>
              <h3>Chapter 1</h3>
              <p>Browser · illustrative checkpoint</p>
              <button className="primary" disabled={!signedIn} onClick={() => setChoice('local')}>
                Use this device · 24% (earlier)
              </button>
            </div>
            <div>
              <Badge>Server</Badge>
              <strong>
                41<span>%</span>
              </strong>
              <h3>Chapter 2</h3>
              <p>KOReader · illustrative snapshot</p>
              <button disabled={!signedIn} onClick={() => setChoice('server')}>
                Use server · 41%
              </button>
            </div>
          </div>
          <p className="small muted">
            Reading activity may synchronize independently. This choice concerns resume position
            only; it does not change credited activity.
          </p>
          <button
            onClick={() => {
              announce(
                'Demo: decision deferred. Both candidates retained in memory; no progress published.',
              );
              back('/more');
            }}
          >
            Decide later · keep both
          </button>
        </section>
      )}
      {choice && (
        <Confirm
          title={
            choice === 'local' ? 'Use the earlier position?' : 'Replace this device’s position?'
          }
          action={choice === 'local' ? 'Use 24% · earlier position' : 'Use 41% · server position'}
          onClose={() => setChoice(null)}
          onConfirm={() => {
            setResolution(
              `Demo choice: ${choice === 'local' ? '24% — the earlier device position' : '41% — the server position'}. No position was published; activity credit is unchanged.`,
            );
            setSync('pending');
          }}
        >
          <p>
            {choice === 'local'
              ? 'Intentionally move the shared resume candidate back from 41% to 24%. A real implementation would submit against the current shared revision and ask again if it changed.'
              : 'Replace the local 24% resume candidate with the server’s 41%. This does not discard independent pending activity.'}
          </p>
          <p>This confirmation only changes in-memory demo state.</p>
        </Confirm>
      )}
    </section>
  );
}
