# syntax=docker/dockerfile:1

FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/cluster-node ./cmd/cluster-node

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S cluster-manager \
    && adduser -S -G cluster-manager cluster-manager \
    && mkdir -p /var/lib/cluster-manager \
    && chown cluster-manager:cluster-manager /var/lib/cluster-manager
COPY --from=build /out/cluster-node /usr/local/bin/cluster-node
USER cluster-manager
ENTRYPOINT ["cluster-node"]
