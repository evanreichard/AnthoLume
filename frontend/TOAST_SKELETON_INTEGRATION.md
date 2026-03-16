# Toast and Skeleton Components - Integration Guide

## Overview

I've added toast notifications and skeleton loading components to the AnthoLume React app. These components respect the current theme and automatically adapt to dark/light mode.

## What Was Added

### 1. Toast Notification System

**Files Created:**
- `src/components/Toast.tsx` - Individual toast component
- `src/components/ToastContext.tsx` - Toast context and provider
- `src/components/index.ts` - Centralized exports

**Features:**
- Three toast types: info, warning, error
- Auto-dismiss with configurable duration
- Manual dismiss via X button
- Smooth animations (slide in/out)
- Theme-aware colors for both light and dark modes
- Fixed positioning (top-right corner)

**Usage:**
```tsx
import { useToasts } from './components/ToastContext';

function MyComponent() {
  const { showInfo, showWarning, showError, showToast } = useToasts();

  const handleAction = async () => {
    try {
      await someApiCall();
      showInfo('Operation completed successfully!');
    } catch (error) {
      showError('An error occurred: ' + error.message);
    }
  };

  return <button onClick={handleAction}>Click me</button>;
}
```

### 2. Skeleton Loading Components

**Files Created:**
- `src/components/Skeleton.tsx` - All skeleton components
- `src/utils/cn.ts` - Utility for className merging
- `src/pages/ComponentDemoPage.tsx` - Demo page showing all components

**Components Available:**
- `Skeleton` - Basic skeleton element (default, text, circular, rectangular variants)
- `SkeletonText` - Multiple lines of text skeleton
- `SkeletonAvatar` - Avatar placeholder (sm, md, lg, or custom size)
- `SkeletonCard` - Card placeholder with optional avatar/title/text
- `SkeletonTable` - Table skeleton with configurable rows/columns
- `SkeletonButton` - Button placeholder
- `PageLoader` - Full-page loading spinner with message
- `InlineLoader` - Small inline spinner (sm, md, lg sizes)

**Usage Examples:**

```tsx
import { 
  Skeleton, 
  SkeletonText, 
  SkeletonCard, 
  SkeletonTable,
  PageLoader 
} from './components';

// Basic skeleton
<Skeleton className="w-full h-8" />

// Text skeleton
<SkeletonText lines={3} />

// Card skeleton
<SkeletonCard showAvatar showTitle showText textLines={4} />

// Table skeleton (already integrated into Table component)
<Table columns={columns} data={data} loading={isLoading} />

// Page loader
<PageLoader message="Loading your documents..." />
```

### 3. Updated Components

**Table Component** (`src/components/Table.tsx`):
- Now displays skeleton table when `loading={true}`
- Automatically shows 5 rows with skeleton content
- Matches the column count of the actual table

**Main App** (`src/main.tsx`):
- Wrapped with `ToastProvider` to enable toast functionality throughout the app

**Global Styles** (`src/index.css`):
- Added `animate-wave` animation for skeleton components
- Theme-aware wave animation for both light and dark modes

## Dependencies Added

```bash
npm install clsx tailwind-merge
```

## Integration Examples

### Example 1: Updating SettingsPage with Toasts

```tsx
import { useToasts } from '../components/ToastContext';
import { useUpdatePassword } from '../generated/anthoLumeAPIV1';

export default function SettingsPage() {
  const { showInfo, showError } = useToasts();
  const updatePassword = useUpdatePassword();

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updatePassword.mutateAsync({
        data: { password, newPassword }
      });
      showInfo('Password updated successfully!');
      setPassword('');
      setNewPassword('');
    } catch (error) {
      showError('Failed to update password. Please try again.');
    }
  };
  // ... rest of component
}
```

### Example 2: Using PageLoader for Initial Load

```tsx
import { PageLoader } from '../components';

export default function DocumentsPage() {
  const { data, isLoading } = useGetDocuments();

  if (isLoading) {
    return <PageLoader message="Loading your documents..." />;
  }

  // ... render documents
}
```

### Example 3: Custom Skeleton for Complex Loading

```tsx
import { SkeletonCard } from '../components';

function UserProfile() {
  const { data, isLoading } = useGetProfile();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SkeletonCard showAvatar showTitle showText textLines={4} />
        <SkeletonCard showAvatar showTitle showText textLines={4} />
      </div>
    );
  }

  // ... render profile data
}
```

## Theme Support

All components automatically adapt to the current theme:

**Light Mode:**
- Toasts: Light backgrounds with appropriate colored borders/text
- Skeletons: `bg-gray-200` (light gray)

**Dark Mode:**
- Toasts: Dark backgrounds with adjusted colored borders/text
- Skeletons: `bg-gray-600` (dark gray)

The theme is controlled via Tailwind's `dark:` classes, which respond to:
- System preference (via `darkMode: 'media'` in tailwind.config.js)
- Future manual theme toggles (can be added to `darkMode: 'class'`)

## Demo Page

A comprehensive demo page is available at `src/pages/ComponentDemoPage.tsx` that showcases:
- All toast notification types
- All skeleton component variants
- Interactive examples

To view the demo:
1. Add a route for the demo page in `src/Routes.tsx`:
```tsx
import ComponentDemoPage from './pages/ComponentDemoPage';

// Add to your routes:
<Route path="/demo" element={<ComponentDemoPage />} />
```

2. Navigate to `/demo` to see all components in action

## Best Practices

### Toasts:
- Use `showInfo()` for success messages and general notifications
- Use `showWarning()` for non-critical issues that need attention
- Use `showError()` for critical failures
- Set duration to `0` for errors that require user acknowledgment
- Keep messages concise and actionable

### Skeletons:
- Use `PageLoader` for full-page loading states
- Use `SkeletonTable` for table data (already integrated)
- Use `SkeletonCard` for card-based layouts
- Match skeleton structure to actual content structure
- Use appropriate variants (text, circular, etc.) for different content types

## Files Changed/Created Summary

**Created:**
- `src/components/Toast.tsx`
- `src/components/ToastContext.tsx`
- `src/components/Skeleton.tsx`
- `src/components/index.ts`
- `src/utils/cn.ts`
- `src/pages/ComponentDemoPage.tsx`
- `src/components/README.md`

**Modified:**
- `src/main.tsx` - Added ToastProvider wrapper
- `src/index.css` - Added wave animation for skeletons
- `src/components/Table.tsx` - Integrated skeleton loading
- `package.json` - Added clsx and tailwind-merge dependencies

## Next Steps

1. **Replace legacy error pages**: Start using toast notifications instead of the Go template error pages
2. **Update API error handling**: Add toast notifications to API error handlers in auth interceptor
3. **Enhance loading states**: Replace simple "Loading..." text with appropriate skeleton components
4. **Add theme toggle**: Consider adding a manual dark/light mode toggle (currently uses system preference)
5. **Add toasts to mutations**: Integrate toast notifications into all form submissions and API mutations
