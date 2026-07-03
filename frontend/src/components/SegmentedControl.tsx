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
  activeClassName: string;
  inactiveClassName: string;
  className?: string;
  buttonClassName?: string;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  activeClassName,
  inactiveClassName,
  className,
  buttonClassName,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className={className} role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            buttonClassName,
            value === option.value ? activeClassName : inactiveClassName
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
