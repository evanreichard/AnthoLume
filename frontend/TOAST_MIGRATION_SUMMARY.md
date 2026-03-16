# Toast Migration - Quick Reference Summary

## Locations Requiring Toast Migration

### 🔴 HIGH PRIORITY (Quick Wins)

1. **AdminPage.tsx** - 4 operations
   - Replace inline `message`/`errorMessage` state with toasts
   - Remove `<span className="text-red-400 text-xs">` and `<span className="text-green-400 text-xs">` from JSX

2. **AdminUsersPage.tsx** - 4 `alert()` calls
   - Replace `alert('Failed to create user: ...')`
   - Replace `alert('Failed to delete user: ...')`
   - Replace `alert('Failed to update password: ...')`
   - Replace `alert('Failed to update admin status: ...')`

3. **AdminImportPage.tsx** - 1 `alert()` call
   - Replace `alert('Import failed: ...')`
   - Add success toast before redirect

### 🟡 MEDIUM PRIORITY

4. **LoginPage.tsx** - 1 inline error
   - Replace `<span className="absolute -bottom-5 text-red-400 text-xs">{error}</span>`
   - Remove `error` state variable

5. **DocumentsPage.tsx** - 2 `alert()` calls
   - Replace `alert('Please upload an EPUB file')` → use `showWarning()`
   - Replace `alert('Document uploaded successfully!')` → use `showInfo()`
   - Replace `alert('Failed to upload document')` → use `showError()`

### 🟢 LOW PRIORITY / FUTURE

6. **SettingsPage.tsx** - 2 TODOs
   - Add toasts when password/timezone API calls are implemented

7. **authInterceptor.ts** - Optional
   - Add global error handling with toasts (requires event system)

---

## Quick Migration Template

```typescript
// 1. Import hook
import { useToasts } from '../components';

// 2. Destructure needed methods
const { showInfo, showWarning, showError } = useToasts();

// 3. Replace inline state (if present)
// REMOVE: const [message, setMessage] = useState<string | null>(null);
// REMOVE: const [errorMessage, setErrorMessage] = useState<string | null>(null);

// 4. Replace inline error rendering (if present)
// REMOVE: {errorMessage && <span className="text-red-400 text-xs">{errorMessage}</span>}
// REMOVE: {message && <span className="text-green-400 text-xs">{message}</span>}

// 5. Replace alert() calls
// BEFORE: alert('Error message');
// AFTER: showError('Error message');

// 6. Replace inline error state
// BEFORE: setError('Invalid credentials');
// AFTER: showError('Invalid credentials');

// 7. Update mutation callbacks
onSuccess: () => {
  showInfo('Operation completed successfully');
  // ... other logic
},
onError: (error: any) => {
  showError('Operation failed: ' + error.message);
  // ... or just showError() if error is handled elsewhere
}
```

---

## File-by-File Checklist

### AdminPage.tsx
- [ ] Import `useToasts`
- [ ] Remove `message` state
- [ ] Remove `errorMessage` state
- [ ] Update `handleBackupSubmit` - use toasts
- [ ] Update `handleRestoreSubmit` - use toasts
- [ ] Update `handleMetadataMatch` - use toasts
- [ ] Update `handleCacheTables` - use toasts
- [ ] Remove inline error/success spans from JSX

### AdminUsersPage.tsx
- [ ] Import `useToasts`
- [ ] Update `handleCreateUser` - replace alert
- [ ] Update `handleDeleteUser` - replace alert
- [ ] Update `handleUpdatePassword` - replace alert
- [ ] Update `handleToggleAdmin` - replace alert

### AdminImportPage.tsx
- [ ] Import `useToasts`
- [ ] Update `handleImport` - replace error alert, add success toast

### LoginPage.tsx
- [ ] Import `useToasts`
- [ ] Remove `error` state
- [ ] Update `handleSubmit` - use toast for error
- [ ] Remove inline error span from JSX

### DocumentsPage.tsx
- [ ] Import `useToasts`
- [ ] Update `handleFileChange` - replace all alerts with toasts

### SettingsPage.tsx (Future)
- [ ] Implement password update API → add toasts
- [ ] Implement timezone update API → add toasts

### authInterceptor.ts (Optional)
- [ ] Design global toast system
- [ ] Implement event-based toast triggers
- [ ] Add toasts for 401 and 5xx errors

---

## Common Patterns

### Replace alert() with showError
```typescript
// BEFORE
onError: (error) => {
  alert('Operation failed: ' + error.message);
}

// AFTER
onError: (error: any) => {
  showError('Operation failed: ' + error.message);
}
```

### Replace alert() with showWarning
```typescript
// BEFORE
if (!file.name.endsWith('.epub')) {
  alert('Please upload an EPUB file');
  return;
}

// AFTER
if (!file.name.endsWith('.epub')) {
  showWarning('Please upload an EPUB file');
  return;
}
```

### Replace inline error state
```typescript
// BEFORE
const [error, setError] = useState('');
setError('Invalid credentials');
<span className="absolute -bottom-5 text-red-400 text-xs">{error}</span>

// AFTER
showError('Invalid credentials');
// Remove the span from JSX
```

### Replace inline success/error messages
```typescript
// BEFORE
const [message, setMessage] = useState<string | null>(null);
const [errorMessage, setErrorMessage] = useState<string | null>(null);
setMessage('Success!');
setErrorMessage('Error!');
{errorMessage && <span className="text-red-400 text-xs">{errorMessage}</span>}
{message && <span className="text-green-400 text-xs">{message}</span>}

// AFTER
showInfo('Success!');
showError('Error!');
// Remove both spans from JSX
```

---

## Toast Duration Guidelines

- **Success messages**: 3000-5000ms (auto-dismiss)
- **Warning messages**: 5000-10000ms (auto-dismiss)
- **Error messages**: 0 (no auto-dismiss, user must dismiss)
- **Validation warnings**: 3000-5000ms (auto-dismiss)

Example:
```typescript
showInfo('Document uploaded successfully!');  // Default 5000ms
showWarning('Low disk space', 10000);           // 10 seconds
showError('Failed to save data', 0);             // No auto-dismiss
```
