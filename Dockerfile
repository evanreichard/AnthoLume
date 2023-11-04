# Certificate Store
FROM alpine AS certs
RUN apk update && apk add ca-certificates

# Build Image
FROM golang:1.20 AS build

# Copy Source
WORKDIR /src
COPY . .

# Create Package Directory
RUN mkdir -p /opt/antholume

# Compile
RUN go build -o /opt/antholume/server; \
    cp -a ./templates /opt/antholume/templates; \
    cp -a ./assets /opt/antholume/assets;

# Create Image
FROM busybox:1.36
COPY --from=certs /etc/ssl/certs /etc/ssl/certs
COPY --from=build /opt/antholume /opt/antholume
WORKDIR /opt/antholume
EXPOSE 8585
ENTRYPOINT ["/opt/antholume/server", "serve"]
