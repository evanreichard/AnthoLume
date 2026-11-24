# Compatibility baseline

Treat an unmerged branch as one proposed change against its merge target. Revise branch-only migrations, APIs, and tests in place. Before adding compatibility code, name the supported release or explicitly designated deployment that requires it. An earlier commit, push, or test run on the same branch does not qualify. Use this baseline for delegated implementation and review too.

# SQL

Handwritten inline SQL in application code is forbidden unless the user explicitly approves the specific exception in advance. Put application queries in `database/queries/*.sql`, run `sqlc generate`, and call the generated methods. This rule also covers SQLite maintenance statements such as `PRAGMA` and `VACUUM`; existing inline SQL is not permission to add more.
