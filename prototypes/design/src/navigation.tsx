import { useLayoutEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export function currentRoute() {
  return location.hash.slice(1) || '/library';
}

export function navigate(to: string, replace = false) {
  history.replaceState({ ...history.state, scroll: window.scrollY }, '');
  const depth = (history.state?.depth ?? 0) + (replace ? 0 : 1);
  history[replace ? 'replaceState' : 'pushState'](
    { depth, scroll: replace ? window.scrollY : 0 },
    '',
    `#${to}`,
  );
  window.dispatchEvent(new Event('m2navigate'));
}

export function back(fallback = '/library') {
  if (history.state?.depth > 0) history.back();
  else navigate(fallback, true);
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute);
  const [popCount, setPopCount] = useState(0);
  useLayoutEffect(() => {
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const update = () => setRoute(currentRoute());
    const pop = () => {
      update();
      setPopCount((count) => count + 1);
    };
    window.addEventListener('popstate', pop);
    window.addEventListener('hashchange', update);
    window.addEventListener('m2navigate', update);
    return () => {
      history.scrollRestoration = previousRestoration;
      window.removeEventListener('popstate', pop);
      window.removeEventListener('hashchange', update);
      window.removeEventListener('m2navigate', update);
    };
  }, []);
  const path = route.split('?')[0];
  useLayoutEffect(() => {
    const reading = Boolean(document.querySelector('.paginated-reader'));
    document.documentElement.dataset.readerOpen = String(reading);
    window.scrollTo(0, reading ? 0 : (history.state?.scroll ?? 0));
    const heading = Array.from(document.querySelectorAll<HTMLElement>('[data-route-heading]')).at(
      -1,
    );
    heading?.focus({ preventScroll: true });
  }, [path, popCount]);
  return { route, path, params: new URLSearchParams(route.split('?')[1] || '') };
}

export function Link({
  to,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  function follow(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    navigate(to);
  }
  return <a href={`#${to}`} onClick={follow} {...props} />;
}
