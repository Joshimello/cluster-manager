# syntax=docker/dockerfile:1

ARG RUNTIME_IMAGE=ubuntu:24.04

FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X github.com/Joshimello/cluster-manager/node/internal/buildinfo.Version=rehearsal" \
    -o /out/cluster-node ./cmd/cluster-node

FROM ${RUNTIME_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssh-server systemd uidmap \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/cluster-node /usr/local/sbin/cluster-node
COPY deploy/config.example.json /etc/cluster-manager/node.json
COPY deploy/cluster-node.service /etc/systemd/system/cluster-node.service
RUN chmod 0755 /usr/local/sbin/cluster-node \
    && chmod 0600 /etc/cluster-manager/node.json \
    && mkdir -p /run/sshd \
    && /usr/sbin/sshd -t \
    && systemd-analyze verify /etc/systemd/system/cluster-node.service \
    && test "$(stat -c %a /etc/cluster-manager/node.json)" = 600 \
    && test "$(/usr/local/sbin/cluster-node --version)" = "cluster-node rehearsal"
CMD ["/usr/local/sbin/cluster-node", "--version"]
