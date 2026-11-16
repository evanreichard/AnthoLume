import { useState } from 'react';
import { useDemo } from './DemoState';
import { navigate, Link } from './navigation';
import { Confirm, Dialog, Icon, PageHeading } from './ui';

export function More() {
  const { signedIn, setSignedIn, sync, setSync, announce, memberRemoved, setMemberRemoved } =
    useDemo();
  const [panel, setPanel] = useState<'logout' | 'admin' | 'preferences' | 'update' | null>(null);
  const [target, setTarget] = useState('');
  return (
    <>
      <PageHeading eyebrow="The practical things" title="More" />
      <section className="profile-card">
        <span className="avatar large">{signedIn ? 'AR' : '—'}</span>
        <div>
          <p className="eyebrow">
            {signedIn ? 'Synthetic account · administrator' : 'Local mode · no login wall'}
          </p>
          <h2>{signedIn ? 'Alex Rowan' : 'Your books, here.'}</h2>
          <p>
            {signedIn
              ? 'Demo permissions only — not server authorization.'
              : 'Local books remain readable without an account.'}
          </p>
        </div>
        {signedIn ? (
          <button onClick={() => setPanel('logout')}>Sign out</button>
        ) : (
          <button
            className="primary"
            onClick={() => {
              setSignedIn(true);
              if (sync === 'auth') setSync('pending');
              announce(
                'Demo: signed in as Alex Rowan. Retained downloads revealed; nothing synchronized.',
              );
            }}
          >
            Sign in as Alex Rowan
          </button>
        )}
      </section>
      {signedIn && sync === 'auth' && (
        <div className="notice">
          <b>Session expired · synchronization paused</b>
          <p>Offline reading remains available in the retained account context.</p>
          <button
            onClick={() => {
              setSync('pending');
              announce('Demo reauthentication: back to pending. No real authentication occurred.');
            }}
          >
            Reauthenticate Alex Rowan · demo
          </button>
        </div>
      )}
      <div className="more-grid">
        <section>
          <div className="section-label">
            <h2>Reading & account</h2>
          </div>
          <div className="menu-list">
            <Link to="/sync">
              <Icon name="offline" />
              <span>
                Synchronization<small>Pending, authentication, quota and conflicts</small>
              </span>
              <Icon name="arrow" />
            </Link>
            <button onClick={() => setPanel('preferences')}>
              <Icon name="sun" />
              <span>
                Preferences<small>Timezone and reader appearance</small>
              </span>
              <Icon name="arrow" />
            </button>
            <Link to="/insights">
              <Icon name="insights" />
              <span>
                Activity & device progress<small>Representative account snapshots</small>
              </span>
              <Icon name="arrow" />
            </Link>
            <button onClick={() => setPanel('update')}>
              <Icon name="check" />
              <span>
                Preview update notice<small>Never interrupt an open book</small>
              </span>
              <Icon name="arrow" />
            </button>
          </div>
        </section>
        <section>
          <div className="section-label">
            <h2>{signedIn ? 'Administration' : 'Local reading'}</h2>
          </div>
          {signedIn ? (
            <div className="admin-card">
              <p className="eyebrow">Administrator-only example</p>
              <h3>People, not pages.</h3>
              <p>
                User removal does not delete shared books. Privileged operations need real server
                permission and fresh authorization.
              </p>
              <div className="admin-user">
                <span>
                  Sam Reed<small>Member · synthetic account</small>
                </span>
                <button
                  className="text-danger"
                  disabled={memberRemoved}
                  onClick={() => {
                    setTarget('');
                    setPanel('admin');
                  }}
                >
                  {memberRemoved ? 'Removed in demo' : 'Review removal'}
                </button>
              </div>
              <p className="small muted">
                Only this confirmation is in scope, not a working administration suite.
              </p>
            </div>
          ) : (
            <div className="admin-card">
              <h3>No account required.</h3>
              <p>
                Import, read, export, and delete local samples from Offline. Account downloads
                remain retained and hidden until Alex Rowan signs in.
              </p>
              <Link className="button" to="/offline">
                Open local books
              </Link>
            </div>
          )}
        </section>
      </div>
      <section className="design-note">
        <p className="eyebrow">A focused M2 proof</p>
        <h2>
          Choose a feeling.
          <br />
          Keep the same possibilities.
        </h2>
        <p>
          Compare Folio’s quiet, cover-forward library with Index’s compact, status-forward
          workspace using the direction selector above. Both use the same four destinations and
          synthetic content.
        </p>
      </section>
      {panel === 'logout' && (
        <Confirm
          title="Sign out and hide account books?"
          action="Sign out · retain downloads"
          onClose={() => setPanel(null)}
          onConfirm={() => {
            setSignedIn(false);
            announce(
              'Demo: signed out. Account downloads retained and hidden; original-account events paused.',
            );
            navigate('/offline');
          }}
        >
          <p>
            Alex Rowan’s downloads will be <b>retained and hidden</b> until the same account signs
            in. Its pending events pause and never transfer to another account.
          </p>
          <p>
            Local-only books remain readable. This is application-level separation, not encryption
            against another person using this browser.
          </p>
          <p className="small muted">
            The prototype simulates this in memory only; reload resets the account.
          </p>
        </Confirm>
      )}
      {panel === 'admin' && (
        <Dialog title="Remove Sam Reed?" onClose={() => setPanel(null)}>
          <p className="eyebrow">Destructive admin confirmation · demo only</p>
          <div className="notice danger-note">
            <b>Account removal cannot be undone.</b>
            <p>
              Shared books stay in the library. This example is a member, not the last
              administrator.
            </p>
          </div>
          <p>
            A real operation must recheck authorization, require fresh credentials, and verify
            recovery readiness before deletion. This study performs none of those operations.
          </p>
          <label className="field">
            Type Sam Reed to confirm
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="dialog-actions">
            <button onClick={() => setPanel(null)}>Cancel</button>
            <button
              className="danger"
              disabled={target !== 'Sam Reed'}
              onClick={() => {
                setMemberRemoved(true);
                setPanel(null);
                announce(
                  'Demo only: Sam Reed removed from this visual example. No account or shared book was changed.',
                );
              }}
            >
              Remove member · demo
            </button>
          </div>
        </Dialog>
      )}
      {panel === 'preferences' && (
        <Dialog title="Preferences preview" onClose={() => setPanel(null)}>
          <p>
            Insights in this study use UTC. Real timezone/password/device settings are not
            implemented.
          </p>
          <p>
            Use the top toolbar for light/dark mode; the reader’s Appearance control changes sample
            text.
          </p>
          <Link className="button primary" to="/read/field" onClick={() => setPanel(null)}>
            Try reader appearance
          </Link>
        </Dialog>
      )}
      {panel === 'update' && (
        <Dialog title="Update ready · preview" onClose={() => setPanel(null)}>
          <p>
            In a real installed app, apply updates after closing the book. New books and pending
            events must be preserved. No service worker or actual update exists here.
          </p>
          <button
            onClick={() => {
              setPanel(null);
              announce('Demo update deferred. Nothing reloaded.');
            }}
          >
            Later · keep reading
          </button>
        </Dialog>
      )}
    </>
  );
}
