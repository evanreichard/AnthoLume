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

<p align="center">Screenshots</p>
<p align="center">
    <a href="https://gitea.va.reichard.io/evan/BookManager/src/branch/master/screenshots/web/README.md">Web App</a> - <a href="https://gitea.va.reichard.io/evan/BookManager/src/branch/master/screenshots/pwa/README.md">PWA</a>
</p>
<p align="center">
    <a href="https://drone.va.reichard.io/evan/BookManager" target="_blank">
        <img src="https://drone.va.reichard.io/api/badges/evan/BookManager/status.svg">
    </a>
</p>

---

This is BookManager! Will probably be renamed at some point. This repository contains:

- Web App / Progressive Web App (PWA)
- [KOReader](https://github.com/koreader/koreader) Plugin (See `client` subfolder)
- [KOReader KOSync](https://github.com/koreader/koreader-sync-server) compatible API
- OPDS API endpoint that provides access to the uploaded documents

In additional to the compatible KOSync API's, we add:

- Additional APIs to automatically upload reading statistics
- Upload documents to the server (can download in the "Documents" view or via OPDS)
- Book metadata scraping (Thanks [OpenLibrary](https://openlibrary.org/) & [Google Books API](https://developers.google.com/books/docs/v1/getting_started))
- Limited JavaScript use. Server-Side Rendering is used wherever possible. The main app is fully operational without any JS. JS is only required for:
  - EPUB Reader
  - Local / Offline Mode
  - Service Worker

# Server

Docker Image: `docker pull gitea.va.reichard.io/evan/bookmanager:latest`

## Local / Offline Reader

The Local / Offline reader allows you to use any BookManager server as a standalone offline accessible reading app! Some features:

- Add local EPUB documents
- Read both local and any cached server documents
- Maintains progress for all types of documents (server / local)
- Uploads any progress or activity for cached server documents once the internet is accessible

## KOSync API

The KOSync compatible API endpoint is located at: `http(s)://<SERVER>/api/ko`

## OPDS API

The OPDS API endpoint is located at: `http(s)://<SERVER>/api/opds`

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

The service is now accessible at: `http://localhost:8585`. I recommend registering an account and then disabling registration unless you expect more users.

## Configuration

| Environment Variable | Default Value | Description                                                         |
| -------------------- | ------------- | ------------------------------------------------------------------- |
| DATABASE_TYPE        | SQLite        | Currently only "SQLite" is supported                                |
| DATABASE_NAME        | book_manager  | The database name, or in SQLite's case, the filename                |
| CONFIG_PATH          | /config       | Directory where to store SQLite's DB                                |
| DATA_PATH            | /data         | Directory where to store the documents and cover metadata           |
| LISTEN_PORT          | 8585          | Port the server listens at                                          |
| REGISTRATION_ENABLED | false         | Whether to allow registration (applies to both WebApp & KOSync API) |
| COOKIE_SESSION_KEY   | <EMPTY>       | Optional secret cookie session key (auto generated if not provided) |
| COOKIE_SECURE        | true          | Set Cookie `Secure` attribute (i.e. only works over HTTPS)          |
| COOKIE_HTTP_ONLY     | true          | Set Cookie `HttpOnly` attribute (i.e. inacessible via JavaScript)   |

## Security

### Authentication

- _Web App / PWA_ - Session based token (7 day expiry, refresh after 6 days)
- _KOSync & SyncNinja API_ - Header based - `X-Auth-User` & `X-Auth-Key` (KOSync compatibility)
- _OPDS API_ - Basic authentication (KOReader OPDS compatibility)

### Notes

- Credentials are the same amongst all endpoints
- The native KOSync plugin sends an MD5 hash of the password. Due to that:
- We store an Argon2 hash _and_ per-password salt of the MD5 hashed original password

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
CONFIG_PATH=./data DATA_PATH=./data REGISTRATION_ENABLED=true go run main.go serve
```

# Building

The `Dockerfile` and `Makefile` contain the build information:

```bash
# Build Local (Linux & Darwin - arm64 & amd64)
make build_local

# Build Local Docker Image
make docker_build_local

# Build Docker & Push Latest or Dev (Linux - arm64 & amd64)
make docker_build_release_latest
make docker_build_release_dev

# Generate Tailwind CSS
make build_tailwind

# Clean Local Build
make clean

# Tests (Unit & Integration - Google Books API)
make tests_unit
make tests_integration
```

## Notes

- Icons: https://www.svgrepo.com/collection/solar-bold-icons
- Icons: https://www.svgrepo.com/collection/scarlab-solid-oval-interface-icons/
