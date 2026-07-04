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
- Unwrap API responses by narrowing on `status` (e.g. `data?.status === 200 ? data.data : undefined`); the generated response types are discriminated unions, so this needs no `as XResponse` cast.
- Type form submit handlers as `SyntheticEvent` (optionally `SyntheticEvent<HTMLFormElement>`); `@types/react@19` deprecates `FormEvent`.
- Route mutation success/error feedback through `useMutationWithToast` (`src/hooks/`); error-toast-on-failure is the app-wide pattern (treat non-2xx as failure).
- Shared input styling lives in `TextInput` / the exported `inputClassName` (`src/components/TextInput.tsx`); reuse rather than re-pasting the input class string.
- Render tabular data with the shared `<Table>` (`src/components/Table.tsx`). Columns are `{ id, header: ReactNode, render(row, index), className? }` — `id` is decoupled from data, so action columns are first-class. The table owns its own loading skeleton and empty state; don't hand-roll `<table>` markup for data grids. (Genuinely different widget shapes — e.g. a file-browser or a card-grid — are fine to build bespoke.)
- Nav items and page titles come from `src/components/navigation.ts` (`navItems`, `adminNavItems`, `getPageTitle`) — add routes there, not in `Layout`/`HamburgerMenu`.
- Avoid custom class names in JSX `className` values unless the Tailwind lint config already allows them.
- For decorative icons in inputs or labels, disable hover styling via the icon component API rather than overriding it ad hoc.
- Prefer `LoadingState` for result-area loading indicators (the single loading convention); avoid early returns that unmount search/filter forms during fetches. React Query `isLoading` is initial-load-only (false on background refetches), so a full-page early-return on `isLoading` is fine for pages with no persistent filter form.
- For mutations, use `useMutationWithToast` (declarative `.mutate(vars, options)` for fire-and-forget) or its imperative sibling `useToastMutation` (awaited, returns a success `boolean`) instead of hand-rolling `mutateAsync` → toast/catch blocks.
- Use `SegmentedControl` for active/inactive toggle groups (view mode, period, reader theme/font) rather than re-implementing `option.map` + ternary class toggling; pass per-call `activeClassName`/`inactiveClassName`.
- For a persistent/progress toast that resolves in place (long-running actions), create it with `showInfo(msg, 0)` and finish with `updateToast(id, { message, type, duration })`.
- Use theme tokens defined in `src/index.css` `@theme` (`bg-surface`, `text-content`, `border-border`, `primary`, etc.) for new UI work instead of adding raw light/dark color pairs. There is no `tailwind.config.js` — Tailwind v4 config is CSS-first.
- Semantic colors map to runtime CSS variables (`--color-x: rgb(var(--x))`) via `@theme inline`; light/dark values live in `:root` / `.dark` in `src/index.css`. Dark mode is class-based via `@custom-variant dark`, toggled by `ThemeProvider`.
- Store frontend-only preferences in `src/utils/localSettings.ts` so appearance and view settings share one local-storage shape.
- Reuse shared primitives instead of re-rolling them: `formatDate` / `formatDateTime` (`src/utils/formatters.ts`) for user-facing timestamps (`formatUtcDate` is intentionally UTC, for graph day-buckets only); `SegmentedControl` for toggle groups (default `pill` variant needs only `options`/`value`/`onChange`; pass `variant="unstyled"` for bespoke shapes like grids/inline text); `usePaginatedList` + `documentColumn` for paginated list/table pages.

## 3) Generated API client

- Do not edit `src/generated/**` directly.
- Edit `../api/v1/openapi.yaml` and regenerate instead.
- Regenerate with: `pnpm run generate:api`

### Important behavior

- The generated client returns the documented **success body directly** and throws `ApiError` (`src/utils/apiFetch.ts`) for non-2xx responses.
- Use React Query's native error flow (`isError`, `error`, `onError`) instead of status narrowing.
- Use `getErrorMessage` (`src/utils/errors.ts`) to display caught errors; `ApiError.message` already contains the server-provided error message when present.
- Centralize mutation error/success feedback via `useMutationWithToast` or `useToastMutation` rather than inline toast/catch duplication.

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
- `pnpm run format` currently reports pre-existing style violations in files unrelated to most changes; format only the files you touched (`npx prettier --write <files>`) rather than reformatting the whole tree.

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
