# AnthoLume Frontend

A React + TypeScript frontend for AnthoLume, replacing the server-side rendering (SSR) templates.

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Type safety
- **React Query (TanStack Query)** - Server state management
- **Orval** - API client generation from OpenAPI spec
- **React Router** - Navigation
- **Tailwind CSS** - Styling
- **Vite** - Build tool
- **Axios** - HTTP client with auth interceptors

## Authentication

The frontend includes a complete authentication system:

### Auth Context
- `AuthProvider` - Manages authentication state globally
- `useAuth()` - Hook to access auth state and methods
- Token stored in `localStorage`
- Axios interceptors automatically attach Bearer token to API requests

### Protected Routes
- All main routes are wrapped in `ProtectedRoute`
- Unauthenticated users are redirected to `/login`
- Layout redirects to login if not authenticated

### Login Flow
1. User enters credentials on `/login`
2. POST to `/api/v1/auth/login`
3. Token stored in localStorage
4. Redirect to home page
5. Axios interceptor includes token in subsequent requests

### Logout Flow
1. User clicks "Logout" in dropdown menu
2. POST to `/api/v1/auth/logout`
3. Token cleared from localStorage
4. Redirect to `/login`

### 401 Handling
- Axios response interceptor clears token on 401 errors
- Prevents stale auth state

## Architecture

The frontend mirrors the existing SSR templates structure:

### Pages
- `HomePage` - Landing page with recent documents
- `DocumentsPage` - Document listing with search and pagination
- `DocumentPage` - Single document view with details
- `ProgressPage` - Reading progress table
- `ActivityPage` - User activity log
- `SearchPage` - Search interface
- `SettingsPage` - User settings
- `LoginPage` - Authentication

### Components
- `Layout` - Main layout with navigation sidebar and header
- Generated API hooks from `api/v1/openapi.yaml`

## API Integration

The frontend uses **Orval** to generate TypeScript types and React Query hooks from the OpenAPI spec:

```bash
npm run generate:api
```

This generates:
- Type definitions for all API schemas
- React Query hooks (`useGetDocuments`, `useGetDocument`, etc.)
- Mutation hooks (`useLogin`, `useLogout`)

## Development

```bash
# Install dependencies
npm install

# Generate API types (if OpenAPI spec changes)
npm run generate:api

# Start development server
npm run dev

# Build for production
npm run build
```

## Deployment

The built output is in `dist/` and can be served by the Go backend or deployed separately.

## Migration from SSR

The frontend replicates the functionality of the following SSR templates:
- `templates/pages/home.tmpl` → `HomePage.tsx`
- `templates/pages/documents.tmpl` → `DocumentsPage.tsx`
- `templates/pages/document.tmpl` → `DocumentPage.tsx`
- `templates/pages/progress.tmpl` → `ProgressPage.tsx`
- `templates/pages/activity.tmpl` → `ActivityPage.tsx`
- `templates/pages/search.tmpl` → `SearchPage.tsx`
- `templates/pages/settings.tmpl` → `SettingsPage.tsx`
- `templates/pages/login.tmpl` → `LoginPage.tsx`

The styling follows the same Tailwind CSS classes as the original templates for consistency.