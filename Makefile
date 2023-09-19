build_local:
	mkdir -p ./build
	cp -a ./templates ./build/templates
	cp -a ./assets ./build/assets
	CGO_ENABLED=1 CGO_CFLAGS="-D_LARGEFILE64_SOURCE" go build -o ./build/server

docker_build_local:
	docker build -t bookmanager:latest .

docker_build_release_beta:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/reichard/bookmanager:beta --push .

docker_build_release_latest:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/reichard/bookmanager:latest --push .
