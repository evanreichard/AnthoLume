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
	test -s assets/app/index.html && test -s assets/app/sw.js && test -s assets/app/manifest.json && test -s assets/app/shell-paths.json

.PHONY: check-release check-go check-race check-frontend check-browser-full check-browser-smoke
check-release: check-go check-race check-frontend
	$(MAKE) check-browser-full

check-go:
	go test -mod=readonly -count=1 ./...
	go vet -mod=readonly ./...
	go mod verify
	bash api/audit.sh

check-race:
	go test -mod=readonly -race -count=1 -timeout=20m ./...

check-frontend: check_web
	$(MAKE) check_generation
	npm --prefix web run lint
	npm --prefix web run format:check
	go build -mod=readonly -o /dev/null .
	npm --prefix web test
	@if [ -z "$$CHROMIUM_PATH" ]; then web/node_modules/.bin/playwright install $(PLAYWRIGHT_INSTALL_FLAGS) --only-shell chromium; fi

check-browser-full:
	npm --prefix web run test:browser
	npm --prefix web run test:reader

check-browser-smoke:
	npm --prefix web run test:smoke

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
