# Shared reading transactions

- `Store` owns progress, activity and device decisions for both web and KO clients. Keep Gin and generated HTTP types in `api/`.
- For web submissions, verify the account, then check the immutable receipt **before** checking the current revision or whether the document still exists. An exact retry returns its original decision; the same event ID with a different normalized payload conflicts. Normalize instants to UTC and signed zero to zero; keep opaque positions and IDs unchanged.
- Commit accepted progress, per-device history and its receipt together. Revisions order writes, not the reported fraction or client clock. Retain revision-conflict decisions; do not silently rebase an event.
- Web events require an existing live book and registered device. KO may create placeholders; SyncNinja may submit historical activity for a deleted book without reviving it. Exercise cross-client behavior and rollback in `api/reading_http_test.go` and `api/kosync_devices_test.go`.
