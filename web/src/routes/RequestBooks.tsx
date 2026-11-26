import { useState } from 'react';
import { Navigate } from 'react-router';
import { ActionRow, ActionRows, Button, Card, CardHeader, SearchField, SegmentedControl } from '../Controls';
import { useSession } from '../session';
import { useShelfmarkPreview } from '../shelfmarkPreview';
import { Dialog, PageHeader } from '../ui';
import { useSnackbar } from '../Snackbar';
import styles from '../App.module.css';
import dune from '../assets/request-preview/dune.jpg';
import messiah from '../assets/request-preview/messiah.jpg';
import children from '../assets/request-preview/children.jpg';
import earthsea from '../assets/request-preview/earthsea.jpg';
import { Icon } from '../Icon';
import coverStyles from './RequestBooks.module.css';

const catalog = [
  {
    id: 'dune',
    cover: dune,
    title: 'Dune',
    author: 'Frank Herbert',
    year: 1965,
    synopsis:
      'On the desert planet Arrakis, Paul Atreides finds himself caught between an empire and the people who call the dunes home.',
  },
  {
    id: 'messiah',
    cover: messiah,
    title: 'Dune Messiah',
    author: 'Frank Herbert',
    year: 1969,
    synopsis: 'Twelve years after taking the throne, Paul faces a conspiracy that his visions cannot fully untangle.',
  },
  {
    id: 'children',
    cover: children,
    title: 'Children of Dune',
    author: 'Frank Herbert',
    year: 1976,
    synopsis: 'The twin heirs to the Atreides throne inherit a desert world on the brink of change.',
  },
  {
    id: 'earthsea',
    cover: earthsea,
    title: 'A Wizard of Earthsea',
    author: 'Ursula K. Le Guin',
    year: 1968,
    synopsis: 'A young wizard sails an archipelago in pursuit of the shadow he set loose.',
  },
];
type Book = (typeof catalog)[number];
type RequestEntry = { bookId: string; username: string; date: string };
const historyKey = 'antholume:shared-request-preview';
function previewHistory(): RequestEntry[] {
  try {
    const saved = JSON.parse(sessionStorage.getItem(historyKey) ?? 'null');
    if (
      Array.isArray(saved) &&
      saved.every(
        (row) =>
          row &&
          catalog.some((book) => book.id === row.bookId) &&
          typeof row.username === 'string' &&
          typeof row.date === 'string' &&
          Number.isFinite(Date.parse(row.date)),
      )
    )
      return saved;
  } catch {
    /* Use the sample history if storage is unavailable. */
  }
  return [
    { bookId: 'messiah', username: 'alex', date: new Date(Date.now() - 86400000).toISOString() },
    { bookId: 'earthsea', username: 'sam', date: new Date(Date.now() - 172800000).toISOString() },
  ];
}
const requestDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function Cover({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={coverStyles.cover} aria-hidden="true">
      {src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Icon name="book" />}
    </span>
  );
}

export function RequestBooks() {
  const { access, session } = useSession();
  const { mode } = useShelfmarkPreview();
  if (mode !== 'enabled' || access.kind !== 'authenticated') return <Navigate to="/library" replace />;
  const scope = JSON.stringify(access.account);
  return <RequestCatalog key={scope} scope={scope} username={session?.user?.id ?? access.account.userId} />;
}

function RequestCatalog({ scope, username }: { scope: string; username: string }) {
  const [view, setView] = useState<'search' | 'history'>('search');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  function editQuery(value: string) {
    setQuery(value);
    if (value.trim().toLowerCase() !== term) setTerm('');
  }
  const [selected, select] = useState<Book | null>(null);
  const [history, setHistory] = useState(previewHistory);
  const requested = new Map(history.map((entry) => [entry.bookId, entry]));
  const previous = selected && requested.get(selected.id);
  const { show } = useSnackbar(scope);
  const results = term ? catalog.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(term)) : [];
  function confirm(book: Book) {
    if (requested.has(book.id)) return;
    const next = [{ bookId: book.id, username, date: new Date().toISOString() }, ...history];
    setHistory(next);
    try {
      sessionStorage.setItem(historyKey, JSON.stringify(next));
    } catch {
      /* Keep the preview usable in memory. */
    }
    select(null);
    show({ message: `Requested ${book.title} in this preview.` });
  }
  return (
    <>
      <PageHeader title="Request" mobileBrand />
      <div className={styles.settingsLayout}>
        <SegmentedControl
          label="Request Views"
          options={[
            ['search', 'Search'],
            ['history', 'History'],
          ]}
          value={view}
          onChange={setView}
        />
        {view === 'search' ? (
          <Card density="compact" aria-labelledby="request-search">
            <CardHeader id="request-search" title="Find a Book" />
            <form
              role="search"
              className={styles.settingsCardRows}
              onSubmit={(event) => {
                event.preventDefault();
                setTerm(query.trim().toLowerCase());
              }}
            >
              <SearchField
                aria-label="Search Books to Request"
                placeholder="Search by title or author"
                value={query}
                enterKeyHint="search"
                submit={{ label: 'Search Books', title: 'Search Books' }}
                onChange={(event) => editQuery(event.target.value)}
                onClear={query ? () => editQuery('') : undefined}
              />
            </form>
            {term && (
              <div role="group" aria-label="Search Results" className={coverStyles.results}>
                <p className={results.length ? styles.srOnly : coverStyles.emptyResults} role="status">
                  {results.length
                    ? `${results.length} ${results.length === 1 ? 'book' : 'books'} found`
                    : 'No books found. Try another title or author.'}
                </p>
                {results.length > 0 && (
                  <ActionRows>
                    {results.map((book) => (
                      <ActionRow
                        key={book.id}
                        leading={<Cover src={book.cover} />}
                        label={book.title}
                        subtitle={
                          requested.has(book.id)
                            ? `${book.author} · Requested by ${requested.get(book.id)?.username}`
                            : `${book.author} · ${book.year}`
                        }
                        onClick={() => select(book)}
                      />
                    ))}
                  </ActionRows>
                )}
              </div>
            )}
          </Card>
        ) : (
          <Card density="compact" aria-labelledby="request-history">
            <CardHeader id="request-history" title="Request History" />
            <ActionRows>
              {history.map((entry) => {
                const book = catalog.find((book) => book.id === entry.bookId)!;
                return (
                  <ActionRow
                    key={book.id}
                    leading={<Cover src={book.cover} />}
                    label={book.title}
                    subtitle={`Requested by ${entry.username} · ${requestDate.format(new Date(entry.date))}`}
                    onClick={() => select(book)}
                  />
                );
              })}
            </ActionRows>
          </Card>
        )}
      </div>
      {selected && (
        <Dialog
          title={selected.title}
          titleLeading={<Cover src={selected.cover} />}
          placement="mobile-sheet"
          onClose={() => select(null)}
          footer={
            previous ? (
              <Button onClick={() => select(null)}>Done</Button>
            ) : (
              <Button tone="primary" onClick={() => confirm(selected)}>
                Request Ebook
              </Button>
            )
          }
        >
          <p className={styles.settingsCardFeedback}>
            {selected.author} · {selected.year} · Ebook
          </p>
          <p>{selected.synopsis}</p>
          <p className={styles.settingsCardFeedback}>
            {previous
              ? `Requested by ${previous.username} on ${requestDate.format(new Date(previous.date))}.`
              : 'Preview only. This will not start a download.'}
          </p>
        </Dialog>
      )}
    </>
  );
}
