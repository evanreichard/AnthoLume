# UI Components

This directory contains reusable UI components for the AnthoLume application.

## Toast Notifications

### Usage

The toast system provides info, warning, and error notifications that respect the current theme and dark/light mode.

```tsx
import { useToasts } from './components/ToastContext';

function MyComponent() {
  const { showInfo, showWarning, showError, showToast } = useToasts();

  const handleAction = async () => {
    try {
      // Do something
      showInfo('Operation completed successfully!');
    } catch (error) {
      showError('An error occurred while processing your request.');
    }
  };

  return <button onClick={handleAction}>Click me</button>;
}
```

### API

- `showToast(message: string, type?: 'info' | 'warning' | 'error', duration?: number): string`
  - Shows a toast notification
  - Returns the toast ID for manual removal
  - Default type: 'info'
  - Default duration: 5000ms (0 = no auto-dismiss)

- `showInfo(message: string, duration?: number): string`
  - Shortcut for showing an info toast

- `showWarning(message: string, duration?: number): string`
  - Shortcut for showing a warning toast

- `showError(message: string, duration?: number): string`
  - Shortcut for showing an error toast

- `removeToast(id: string): void`
  - Manually remove a toast by ID

- `clearToasts(): void`
  - Clear all active toasts

### Examples

```tsx
// Info toast (auto-dismisses after 5 seconds)
showInfo('Document saved successfully!');

// Warning toast (auto-dismisses after 10 seconds)
showWarning('Low disk space warning', 10000);

// Error toast (no auto-dismiss)
showError('Failed to load data', 0);

// Generic toast
showToast('Custom message', 'warning', 3000);
```

## Skeleton Loading

### Usage

Skeleton components provide placeholder content while data is loading. They automatically adapt to dark/light mode.

### Components

#### `Skeleton`

Basic skeleton element with various variants:

```tsx
import { Skeleton } from './components/Skeleton';

// Default (rounded rectangle)
<Skeleton className="w-full h-8" />

// Text variant
<Skeleton variant="text" className="w-3/4" />

// Circular variant (for avatars)
<Skeleton variant="circular" width={40} height={40} />

// Rectangular variant
<Skeleton variant="rectangular" width="100%" height={200} />
```

#### `SkeletonText`

Multiple lines of text skeleton:

```tsx
<SkeletonText lines={3} />
<SkeletonText lines={5} className="max-w-md" />
```

#### `SkeletonAvatar`

Avatar placeholder:

```tsx
<SkeletonAvatar size="md" />
<SkeletonAvatar size={56} />
```

#### `SkeletonCard`

Card placeholder with optional elements:

```tsx
// Default card
<SkeletonCard />

// With avatar
<SkeletonCard showAvatar />

// Custom configuration
<SkeletonCard 
  showAvatar 
  showTitle 
  showText 
  textLines={4}
  className="max-w-sm"
/>
```

#### `SkeletonTable`

Table placeholder:

```tsx
<SkeletonTable rows={5} columns={4} />
<SkeletonTable rows={10} columns={6} showHeader={false} />
```

#### `SkeletonButton`

Button placeholder:

```tsx
<SkeletonButton width={120} />
<SkeletonButton className="w-full" />
```

#### `PageLoader`

Full-page loading indicator:

```tsx
<PageLoader message="Loading your documents..." />
```

#### `InlineLoader`

Small inline loading spinner:

```tsx
<InlineLoader size="sm" />
<InlineLoader size="md" />
<InlineLoader size="lg" />
```

## Integration with Table Component

The Table component now supports skeleton loading:

```tsx
import { Table, SkeletonTable } from './components/Table';

function DocumentList() {
  const { data, isLoading } = useGetDocuments();

  if (isLoading) {
    return <SkeletonTable rows={10} columns={5} />;
  }

  return (
    <Table
      columns={columns}
      data={data?.documents || []}
    />
  );
}
```

## Theme Support

All components automatically adapt to the current theme:

- **Light mode**: Uses gray tones for skeletons, appropriate colors for toasts
- **Dark mode**: Uses darker gray tones for skeletons, adjusted colors for toasts

The theme is controlled via Tailwind's `dark:` classes, which respond to the system preference or manual theme toggles.

## Dependencies

- `clsx` - Utility for constructing className strings
- `tailwind-merge` - Merges Tailwind CSS classes intelligently
- `lucide-react` - Icon library used by Toast component
