# AnthoLume Agent Guide

## 1) Working Style

- Keep changes targeted.
- Do not refactor broadly unless the task requires it.
- Validate only what is relevant to the change when practical.
- If a fix will require substantial refactoring or wide-reaching changes, stop and ask first.

## 2) Hard Rules

- Never edit generated files directly.
- Never write ad-hoc SQL.
- For Go error wrapping, use `fmt.Errorf("message: %w", err)`.
- Do not use `github.com/pkg/errors`.

## 3) Generated Code

### OpenAPI
Edit:
- `api/v1/openapi.yaml`

Regenerate:
- `go generate ./api/v1/generate.go`
- `cd frontend && bun run generate:api`

Examples of generated files:
- `api/v1/api.gen.go`
- `frontend/src/generated/**/*.ts`

### SQLC
Edit:
- `database/query.sql`

Regenerate:
- `sqlc generate`

## 4) Backend / Assets

### Common commands
- Dev server: `make dev`
- Direct dev run: `CONFIG_PATH=./data DATA_PATH=./data REGISTRATION_ENABLED=true go run main.go serve`
- Tests: `make tests`
- Tailwind asset build: `make build_tailwind`

### Notes
- The Go server embeds `templates/*` and `assets/*`.
- Root Tailwind output is built to `assets/style.css`.
- Be mindful of whether a change affects the embedded server-rendered app, the React frontend, or both.

## 5) Frontend

For frontend-specific implementation notes and commands, also read:
- `frontend/AGENTS.md`

## 6) Regeneration Summary

- Go API: `go generate ./api/v1/generate.go`
- Frontend API client: `cd frontend && bun run generate:api`
- SQLC: `sqlc generate`

## 7) Updating This File

After completing a task, update this `AGENTS.md` if you learned something general that would help future agents.

Rules for updates:
- Add only repository-wide guidance.
- Do not add one-off task history.
- Keep updates short, concrete, and organized.
- Place new guidance in the most relevant section.
- If the new information would help future agents avoid repeated mistakes, add it proactively.
