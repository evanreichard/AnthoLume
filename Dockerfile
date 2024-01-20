# Certificate Store
FROM alpine AS certs
RUN apk update && apk add ca-certificates

# Build Image
FROM golang:1.21 AS build

# Copy Source
WORKDIR /src
COPY . .

# Create Package Directory
RUN mkdir -p /opt/antholume

# Compile
RUN go build \
  -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" \
  -o /opt/antholume/server

# Create Image
FROM busybox:1.36
COPY --from=certs /etc/ssl/certs /etc/ssl/certs
COPY --from=build /opt/antholume /opt/antholume
WORKDIR /opt/antholume
EXPOSE 8585
ENTRYPOINT ["/opt/antholume/server", "serve"]
