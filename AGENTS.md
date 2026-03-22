# AnthoLume - Agent Context

## Critical Rules

### Generated Files
- **NEVER edit generated files directly** - Always edit the source and regenerate
- Go backend API: Edit `api/v1/openapi.yaml` then run:
  - `go generate ./api/v1/generate.go`
  - `cd frontend && bun run generate:api`
- Examples of generated files:
  - `api/v1/api.gen.go`
  - `frontend/src/generated/**/*.ts`

### Database Access
- **NEVER write ad-hoc SQL** - Only use SQLC queries from `database/query.sql`
- Define queries in `database/query.sql` and regenerate via `sqlc generate`

### Error Handling
- Use `fmt.Errorf("message: %w", err)` for wrapping errors
- Do NOT use `github.com/pkg/errors`

## Frontend
- **Package manager**: bun (not npm)
- **Icons**: Use `lucide-react` for all icons (not custom SVGs)
- **Lint**: `cd frontend && bun run lint` (and `lint:fix`)
- **Format**: `cd frontend && bun run format` (and `format:fix`)
- **Generate API client**: `cd frontend && bun run generate:api`

## Regeneration
- Go backend: `go generate ./api/v1/generate.go`
- TS client: `cd frontend && bun run generate:api`
