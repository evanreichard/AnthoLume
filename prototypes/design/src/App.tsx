import { useLayoutEffect, useState } from 'react';
import { BookDetail } from './BookDetail';
import { useDemo } from './DemoState';
import { Insights } from './Insights';
import { Library } from './Library';
import { More } from './More';
import { Link, useRoute } from './navigation';
import { Offline } from './Offline';
import { Reader } from './Reader';
import { Shell, StudioBar, type Direction } from './Shell';
import { Sync } from './Sync';
import { PageHeading } from './ui';

export function App() {
  const initial = new URLSearchParams(location.search);
  const [direction, setDirection] = useState<Direction>(
    initial.get('direction') === 'index' ? 'index' : 'folio',
  );
  const [theme, setTheme] = useState(initial.get('theme') === 'dark' ? 'dark' : 'light');
  const { path, params } = useRoute();
  const { items, signedIn, notice } = useDemo();
  useLayoutEffect(() => {
    document.documentElement.dataset.direction = direction;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const url = new URL(location.href);
    url.searchParams.set('direction', direction);
    url.searchParams.set('theme', theme);
    history.replaceState(history.state, '', url);
  }, [direction, theme]);
  const bookId = path.match(/^\/(?:books|read)\/([^/]+)$/)?.[1];
  const book = items.find((item) => item.id === bookId);
  const locked = book?.kind === 'shared' && !signedIn;
  const reader = path.startsWith('/read/') && book && !locked;
  let content;
  if (bookId && (!book || locked))
    content = (
      <>
        <PageHeading
          eyebrow="Demo library"
          title={locked ? 'Account book hidden' : 'Book unavailable'}
        />
        <p>
          {locked
            ? 'Sign in as Alex Rowan to reveal retained account downloads. Local books are still available.'
            : 'This sample was removed, or the link does not match a demo title.'}
        </p>
        <Link className="button" to={locked ? '/more' : '/library'}>
          {locked ? 'Sign in to the same demo account' : 'Back to Library'}
        </Link>
      </>
    );
  else if (book && path.startsWith('/books/'))
    content = (
      <div className="detail-workspace">
        <Library params={params} split />
        <BookDetail key={book.id} book={book} params={params} />
      </div>
    );
  else if (path === '/library') content = <Library params={params} />;
  else if (path === '/offline') content = <Offline />;
  else if (path === '/insights') content = <Insights />;
  else if (path === '/more') content = <More />;
  else if (path === '/sync') content = <Sync params={params} />;
  else
    content = (
      <>
        <PageHeading eyebrow="Design study" title="Page not found" />
        <Link to="/library">Return to Library</Link>
      </>
    );
  return (
    <>
      {!reader && (
        <StudioBar
          direction={direction}
          theme={theme}
          setDirection={setDirection}
          setTheme={setTheme}
        />
      )}
      {reader ? (
        <>
          <Reader key={book.id} book={book} />
          <div role="status" className={`toast ${notice ? 'visible' : ''}`}>
            {notice}
          </div>
        </>
      ) : (
        <Shell path={path}>{content}</Shell>
      )}
    </>
  );
}
