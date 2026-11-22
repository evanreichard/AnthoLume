FROM node:22.23.4 AS frontend
WORKDIR /src
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY web ./web
COPY assets/manifest.json ./assets/manifest.json
RUN npm --prefix web run build && test -s assets/app/index.html && test -s assets/app/sw.js && test -s assets/app/manifest.json && test -s assets/app/shell-paths.json

FROM alpine AS alpine
RUN apk add --no-cache ca-certificates tzdata

FROM golang:1.26.11 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/assets/app ./assets/app
ARG VERSION=release
RUN CGO_ENABLED=0 go build -mod=readonly -ldflags "-X reichard.io/antholume/config.version=$VERSION" -o /opt/antholume/server

FROM busybox:1.36
COPY --from=alpine /etc/ssl/certs /etc/ssl/certs
COPY --from=alpine /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=build /opt/antholume /opt/antholume
WORKDIR /opt/antholume
EXPOSE 8585
ENTRYPOINT ["/opt/antholume/server", "serve"]
