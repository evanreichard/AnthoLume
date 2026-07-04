import { ReactNode } from 'react';
import { cn } from '../utils/cn';

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: 'pill' | 'unstyled';
  className?: string;
  buttonClassName?: string;
  activeClassName?: string;
  inactiveClassName?: string;
  ariaLabel?: string;
}

// Pill Variant Defaults - The bordered "segmented" look most call sites want, so they pass only
// options/value/onChange. `unstyled` opts out entirely for callers with a bespoke shape (grid, inline text).
const PILL = {
  container: 'inline-flex rounded border border-border bg-surface-muted p-1',
  button: 'flex-1 rounded px-3 py-1 text-sm font-medium capitalize transition-colors',
  active: 'bg-content text-content-inverse',
  inactive: 'text-content-muted hover:bg-surface hover:text-content',
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = 'pill',
  className,
  buttonClassName,
  activeClassName,
  inactiveClassName,
  ariaLabel,
}: SegmentedControlProps<T>) {
  const styles =
    variant === 'pill'
      ? {
          container: cn(PILL.container, className),
          button: cn(PILL.button, buttonClassName),
          active: activeClassName ?? PILL.active,
          inactive: inactiveClassName ?? PILL.inactive,
        }
      : {
          container: className,
          button: buttonClassName,
          active: activeClassName,
          inactive: inactiveClassName,
        };

  return (
    <div className={styles.container} role="group" aria-label={ariaLabel}>
      {options.map(option => {
        const isActive = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              if (!isActive) onChange(option.value);
            }}
            aria-pressed={isActive}
            className={cn(styles.button, isActive ? styles.active : styles.inactive)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
