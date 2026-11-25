import { useEffect, useId, useRef, type ReactNode, type Ref } from 'react';
import styles from './App.module.css';

type PageHeaderProps = { actions?: ReactNode; mobileBrand?: boolean } & (
  | { title: string; headingRef?: Ref<HTMLHeadingElement>; leading?: ReactNode }
  | { title?: never; headingRef?: never; leading: ReactNode }
);

export function PageHeader({ title, headingRef, leading, actions, mobileBrand }: PageHeaderProps) {
  return <header className={styles.pageTitle}>
    <div className={styles.pageTitleStart}>
      {mobileBrand && <img className={styles.mobileBrand} src="/assets/icons/mark.svg" width="30" height="30" alt="" />}
      {leading}
      {title && <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>{title}</h1>}
    </div>
    {actions}
  </header>;
}

type DialogProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  dismissDisabled?: boolean;
  size?: 'default' | 'wide';
  layout?: 'content' | 'scroll-body';
  scrollHeight?: 'default' | 'tall';
  placement?: 'center' | 'mobile-sheet';
  toolbar?: ReactNode;
  titleLeading?: ReactNode;
  footer?: ReactNode;
};

export function Dialog({ title, children, onClose, dismissDisabled = false, size = 'default', layout = 'content', scrollHeight = 'default', placement = 'center', toolbar, titleLeading, footer }: DialogProps) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const heading = titleRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Give native dialog focus a non-interactive target instead of the first button.
    heading?.setAttribute('autofocus', '');
    dialog?.showModal();
    if (heading && document.activeElement !== heading) heading.focus({ preventScroll: true });
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  const heading = <h2 id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>;
  return <dialog ref={ref} className={styles.dialog} data-size={size} data-layout={layout} data-scroll-height={layout === 'scroll-body' ? scrollHeight : undefined} data-placement={placement} onCancel={(event) => { event.preventDefault(); if (!dismissDisabled) onClose(); }} onClick={(event) => { if (!dismissDisabled && event.target === ref.current) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom) onClose();
  } }} aria-labelledby={titleId}>
    <header className={styles.dialogHeader}>{titleLeading ? <div className={styles.dialogTitleGroup}>{titleLeading}{heading}</div> : heading}<button type="button" className={styles.icon} disabled={dismissDisabled} onClick={onClose} aria-label="Close Dialog">×</button></header>
    {toolbar != null && <div className={styles.dialogToolbar}>{toolbar}</div>}
    {layout === 'scroll-body' ? <div className={styles.dialogBody}>{children}</div> : children}
    {footer != null && <footer className={styles.dialogFooter}>{footer}</footer>}
  </dialog>;
}

export function ErrorNotice({ error }: { error: unknown }) {
  return error ? <p role="alert" className={styles.error}>{error instanceof Error ? error.message : String(error)}</p> : null;
}
