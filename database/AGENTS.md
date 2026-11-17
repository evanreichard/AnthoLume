# Database contracts

- Fresh initialization composes `schema.sql` with the same `migrations.ReadingSchema` used by Goose. Keep reading changes additive; historical rows, external basepaths and known orphan metadata are not cleanup targets.
- Resume state belongs to `reading_heads`; timestamp-sorted per-device rows are history/compatibility effects, not a second current-state selector. Credit history is not rewritten by projections.
- Use file-backed SQLite for cancellation, lifecycle, reopen and durability tests. Canceling a modernc query can recycle its connection; `:memory:` then loses the schema, even with one open connection configured.
- Old writers are unsafe around retained receipts/heads. Preserve the write capability gate and refused Down migration; restoration/rollback requires its own qualified stopped-write workflow.
