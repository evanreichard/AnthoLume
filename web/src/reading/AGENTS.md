# Browser EPUB reader

## Open and render

- When online, `runtime.ts` revalidates the file and fetches reading state. A passwordless offline profile can read cached copies within its origin and restore generation. Overlay only that profile’s checkpoints; never borrow position or drafts from a book’s original downloader. Pinning exempts the book from automatic eviction, not explicit cache clearing. `/sw.js` caches only the public shell and build assets; IndexedDB owns account-scoped books and the outbox. The `offline` table is separate from the replay outbox. Only an authenticated owner’s explicit per-book selection may move drafts to the outbox; compare progress against the displayed revision and activity against the same account-local dates. Sign-out retains offline profiles; forgetting discards unsubmitted drafts.
- Stream originals into staging; use bounded chunk/range reads rather than buffering the whole book. `repository.ts` publishes the complete source, validated index and checkpoint together. A complete cached source is not proof that every chapter is safe. Cache eviction must preserve checkpoints, outbox events and actively leased sources.
- Give EPUB.js validated documents, not the original archive or network access. `source.worker.ts` checks ZIP entries; `content-policy.ts` and `chapter-policy.ts` validate resources before rendering. Preserve the scriptless frame, CSP and authored XHTML tree. Keep EPUB.js-specific lifecycle workarounds in `epub-lifecycle.ts`; release unused resources on failure as well as success.
- `codec.ts` translates KOReader positions. New positions must round-trip to the authored element; legacy fallback is for reading historical positions, not rewriting them. A failed restore must not publish a guessed position. Reflow and choosing a resume candidate do not publish progress.

## Save and replay

- `repository.ts` owns the durable outbox; `sync.ts` delivers through the session bridge. Save the checkpoint and its pending event or latest draft atomically. Keep the event ID and payload stable across retries. On acknowledgement, promote a waiting draft using the receipt’s revision.
- Replay activity before progress. On revision conflict, fetch valid server state before removing pending progress; retain the device position as a resume choice. Distinguish terminal rejection from a retryable failure. Ignore stale responses after account or access changes.
- In browser tests, wait for the operation under test: settle prior appearance changes before observing resize, and have a worker signal that it is busy before advancing the parent clock to test its deadline.
- From the repo root, `npm --prefix web run test:reader` prepares fixtures and runs the reader browser suite. Use the app browser suite under `web/tests/` for behavior crossing the real Go API, including restore, sync and worker retirement.
