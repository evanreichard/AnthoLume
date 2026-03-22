import { type ReactNode } from 'react';

interface BaseIconProps {
  size?: number;
  className?: string;
  disabled?: boolean;
  viewBox?: string;
  children: ReactNode;
}

export function BaseIcon({
  size = 24,
  className = '',
  disabled = false,
  viewBox = '0 0 24 24',
  children,
}: BaseIconProps) {
  const disabledClasses = disabled
    ? 'text-gray-200 dark:text-gray-600'
    : 'hover:text-gray-800 dark:hover:text-gray-100';

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={`${disabledClasses} ${className}`}
    >
      {children}
    </svg>
  );
}
