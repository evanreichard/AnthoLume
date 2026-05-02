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

Notes:
- If you add response headers in `api/v1/openapi.yaml` (for example `Set-Cookie`), `oapi-codegen` will generate typed response header structs in `api/v1/api.gen.go`; update the handler response values to populate those headers explicitly.

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
- No-auth dev run: `CONFIG_PATH=./data DATA_PATH=./data REGISTRATION_ENABLED=true DISABLE_AUTH=true DISABLE_AUTH_USER=evan go run main.go serve`
- Tests: `make tests`
- Tailwind asset build: `make build_tailwind`

### Notes
- The Go server embeds `templates/*` and `assets/*`.
- Root Tailwind output is built to `assets/style.css`.
- Be mindful of whether a change affects the embedded server-rendered app, the React frontend, or both.
- SQLite timestamps are stored as RFC3339 strings (usually with a trailing `Z`); prefer `parseTime` / `parseTimePtr` instead of ad-hoc `time.Parse` layouts.
- `DISABLE_AUTH=true` bypasses authentication on **all** routes (v1 API, legacy web app, KOSync, OPDS). Set `DISABLE_AUTH_USER=<username>` to control which database user the session impersonates (defaults to the first user in the DB). The user must already exist.

## 5) Frontend

For frontend-specific implementation notes and commands, also read:
- `frontend/AGENTS.md`

## 6) Regeneration Summary

- Go API: `go generate ./api/v1/generate.go`
- Frontend API client: `cd frontend && bun run generate:api`
- SQLC: `sqlc generate`

## 7) Live Dev Server Debugging

- The Vite dev server runs on `localhost:5173` and proxies `/api` to the Go backend on `localhost:8585`.
- Use `glimpse` to interact with the running frontend for visual debugging:
  ```bash
  # Snapshot rendered page state (text, links, forms, buttons)
  glimpse snapshot http://localhost:5173/some-page --wait-until=complete --timeout=15000

  # Screenshot for visual inspection
  glimpse screenshot http://localhost:5173/some-page --wait-until=complete --output=_scratch/page.png

  # Execute JS in the browser context (e.g. fill forms, click buttons, read state)
  glimpse exec http://localhost:5173/some-page --wait-until=complete --timeout=20000 --js='return document.title'
  ```
- Use `curl` for direct API testing (both `localhost:5173` via Vite proxy and `localhost:8585` directly work).
- **Caveat:** Monkey-patching `window.fetch` inside `glimpse exec` breaks in Firefox with `TypeError: 'fetch' called on an object that does not implement interface Window.`. Avoid fetch interception; instead test API calls separately with `curl`.

## 8) Updating This File

After completing a task, update this `AGENTS.md` if you learned something general that would help future agents.

Rules for updates:
- Add only repository-wide guidance.
- Do not add one-off task history.
- Keep updates short, concrete, and organized.
- Place new guidance in the most relevant section.
- If the new information would help future agents avoid repeated mistakes, add it proactively.
