build_local: build_tailwind
	go mod download
	rm -r ./build || true
	mkdir -p ./build

	env GOOS=linux GOARCH=amd64  go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/server_linux_amd64
	env GOOS=linux GOARCH=arm64  go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/server_linux_arm64
	env GOOS=darwin GOARCH=arm64 go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/server_darwin_arm64
	env GOOS=darwin GOARCH=amd64 go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/server_darwin_amd64

docker_build_local: build_tailwind
	docker build -t antholume:latest .

docker_build_release_dev: build_tailwind
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/antholume:dev \
		-f Dockerfile-BuildKit \
		--push .

docker_build_release_latest: build_tailwind
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/antholume:latest \
		-t gitea.va.reichard.io/evan/antholume:`git describe --tags` \
		-f Dockerfile-BuildKit \
		--push .

build_tailwind:
	tailwind build -o ./assets/style.css --minify

dev: build_tailwind
	GIN_MODE=release \
	CONFIG_PATH=./data \
	DATA_PATH=./data \
	SEARCH_ENABLED=true \
	REGISTRATION_ENABLED=true \
	COOKIE_SECURE=false \
	COOKIE_AUTH_KEY=1234 \
	LOG_LEVEL=debug go run main.go serve

clean:
	rm -rf ./build

tests:
	SET_TEST=set_val go test -coverpkg=./... ./... -coverprofile=./cover.out
	go tool cover -html=./cover.out -o ./cover.html
	rm ./cover.out
