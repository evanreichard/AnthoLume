# Toast Migration Analysis

This document identifies all places in the app where toast notifications should replace existing error handling mechanisms.

## Summary

**Total Locations Identified**: 7 pages/components  
**Current Error Handling Methods**:
- `alert()` - Used in 3 locations (5+ instances)
- Inline error/success messages - Used in 2 locations
- Form input validation messages - Used in 1 location
- No error handling (TODO) - Used in 1 location

---

## Detailed Analysis

### 1. AdminPage.tsx ⚠️ HIGH PRIORITY

**File**: `src/pages/AdminPage.tsx`

**Current Implementation**:
```typescript
const [message, setMessage] = useState<string | null>(null);
const [errorMessage, setErrorMessage] = useState<string | null>(null);

// Multiple handlers use inline state
onSuccess: () => {
  setMessage('Backup completed successfully');
  setErrorMessage(null);
},
onError: (error) => {
  setErrorMessage('Backup failed: ' + (error as any).message);
  setMessage(null);
},

// Rendered inline in JSX
{errorMessage && (
  <span className="text-red-400 text-xs">{errorMessage}</span>
)}
{message && (
  <span className="text-green-400 text-xs">{message}</span>
)}
```

**Affected Actions**:
- `handleBackupSubmit` - Backup operation
- `handleRestoreSubmit` - Restore operation  
- `handleMetadataMatch` - Metadata matching
- `handleCacheTables` - Cache tables

**Recommended Migration**:
```typescript
import { useToasts } from '../components';

const { showInfo, showError } = useToasts();

onSuccess: () => {
  showInfo('Backup completed successfully');
},
onError: (error) => {
  showError('Backup failed: ' + (error as any).message);
},

// Remove these from JSX:
// - {errorMessage && <span className="text-red-400 text-xs">{errorMessage}</span>}
// - {message && <span className="text-green-400 text-xs">{message}</span>}
// Remove state variables:
// - const [message, setMessage] = useState<string | null>(null);
// - const [errorMessage, setErrorMessage] = useState<string | null>(null);
```

**Impact**: HIGH - 4 API operations with error/success feedback

---

### 2. AdminUsersPage.tsx ⚠️ HIGH PRIORITY

**File**: `src/pages/AdminUsersPage.tsx`

**Current Implementation**:
```typescript
// 4 instances of alert() calls
onError: (error: any) => {
  alert('Failed to create user: ' + error.message);
},
// ... similar for delete, update password, update admin status
```

**Affected Operations**:
- User creation (line ~55)
- User deletion (line ~69)
- Password update (line ~85)
- Admin status toggle (line ~101)

**Recommended Migration**:
```typescript
import { useToasts } from '../components';

const { showInfo, showError } = useToasts();

onSuccess: () => {
  showInfo('User created successfully');
  setShowAddForm(false);
  setNewUsername('');
  setNewPassword('');
  setNewIsAdmin(false);
  refetch();
},
onError: (error: any) => {
  showError('Failed to create user: ' + error.message);
},

// Similar pattern for other operations
```

**Impact**: HIGH - Critical user management operations

---

### 3. AdminImportPage.tsx ⚠️ HIGH PRIORITY

**File**: `src/pages/AdminImportPage.tsx`

**Current Implementation**:
```typescript
onError: (error) => {
  console.error('Import failed:', error);
  alert('Import failed: ' + (error as any).message);
},

// No success toast - just redirects
onSuccess: (response) => {
  console.log('Import completed:', response.data);
  window.location.href = '/admin/import-results';
},
```

**Recommended Migration**:
```typescript
import { useToasts } from '../components';

const { showInfo, showError } = useToasts();

onSuccess: (response) => {
  showInfo('Import completed successfully');
  setTimeout(() => {
    window.location.href = '/admin/import-results';
  }, 1500);
},
onError: (error) => {
  showError('Import failed: ' + (error as any).message);
},
```

**Impact**: HIGH - Long-running import operation needs user feedback

---

### 4. SettingsPage.tsx ⚠️ MEDIUM PRIORITY (TODO)

**File**: `src/pages/SettingsPage.tsx`

