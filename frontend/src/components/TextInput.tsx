import { forwardRef, InputHTMLAttributes } from 'react';
import { cn } from '../utils/cn';

export const inputClassName =
  'w-full flex-1 appearance-none rounded-none border border-border bg-surface px-4 py-2 text-base text-content shadow-xs placeholder:text-content-subtle focus:border-transparent focus:outline-hidden focus:ring-2 focus:ring-primary-600';

type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClassName, className)} {...props} />
  )
);

TextInput.displayName = 'TextInput';
