# AnthoLume M2 · Folio / Index

Two disposable, standalone React/TypeScript visual directions on the approved Library, Offline, Insights, More IA. All content is synthetic; no API, EPUB engine, service worker, or real storage/sync. Neither creative direction has been selected.

## Safe review preview

From the repository root, with Node 22.12+ (verified with 22.23.4):

```sh
npm --prefix prototypes/design ci
npm --prefix prototypes/design run audit
npm --prefix prototypes/design run build
npm --prefix prototypes/design run preview
```

This script serves **only `prototypes/design/dist` on `127.0.0.1:5173`**. It has no Vite development middleware, repository fallback, directory listing or host-binding option. Missing paths/dotfiles/traversal return errors; resolved symlinks must stay within dist. Stop with Ctrl-C. No server starts during install/build, and none is left running by tests.

- Folio: http://127.0.0.1:5173/?direction=folio&theme=light#/library
- Index: http://127.0.0.1:5173/?direction=index&theme=light#/library
- Dark mode: use `theme=dark` or the toolbar.
- Reader: `#/read/tidal`; conflict: `#/sync?state=conflict`.

The toolbar preserves the journey. Per-book chapter/appearance/chrome and mock outcomes survive route changes, **not reload**. History restores scroll only for a matching reader context. Direction/theme/route/library query remain in the URL. No durable reading position or activity is saved.

For editing only, `npm --prefix prototypes/design run dev` starts patched Vite **7.3.8**, also loopback-only on 5173. Do not serve the repository root, broaden the dev bind, or tunnel the development server. Stop any existing preview first. Audits are point-in-time evidence, not a security guarantee.

## Checks and screenshots

```sh
npm --prefix prototypes/design run typecheck
npm --prefix prototypes/design run test:preview
npm --prefix prototypes/design run audit
cd prototypes/design
npx playwright install chromium
npm test
```

`test:preview` builds and runs Node tests against temporary loopback static servers, then closes them. Browser tests start/stop their own Vite on **5313**. On NixOS, replace browser installation/test commands with:

```sh
CHROMIUM_PATH="$(nix build nixpkgs#chromium --no-link --print-out-paths)/bin/chromium" npm test
```

Screenshots default to `_scratch/m2/design/screenshots/` at the repository root. Independent reviewers can direct **all screenshot writes** into their own absolute path, without editing tests:

```sh
# From prototypes/design; include CHROMIUM_PATH on NixOS.
M2_SCREENSHOT_DIR=/absolute/owned/review/screenshots npm test -- --grep 'review screenshots'
```

Relative overrides resolve from the test process working directory (`prototypes/design` under `npm --prefix`). The two screenshot tests regenerate **52 PNGs** across both directions: libraries at 320/390/1280 in light/dark, mobile detail/reader/offline/conflict, desktop detail and logged-out Sync. Plain names are viewport captures; `-full.png` captures the scrollable document, with fixed tabs at the initial viewport edge. These are review artifacts, not pixel-baseline assertions.

See [review findings](../../docs/evaluation/m2-design.md) for walkthroughs, dispositions and evidence. CSS cover padding uses fixed values: percentage padding resolves against the containing block and distorts reused thumbnails in split/detail contexts. Dialog cancellation restores the opener; intentional chapter transitions and successful removals supply a meaningful post-close focus destination.
