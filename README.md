# Book Manager

<p align="center">
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/login.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/login.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/home.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/home.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/documents.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/documents.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/document.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/document.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/metadata.png">
        <img src="https://gitea.va.reichard.io/evan/BookManager/raw/branch/master/screenshots/pwa/metadata.png" width="19%">
    </a>
</p>

<p align="center">
    <a href="https://gitea.va.reichard.io/evan/BookManager/src/branch/master/screenshots/web/README.md">
        --- WEB ---
    </a>
    <a href="https://gitea.va.reichard.io/evan/BookManager/src/branch/master/screenshots/pwa/README.md">
        --- PWA ---
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
- Book metadata scraping (Thanks [OpenLibrary](https://openlibrary.org/) & [Google Books API](https://developers.google.com/books/docs/v1/getting_started))
- No JavaScript! All information is rendered server side.

# Server

Docker Image: `docker pull gitea.va.reichard.io/evan/bookmanager:latest`

## Quick Start

```bash
# Make Data Directory
mkdir -p bookmanager_data

# Run Server
docker run \
    -p 8585:8585 \
    -e REGISTRATION_ENABLED=true \
    -v ./bookmanager_data:/config \
    -v ./bookmanager_data:/data \
    gitea.va.reichard.io/evan/bookmanager:latest
```

The service is now accessible at: `http://localhost:8585`

## Configuration

| Environment Variable | Default Value | Description                                                          |
| -------------------- | ------------- | -------------------------------------------------------------------- |
| DATABASE_TYPE        | SQLite        | Currently only "SQLite" is supported                                 |
| DATABASE_NAME        | bbank         | The database name, or in SQLite's case, the filename                 |
| DATABASE_PASSWORD    | <EMPTY>       | Currently not used. Placeholder for potential alternative DB support |
| CONFIG_PATH          | /config       | Directory where to store SQLite's DB                                 |
| DATA_PATH            | /data         | Directory where to store the documents and cover metadata            |
| LISTEN_PORT          | 8585          | Port the server listens at                                           |
| REGISTRATION_ENABLED | false         | Whether to allow registration (applies to both WebApp & KOSync API)  |
| COOKIE_SESSION_KEY   | <EMPTY>       | Optional secret cookie session key (auto generated if not provided)  |

# Client (KOReader Plugin)

See documentation in the `client` subfolder: [SyncNinja](https://gitea.va.reichard.io/evan/BookManager/src/branch/master/client/)

# Development

SQLC Generation (v1.21.0):

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
~/go/bin/sqlc generate
```

Run Development:

```bash
CONFIG_PATH=./data DATA_PATH=./data go run main.go serve
```

# Building

The `Dockerfile` and `Makefile` contain the build information:

```bash
# Build Local Docker Image
make docker_build_local

# Push Latest
make docker_build_release_latest
```

If manually building, you must enable CGO:

```bash
# Download Dependencies
go mod download

# Compile (Binary `./bookmanager`)
CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o /bookmanager
```

## Notes

- Icons: https://www.svgrepo.com/collection/solar-bold-icons
- Icons: https://www.svgrepo.com/collection/scarlab-solid-oval-interface-icons/
