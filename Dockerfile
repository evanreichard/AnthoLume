# Certificate Store
FROM alpine AS certs
RUN apk update && apk add ca-certificates

# Build Image
FROM golang:1.20 AS build

# Copy Source
WORKDIR /src
COPY . .

# Create Package Directory
RUN mkdir -p /opt/bookmanager

# Compile
RUN go build -o /opt/bookmanager/server; \
    cp -a ./templates /opt/bookmanager/templates; \
    cp -a ./assets /opt/bookmanager/assets;

# Create Image
FROM busybox:1.36
COPY --from=certs /etc/ssl/certs /etc/ssl/certs
COPY --from=build /opt/bookmanager /opt/bookmanager
WORKDIR /opt/bookmanager
EXPOSE 8585
ENTRYPOINT ["/opt/bookmanager/server", "serve"]
