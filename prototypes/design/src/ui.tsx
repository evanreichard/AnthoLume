import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Book } from './data';

export function Icon({ name, ...props }: { name: string; className?: string }) {
  const paths: Record<string, ReactNode> = {
    library: (
      <>
        <path d="M4 5h5v15H4zM9 5h5v15H9zM16 4l4-1 4 15-4 1z" />
      </>
    ),
    offline: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5" />
      </>
    ),
    insights: (
      <>
        <path d="M4 20V11m8 9V4m8 16V8M2 20h20" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    filter: (
      <>
        <path d="M4 6h16M7 12h10M10 18h4" />
        <circle cx="8" cy="6" r="2" fill="currentColor" />
        <circle cx="16" cy="12" r="2" fill="currentColor" />
      </>
    ),
    shared: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5" />
      </>
    ),
    device: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 17h6" />
      </>
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
      </>
    ),
    book: (
      <>
        <path d="M12 5v16M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z" />
      </>
    ),
  };
  return (
    <svg
      {...props}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.book}
    </svg>
  );
}

export function Cover({ book, small = false }: { book: Book; small?: boolean }) {
  return (
    <div className={`cover cover-${book.cover} ${small ? 'cover-small' : ''}`} aria-hidden="true">
      <span className="cover-author">{book.author}</span>
      <strong>{book.title}</strong>
      <div className="cover-art">
        <i />
        <i />
        <i />
      </div>
      <span className="cover-footer">{book.category} · AL</span>
    </div>
  );
}

export function SourceBadge({ kind }: { kind: Book['kind'] }) {
  const label = kind === 'shared' ? 'Shared library' : 'Local original';
  return (
    <span
      className={`source-badge source-${kind}`}
      role="img"
      aria-label={`Source: ${label}`}
      title={label}
    >
      <Icon name={kind === 'shared' ? 'shared' : 'device'} />
    </span>
  );
}

export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function PageHeading({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 tabIndex={-1} data-route-heading>
          {title}
        </h1>
      </div>
      {children}
    </header>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  focusOnClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  focusOnClose?: () => HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const focusRef = useRef(focusOnClose);
  focusRef.current = focusOnClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      const requested = focusRef.current?.();
      const destination = requested?.isConnected
        ? requested
        : opener?.isConnected && !opener.matches(':disabled')
          ? opener
          : Array.from(document.querySelectorAll<HTMLElement>('[data-route-heading]')).at(-1);
      destination?.focus({ preventScroll: destination === opener && !requested });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose} autoFocus>
          <Icon name="close" />
        </button>
      </div>
      <div className="dialog-content">{children}</div>
    </dialog>,
    document.body,
  );
}

export function Confirm({
  title,
  children,
  action,
  onConfirm,
  onClose,
  focusAfterConfirm,
}: {
  title: string;
  children: ReactNode;
  action: string;
  onConfirm: () => void;
  onClose: () => void;
  focusAfterConfirm?: () => HTMLElement | null;
}) {
  const confirmed = useRef(false);
  return (
    <Dialog
      title={title}
      onClose={onClose}
      focusOnClose={() => (confirmed.current ? (focusAfterConfirm?.() ?? null) : null)}
    >
      <p className="eyebrow">Demo confirmation · no real data affected</p>
      {children}
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="danger"
          onClick={() => {
            confirmed.current = true;
            onConfirm();
            onClose();
          }}
        >
          {action}
        </button>
      </div>
    </Dialog>
  );
}