**Current Implementation**:
```typescript
const handlePasswordSubmit = (e: FormEvent) => {
  e.preventDefault();
  // TODO: Call API to change password
};

const handleTimezoneSubmit = (e: FormEvent) => {
  e.preventDefault();
  // TODO: Call API to change timezone
};
```

**Recommended Migration** (when API calls are implemented):
```typescript
import { useToasts } from '../components';
import { useUpdatePassword, useUpdateTimezone } from '../generated/anthoLumeAPIV1';

const { showInfo, showError } = useToasts();
const updatePassword = useUpdatePassword();
const updateTimezone = useUpdateTimezone();

const handlePasswordSubmit = async (e: FormEvent) => {
  e.preventDefault();
  try {
    await updatePassword.mutateAsync({
      data: { password, newPassword }
    });
    showInfo('Password updated successfully');
    setPassword('');
    setNewPassword('');
  } catch (error: any) {
    showError('Failed to update password: ' + error.message);
  }
};

const handleTimezoneSubmit = async (e: FormEvent) => {
  e.preventDefault();
  try {
    await updateTimezone.mutateAsync({
      data: { timezone }
    });
    showInfo('Timezone updated successfully');
  } catch (error: any) {
    showError('Failed to update timezone: ' + error.message);
  }
};
```

**Impact**: MEDIUM - User-facing settings need feedback when implemented

---

### 5. LoginPage.tsx ⚠️ MEDIUM PRIORITY

**File**: `src/pages/LoginPage.tsx`

**Current Implementation**:
```typescript
const [error, setError] = useState('');

const handleSubmit = async (e: FormEvent) => {
  // ...
  try {
    await login(username, password);
  } catch (err) {
    setError('Invalid credentials');
  }
  // ...
};

// Rendered inline under password input
<span className="absolute -bottom-5 text-red-400 text-xs">{error}</span>
```

**Recommended Migration**:
```typescript
import { useToasts } from '../components';

const { showError } = useToasts();

const handleSubmit = async (e: FormEvent) => {
  e.preventDefault();
  setIsLoading(true);

  try {
    await login(username, password);
  } catch (err) {
    showError('Invalid credentials');
  } finally {
    setIsLoading(false);
  }
};

// Remove from JSX:
// - <span className="absolute -bottom-5 text-red-400 text-xs">{error}</span>
// Remove state:
// - const [error, setError] = useState('');
```

**Impact**: MEDIUM - Login errors are important but less frequent

---

### 6. DocumentsPage.tsx ⚠️ LOW PRIORITY

**File**: `src/pages/DocumentsPage.tsx`

**Current Implementation**:
```typescript
const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.name.endsWith('.epub')) {
    alert('Please upload an EPUB file');
    return;
  }

  try {
    await createMutation.mutateAsync({
      data: { document_file: file }
    });
    alert('Document uploaded successfully!');
    setUploadMode(false);
    refetch();
  } catch (error) {
    console.error('Upload failed:', error);
    alert('Failed to upload document');
  }
};
```

**Recommended Migration**:
```typescript
import { useToasts } from '../components';

const { showInfo, showWarning, showError } = useToasts();

const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.name.endsWith('.epub')) {
    showWarning('Please upload an EPUB file');
    return;
  }

  try {
    await createMutation.mutateAsync({
      data: { document_file: file }
    });
    showInfo('Document uploaded successfully!');
    setUploadMode(false);
    refetch();
  } catch (error: any) {
    showError('Failed to upload document: ' + error.message);
  }
};
```

**Impact**: LOW - Upload errors are less frequent, but good UX to have toasts

---

### 7. authInterceptor.ts ⚠️ OPTIONAL ENHANCEMENT

**File**: `src/auth/authInterceptor.ts`

**Current Implementation**:
```typescript
// Response interceptor to handle auth errors
axios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      // Clear token on auth failure
      localStorage.removeItem(TOKEN_KEY);
      // Optionally redirect to login
      // window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

**Recommended Enhancement**:
```typescript
// Add a global error handler for 401 errors
// Note: This would need access to a toast context outside React
// Could be implemented via a global toast service or event system

