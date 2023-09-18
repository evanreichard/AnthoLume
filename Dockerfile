# FROM golang:1.20-alpine AS build
FROM alpine:edge AS build
RUN apk add --no-cache --update go gcc g++
WORKDIR /app
COPY . /app
RUN go mod download
RUN CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o /sync-ninja cmd/main.go

FROM alpine:3.18
COPY --from=build /sync-ninja /sync-ninja
EXPOSE 8585
ENTRYPOINT ["/sync-ninja", "serve"]
