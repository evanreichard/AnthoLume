import { useEffect, useEffectEvent, type RefObject } from 'react';

export function useNearEnd(
  target: RefObject<HTMLElement | null>,
  {
    enabled,
    rootMargin,
    scope,
    onReach,
  }: {
    enabled: boolean;
    rootMargin: string;
    scope: string;
    onReach: () => void;
  },
) {
  const reach = useEffectEvent((observedScope: string) => {
    if (enabled && scope === observedScope) onReach();
  });
  useEffect(() => {
    const node = target.current;
    if (!node || !enabled || !('IntersectionObserver' in window)) return;
    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!active || !entries.some((entry) => entry.isIntersecting)) return;
        active = false;
        observer.disconnect();
        reach(scope);
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [target, enabled, rootMargin, scope]);
}
