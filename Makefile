build_local:
	go mod download
	rm -r ./build
	mkdir -p ./build
	cp -a ./templates ./build/templates
	cp -a ./assets ./build/assets

	env GOOS=linux GOARCH=amd64 CGO_ENABLED=1 CC="zig cc -target x86_64-linux" CXX="zig c++ -target x86_64-linux" go build -o ./build/server_linux_x86_64
	env GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o ./build/server_darwin_arm64

docker_build_local:
	docker build -t bookmanager:latest .

docker_build_release_dev:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/bookmanager:dev \
		--push .

docker_build_release_latest:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/bookmanager:latest \
		-t gitea.va.reichard.io/evan/bookmanager:`git describe --tags` \
		--push .
