import { describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedState } from './useDebouncedState';

describe('useDebouncedState', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the initial value for both the input and the debounced value', () => {
    const { result } = renderHook(() => useDebouncedState('initial', 300));

    const [value, , debounced] = result.current;
    expect(value).toBe('initial');
    expect(debounced).toBe('initial');
  });

  it('updates the input immediately but delays the debounced value', () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useDebouncedState('initial', 300));

    act(() => {
      const setValue = result.current[1];
      setValue('updated');
    });

    expect(result.current[0]).toBe('updated');
    expect(result.current[2]).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(result.current[2]).toBe('updated');
  });

  it('cancels the previous timer when the value changes again', () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useDebouncedState('first', 300));

    act(() => result.current[1]('second'));
    act(() => vi.advanceTimersByTime(200));
    act(() => result.current[1]('third'));

    act(() => vi.advanceTimersByTime(100));
    expect(result.current[2]).toBe('first');

    act(() => vi.advanceTimersByTime(200));
    expect(result.current[2]).toBe('third');
  });

  it('flush resolves the debounced value immediately, skipping the debounce window', () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useDebouncedState('initial', 300));

    act(() => result.current[1]('updated'));
    expect(result.current[2]).toBe('initial');

    act(() => {
      const flush = result.current[3];
      flush();
    });

    expect(result.current[2]).toBe('updated');
  });

  it('flush with an argument sets both the input and the resolved value', () => {
    const { result } = renderHook(() => useDebouncedState('initial', 300));

    act(() => {
      const flush = result.current[3];
      flush('forced');
    });

    expect(result.current[0]).toBe('forced');
    expect(result.current[2]).toBe('forced');
  });
});
