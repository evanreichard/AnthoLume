# SQLite and migrations

- Put each new Goose migration in one `<version>_<description>.sql` file under `database/migrations/`. If sqlc needs the schema change, point `sqlc.yaml` at that same file. Use a numbered `.go` migration only for work that requires Go, not as a wrapper for a separate SQL script.
- Give each new migration a unique version greater than the latest on the merge target. Keep merged migration files and version numbers unchanged; revise unmerged migrations in place.

- Edit SQL inputs listed in `sqlc.yaml`, then run `sqlc generate` from the repo root. `schema.sql` bootstraps a database; Goose migrations upgrade persisted data. Keep the reading-writer triggers and the forward-only ledger migrations: older writers cannot maintain heads and receipts.
- Store scalar instance preferences in `settings` (one row per name); use the generated `UpdateSettings` upsert. Keep deployment secrets out of the database.
- Startup upgrades and staged restores share the Goose migration runner. Test upgrades of older releases using database fixtures, not a separate registry of historical schemas. Restore migrations must not trust filesystem paths carried in a backup.
- Keep device identity account-scoped: `(user_id, id)`. Preserve historical activity, resume positions and sync cursors when changing keys. `reading_heads` is the current position; per-device progress and statistics are not alternate authorities.
- Store book placement as a root ID plus a relative path. Library is managed; source files may be referenced in place. Normalize legacy `.` components without accepting traversal. Backup mounts are not local permissions.
- The main SQLite handle has one connection. Set foreign-key enforcement in the runtime DSN so replacement connections preserve it; historical rebuilds run on a private startup or restore handle. Clear `hardcover_links` on the exported snapshot, never on the live database. Restore needs no Hardcover-specific handling. Read through the transaction you already hold; materialize query results before slow filesystem scans or response streaming. Use file-backed databases for cancellation, reopen and durability tests.
