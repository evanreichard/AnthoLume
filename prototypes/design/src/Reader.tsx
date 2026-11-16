import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { defaultReaderSession, useDemo } from './DemoState';
import { chapterTitles, sampleParagraphs, type Book } from './data';
import { back, Link } from './navigation';
import { Dialog, Icon } from './ui';

export function Reader({ book }: { book: Book }) {
  const { readerSessions, updateReaderSession } = useDemo();
  const { chapter, size, font, paper, chrome } = readerSessions[book.id] ?? defaultReaderSession;
  const [panel, setPanel] = useState<'toc' | 'appearance' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const chapterTransition = useRef(false);
  const tocSelection = useRef(false);
  useLayoutEffect(() => {
    if (!chapterTransition.current) return;
    chapterTransition.current = false;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: 'start' });
  }, [chapter, panel]);
  useEffect(() => {
    function turn(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        panel ||
        target.closest('button, a, input, select, textarea, [contenteditable]') ||
        window.getSelection()?.toString()
      )
        return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (chapter < 3) chooseChapter(chapter + 1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        if (chapter > 0) chooseChapter(chapter - 1);
      }
    }
    window.addEventListener('keydown', turn);
    return () => window.removeEventListener('keydown', turn);
  }, [panel, chapter, book.id, updateReaderSession]);
  function chooseChapter(index: number) {
    chapterTransition.current = true;
    tocSelection.current = panel === 'toc';
    updateReaderSession(book.id, { chapter: index });
    setPanel(null);
  }
  return (
    <main
      className={`reader paper-${paper} ${chrome ? '' : 'quiet-reader'}`}
      data-reader-context={`${book.id}:${chapter}:${size}:${font}:${paper}:${chrome}`}
      style={
        {
          '--reader-size': `${size}px`,
          '--reader-font':
            font === 'serif' ? 'Georgia, "Times New Roman", serif' : 'system-ui, sans-serif',
        } as CSSProperties
      }
    >
      <header className="reader-header">
        <button className="back-link" onClick={() => back(`/books/${book.id}`)}>
          <Icon name="back" />
          <span>Back</span>
        </button>
        <div className="reader-book-label">
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
          <span className="appearance-label">Appearance</span>
        </button>
      </header>
      <div className="reader-disclaimer">
        Original sample text · NOT an EPUB engine · no durable position or activity is saved
      </div>
      <button
        className="chrome-control"
        onClick={() => updateReaderSession(book.id, { chrome: !chrome })}
        aria-pressed={!chrome}
      >
        {chrome ? 'Quiet reading' : 'Show reading controls'}
      </button>
      <div className="reader-layout">
        <aside className="reader-toc" aria-label="Chapters">
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
            Chapter navigation is illustrative. No activity credit is calculated.
          </p>
        </aside>
        <article className="reader-text">
          <p className="eyebrow">Chapter {chapter + 1} · original demo passage</p>
          <h1 ref={heading} tabIndex={-1} data-route-heading>
            {chapterTitles[chapter]}
          </h1>
          <div className="chapter-ornament" aria-hidden="true">
            ✳
          </div>
          {sampleParagraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          <p className="sample-end">
            End of sample passage · this same original passage illustrates each chapter.
          </p>
        </article>
      </div>
      <footer className="reader-footer">
        <button disabled={chapter === 0} onClick={() => chooseChapter(chapter - 1)}>
          <Icon name="back" />
          Previous
        </button>
        <div>
          <span role="status">Chapter {chapter + 1} of 4</span>
          <small>Sample position only</small>
        </div>
        <button disabled={chapter === 3} onClick={() => chooseChapter(chapter + 1)}>
          Next
          <Icon name="arrow" />
        </button>
      </footer>
      <div className="reader-sync">
        <Link to="/sync">Demo · 2 pending events →</Link>
        <span>No durable save or server connection</span>
      </div>
      {panel === 'toc' && (
        <Dialog
          title="Table of contents"
          onClose={() => setPanel(null)}
          focusOnClose={() => (tocSelection.current ? heading.current : null)}
        >
          <ol className="toc-list">
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
        </Dialog>
      )}
      {panel === 'appearance' && (
        <Dialog title="Reading appearance" onClose={() => setPanel(null)}>
          <div className="stack">
            <label className="field">
              Typeface
              <select
                value={font}
                onChange={(event) => updateReaderSession(book.id, { font: event.target.value })}
              >
                <option value="serif">Literary · system serif</option>
                <option value="sans">Clear · system sans</option>
              </select>
            </label>
            <label className="field">
              Text size · {size}px
              <input
                type="range"
                min="16"
                max="28"
                value={size}
                onChange={(event) =>
                  updateReaderSession(book.id, { size: Number(event.target.value) })
                }
              />
            </label>
            <fieldset>
              <legend>Page appearance</legend>
              <div className="segmented">
                {[
                  ['auto', 'Follow app'],
                  ['paper', 'Paper'],
                  ['ink', 'Ink'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={paper === value}
                    onClick={() => updateReaderSession(book.id, { paper: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="small muted">
              Preferences apply to this sample session only. Text reflows; no real EPUB anchor is
              involved.
            </p>
          </div>
        </Dialog>
      )}
    </main>
  );
}
