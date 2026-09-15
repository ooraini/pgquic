.PHONY: all test test-go test-client build lint race demo benchmark cert
all: test build
test: test-go test-client
test-go:
	cd gateway && go test ./...
test-client:
	npm run typecheck -w packages/client && npm run test -w packages/client
race:
	cd gateway && go test -race ./...
build:
	cd gateway && go build ./cmd/pgquic-gateway
	npm run build -w packages/client
	npm run build -w examples/browser
lint:
	cd gateway && go vet ./...
	npm run lint -w packages/client
cert:
	./scripts/dev-cert.sh
demo: cert
	docker compose -f deploy/docker-compose.yml up --build
benchmark:
	node scripts/benchmark.mjs
