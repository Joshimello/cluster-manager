# syntax=docker/dockerfile:1

FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X github.com/Joshimello/cluster-manager/node/internal/buildinfo.Version=rehearsal" \
    -o /out/cluster-manager-node ./cmd/cluster-manager-node

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssh-server systemd \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/cluster-manager-node /usr/local/sbin/cluster-manager-node
COPY deploy/config.example.json /etc/cluster-manager/node.json
COPY deploy/cluster-manager-node.service /etc/systemd/system/cluster-manager-node.service
RUN chmod 0755 /usr/local/sbin/cluster-manager-node \
    && chmod 0600 /etc/cluster-manager/node.json \
    && systemd-analyze verify /etc/systemd/system/cluster-manager-node.service \
    && test "$(stat -c %a /etc/cluster-manager/node.json)" = 600 \
    && test "$(/usr/local/sbin/cluster-manager-node --version)" = "cluster-manager-node rehearsal"
CMD ["/usr/local/sbin/cluster-manager-node", "--version"]
