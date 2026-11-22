build_local: export CGO_ENABLED=0
build_local: check_web
	go mod download
	mkdir -p ./build/bin

	env GOOS=linux GOARCH=amd64  go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/bin/server_linux_amd64
	env GOOS=linux GOARCH=arm64  go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/bin/server_linux_arm64
	env GOOS=darwin GOARCH=arm64 go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/bin/server_darwin_arm64
	env GOOS=darwin GOARCH=amd64 go build -ldflags "-X reichard.io/antholume/config.version=`git describe --tags`" -o ./build/bin/server_darwin_amd64

docker_build_local:
	docker build -t antholume:latest .

docker_build_release_dev:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/antholume:dev \
		-f Dockerfile-BuildKit \
		--push .

docker_build_release_latest:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/antholume:latest \
		-t gitea.va.reichard.io/evan/antholume:`git describe --tags` \
		-f Dockerfile-BuildKit \
		--push .

.PHONY: build_web check_web generate check_generation
build_web:
	npm --prefix web ci
	npm --prefix web run build

check_web: build_web
	test -s assets/app/index.html && test -s assets/app/sw.js && test -s assets/app/manifest.json

.PHONY: screenshots
screenshots: check_web
	@if [ -z "$$CHROMIUM_PATH" ]; then web/node_modules/.bin/playwright install --only-shell chromium; fi
	go run -mod=readonly ./tools/screenshots

generate:
	bash api/generate.sh

check_generation:
	bash api/check-generation.sh

.PHONY: dev dev-hot clean-dev
dev:
	bash web/dev.sh start

dev-hot:
	bash web/dev.sh hot

clean-dev:
	bash web/dev.sh clean

clean:
	rm -rf ./build

tests:
	go test -coverpkg=./... ./... -coverprofile=./cover.out
	go tool cover -html=./cover.out -o ./cover.html
	rm ./cover.out
