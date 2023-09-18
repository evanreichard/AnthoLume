# Book Manager

<p align="center">
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/login.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/login.png" width="30%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/home.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/home.png" width="30%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/documents.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/documents.png" width="30%">
    </a>
</p>

---

This is BookManager! Will probably be renamed at some point. This repository contains:

- [KOReader KOSync](https://github.com/koreader/koreader-sync-server) Compatible API
- KOReader Plugin (See `client` subfolder)
- WebApp

In additional to the compatible KOSync API's, we add:

- Additional APIs to automatically upload reading statistics
- Automatically upload documents to the server (can download in the "Documents" view)
- Automatic book cover metadata scraping (Thanks [OpenLibrary](https://openlibrary.org/))

# Development

SQLC Generation:

```
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
~/go/bin/sqlc generate
```

Run Development:

```
CONFIG_PATH=./data DATA_PATH=./data go run cmd/main.go serve
```

## Notes

- Icons: https://www.svgrepo.com/collection/solar-bold-icons
