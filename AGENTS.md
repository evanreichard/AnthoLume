# Agent Context Hints

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
