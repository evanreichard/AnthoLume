#!/bin/bash
env GOOS=linux GOARCH=arm64 CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o ./build/server_linux_arm64
env GOOS=linux GOARCH=amd64 CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o ./build/server_linux_amd64
# env GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -o ./build/server_darwin_amd64
# env GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -o ./build/server_darwin_arm64
