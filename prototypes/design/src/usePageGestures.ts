import { useRef, type PointerEvent } from 'react';

type Gesture = {
  id: number;
  x: number;
  y: number;
  maxX: number;
  maxY: number;
  selected: boolean;
};
const interactive = (target: EventTarget) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'a, button, input, select, textarea, summary, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])',
    ),
  );
const selected = () => Boolean(window.getSelection()?.toString());

// Single Turn Boundary - Pointer-up owns taps and swipes; compatibility clicks never turn another page.
export function usePageGestures(blocked: boolean, turn: (direction: -1 | 1) => void) {
  const gesture = useRef<Gesture | null>(null);
  function track(event: PointerEvent<HTMLElement>, origin: Gesture) {
    origin.maxX = Math.max(origin.maxX, Math.abs(event.clientX - origin.x));
    origin.maxY = Math.max(origin.maxY, Math.abs(event.clientY - origin.y));
    origin.selected ||= selected();
  }
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      gesture.current =
        !blocked && event.isPrimary && event.button === 0 && !interactive(event.target)
          ? {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              maxX: 0,
              maxY: 0,
              selected: selected(),
            }
          : null;
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const origin = gesture.current;
      if (origin && origin.id === event.pointerId) track(event, origin);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const origin = gesture.current;
      gesture.current = null;
      if (!origin || origin.id !== event.pointerId || blocked || interactive(event.target)) return;
      track(event, origin);
      if (origin.selected) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.abs(dx) > 60 && Math.abs(dy) < 35 && origin.maxY < 35) {
        turn(dx < 0 ? 1 : -1);
        return;
      }
      if (origin.maxX > 8 || origin.maxY > 8) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientY < bounds.top || event.clientY > bounds.bottom) return;
      const x = (event.clientX - bounds.left) / bounds.width;
      if (x >= 0 && x <= 0.2) turn(-1);
      else if (x >= 0.8 && x <= 1) turn(1);
    },
    onPointerCancel() {
      gesture.current = null;
    },
  };
}
