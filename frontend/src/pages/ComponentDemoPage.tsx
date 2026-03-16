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
      <section className="bg-white dark:bg-gray-700 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Toast Notifications</h2>
        <div className="flex flex-wrap gap-4">
          <button
            onClick={handleDemoClick}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? <InlineLoader size="sm" /> : 'Show Info Toast'}
          </button>
          <button
            onClick={handleWarningClick}
            className="px-4 py-2 bg-yellow-500 text-white rounded hover:bg-yellow-600"
          >
            Show Warning Toast (10s)
          </button>
          <button
            onClick={handleErrorClick}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            Show Error Toast
          </button>
          <button
            onClick={handleCustomToast}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600"
          >
            Show Custom Toast
          </button>
        </div>
      </section>

      {/* Skeleton Demos */}
      <section className="bg-white dark:bg-gray-700 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Skeleton Loading Components</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Basic Skeletons */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium dark:text-gray-300">Basic Skeletons</h3>
            <div className="space-y-2">
              <Skeleton className="w-full h-8" />
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
            <div className="flex gap-2 flex-wrap">
              <SkeletonButton width={120} />
              <SkeletonButton className="w-full max-w-xs" />
            </div>
          </div>
        </div>
      </section>

      {/* Skeleton Card Demo */}
      <section className="bg-white dark:bg-gray-700 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Skeleton Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard showAvatar />
          <SkeletonCard showAvatar showTitle showText textLines={4} />
        </div>
      </section>

      {/* Skeleton Table Demo */}
      <section className="bg-white dark:bg-gray-700 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Skeleton Table</h2>
        <SkeletonTable rows={5} columns={4} />
      </section>

      {/* Page Loader Demo */}
      <section className="bg-white dark:bg-gray-700 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Page Loader</h2>
        <PageLoader message="Loading demo content..." />
      </section>

      {/* Inline Loader Demo */}
      <section className="bg-white dark:bg-gray-700 rounded-lg p-6 shadow">
        <h2 className="text-xl font-semibold mb-4 dark:text-white">Inline Loader</h2>
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
