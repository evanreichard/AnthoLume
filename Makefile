build_local:
	go mod download
	rm -r ./build
	mkdir -p ./build
	cp -a ./templates ./build/templates
	cp -a ./assets ./build/assets

	env GOOS=linux GOARCH=amd64 go build -o ./build/server_linux_amd64
	env GOOS=linux GOARCH=arm64 go build -o ./build/server_linux_arm64
	env GOOS=darwin GOARCH=arm64 go build -o ./build/server_darwin_arm64
	env GOOS=darwin GOARCH=amd64 go build -o ./build/server_darwin_amd64

docker_build_local:
	docker build -t bookmanager:latest .

docker_build_release_dev:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/bookmanager:dev \
		-f Dockerfile-BuildKit \
		--push .

docker_build_release_latest:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/evan/bookmanager:latest \
		-t gitea.va.reichard.io/evan/bookmanager:`git describe --tags` \
		-f Dockerfile-BuildKit \
		--push .

tests_integration:
	go test -v -tags=integration -coverpkg=./... ./metadata

tests_unit:
	SET_TEST=set_val go test -v -coverpkg=./... ./...
