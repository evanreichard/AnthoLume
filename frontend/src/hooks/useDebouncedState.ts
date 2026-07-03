import { useState, useEffect, useCallback } from 'react';

const DEFAULT_DELAY = 300;

/**
 * Owns a search/filter input and a debounced view of it. The fourth value, `flush`,
 * resolves the debounced value immediately (e.g. on an explicit submit button)
 * without waiting for the debounce window to elapse.
 */
export function useDebouncedState<T>(initialValue: T, delay: number = DEFAULT_DELAY) {
  const [value, setValue] = useState<T>(initialValue);
  const [debounced, setDebounced] = useState<T>(initialValue);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  // Flush - skip the debounce window so an explicit submit resolves the active value right away.
  const flush = useCallback((next?: T) => {
    if (next !== undefined) setValue(next);
    setDebounced(next !== undefined ? next : value);
  }, [value]);

  return [value, setValue, debounced, flush] as const;
}
