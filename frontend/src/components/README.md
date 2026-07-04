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

A pulsing placeholder block. Size and shape are controlled with Tailwind classes via `className`:

```tsx
import { Skeleton } from './components/Skeleton';

<Skeleton className="h-8 w-full" />
<Skeleton className="w-3/4" />
```

#### `SkeletonTable`

Table placeholder:

```tsx
<SkeletonTable rows={5} columns={4} />
<SkeletonTable rows={10} columns={6} showHeader={false} />
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

  return <Table columns={columns} data={data?.documents || []} />;
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
- Local icon components in `src/icons/`
