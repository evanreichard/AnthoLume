# API V1 Admin vs Legacy Implementation Comparison

## Overview
This document compares the V1 API admin implementations with the legacy API implementations to identify deviations and ensure adequate information is returned for the React app.

---

## 1. GET /admin

### V1 Implementation
- Returns: `GetAdmin200JSONResponse` with `DatabaseInfo`
- DatabaseInfo contains: `documentsSize`, `activitySize`, `progressSize`, `devicesSize`
- Gets documents count from `GetDocumentsSize(nil)`
- Aggregates activity/progress/devices across all users using `GetDatabaseInfo`

### Legacy Implementation
- Function: `appGetAdmin`
- Returns: HTML template page
- No direct database info returned in endpoint
- Template uses base template variables

### Deviations
**None** - V1 provides more detailed information which is beneficial for React app

### React App Requirements
✅ **Sufficient** - V1 returns all database statistics needed for admin dashboard

---

## 2. POST /admin (Admin Actions)

### V1 Implementation
- Actions: `BACKUP`, `RESTORE`, `CACHE_TABLES`, `METADATA_MATCH`
- Returns: `PostAdminAction200ApplicationoctetStreamResponse` with Body as io.Reader
- BACKUP: Streams ZIP file via pipe
- RESTORE: Returns success message as stream
- CACHE_TABLES: Returns confirmation message as stream
- METADATA_MATCH: Returns not implemented message as stream

### Legacy Implementation
- Function: `appPerformAdminAction`
- Actions: Same as V1
- BACKUP: Streams ZIP with proper Content-Disposition header
- RESTORE: After restore, redirects to `/login`
- CACHE_TABLES: Runs async, returns to admin page
- METADATA_MATCH: TODO (not implemented)

### Deviations
1. **RESTORE Response**: V1 returns success message, legacy redirects to login
   - **Impact**: React app won't be redirected, but will get success confirmation
   - **Recommendation**: Consider adding redirect URL in response for React to handle

2. **CACHE_TABLES Response**: V1 returns stream, legacy returns to admin page
   - **Impact**: Different response format but both provide confirmation
   - **Recommendation**: Acceptable for REST API

3. **METADATA_MATCH Response**: Both not implemented
   - **Impact**: None

### React App Requirements
✅ **Sufficient** - V1 returns confirmation messages for all actions
⚠️ **Consideration**: RESTORE doesn't redirect - React app will need to handle auth state

---

## 3. GET /admin/users

### V1 Implementation
- Returns: `GetUsers200JSONResponse` with array of `User` objects
- User object fields: `Id`, `Admin`, `CreatedAt`
- Data from: `s.db.Queries.GetUsers(ctx)`

### Legacy Implementation
- Function: `appGetAdminUsers`
- Returns: HTML template with user data
- Template variables available: `.Data` contains all user fields
- User fields from DB: `ID`, `Pass`, `AuthHash`, `Admin`, `Timezone`, `CreatedAt`
- Template only uses: `$user.ID`, `$user.Admin`, `$user.CreatedAt`

### Deviations
**None** - V1 returns exactly the fields used by the legacy template

### React App Requirements
✅ **Sufficient** - All fields used by legacy admin users page are included

---

## 4. POST /admin/users (User CRUD)

### V1 Implementation
- Operations: `CREATE`, `UPDATE`, `DELETE`
- Returns: `UpdateUser200JSONResponse` with updated users list
- Validation:
  - User cannot be empty
  - Password required for CREATE
  - Something to update for UPDATE
  - Last admin protection for DELETE and UPDATE
- Same business logic as legacy

### Legacy Implementation
- Function: `appUpdateAdminUsers`
- Operations: Same as V1
- Returns: HTML template with updated user list
- Same validation and business logic

### Deviations
**None** - V1 mirrors legacy business logic exactly

### React App Requirements
✅ **Sufficient** - V1 returns updated users list after operation

---

## 5. GET /admin/import

### V1 Implementation
- Parameters: `directory` (optional), `select` (optional)
- Returns: `GetImportDirectory200JSONResponse`
- Response fields: `CurrentPath`, `Items` (array of `DirectoryItem`)
- DirectoryItem fields: `Name`, `Path`
- Default path: `s.cfg.DataPath` if no directory specified
- If `select` parameter set, returns empty items with selected path

### Legacy Implementation
- Function: `appGetAdminImport`
- Parameters: Same as V1
- Returns: HTML template
- Template variables: `.CurrentPath`, `.Data` (array of directory names)
- Same default path logic

### Deviations
1. **DirectoryItem structure**: V1 includes `Path` field, legacy only uses names
   - **Impact**: V1 provides more information (beneficial for React)
   - **Recommendation**: Acceptable improvement

### React App Requirements
✅ **Sufficient** - V1 provides all information plus additional path data

