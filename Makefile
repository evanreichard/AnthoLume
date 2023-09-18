docker_build_local:
	docker build -t sync-ninja:latest .

docker_build_release_beta:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/reichard/sync-ninja:beta --push .

docker_build_release_latest:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		-t gitea.va.reichard.io/reichard/sync-ninja:latest --push .
