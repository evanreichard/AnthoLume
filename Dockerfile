# Certificates & Timezones
FROM alpine AS alpine
RUN apk update && apk add --no-cache ca-certificates tzdata

# Build Image
FROM golang:1.24 AS build

# Create Package Directory
RUN mkdir -p /opt/antholume

# Copy Source
WORKDIR /src
COPY . .

# Compile
RUN go build \
  -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" \
  -o /opt/antholume/server

# Create Image
FROM busybox:1.36
COPY --from=alpine /etc/ssl/certs /etc/ssl/certs
COPY --from=alpine /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=build /opt/antholume /opt/antholume
WORKDIR /opt/antholume
EXPOSE 8585
ENTRYPOINT ["/opt/antholume/server", "serve"]
