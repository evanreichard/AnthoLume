# SQL

Handwritten inline SQL in application code is forbidden unless the user explicitly approves the specific exception in advance. Put application queries in `database/queries/*.sql`, run `sqlc generate`, and call the generated methods. This rule also covers SQLite maintenance statements such as `PRAGMA` and `VACUUM`; existing inline SQL is not permission to add more.
