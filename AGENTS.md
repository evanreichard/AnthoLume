# Agent Context Hints

## Current Status
Currently mid migration from go templates (`./templates`) to React App (`./frontend`)

## Architecture Context
- **Backend**: Go with Gin router (legacy), SQLC for database queries, currently migrating to V1 API (oapi-codegen)
- **Frontend**: React with Vite, currently migrating from Go templates (using the V1 API)
- **API**: OpenAPI 3.0 spec, generates Go server (oapi-codegen) and TS client (orval)

## Data Flow (CRITICAL for migrations)
1. Database schema → SQL queries (`database/query.sql`, `database/query.sql.go`)
2. SQLC models → API handlers (`api/v1/*.go`)  
3. Go templates show **intended UI** structure (`templates/pages/*.tmpl`)
4. API spec defines actual API contract (`api/v1/openapi.yaml`)
5. Generated TS client → React components

## When Migrating from Go Templates
- Check template AND database query results (Go templates may show fields API doesn't return)
- Template columns often map to: document_id, title, author, start_time, duration, start/end_percentage
- Go template rendering: `{{ template "component/table" }}` with "Columns" and "Keys"

## API Regeneration Commands
- Go backend: `go generate ./api/v1/generate.go`
- TS client: `cd frontend && npm run generate:api`

## Key Files
- Database queries: `database/query.sql` → SQLc Query shows actual fields returned
- SQLC models: `database/query.sql.go` → SQLc Generated Go struct definitions
- Go templates: `templates/pages/*.tmpl` → Legacy UI reference
- API spec: `api/v1/openapi.yaml` → contract definition
- Generated TS types: `frontend/src/generated/model/*.ts`

## Common Gotchas
- API implementation may not map all fields from DB query (check `api/v1/activity.go` mapping)
- `start_time` is `interface{}` in Go models, needs type assertion
- Go templates use `LOCAL_TIME()` SQL function for timezone-aware display

## CRITICAL: Migration Implementation Rules
- **NEVER write ad-hoc SQL queries** - All database access must use existing SQLC queries from `database/query.sql`
- **Mirror legacy implementation** - Check `api/app-admin-routes.go`, `api/app-routes.go` for existing business logic
- **Reuse existing functions** - Look for helper functions in `api/utils.go` that handle file operations, metadata, etc.
- **SQLC query reference** - Check `database/query.sql` for available queries and `database/query.sql.go` for function signatures
- **When implementing TODOs in v1 API**:
  1. Find the corresponding function in legacy API (e.g., `api/app-admin-routes.go`)
  2. Copy the logic pattern but adapt to use `s.db.Queries.*` instead of `api.db.Queries.*`
  3. Use existing helper functions from `api/utils.go` (make them accessible if needed)
  4. Map legacy response types to new v1 API response types
  5. Never create new database queries - use what SQLC already provides

## API Structure
- **Legacy API**: `api/` directory (e.g., `api/app-admin-routes.go`, `api/app-routes.go`)
  - Uses Gin router
  - Renders Go templates
  - Contains all existing business logic to mirror
- **V1 API**: `api/v1/` directory (e.g., `api/v1/admin.go`, `api/v1/documents.go`)
  - Uses oapi-codegen (OpenAPI spec driven)
  - Returns JSON responses
  - Currently being migrated from legacy patterns
