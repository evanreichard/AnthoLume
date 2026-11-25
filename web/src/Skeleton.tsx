import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

export function LoadingStatus({ children }: { children: string }) {
  return (
    <span className={styles.status} role="status">
      {children}
    </span>
  );
}

export function Skeleton({
  width,
  className,
  block = false,
  style,
}: {
  width?: string;
  className?: string;
  block?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={[styles.shape, !block && styles.line, className].filter(Boolean).join(' ')}
      style={{ ...style, width }}
    />
  );
}

export function SkeletonRows({
  label,
  count = 3,
  secondary = true,
}: {
  label: string;
  count?: number;
  secondary?: boolean;
}) {
  return (
    <>
      <LoadingStatus>{label}</LoadingStatus>
      <div className={styles.rows} aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>
            <Skeleton width={i % 2 ? '45%' : '60%'} />
            {secondary && (
              <small>
                <Skeleton width="30%" />
              </small>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
