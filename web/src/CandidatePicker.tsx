import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import hardcoverIcon from './assets/hardcover.svg';
import openLibraryIcon from './assets/openlibrary.svg';
import { Icon } from './Icon';
import styles from './CandidatePicker.module.css';

export const candidateProviders = { openlibrary: { name: 'Open Library', icon: openLibraryIcon }, hardcover: { name: 'Hardcover', icon: hardcoverIcon } };
type Provider = keyof typeof candidateProviders;
type Book = { title: string; author: string };
type ProviderMatch = { work_id: string; url?: string };
type Candidate = Book & ProviderMatch & { reason?: string };
type CandidatePickerProps<T extends Candidate> = {
  label: string;
  groupLabel: string;
  selected?: T;
  candidates: T[];
  disabled?: boolean;
  placeholder?: string;
  toolbar?: ReactNode;
  emptyMessage?: string;
  onChoose: (candidate: T) => void;
  provider?: Provider;
};

export function BookInfo({ book, isbn }: { book: Book; isbn?: string }) {
  return <span className={styles.bookInfo}>
    <span className={styles.bookTitle} title={book.title}>{book.title}</span>
    {book.author && <span className={styles.author} title={book.author}>{book.author}</span>}
    {isbn && <span className={styles.isbn}>ISBN {isbn}</span>}
  </span>;
}

export function ProviderPill({ provider, match, matchValue }: { provider?: Provider; match: ProviderMatch; matchValue?: boolean }) {
  const branding = provider && candidateProviders[provider];
  const contents = <>{branding && <img src={branding.icon} alt="" width={15} height={15} />}<span>{match.work_id}</span></>;
  if (!match.url) return <span className={styles.providerPill}>{contents}</span>;
  return <a className={styles.providerPill} href={match.url} target="_blank" rel="noopener noreferrer" data-match-value={matchValue || undefined}
    aria-label={`${match.work_id}${branding ? ` on ${branding.name}` : ''} (Opens in a New Tab)`}>{contents}</a>;
}

function placePicker(picker: HTMLDivElement, content: HTMLDivElement, anchor: HTMLButtonElement) {
  const rect = anchor.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft ?? 0) + 8, top = (viewport?.offsetTop ?? 0) + 8;
  const right = left + (viewport?.width ?? document.documentElement.clientWidth) - 16;
  const bottom = top + (viewport?.height ?? document.documentElement.clientHeight) - 16;
  const below = Math.max(0, bottom - rect.bottom - 4), above = Math.max(0, rect.top - top - 4);
  picker.style.maxWidth = `${right - left}px`;
  const openAbove = below < Math.min(content.offsetHeight + 12, 320) && above > below;
  picker.style.maxHeight = `${Math.min(320, openAbove ? above : below)}px`;
  const { width, height } = picker.getBoundingClientRect();
  picker.style.left = `${Math.max(left, Math.min(rect.right - width, right - width))}px`;
  picker.style.top = `${openAbove ? rect.top - height - 4 : rect.bottom + 4}px`;
}

export function CandidatePicker<T extends Candidate>({ label, groupLabel, selected, candidates, disabled, placeholder = 'Choose Match', toolbar, emptyMessage = 'No Match', onChoose, provider }: CandidatePickerProps<T>) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [sheetWidth, setSheetWidth] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  const inline = toolbar != null && sheetWidth;
  useEffect(() => {
    if (toolbar == null) return;
    const media = window.matchMedia('(max-width: 760px)');
    const resize = () => { setOpen(false); setSheetWidth(media.matches); };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, [toolbar != null]);

  useEffect(() => {
    if (!inline || !open) return;
    function dismiss(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !picker.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    }
    function escape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [inline, open]);

  const position = () => {
    if (picker.current?.matches(':popover-open') && content.current && trigger.current) placePicker(picker.current, content.current, trigger.current);
  };

  useLayoutEffect(position);
  useEffect(() => {
    if (!open || inline || !content.current || !trigger.current) return;
    const observer = new ResizeObserver(position);
    observer.observe(content.current);
    observer.observe(trigger.current);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open, inline]);

  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const options = resultButtons(event.currentTarget);
    const index = options.findIndex(option => option === event.target);
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[next].focus();
  }

  return <>
    <button ref={trigger} type="button" className={styles.trigger} data-rounded={toolbar != null || undefined} data-match-value aria-label={label}
      popoverTarget={inline ? undefined : id} aria-controls={id} aria-expanded={open} disabled={disabled} onClick={inline ? () => setOpen(!open) : undefined} onKeyDown={event => {
        const popup = picker.current;
        if (!popup || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
        event.preventDefault();
        if (!open) event.currentTarget.click();
        const first = event.key === 'ArrowDown';
        requestAnimationFrame(() => {
          const options = resultButtons(popup);
          options[first ? 0 : options.length - 1]?.focus();
        });
      }}>
      {selected ? <BookInfo book={selected} /> : <span className={styles.placeholder}>{placeholder}</span>}<Icon name="down" size={14} />
    </button>
    <div key={inline ? 'sheet' : 'popover'} id={id} ref={picker} className={inline ? styles.sheetPicker : styles.picker} hidden={inline && !open} popover={inline ? undefined : 'auto'} role="group" aria-label={groupLabel} onKeyDown={keys}
      onToggle={event => {
        if (event.target !== event.currentTarget) return;
        setOpen(event.newState === 'open');
        if (event.newState === 'open') position();
      }}>
      <div ref={content}>
        {toolbar}
        {candidates.length === 0 && emptyMessage && <p role="status" className={styles.empty}>{emptyMessage}</p>}
        {candidates.map(item => <div className={styles.candidate} key={item.work_id}>
          <button type="button" data-candidate disabled={disabled} onClick={() => {
            if (inline) setOpen(false); else picker.current?.hidePopover();
            trigger.current?.focus({ preventScroll: true });
            onChoose(item);
          }}><BookInfo book={item} /></button>
          <ProviderPill provider={provider} match={item} />
          {item.reason && <p>{item.reason}</p>}
        </div>)}
      </div>
    </div>
  </>;
}

function resultButtons(popup: HTMLDivElement) {
  return Array.from(popup.querySelectorAll<HTMLButtonElement>('button[data-candidate]:enabled'));
}
