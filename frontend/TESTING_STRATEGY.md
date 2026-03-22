# Frontend Testing Strategy

This project prefers meaningful frontend tests over high test counts.

## What we want to test

Prioritize tests for app-owned behavior such as:

- user-visible page and component behavior
- auth and routing behavior
- branching logic and business rules
- data normalization and error handling
- timing behavior with real app logic
- side effects that could regress, such as token handling or redirects
- algorithmic or formatting logic that defines product behavior

Good examples in this repo:

- login and registration flows
- protected-route behavior
- auth interceptor token injection and cleanup
- error message extraction
- debounce timing
- human-readable formatting logic
- graph/algorithm output where exact parity matters

## What we usually do not want to test

Avoid tests that mostly prove:

- the language/runtime works
- React forwards basic props correctly
- a third-party library behaves as documented
- exact Tailwind class strings with no product meaning
- implementation details not observable in behavior
- duplicated examples that re-assert the same logic

In other words, do not add tests equivalent to checking that JavaScript can compute `1 + 1`.

## Preferred test style

- Prefer behavior-focused assertions over implementation-detail assertions.
- Prefer user-visible outcomes over internal state inspection.
- Mock at module boundaries when needed.
- Keep test setup small and local.
- Use exact-output assertions only when the output itself is the contract.

## When exact assertions are appropriate

Exact assertions are appropriate when they protect a real contract, for example:

- a formatter's exact human-readable output
- auth decision outcomes for a given API response shape
- exact algorithm output that must remain stable

Exact assertions are usually not appropriate for:

- incidental class names
- framework internals
- non-observable React keys

## Cleanup rule of thumb

Keep tests that would catch meaningful regressions in product behavior.
Trim or remove tests that are brittle, duplicated, or mostly validate tooling rather than app logic.

## Validation

For frontend test work, validate with:

- `cd frontend && bun run lint`
- `cd frontend && bun run typecheck`
- `cd frontend && bun run test`
