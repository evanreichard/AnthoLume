# Certificate Store
FROM alpine as certs
RUN apk update && apk add ca-certificates

# Build Image
FROM --platform=$BUILDPLATFORM golang:1.20 AS build

# Install Dependencies
RUN apt-get update -y
RUN apt install -y gcc-x86-64-linux-gnu

# Create Package Directory
WORKDIR /src
RUN mkdir -p /opt/bookmanager

# Cache Dependencies & Compile
ARG TARGETOS
ARG TARGETARCH
RUN --mount=target=. \
    --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg \
    GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /opt/bookmanager/server; \
    cp -a ./templates /opt/bookmanager/templates; \
    cp -a ./assets /opt/bookmanager/assets;

# Create Image
FROM busybox:1.36
COPY --from=certs /etc/ssl/certs /etc/ssl/certs
COPY --from=build /opt/bookmanager /opt/bookmanager
WORKDIR /opt/bookmanager
EXPOSE 8585
ENTRYPOINT ["/opt/bookmanager/server", "serve"]
