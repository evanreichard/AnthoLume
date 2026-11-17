import { useLayoutEffect, useRef, useState } from 'react';
import { measurePages, type SamplePage } from './samplePagination';

export function useSamplePages(layoutKey: string) {
  const measurement = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<SamplePage[]>([]);
  useLayoutEffect(() => {
    const element = measurement.current;
    if (!element) return;
    const measure = () => setPages(measurePages(element));
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [layoutKey]);
  return { measurement, pages };
}
