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
    <div
      className={cn(
        'flex items-center justify-center gap-3 text-gray-500 dark:text-gray-400',
        className,
      )}
    >
      <LoadingIcon size={iconSize} className="text-purple-600 dark:text-purple-400" />
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
}
