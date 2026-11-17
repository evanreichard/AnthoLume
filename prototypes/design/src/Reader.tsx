import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { defaultReaderSession, useDemo } from './DemoState';
import { chapterTitles, type Book } from './data';
import { back, Link } from './navigation';
import { ReaderPanels, type ReaderPanel } from './ReaderPanels';
import { pageParagraphs, sampleWords } from './samplePagination';
import { useSamplePages } from './useSamplePages';
import { usePageGestures } from './usePageGestures';
import { Icon } from './ui';
import './reader.css';

export function Reader({ book }: { book: Book }) {
  const { readerSessions, updateReaderSession, signedIn } = useDemo();
  const session = readerSessions[book.id] ?? defaultReaderSession;
  const { chapter, anchor, size, font, paper, chrome } = session;
  const [panel, setPanel] = useState<ReaderPanel>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const pageElement = useRef<HTMLElement>(null);
  const transition = useRef<'page' | 'chapter' | null>(null);
  const tocSelection = useRef(false);
  const { measurement, pages } = useSamplePages(`${chapter}:${size}:${font}:${chrome}`);
  const pageIndex = Math.max(
    0,
    pages.findIndex((page) => page.start <= anchor && anchor < page.end),
  );
  const page = pages[pageIndex] ?? { start: 0, end: 1 };
  const pageLabel = `Chapter ${chapter + 1} · page ${pageIndex + 1} of ${pages.length || 1}`;
  const first = chapter === 0 && pageIndex === 0;
  const last = chapter === 3 && pageIndex === pages.length - 1;
  const changeSession = (patch: Partial<typeof session>) => updateReaderSession(book.id, patch);

  function chooseChapter(index: number) {
    transition.current = 'chapter';
    tocSelection.current = panel === 'toc';
    changeSession({ chapter: index, anchor: 0 });
    setPanel(null);
  }
  function turnPage(direction: -1 | 1) {
    if (!pages.length || (direction === -1 && first) || (direction === 1 && last)) return;
    transition.current = 'page';
    const next = pages[pageIndex + direction];
    if (next) changeSession({ anchor: next.start });
    else {
      transition.current = 'chapter';
      changeSession({
        chapter: chapter + direction,
        anchor: direction === 1 ? 0 : sampleWords.length - 1,
      });
    }
  }
  const pageGestures = usePageGestures(Boolean(panel), turnPage);
  useLayoutEffect(() => {
    if (!transition.current) return;
    const target = transition.current === 'chapter' ? heading.current : pageElement.current;
    transition.current = null;
    target?.focus({ preventScroll: true });
  }, [chapter, pageIndex, panel]);
  useEffect(() => {
    function turn(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        panel ||
        target.closest('button, a, input, select, textarea, [contenteditable]') ||
        window.getSelection()?.toString()
      )
        return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        turnPage(event.key === 'ArrowRight' ? 1 : -1);
      }
    }
    window.addEventListener('keydown', turn);
    return () => window.removeEventListener('keydown', turn);
  });
  return (
    <main
      className={`paginated-reader paper-${paper} ${chrome ? '' : 'quiet-reader'}`}
      data-reader-context={book.id}
      style={
        {
          '--reader-size': `${size}px`,
          '--reader-font':
            font === 'serif' ? 'Georgia, "Times New Roman", serif' : 'system-ui, sans-serif',
        } as CSSProperties
      }
    >
      <header className="page-reader-header">
        <button className="icon-button" aria-label="Back" onClick={() => back(`/books/${book.id}`)}>
          <Icon name="back" />
        </button>
        <div className="page-book-label">
          <b>{book.title}</b>
          <span>{book.author}</span>
        </div>
        <button
          onClick={() => {
            tocSelection.current = false;
            setPanel('toc');
          }}
        >
          Contents
        </button>
        <button aria-label="Appearance" onClick={() => setPanel('appearance')}>
          <span className="type-icon" aria-hidden="true">
            Aa
          </span>
        </button>
      </header>
      <p className="page-disclaimer">
        Synthetic text · NOT an EPUB engine · no activity or durable save
      </p>
      <div className="page-reader-layout">
        <aside className="page-toc" aria-label="Chapters">
          <p className="eyebrow">{book.title} · sample</p>
          <h2>Contents</h2>
          <ol>
            {chapterTitles.map((title, index) => (
              <li key={title}>
                <button
                  aria-current={chapter === index ? 'location' : undefined}
                  onClick={() => chooseChapter(index)}
                >
                  <span>0{index + 1}</span>
                  {title}
                </button>
              </li>
            ))}
          </ol>
          <p className="small muted">
            Original repeated passage. No activity credit is calculated.
          </p>
        </aside>
        <section className="page-reading-area" aria-label="Paginated sample">
          <div className="page-chapter">
            <span className="eyebrow">Chapter {chapter + 1} / 4 · sample</span>
            <h1 ref={heading} tabIndex={-1} data-route-heading>
              {chapterTitles[chapter]}
            </h1>
          </div>
          <div className="page-window">
            <article
              ref={pageElement}
              tabIndex={-1}
              className="page-text"
              aria-label={pageLabel}
              data-page-start={page.start}
              data-page-end={page.end}
              data-anchor={anchor}
              {...pageGestures}
            >
              {pageParagraphs(page).map((text, index) => (
                <p key={`${page.start}:${index}`}>{text}</p>
              ))}
            </article>
            <div ref={measurement} className="page-text page-measure" aria-hidden="true" />
          </div>
        </section>
      </div>
      <footer className="page-reader-footer">
        <div className="page-turns">
          <button
            aria-label="Previous"
            disabled={first || !pages.length}
            onClick={() => turnPage(-1)}
          >
            <Icon name="back" />
            <span>Previous</span>
          </button>
          <span className="page-position" role="status">
            Page {pageIndex + 1} / {pages.length || 1}
            <small>Chapter {chapter + 1} / 4 · sample</small>
          </span>
          <button aria-label="Next" disabled={last || !pages.length} onClick={() => turnPage(1)}>
            <span>Next</span>
            <Icon name="arrow" />
          </button>
        </div>
        <div className="page-secondary">
          <button aria-pressed={!chrome} onClick={() => changeSession({ chrome: !chrome })}>
            {chrome ? 'Quiet reading' : 'Show reading controls'}
          </button>
          <Link
            to="/sync"
            aria-label={signedIn ? 'Demo · 2 pending events →' : 'Demo · account events paused →'}
          >
            Sync · demo <Icon name="arrow" />
          </Link>
        </div>
      </footer>
      <ReaderPanels
        panel={panel}
        session={session}
        onClose={() => setPanel(null)}
        onChapter={chooseChapter}
        onChange={changeSession}
        focusAfterToc={() => (tocSelection.current ? heading.current : null)}
      />
    </main>
  );
}
