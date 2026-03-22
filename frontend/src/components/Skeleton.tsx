import { cn } from '../utils/cn';

interface SkeletonProps {
  className?: string;
  variant?: 'default' | 'text' | 'circular' | 'rectangular';
  width?: string | number;
  height?: string | number;
  animation?: 'pulse' | 'wave' | 'none';
}

export function Skeleton({
  className = '',
  variant = 'default',
  width,
  height,
  animation = 'pulse',
}: SkeletonProps) {
  const baseClasses = 'bg-surface-strong';

  const variantClasses = {
    default: 'rounded',
    text: 'h-4 rounded-md',
    circular: 'rounded-full',
    rectangular: 'rounded-none',
  };

  const animationClasses = {
    pulse: 'animate-pulse',
    wave: 'animate-wave',
    none: '',
  };

  const style = {
    width: width !== undefined ? (typeof width === 'number' ? `${width}px` : width) : undefined,
    height:
      height !== undefined ? (typeof height === 'number' ? `${height}px` : height) : undefined,
  };

  return (
    <div
      className={cn(baseClasses, variantClasses[variant], animationClasses[animation], className)}
      style={style}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
  lineClassName?: string;
}

export function SkeletonText({ lines = 3, className = '', lineClassName = '' }: SkeletonTextProps) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className={cn(lineClassName, i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full')}
        />
      ))}
    </div>
  );
}

interface SkeletonAvatarProps {
  size?: number | 'sm' | 'md' | 'lg';
  className?: string;
}

export function SkeletonAvatar({ size = 'md', className = '' }: SkeletonAvatarProps) {
  const sizeMap = {
    sm: 32,
    md: 40,
    lg: 56,
  };

  const pixelSize = typeof size === 'number' ? size : sizeMap[size];

  return <Skeleton variant="circular" width={pixelSize} height={pixelSize} className={className} />;
}

interface SkeletonCardProps {
  className?: string;
  showAvatar?: boolean;
  showTitle?: boolean;
  showText?: boolean;
  textLines?: number;
}

export function SkeletonCard({
  className = '',
  showAvatar = false,
  showTitle = true,
  showText = true,
  textLines = 3,
}: SkeletonCardProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface p-4', className)}>
      {showAvatar && (
        <div className="mb-4 flex items-start gap-4">
          <SkeletonAvatar />
          <div className="flex-1">
            <Skeleton variant="text" className="mb-2 w-3/4" />
            <Skeleton variant="text" className="w-1/2" />
          </div>
        </div>
      )}
      {showTitle && <Skeleton variant="text" className="mb-4 h-6 w-1/2" />}
      {showText && <SkeletonText lines={textLines} />}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
  showHeader?: boolean;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className = '',
  showHeader = true,
}: SkeletonTableProps) {
  return (
    <div className={cn('overflow-hidden rounded-lg bg-surface', className)}>
      <table className="min-w-full">
        {showHeader && (
          <thead>
            <tr className="border-b border-border">
              {Array.from({ length: columns }).map((_, i) => (
                <th key={i} className="p-3">
                  <Skeleton variant="text" className="h-5 w-3/4" />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-0">
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td key={colIndex} className="p-3">
                  <Skeleton
                    variant="text"
                    className={colIndex === columns - 1 ? 'w-1/2' : 'w-full'}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SkeletonButtonProps {
  className?: string;
  width?: string | number;
}

export function SkeletonButton({ className = '', width }: SkeletonButtonProps) {
  return (
    <Skeleton
      variant="rectangular"
      height={36}
      width={width || '100%'}
      className={cn('rounded', className)}
    />
  );
}

interface PageLoaderProps {
  message?: string;
  className?: string;
}

export function PageLoader({ message = 'Loading...', className = '' }: PageLoaderProps) {
  return (
    <div className={cn('flex min-h-[400px] flex-col items-center justify-center gap-4', className)}>
      <div className="relative">
        <div className="size-12 animate-spin rounded-full border-4 border-surface-strong border-t-secondary-500" />
      </div>
      <p className="text-sm font-medium text-content-muted">{message}</p>
    </div>
  );
}

interface InlineLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function InlineLoader({ size = 'md', className = '' }: InlineLoaderProps) {
  const sizeMap = {
    sm: 'h-4 w-4 border-2',
    md: 'h-6 w-6 border-[3px]',
    lg: 'h-8 w-8 border-4',
  };

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div
        className={`${sizeMap[size]} animate-spin rounded-full border-surface-strong border-t-secondary-500`}
      />
    </div>
  );
}

export { SkeletonTable as SkeletonTableExport };
