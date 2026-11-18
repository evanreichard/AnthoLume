import { useEffect, useRef, useState } from 'react';
import { bindReadingPinch } from './pinch';

export function useParentGestures() {
  const [needed, setNeeded] = useState<boolean>();
  useEffect(() => {
    const probe = document.createElement('iframe');
    probe.hidden = true;
    probe.setAttribute('sandbox', 'allow-same-origin');
    probe.srcdoc = '<!doctype html><title>Reader input check</title><p></p>';
    const finish = (result: boolean) => { clearTimeout(timer); probe.onload = null; probe.remove(); setNeeded(result); };
    const timer = setTimeout(() => finish(true), 1500);
    probe.onload = () => {
      const target = probe.contentDocument?.querySelector('p');
      if (!target) { finish(true); return; }
      let delivered = false;
      target.addEventListener('click', () => { delivered = true; }, { once: true });
      target.dispatchEvent(new MouseEvent('click'));
      finish(!delivered);
    };
    document.body.append(probe);
    return () => { clearTimeout(timer); probe.onload = null; probe.remove(); };
  }, []);
  return needed;
}

export function GestureLayer({ className, tap, turn, showControls, resize }: {
  className: string;
  tap(x: number, y: number, zone: number): void;
  turn(forward: boolean): void;
  showControls(): void;
  resize(scale: number, finished: boolean): void;
}) {
  const start = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const hoveredCenter = useRef(false);
  const surface = useRef<HTMLDivElement>(null), onResize = useRef(resize);
  onResize.current = resize;
  useEffect(() => bindReadingPinch(surface.current!, (scale, finished) => {
    start.current = null;
    onResize.current(scale, finished);
  }), []);
  return <div ref={surface} className={className} data-reader-gesture-layer aria-hidden="true"
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) { start.current = null; return; }
      start.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now() };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { start.current = null; }}
    onPointerUp={event => {
      const down = start.current;
      start.current = null;
      if (down?.id !== event.pointerId) return;
      const dx = event.clientX - down.x, dy = event.clientY - down.y;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) turn(dx < 0);
      else if (Math.abs(dy) >= 60 && Math.abs(dy) > Math.abs(dx)) showControls();
      else if (Math.max(Math.abs(dx), Math.abs(dy)) < 14 && Date.now() - down.at < 500) {
        const box = event.currentTarget.getBoundingClientRect();
        tap(event.clientX, event.clientY, (event.clientX - box.left) / box.width);
      }
    }}
    onPointerMove={event => {
      if (event.pointerType !== 'mouse' || event.buttons) return;
      const box = event.currentTarget.getBoundingClientRect(), x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
      const center = x >= .2 && x <= .8 && y >= .18 && y <= .82;
      if (center && !hoveredCenter.current) showControls();
      hoveredCenter.current = center;
    }}
    onPointerLeave={() => { hoveredCenter.current = false; }}
  />;
}