---

## 6. POST /admin/import

### V1 Implementation
- Parameters: `directory`, `type` (DIRECT or COPY)
- Returns: `PostImport200JSONResponse` with `ImportResult` array
- ImportResult fields: `Id`, `Name`, `Path`, `Status`, `Error`
- Status values: `SUCCESS`, `EXISTS`, `FAILED`
- Same transaction and error handling as legacy
- Results sorted by status priority

### Legacy Implementation
- Function: `appPerformAdminImport`
- Parameters: Same as V1
- Returns: HTML template with results (redirects to import-results page)
- Result fields: `ID`, `Name`, `Path`, `Status`, `Error`
- Same status values and priority

### Deviations
**None** - V1 mirrors legacy exactly

### React App Requirements
✅ **Sufficient** - All import result information included

---

## 7. GET /admin/import-results

### V1 Implementation
- Returns: `GetImportResults200JSONResponse` with empty `ImportResult` array
- Note: Results returned immediately after import in POST /admin/import
- Legacy behavior: Results displayed on separate page after POST

### Legacy Implementation
- No separate endpoint
- Results shown on `page/admin-import-results` template after POST redirect

### Deviations
1. **Endpoint Purpose**: Legacy doesn't have this endpoint
   - **Impact**: V1 endpoint returns empty results
   - **Recommendation**: Consider storing results in session/memory for retrieval
   - **Alternative**: React app can cache results from POST response

### React App Requirements
⚠️ **Limited** - Endpoint returns empty, React app should cache POST results
💡 **Suggestion**: Enhance to store/retrieve results from session or memory

---

## 8. GET /admin/logs

### V1 Implementation
- Parameters: `filter` (optional)
- Returns: `GetLogs200JSONResponse` with `Logs` and `Filter`
- Log lines: Pretty-printed JSON with indentation
- Supports JQ filters for complex filtering
- Supports basic string filters (quoted)
- Filters only pretty JSON lines

### Legacy Implementation
- Function: `appGetAdminLogs`
- Parameters: Same as V1
- Returns: HTML template with filtered logs
- Same JQ and basic filter logic
- Template variables: `.Data` (log lines), `.Filter`

### Deviations
**None** - V1 mirrors legacy exactly

### React App Requirements
✅ **Sufficient** - All log information and filtering capabilities included

---

## Summary of Deviations

### Critical (Requires Action)
None identified

### Important (Consideration)
1. **RESTORE redirect**: Legacy redirects to login after restore, V1 doesn't
   - **Impact**: React app won't automatically redirect
   - **Recommendation**: Add `redirect_url` field to response or document expected behavior

2. **Import-results endpoint**: Returns empty results
   - **Impact**: Cannot retrieve previous import results
   - **Recommendation**: Store results in session/memory or cache on client side

### Minor (Acceptable Differences)
1. **DirectoryItem includes Path**: V1 includes path field
   - **Impact**: Additional information available
   - **Recommendation**: Acceptable improvement

2. **Response formats**: V1 returns JSON, legacy returns HTML
   - **Impact**: Expected for REST API migration
   - **Recommendation**: Acceptable

### No Deviations
- GET /admin (actually provides MORE info)
- GET /admin/users
- POST /admin/users
- POST /admin/import
- GET /admin/logs

---

## Database Access Compliance

✅ **All database access uses existing SQLC queries**
- `GetDocumentsSize` - Document count
- `GetUsers` - User list
- `GetDatabaseInfo` - Per-user stats
- `CreateUser` - User creation
- `UpdateUser` - User updates
- `DeleteUser` - User deletion
- `GetUser` - Single user retrieval
- `GetDocument` - Document lookup
- `UpsertDocument` - Document upsert
- `CacheTempTables` - Table caching
- `Reload` - Database reload

❌ **No ad-hoc SQL queries used**

---

## Business Logic Compliance

✅ **All critical business logic mirrors legacy**
- User validation (empty user, password requirements)
- Last admin protection
- Transaction handling for imports
- Backup/restore validation and flow
- Auth hash rotation after restore
- Log filtering with JQ support

---

## Recommendations for React App

1. **Handle restore redirect**: After successful restore, redirect to login page
2. **Cache import results**: Store POST import results for display
3. **Leverage additional data**: Use `Path` field in DirectoryItem for better UX
4. **Error handling**: All error responses follow consistent pattern with message

---

## Conclusion

The V1 API admin implementations successfully mirror the legacy implementations with:
- ✅ All required data fields for React app
- ✅ Same business logic and validation
- ✅ Proper use of existing SQLC queries
- ✅ No critical deviations

Minor improvements and acceptable RESTful patterns:
- Additional data fields (DirectoryItem.Path)
- RESTful JSON responses instead of HTML
- Confirmation messages for async operations

**Status**: Ready for React app integration
