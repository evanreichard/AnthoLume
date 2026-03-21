# AnthoLume - Agent Context

## Migration Context
Updating Go templates (rendered HTML) → React app using V1 API (OpenAPI spec)

## Critical Rules

### Generated Files
- **NEVER edit generated files** - Always edit the source and regenerate
  - Go backend API: Edit `api/v1/openapi.yaml` then run `go generate ./api/v1/generate.go`
  - TS client: Regenerate with `cd frontend && npm run generate:api`
  - Examples of generated files:
    - `api/v1/api.gen.go`
    - `frontend/src/generated/**/*.ts`

### Database Access
- **NEVER write ad-hoc SQL** - Only use SQLC queries from `database/query.sql`
- Migrate V1 API by mirroring legacy implementation in `api/app-admin-routes.go` and `api/app-routes.go`

### Migration Workflow
1. Check legacy implementation for business logic
2. Copy pattern but adapt to use `s.db.Queries.*` instead of `api.db.Queries.*`
3. Map legacy response types to V1 API response types
4. Never create new DB queries

### Surprises
- Templates may show fields the API doesn't return - cross-check with DB query
- `start_time` is `interface{}` in Go models, needs type assertion in Go
- Templates use `LOCAL_TIME()` SQL function for timezone-aware display

## Error Handling
Use `fmt.Errorf("message: %w", err)` for wrapping. Do NOT use `github.com/pkg/errors`.

## Frontend
- **Package manager**: bun (not npm)
- **Lint**: `cd frontend && bun run lint` (and `lint:fix`)
- **Format**: `cd frontend && bun run format` (and `format:fix`)

## Regeneration
- Go backend: `go generate ./api/v1/generate.go`
- TS client: `cd frontend && npm run generate:api`
