# DB Migrations

```bash
goose create migration_name
```

## Note

Since we update both the `schema.sql`, as well as the migration files, when we create a new DB it will inherently be up-to-date. We don't want to run the migrations if it's already up-to-date. Instead each migration checks if we have a new DB (via a value passed into the context), and if we do we simply return.
