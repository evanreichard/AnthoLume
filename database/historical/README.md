# Historical restore references

Each SQL file is frozen at its Goose version. The DDL comes from `sqlite_schema` in an empty file initialized by `database.NewMgr` **at the historical revision**, not from editing the current bootstrap schema. Seed the migration ledger and any storage roots needed by test databases. Do not regenerate these files from HEAD.

| Version | Source commit |
| --- | --- |
| 20240510123707 | `26da8e1b3432c1608b04f6c121e76bf1800ae571` |
| 20261126000000 | `b52a1c7e7ffc90a6b0fa0eba3fc3522b92f24594` |

`api/testdata/pre-react.db` is the first revision’s actual SQLite file, populated with a synthetic owner, two documents and one device checkpoint. The HTTP restore test consumes its bytes without running the reference builder. No user backup is used.
