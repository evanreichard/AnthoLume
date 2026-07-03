import { useState } from 'react';
import { useToasts } from '../components/ToastContext';
import {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTable,
  SkeletonButton,
  PageLoader,
  InlineLoader,
} from '../components/Skeleton';

export default function ComponentDemoPage() {
  const { showInfo, showWarning, showError, showToast } = useToasts();
  const [isLoading, setIsLoading] = useState(false);

  const handleDemoClick = () => {
    setIsLoading(true);
    showInfo('Starting demo operation...');

    setTimeout(() => {
      setIsLoading(false);
      showInfo('Demo operation completed successfully!');
    }, 2000);
  };

  const handleErrorClick = () => {
    showError('This is a sample error message');
  };

  const handleWarningClick = () => {
    showWarning('This is a sample warning message', 10000);
  };

  const handleCustomToast = () => {
    showToast('Custom toast message', 'info', 3000);
  };

  return (
    <div className="space-y-8 p-4 text-content">
      <h1 className="text-2xl font-bold">UI Components Demo</h1>

      <section className="rounded-lg bg-surface p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold">Toast Notifications</h2>
        <div className="flex flex-wrap gap-4">
          <button
            onClick={handleDemoClick}
            disabled={isLoading}
            className="rounded bg-secondary-500 px-4 py-2 text-secondary-foreground hover:bg-secondary-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? <InlineLoader size="sm" /> : 'Show Info Toast'}
          </button>
          <button
            onClick={handleWarningClick}
            className="rounded bg-yellow-500 px-4 py-2 text-white hover:bg-yellow-600"
          >
            Show Warning Toast (10s)
          </button>
          <button
            onClick={handleErrorClick}
            className="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600"
          >
            Show Error Toast
          </button>
          <button
            onClick={handleCustomToast}
            className="rounded bg-primary-500 px-4 py-2 text-primary-foreground hover:bg-primary-600"
          >
            Show Custom Toast
          </button>
        </div>
      </section>

      <section className="rounded-lg bg-surface p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold">Skeleton Loading Components</h2>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-content-muted">Basic Skeletons</h3>
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton variant="text" className="w-3/4" />
              <Skeleton variant="text" className="w-1/2" />
              <div className="flex items-center gap-4">
                <Skeleton variant="circular" width={40} height={40} />
                <Skeleton variant="rectangular" width={100} height={40} />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-medium text-content-muted">Skeleton Text</h3>
            <SkeletonText lines={3} />
            <SkeletonText lines={5} className="max-w-md" />
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-medium text-content-muted">Skeleton Avatar</h3>
            <div className="flex items-center gap-4">
              <SkeletonAvatar size="sm" />
              <SkeletonAvatar size="md" />
              <SkeletonAvatar size="lg" />
              <SkeletonAvatar size={72} />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-lg font-medium text-content-muted">Skeleton Button</h3>
            <div className="flex flex-wrap gap-2">
              <SkeletonButton width={120} />
              <SkeletonButton className="w-full max-w-xs" />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg bg-surface p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold">Skeleton Cards</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard showAvatar />
          <SkeletonCard showAvatar showTitle showText textLines={4} />
        </div>
      </section>

      <section className="rounded-lg bg-surface p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold">Skeleton Table</h2>
        <SkeletonTable rows={5} columns={4} />
      </section>

      <section className="rounded-lg bg-surface p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold">Page Loader</h2>
        <PageLoader message="Loading demo content..." />
      </section>

      <section className="rounded-lg bg-surface p-6 shadow">
        <h2 className="mb-4 text-xl font-semibold">Inline Loader</h2>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <InlineLoader size="sm" />
            <p className="mt-2 text-sm text-content-muted">Small</p>
          </div>
          <div className="text-center">
            <InlineLoader size="md" />
            <p className="mt-2 text-sm text-content-muted">Medium</p>
          </div>
          <div className="text-center">
            <InlineLoader size="lg" />
            <p className="mt-2 text-sm text-content-muted">Large</p>
          </div>
        </div>
      </section>
    </div>
  );
}
