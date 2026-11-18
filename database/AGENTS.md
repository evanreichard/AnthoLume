# Database contracts

- Fresh initialization composes `schema.sql` with the same `migrations.ReadingSchema` used by Goose. Keep reading changes additive; preserve historical rows and known orphan metadata.
- Documents store a root ID and a canonical slash-separated relative path. Normalize redundant legacy `.` components at startup migration and restore; reject traversal and colliding archive entries. Treat legacy absolute paths only as remap hints; never activate mount paths from a backup. Library is the only managed root; initialize its default without overwriting configured paths. Other roots are import sources. Only Library files may be bundled or restored.
- Resume state belongs to `reading_heads`; timestamp-sorted per-device rows are history/compatibility effects, not a second current-state selector. Credit history is not rewritten by projections.
- Use file-backed SQLite for cancellation, lifecycle, reopen and durability tests. Canceling a modernc query can recycle its connection; `:memory:` then loses the schema, even with one open connection configured.
- Old writers are unsafe around retained receipts/heads. Preserve the write capability gate and refused Down migration; restoration/rollback requires its own qualified stopped-write workflow.
