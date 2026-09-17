.PHONY: setup install up down logs ps test test-ubuntu-reconcile test-ubuntu-deploy check format build build-node-linux db-migrate

VERSION ?= development

setup:
	@test -f .env || cp .env.example .env

install:
	cd platform && npm ci

up: setup
	docker compose -f docker-compose.dev.yml up --build

down:
	docker compose -f docker-compose.dev.yml down

logs:
	docker compose -f docker-compose.dev.yml logs -f

ps:
	docker compose -f docker-compose.dev.yml ps

test:
	cd platform && npm test
	cd node && go test ./...

test-ubuntu-reconcile:
	docker build -f node/integration/ubuntu.Dockerfile -t cluster-manager-ubuntu-reconcile-test node
	docker run --rm cluster-manager-ubuntu-reconcile-test

test-ubuntu-deploy:
	docker build -f node/integration/ubuntu-deploy.Dockerfile -t cluster-manager-ubuntu-deploy-test node
	docker run --rm cluster-manager-ubuntu-deploy-test

check:
	cd platform && npm run check
	cd platform && npm run lint
	cd node && go vet ./...

format:
	cd platform && npm run format
	cd node && gofmt -w cmd internal

build:
	cd platform && npm run build
	cd node && go build -trimpath -ldflags="-s -w -X github.com/Joshimello/cluster-manager/node/internal/buildinfo.Version=$(VERSION)" -o bin/cluster-node ./cmd/cluster-node

build-node-linux:
	cd node && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w -X github.com/Joshimello/cluster-manager/node/internal/buildinfo.Version=$(VERSION)" -o bin/cluster-node-linux-amd64 ./cmd/cluster-node

db-migrate:
	docker compose -f docker-compose.dev.yml exec platform npm run db:migrate:runtime
