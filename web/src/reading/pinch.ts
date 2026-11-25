export function bindReadingPinch(surface: HTMLElement, resize: (scale: number, finished: boolean) => void) {
  let pinch: { distance: number; scale: number } | undefined;
  const distance = (event: TouchEvent) => {
    const [a, b] = Array.from(event.touches);
    return a && b ? Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) : 0;
  };
  const start = (event: TouchEvent) => {
    if (event.touches.length !== 2 || pinch) return;
    const initial = distance(event);
    if (initial > 0) pinch = { distance: initial, scale: 1 };
  };
  const move = (event: TouchEvent) => {
    if (!pinch || event.touches.length !== 2) return;
    if (event.cancelable) event.preventDefault();
    pinch.scale = distance(event) / pinch.distance;
    resize(pinch.scale, false);
  };
  const finish = (event: TouchEvent) => {
    if (!pinch || (event.touches.length >= 2 && event.type !== 'touchcancel')) return;
    const { scale } = pinch;
    pinch = undefined;
    resize(event.type === 'touchcancel' ? 1 : scale, true);
  };
  const listeners = new AbortController(),
    capture = { capture: true, signal: listeners.signal };
  surface.addEventListener('touchstart', start, { ...capture, passive: true });
  surface.addEventListener('touchmove', move, { ...capture, passive: false });
  surface.addEventListener('touchend', finish, { ...capture, passive: true });
  surface.addEventListener('touchcancel', finish, { ...capture, passive: true });
  return () => listeners.abort();
}
