import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Snackbar.module.css';

type NoticeOptions = {
  message: string;
  action?: { label: string; onClick: () => void };
  placement?: 'reader';
  tone?: 'error';
  icon?: IconName;
};
type Owner = { active: boolean };
type Notice = NoticeOptions & { owner: Owner; id: number };
type Slot = { show(owner: Owner, options: NoticeOptions): void; dismiss(owner: Owner): void };
const SnackbarContext = createContext<Slot | null>(null);

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const current = useRef<Notice | null>(null);
  const nextId = useRef(0);
  const close = useCallback((entry: Notice) => {
    if (current.current !== entry) return false;
    current.current = null;
    setNotice(null);
    return true;
  }, []);
  const slot = useMemo<Slot>(() => ({
    show(owner, options) {
      if (!owner.active) return;
      const entry = { ...options, owner, id: ++nextId.current };
      current.current = entry;
      setNotice(entry);
    },
    dismiss(owner) {
      const entry = current.current;
      if (entry?.owner === owner) close(entry);
    },
  }), [close]);
  return <SnackbarContext.Provider value={slot}>
    {children}
    <SnackbarHost notice={notice} close={close} />
  </SnackbarContext.Provider>;
}

export function useSnackbar(scope?: string) {
  const slot = useContext(SnackbarContext);
  if (!slot) throw new Error('SnackbarProvider is required');
  // Owner Lifetime - A returning scope gets a fresh owner so callbacks from its earlier visit stay inactive.
  const owner = useMemo(() => ({ scope, slot, active: false }), [scope, slot]);
  useLayoutEffect(() => {
    owner.active = true;
    return () => { owner.active = false; owner.slot.dismiss(owner); };
  }, [owner]);
  return useMemo(() => ({
    show: (options: NoticeOptions) => owner.slot.show(owner, options),
    dismiss: () => owner.slot.dismiss(owner),
  }), [owner]);
}

function SnackbarHost({ notice, close }: { notice: Notice | null; close(entry: Notice): boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const hovered = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const updateTimer = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (!notice || !panel.current) {
      hovered.current = false;
      returnFocus.current = null;
      return;
    }
    const element = panel.current;
    const entry = notice;
    let remaining = entry.action ? 9000 : 3000;
    let started = 0;
    let timer: number | undefined, fade: Animation | undefined;
    function update() {
      if (hovered.current || element.contains(document.activeElement) || document.hidden) {
        if (timer !== undefined) {
          window.clearTimeout(timer);
          fade?.cancel();
          timer = undefined;
          remaining = Math.max(0, remaining - (performance.now() - started));
        }
      } else if (timer === undefined) {
        started = performance.now();
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const duration = Math.min(150, remaining);
          fade = element.animate([{ opacity: 1 }, { opacity: 0 }], { delay: remaining - duration, duration, fill: 'forwards' });
        }
        timer = window.setTimeout(() => close(entry), remaining);
      }
    }
    updateTimer.current = update;
    document.addEventListener('visibilitychange', update);
    update();
    return () => {
      window.clearTimeout(timer);
      fade?.cancel();
      document.removeEventListener('visibilitychange', update);
      updateTimer.current = undefined;
    };
  }, [notice, close]);

  function finish(entry: Notice, runAction = false) {
    if (!entry.owner.active || !close(entry)) return;
    if (panel.current?.contains(document.activeElement)) returnFocus.current?.focus({ preventScroll: true });
    if (runAction && entry.owner.active) entry.action?.onClick();
  }
  return <div ref={panel} className={notice ? styles.snackbar : styles.idle} data-snackbar={notice ? '' : undefined} data-placement={notice?.placement} data-tone={notice?.tone}
    onPointerEnter={event => { if (event.pointerType !== 'touch') { hovered.current = true; updateTimer.current?.(); } }}
    onPointerLeave={event => { if (event.pointerType !== 'touch') { hovered.current = false; updateTimer.current?.(); } }}
    onFocus={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) returnFocus.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null;
      updateTimer.current?.();
    }}
    onBlur={() => queueMicrotask(() => updateTimer.current?.())}>
    {notice && <Icon name={notice.icon ?? (notice.tone === 'error' ? 'warning' : 'info')} size={18} />}
    <span className={styles.message} role="status" aria-atomic="true">{notice && <span key={notice.id}>{notice.message}</span>}</span>
    {notice?.action && <button type="button" className={styles.action} onClick={() => finish(notice, true)}>{notice.action.label}</button>}
    {notice && <button type="button" aria-label="Dismiss" onClick={() => finish(notice)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
    </button>}
  </div>;
}
