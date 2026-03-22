import { type ReactNode } from 'react';

interface BaseIconProps {
  size?: number;
  className?: string;
  disabled?: boolean;
  hoverable?: boolean;
  viewBox?: string;
  children: ReactNode;
}

export function BaseIcon({
  size = 24,
  className = '',
  disabled = false,
  hoverable = true,
  viewBox = '0 0 24 24',
  children,
}: BaseIconProps) {
  const disabledClasses = disabled
    ? 'text-content-subtle'
    : hoverable
      ? 'hover:text-content'
      : '';

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
