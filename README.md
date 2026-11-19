<p><img align="center" src="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/banner.png"></p>

<p align="center">
    <a href="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/login.png">
        <img src="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/login.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/home.png">
        <img src="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/home.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/documents.png">
        <img src="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/documents.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/document.png">
        <img src="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/document.png" width="19%">
    </a>
    <a href="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/metadata.png">
        <img src="https://gitea.va.reichard.io/evan/AnthoLume/raw/branch/master/screenshots/pwa/metadata.png" width="19%">
    </a>
</p>

<p align="center">
    <strong><a href="https://gitea.va.reichard.io/evan/AnthoLume/src/branch/master/screenshots">Screenshots</a></strong> • 
    <strong><a href="https://antholume-demo.cloud.reichard.io/">Demo Server</a></strong>
</p>
<p align="center"><strong>user:</strong> demo • <strong>pass:</strong> demo</p>

<p align="center">
    <a href="https://gitea.va.reichard.io/evan/AnthoLume/actions" target="_blank">
        <img src="https://gitea.va.reichard.io/evan/AnthoLume/actions/workflows/ci.yaml/badge.svg?branch=master" alt="CI status">
    </a>
</p>

---

AnthoLume is a Progressive Web App (PWA) that manages your EPUB documents, provides an EPUB reader, and tracks your reading activity! It also has a [KOReader KOSync](https://github.com/koreader/koreader-sync-server) compatible API, and a [KOReader](https://github.com/koreader/koreader) Plugin used to sync activity from your Kindle. Some additional features include:

- OPDS API Endpoint
- Browser EPUB reader with on-device caching
- Book identification with [Open Library](https://openlibrary.org/)
- Words / Minute (WPM) Tracking & Leaderboard (Amongst Server Users)

## Server

Docker Image: `docker pull gitea.va.reichard.io/evan/antholume:latest`

### EPUB Reader

Opening or reopening a book requires a connection to the server, even if the EPUB is cached on your device. The reader can continue displaying already loaded content during a connection drop, but the app does not support offline launch or reopening.

### KOSync API

The KOSync compatible API endpoint is located at: `http(s)://<SERVER>/api/ko`

### OPDS API

The OPDS API endpoint is located at: `http(s)://<SERVER>/api/opds`

### Quick Start

Set `PUBLIC_ORIGIN` to the exact browser origin, with no trailing slash. Use HTTPS for deployed instances. Loopback HTTP is allowed for local development and requires `COOKIE_SECURE=false`.

```bash
# Make Data Directory
mkdir -p antholume_data

# Run Server
docker run \
    -p 127.0.0.1:8585:8585 \
    -e PUBLIC_ORIGIN=http://localhost:8585 \
    -e COOKIE_SECURE=false \
    -e REGISTRATION_ENABLED=true \
    -v ./antholume_data:/config \
    -v ./antholume_data:/data \
    gitea.va.reichard.io/evan/antholume:latest
```

The service is now accessible at `http://localhost:8585`. Register an account, then disable registration unless you expect more users.

### Book Storage and Upgrades

Configure storage roots in **Settings → Administration → Library**. Library is the only managed root and defaults to `$DATA_PATH/documents`. Imported books can be copied into Library or referenced in place from a source root. In Docker, mount source directories into the container before adding them. To relocate a source without changing book IDs or reading history, edit the existing root and keep paths relative to that root unchanged. If you change `DATA_PATH` during an upgrade, books with a recorded path outside the new Library stay on an unmanaged source. If you moved those books into the new Library folder, point the source at that folder and confirm **Merge into Library**.

Backups always include the database; **Database + Library files** also includes cataloged Library EPUBs and covers. Source files are not included. After restore, review the source mappings before re-enabling auto-import schedules. **To restore a backup made by the previous release, restore it on that release before upgrading.**

### Configuration

| Environment Variable | Default Value | Description                                                                |
| -------------------- | ------------- | -------------------------------------------------------------------------- |
| DATABASE_TYPE        | SQLite        | Currently only "SQLite" is supported                                       |
| DATABASE_NAME        | antholume     | The database name, or in SQLite's case, the filename                       |
| CONFIG_PATH          | /config       | Directory where to store SQLite's DB                                       |
| DATA_PATH            | /data         | Directory where to store the documents and cover metadata                  |
| PUBLIC_ORIGIN        | Required      | Exact browser origin (HTTPS, or HTTP for loopback development)             |
| LISTEN_HOST          |               | Interface address to bind; empty listens on all interfaces                |
| LISTEN_PORT          | 8585          | Port the server listens at                                                 |
| LOG_LEVEL            | info          | Set server log level                                                       |
| REGISTRATION_ENABLED | false         | Whether to allow registration (applies to both WebApp & KOSync API)        |
| COOKIE_AUTH_KEY      | <EMPTY>       | Optional secret cookie authentication key (auto generated if not provided) |
| COOKIE_ENC_KEY       | <EMPTY>       | Optional secret cookie encryption key (16 or 32 bytes)                     |
| COOKIE_SECURE        | true          | Set Cookie `Secure` attribute (i.e. only works over HTTPS)                 |
| COOKIE_HTTP_ONLY     | true          | Set Cookie `HttpOnly` attribute (i.e. inacessible via JavaScript)          |

## Security

### Authentication

- _Web App / PWA_ - Session based token (7 day expiry, refresh after 6 days)
- _KOSync & SyncNinja API_ - Header based - `X-Auth-User` & `X-Auth-Key` (KOSync compatibility)
- _OPDS API_ - Basic authentication (KOReader OPDS compatibility)

### Notes

- Credentials are the same amongst all endpoints
- The native KOSync plugin sends an MD5 hash of the password. Due to that:
- We store an Argon2 hash _and_ per-password salt of the MD5 hashed original password

## Client (KOReader Plugin)

See documentation in the `client` subfolder: [SyncNinja](https://gitea.va.reichard.io/evan/AnthoLume/src/branch/master/client/)

## Development

SQLC Generation (v1.26.0):

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
~/go/bin/sqlc generate
```

Goose Migrations:

```bash
go install github.com/pressly/goose/v3/cmd/goose@latest
```

Run `make dev RESTORE=/path/to/backup.zip` to seed a local development library, then `make dev` to reuse it. Open `http://127.0.0.1:5323` or the printed Tailscale URL. See [web development](web/README.md) for setup and reset commands.

## Building

The `Dockerfile` and `Makefile` contain the build information:

```bash
# Build Local (Linux & Darwin - arm64 & amd64)
make build_local

# Build Local Docker Image
make docker_build_local

# Build Docker & Push Latest or Dev (Linux - arm64 & amd64)
make docker_build_release_latest
make docker_build_release_dev

# Build React assets
make build_web

# Clean Local Build
make clean

# Tests (after building React assets)
make tests
npm --prefix web test
```

## Notes

- Icons: https://www.svgrepo.com/collection/solar-bold-icons
- Icons: https://www.svgrepo.com/collection/scarlab-solid-oval-interface-icons/
