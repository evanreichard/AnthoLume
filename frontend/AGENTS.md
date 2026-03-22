# AnthoLume Frontend Agent Guide

Read this file for work in `frontend/`.
Also follow the repository root guide at `../AGENTS.md`.

## 1) Stack

- Package manager: `bun`
- Framework: React + Vite
- Data fetching: React Query
- API generation: Orval
- Linting: ESLint + Tailwind plugin
- Formatting: Prettier

## 2) Conventions

- Use local icon components from `src/icons/`.
- Do not add external icon libraries.
- Prefer generated types from `src/generated/model/` over `any`.
- Avoid custom class names in JSX `className` values unless the Tailwind lint config already allows them.

## 3) Generated API client

- Do not edit `src/generated/**` directly.
- Edit `../api/v1/openapi.yaml` and regenerate instead.
- Regenerate with: `bun run generate:api`

### Important behavior

- The generated client returns `{ data, status, headers }` for both success and error responses.
- Do not assume non-2xx responses throw.
- Check `response.status` and response shape before treating a request as successful.

## 4) Auth / Query State

- When changing auth flows, account for React Query cache state.
- Pay special attention to `/api/v1/auth/me`.
- A local auth state update may not be enough if cached query data still reflects a previous auth state.

## 5) Commands

- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Lint fix: `bun run lint:fix`
- Format check: `bun run format`
- Format fix: `bun run format:fix`
- Build: `bun run build`
- Generate API client: `bun run generate:api`

## 6) Validation Notes

- ESLint ignores `src/generated/**`.
- Frontend unit tests use Vitest and live alongside source as `src/**/*.test.ts(x)`.
- `bun run lint` includes test files but does not typecheck.
- Use `bun run typecheck` to run TypeScript validation for app code and colocated tests without a full production build.
- Run frontend tests with `bun run test`.
- `bun run build` still runs `tsc && vite build`, so unrelated TypeScript issues elsewhere in `src/` can fail the build.
- When possible, validate changed files directly before escalating to full-project fixes.

## 7) Updating This File

After completing a frontend task, update this file if you learned something general that would help future frontend agents.

Rules for updates:

- Add only frontend-wide guidance.
- Do not record one-off task history.
- Keep updates concise and action-oriented.
- Prefer notes that prevent repeated mistakes.
