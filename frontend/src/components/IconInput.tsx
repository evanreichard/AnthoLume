import { ReactNode } from 'react';
import { cn } from '../utils/cn';

interface IconInputProps {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}

export function IconInput({ icon, children, className }: IconInputProps) {
  return (
    <div className={cn('relative flex', className)}>
      <span className="inline-flex items-center border-y border-l border-border bg-surface px-3 text-sm text-content-muted shadow-xs">
        {icon}
      </span>
      {children}
    </div>
  );
}
