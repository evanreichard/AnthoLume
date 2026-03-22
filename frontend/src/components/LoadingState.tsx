import { LoadingIcon } from '../icons';
import { cn } from '../utils/cn';

interface LoadingStateProps {
  message?: string;
  className?: string;
  iconSize?: number;
}

export function LoadingState({
  message = 'Loading...',
  className = '',
  iconSize = 24,
}: LoadingStateProps) {
  return (
    <div className={cn('flex items-center justify-center gap-3 text-content-muted', className)}>
      <LoadingIcon size={iconSize} className="text-primary-500" />
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
}
