build_local: build_tailwind
	go mod download
	rm -r ./build
	mkdir -p ./build
	cp -a ./templates ./build/templates
	cp -a ./assets ./build/assets

	env GOOS=linux GOARCH=amd64 go build -o ./build/server_linux_amd64
	env GOOS=linux GOARCH=arm64 go build -o ./build/server_linux_arm64
	env GOOS=darwin GOARCH=arm64 go build -o ./build/server_darwin_arm64
	env GOOS=darwin GOARCH=amd64 go build -o ./build/server_darwin_amd64

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


clean:
	rm -rf ./build

tests_integration:
	go test -v -tags=integration -coverpkg=./... ./metadata

tests_unit:
	SET_TEST=set_val go test -v -coverpkg=./... ./...
