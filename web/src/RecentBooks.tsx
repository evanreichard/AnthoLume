import { useEffect, useRef, useState } from 'react';
import { bookKey, type LibraryBook } from './library';
import { BookHero } from './BookPresentation';
import styles from './App.module.css';

function RecentBook({ book, bookLinkState, embedded }: { book: LibraryBook; bookLinkState: { librarySearch: string }; embedded?: boolean }) {
  const fraction = book.stored?.checkpoint.fraction ?? book.document?.resume_fraction;
  return <BookHero variant="continue" embedded={embedded} book={book} linkState={bookLinkState} progress={fraction == null ? null : Math.round(fraction * 100)} />;
}

type RecentBooksProps = { books: readonly LibraryBook[]; bookLinkState: { librarySearch: string } };

export function RecentBooks({ books, bookLinkState }: RecentBooksProps) {
  if (!books.length) return null;
  if (books.length === 1) return <RecentBook book={books[0]!} bookLinkState={bookLinkState} />;
  return <RecentCarousel key={JSON.stringify(books.map(book => bookKey(book.ref)))} books={books} bookLinkState={bookLinkState} />;
}

function RecentCarousel({ books, bookLinkState }: RecentBooksProps) {
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  const [touchHint, setTouchHint] = useState(false);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReduced(motion.matches);
    const updateVisibility = () => setVisible(!document.hidden);
    motion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      motion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);
  const go = (index: number) => {
    const el = track.current;
    if (!el) return;
    const direction = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
    el.scrollTo({ left: index * el.clientWidth * direction, behavior: reduced ? 'instant' : 'smooth' });
  };
  useEffect(() => {
    if (touching || !touchHint) return;
    const timer = window.setTimeout(() => setTouchHint(false), 2500);
    return () => window.clearTimeout(timer);
  }, [touching, touchHint]);
  useEffect(() => {
    if (paused || reduced || hovered || focused || touching || touchHint || !visible) return;
    const timer = window.setTimeout(() => go((active + 1) % books.length), 5000);
    return () => window.clearTimeout(timer);
  }, [active, books.length, paused, reduced, hovered, focused, touching, touchHint, visible]);
  return <div className={styles.recentCarousel} role="region" aria-label="Continue reading carousel" aria-roledescription="carousel"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setHovered(true); }} onPointerLeave={() => setHovered(false)}
    data-show-dots={hovered || touchHint || undefined}
    onTouchStart={() => { setTouching(true); setTouchHint(true); }} onTouchEnd={() => setTouching(false)} onTouchCancel={() => setTouching(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <div className={styles.recentTrack} ref={track}
      onScroll={event => {
        const el = event.currentTarget;
        const index = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
        setActive(Math.max(0, Math.min(books.length - 1, index)));
      }}>
      {books.map((book, index) => <div key={bookKey(book.ref)} className={styles.recentSlide} inert={index !== active} aria-hidden={index !== active || undefined}>
        <RecentBook embedded book={book} bookLinkState={bookLinkState} />
      </div>)}
    </div>
    <div className={styles.recentControls}>
      <div className={styles.recentDots} role="group" aria-label="Choose recent book">
        {books.map((book, index) => <button key={bookKey(book.ref)} type="button" aria-label={`Show ${book.title || 'Untitled'} (${index + 1} of ${books.length})`} aria-pressed={index === active} onClick={() => go(index)}><span /></button>)}
      </div>
      {!reduced && <button type="button" className={styles.recentPause} aria-label={paused ? 'Play Recent Books' : 'Pause Recent Books'} onClick={() => setPaused(!paused)}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{paused ? <path d="M5 3v10l8-5z" /> : <path d="M4 3h3v10H4zm5 0h3v10H9z" />}</svg>
      </button>}
    </div>
  </div>;
}