axios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      // Could dispatch a global event here to show toast
      window.dispatchEvent(new CustomEvent('auth-error', { 
        detail: { message: 'Session expired. Please log in again.' } 
      }));
    } else if (error.response?.status >= 500) {
      // Show toast for server errors
      window.dispatchEvent(new CustomEvent('api-error', { 
        detail: { message: 'Server error. Please try again later.' } 
      }));
    }
    return Promise.reject(error);
  }
);
```

**Note**: This would require a global toast service or event system. More complex to implement.

**Impact**: LOW - Optional enhancement for global error handling

---

## Priority Matrix

| Page | Priority | Complexity | Impact | Instances |
|------|----------|------------|--------|-----------|
| AdminPage.tsx | HIGH | LOW | HIGH | 4 actions |
| AdminUsersPage.tsx | HIGH | LOW | HIGH | 4 alerts |
| AdminImportPage.tsx | HIGH | LOW | HIGH | 1 alert |
| SettingsPage.tsx | MEDIUM | MEDIUM | MEDIUM | 2 TODOs |
| LoginPage.tsx | MEDIUM | LOW | MEDIUM | 1 error |
| DocumentsPage.tsx | LOW | LOW | LOW | 2 alerts |
| authInterceptor.ts | OPTIONAL | HIGH | LOW | N/A |

---

## Implementation Plan

### Phase 1: Quick Wins (1-2 hours)
1. **AdminPage.tsx** - Replace inline messages with toasts
2. **AdminUsersPage.tsx** - Replace all `alert()` calls
3. **AdminImportPage.tsx** - Replace `alert()` and add success toast

### Phase 2: Standard Migration (1 hour)
4. **LoginPage.tsx** - Replace inline error with toast
5. **DocumentsPage.tsx** - Replace `alert()` calls

### Phase 3: Future Implementation (when ready)
6. **SettingsPage.tsx** - Add toasts when API calls are implemented

### Phase 4: Optional Enhancement (if needed)
7. **authInterceptor.ts** - Global error handling with toasts

---

## Benefits of Migration

### User Experience
- ✅ Consistent error messaging across the app
- ✅ Less intrusive than `alert()` dialogs
- ✅ Auto-dismissing notifications (no need to click to dismiss)
- ✅ Better mobile experience (no modal blocking the UI)
- ✅ Stackable notifications for multiple events

### Developer Experience
- ✅ Remove state management for error/success messages
- ✅ Cleaner, more maintainable code
- ✅ Consistent API for showing notifications
- ✅ Theme-aware styling (automatic dark/light mode support)

### Code Quality
- ✅ Remove `alert()` calls (considered an anti-pattern in modern web apps)
- ✅ Remove inline error message rendering
- ✅ Follow React best practices
- ✅ Reduce component complexity

---

## Testing Checklist

After migrating each page, verify:
- [ ] Error toasts display correctly on API failures
- [ ] Success toasts display correctly on successful operations
- [ ] Toasts appear in top-right corner
- [ ] Toasts auto-dismiss after the specified duration
- [ ] Toasts can be manually dismissed via X button
- [ ] Multiple toasts stack correctly
- [ ] Theme colors are correct in light mode
- [ ] Theme colors are correct in dark mode
- [ ] No console errors related to toast functionality
- [ ] Previous functionality still works (e.g., redirects after success)

---

## Estimated Effort

| Phase | Pages | Time Estimate |
|-------|-------|---------------|
| Phase 1 | AdminPage, AdminUsersPage, AdminImportPage | 1-2 hours |
| Phase 2 | LoginPage, DocumentsPage | 1 hour |
| Phase 3 | SettingsPage (when API ready) | 30 minutes |
| Phase 4 | authInterceptor (optional) | 1-2 hours |
| **Total** | **7 pages** | **3-5 hours** |

---

## Notes

1. **SettingsPage**: API calls are not yet implemented (TODOs). Should migrate when those are added.

2. **authInterceptor**: Global error handling would require a different approach, possibly a global event system or toast service outside React context.

3. **Redirect behavior**: Some operations (like AdminImportPage) redirect on success. Consider showing a toast first, then redirecting after a short delay for better UX.

4. **Validation messages**: Some pages have inline validation messages (like "Please upload an EPUB file"). These could remain inline or be shown as warning toasts - consider UX tradeoffs.

5. **Loading states**: Ensure loading states are still displayed appropriately alongside toasts.

6. **Refetch behavior**: Pages that call `refetch()` after successful mutations should continue to do so; toasts are additive, not replacement for data refresh.
