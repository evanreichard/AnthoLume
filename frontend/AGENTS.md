# AnthoLume Frontend Agent Guide

Read this file for work in `frontend/`.
Also follow the repository root guide at `../AGENTS.md`.

## 1) Stack

- Package manager: `pnpm`
- Framework: React + Vite
- Data fetching: React Query
- API generation: Orval
- Styling: Tailwind CSS v4 (CSS-first config)
- Linting: oxlint (config in `.oxlintrc.json`) + `oxlint-tailwindcss` for Tailwind rules
- Formatting: Prettier

## 2) Conventions

- Use local icon components from `src/icons/`.
- Do not add external icon libraries.
- Prefer generated types from `src/generated/model/` over `any`.
- Avoid custom class names in JSX `className` values unless the Tailwind lint config already allows them.
- For decorative icons in inputs or labels, disable hover styling via the icon component API rather than overriding it ad hoc.
- Prefer `LoadingState` for result-area loading indicators; avoid early returns that unmount search/filter forms during fetches.
- Use theme tokens defined in `src/index.css` `@theme` (`bg-surface`, `text-content`, `border-border`, `primary`, etc.) for new UI work instead of adding raw light/dark color pairs. There is no `tailwind.config.js` — Tailwind v4 config is CSS-first.
- Semantic colors map to runtime CSS variables (`--color-x: rgb(var(--x))`) via `@theme inline`; light/dark values live in `:root` / `.dark` in `src/index.css`. Dark mode is class-based via `@custom-variant dark`, toggled by `ThemeProvider`.
- Store frontend-only preferences in `src/utils/localSettings.ts` so appearance and view settings share one local-storage shape.

## 3) Generated API client

- Do not edit `src/generated/**` directly.
- Edit `../api/v1/openapi.yaml` and regenerate instead.
- Regenerate with: `pnpm run generate:api`

### Important behavior

- The generated client returns `{ data, status, headers }` for both success and error responses.
- Do not assume non-2xx responses throw.
- Check `response.status` and response shape before treating a request as successful.

## 4) Auth / Query State

- When changing auth flows, account for React Query cache state.
- Pay special attention to `/api/v1/auth/me`.
- A local auth state update may not be enough if cached query data still reflects a previous auth state.

## 5) Commands

- Lint: `pnpm run lint`
- Typecheck: `pnpm run typecheck`
- Lint fix: `pnpm run lint:fix`
- Format check: `pnpm run format`
- Format fix: `pnpm run format:fix`
- Build: `pnpm run build`
- Generate API client: `pnpm run generate:api`

## 6) Validation Notes

- oxlint ignores `src/generated/**` and `dist/**` (via `ignorePatterns` in `.oxlintrc.json`).
- `lint` runs `oxlint --max-warnings=0`; keep the tree warning-free. `react-hooks/exhaustive-deps` is enforced — fix deps rather than disabling the rule; use a justified inline `// oxlint-disable-next-line` only for genuine init-once effects.
- The Tailwind lint plugin uses oxlint `jsPlugins` (experimental, not run by the editor language server), so Tailwind diagnostics surface via CLI/CI, not in-editor. It reads the theme from `src/index.css` (`settings.tailwindcss.entryPoint`).
- Frontend unit tests use Vitest and live alongside source as `src/**/*.test.ts(x)`.
- Read `TESTING_STRATEGY.md` before adding or expanding frontend tests.
- Prefer tests for meaningful app behavior, branching logic, side effects, and user-visible outcomes.
- Avoid low-value tests that mainly assert exact styling classes, duplicate existing coverage, or re-test framework/library behavior.
- `pnpm run lint` includes test files but does not typecheck.
- Use `pnpm run typecheck` to run TypeScript validation for app code and colocated tests without a full production build.
- Run frontend tests with `pnpm run test`.
- `pnpm run build` still runs `tsc && vite build`, so unrelated TypeScript issues elsewhere in `src/` can fail the build.
- When possible, validate changed files directly before escalating to full-project fixes.

## 7) Live Dev Server Debugging

- Use `glimpse` to inspect the running Vite dev server at `localhost:5173`:
  ```bash
  glimpse snapshot http://localhost:5173/some-page --wait-until=complete --timeout=15000
  glimpse screenshot http://localhost:5173/some-page --wait-until=complete --output=_scratch/page.png
  glimpse exec http://localhost:5173/some-page --wait-until=complete --timeout=20000 --js='return document.title'
  ```
- Use `curl` for API endpoint testing (both `localhost:5173` via proxy and `localhost:8585` directly).
- Do not monkey-patch `window.fetch` in `glimpse exec`; Firefox rejects it. Test API calls with `curl` instead.

## 8) Updating This File

After completing a frontend task, update this file if you learned something general that would help future frontend agents.

Rules for updates:

- Add only frontend-wide guidance.
- Do not record one-off task history.
- Keep updates concise and action-oriented.
- Prefer notes that prevent repeated mistakes.
