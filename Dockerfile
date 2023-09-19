FROM alpine:edge AS build
RUN apk add --no-cache --update go gcc g++
WORKDIR /app
COPY . /app

# Copy Resources
RUN mkdir -p /opt/bookmanager
RUN cp -a ./templates /opt/bookmanager/templates
RUN cp -a ./assets /opt/bookmanager/assets

# Download Dependencies & Compile
RUN go mod download
RUN CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o /opt/bookmanager/server

# Create Image
FROM alpine:3.18
COPY --from=build /opt/bookmanager /opt/bookmanager
WORKDIR /opt/bookmanager
EXPOSE 8585
ENTRYPOINT ["/opt/bookmanager/server", "serve"]
