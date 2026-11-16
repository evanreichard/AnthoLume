import type { ReactNode } from 'react';
import { useDemo } from './DemoState';
import { Link } from './navigation';
import { Icon } from './ui';

const tabs = [
  ['library', 'Library'],
  ['offline', 'Offline'],
  ['insights', 'Insights'],
  ['more', 'More'],
];
export type Direction = 'folio' | 'index';

export function StudioBar({
  direction,
  theme,
  setDirection,
  setTheme,
}: {
  direction: Direction;
  theme: string;
  setDirection: (value: Direction) => void;
  setTheme: (value: string) => void;
}) {
  return (
    <aside className="studio-bar" aria-label="Prototype controls">
      <span className="studio-label">
        <b>M2</b> Design study <span>· synthetic, in-memory demo</span>
      </span>
      <div className="studio-controls">
        <label>
          Direction{' '}
          <select
            value={direction}
            onChange={(event) => setDirection(event.target.value as Direction)}
          >
            <option value="folio">A · Folio / editorial</option>
            <option value="index">B · Index / utility</option>
          </select>
        </label>
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          <Icon name="sun" />
          <span>{theme === 'light' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </aside>
  );
}

export function Shell({ path, children }: { path: string; children: ReactNode }) {
  const { signedIn, sync, notice } = useDemo();
  const active = path.startsWith('/books') ? 'library' : path === '/sync' ? 'more' : path.slice(1);
  const status = !signedIn
    ? 'Account events paused'
    : sync === 'auth'
      ? 'Sign-in needed'
      : sync === 'conflict'
        ? 'Progress needs a choice'
        : '2 events pending';
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app-shell">
        <aside className="rail">
          <Link className="wordmark" to="/library">
            <span className="brand-symbol">
              a<span>l</span>
            </span>
            <span>
              AnthoLume<small>A place for your pages</small>
            </span>
          </Link>
          <nav aria-label="Main navigation">
            {tabs.map(([key, label]) => (
              <Link key={key} to={`/${key}`} aria-current={active === key ? 'page' : undefined}>
                <Icon name={key} />
                <span>{label}</span>
                <span className="nav-index">0{tabs.findIndex((tab) => tab[0] === key) + 1}</span>
              </Link>
            ))}
          </nav>
          <div className="rail-bottom">
            <Link className="sync-link" to="/sync">
              <span className="status-dot" />
              <span>
                {status}
                <small>Demo synchronization</small>
              </span>
              <Icon name="arrow" />
            </Link>
            <div className="account">
              <span className="avatar">{signedIn ? 'AR' : '—'}</span>
              <div>
                {signedIn ? 'Alex Rowan' : 'Local reading'}
                <small>{signedIn ? 'Synthetic account · admin' : 'No account required'}</small>
              </div>
            </div>
          </div>
        </aside>
        <main id="main-content" tabIndex={-1}>
          {children}
          <footer className="demo-footer">
            Interactive design prototype. All books, people, statistics and storage states are
            synthetic. Changes reset on reload. No network, files, or activity are synchronized.
          </footer>
        </main>
      </div>
      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {tabs.map(([key, label]) => (
          <Link key={key} to={`/${key}`} aria-current={active === key ? 'page' : undefined}>
            <Icon name={key} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <div className={`toast ${notice ? 'visible' : ''}`} role="status">
        {notice}
      </div>
    </>
  );
}
