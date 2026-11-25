import { useEffect, useEffectEvent, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';

export function useActionPanel(open: boolean, trigger: RefObject<HTMLElement | null>, panel: RefObject<HTMLElement | null>, onDismiss: () => void) {
  function contains(target: EventTarget | null) {
    return target instanceof Node && (trigger.current?.contains(target) || panel.current?.contains(target));
  }

  function dismiss(restoreFocus = false) {
    onDismiss();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }

  const onOutsidePointer = useEffectEvent((event: PointerEvent) => {
    if (!contains(event.target)) dismiss();
  });
  useEffect(() => {
    if (!open) return;
    window.addEventListener('pointerdown', onOutsidePointer, true);
    return () => window.removeEventListener('pointerdown', onOutsidePointer, true);
  }, [open]);

  return {
    dismiss,
    events: {
      onBlur(event: FocusEvent<HTMLElement>) {
        // Safari Taps - A tap can blur the current action before activating it, without a new focus target.
        if (open && event.relatedTarget && !contains(event.relatedTarget)) dismiss();
      },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        if (!open || event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        dismiss(true);
      },
    },
  };
}
