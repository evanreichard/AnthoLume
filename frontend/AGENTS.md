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
- For decorative icons in inputs or labels, disable hover styling via the icon component API rather than overriding it ad hoc.
- Prefer `LoadingState` for result-area loading indicators; avoid early returns that unmount search/filter forms during fetches.
- Use theme tokens from `tailwind.config.js` / `src/index.css` (`bg-surface`, `text-content`, `border-border`, `primary`, etc.) for new UI work instead of adding raw light/dark color pairs.
- Store frontend-only preferences in `src/utils/localSettings.ts` so appearance and view settings share one local-storage shape.

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
- Read `TESTING_STRATEGY.md` before adding or expanding frontend tests.
- Prefer tests for meaningful app behavior, branching logic, side effects, and user-visible outcomes.
- Avoid low-value tests that mainly assert exact styling classes, duplicate existing coverage, or re-test framework/library behavior.
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
