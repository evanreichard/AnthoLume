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
  InlineLoader 
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
    <div className="space-y-8 p-4">
      <h1 className="text-2xl font-bold dark:text-white">UI Components Demo</h1>

      {/* Toast Demos */}
      <section className="rounded-lg bg-white p-6 shadow dark:bg-gray-700">
        <h2 className="mb-4 text-xl font-semibold dark:text-white">Toast Notifications</h2>
        <div className="flex flex-wrap gap-4">
          <button
            onClick={handleDemoClick}
            disabled={isLoading}
            className="rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="rounded bg-purple-500 px-4 py-2 text-white hover:bg-purple-600"
          >
            Show Custom Toast
          </button>
        </div>
      </section>

      {/* Skeleton Demos */}
      <section className="rounded-lg bg-white p-6 shadow dark:bg-gray-700">
        <h2 className="mb-4 text-xl font-semibold dark:text-white">Skeleton Loading Components</h2>
        
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {/* Basic Skeletons */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium dark:text-gray-300">Basic Skeletons</h3>
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

          {/* Skeleton Text */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium dark:text-gray-300">Skeleton Text</h3>
            <SkeletonText lines={3} />
            <SkeletonText lines={5} className="max-w-md" />
          </div>

          {/* Skeleton Avatar */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium dark:text-gray-300">Skeleton Avatar</h3>
            <div className="flex items-center gap-4">
              <SkeletonAvatar size="sm" />
              <SkeletonAvatar size="md" />
              <SkeletonAvatar size="lg" />
              <SkeletonAvatar size={72} />
            </div>
          </div>

          {/* Skeleton Button */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium dark:text-gray-300">Skeleton Button</h3>
            <div className="flex flex-wrap gap-2">
              <SkeletonButton width={120} />
              <SkeletonButton className="w-full max-w-xs" />
            </div>
          </div>
        </div>
      </section>

      {/* Skeleton Card Demo */}
      <section className="rounded-lg bg-white p-6 shadow dark:bg-gray-700">
        <h2 className="mb-4 text-xl font-semibold dark:text-white">Skeleton Cards</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard showAvatar />
          <SkeletonCard showAvatar showTitle showText textLines={4} />
        </div>
      </section>

      {/* Skeleton Table Demo */}
      <section className="rounded-lg bg-white p-6 shadow dark:bg-gray-700">
        <h2 className="mb-4 text-xl font-semibold dark:text-white">Skeleton Table</h2>
        <SkeletonTable rows={5} columns={4} />
      </section>

      {/* Page Loader Demo */}
      <section className="rounded-lg bg-white p-6 shadow dark:bg-gray-700">
        <h2 className="mb-4 text-xl font-semibold dark:text-white">Page Loader</h2>
        <PageLoader message="Loading demo content..." />
      </section>

      {/* Inline Loader Demo */}
      <section className="rounded-lg bg-white p-6 shadow dark:bg-gray-700">
        <h2 className="mb-4 text-xl font-semibold dark:text-white">Inline Loader</h2>
        <div className="flex items-center gap-8">
          <div className="text-center">
            <InlineLoader size="sm" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Small</p>
          </div>
          <div className="text-center">
            <InlineLoader size="md" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Medium</p>
          </div>
          <div className="text-center">
            <InlineLoader size="lg" />
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">Large</p>
          </div>
        </div>
      </section>
    </div>
  );
}
