# syntax=docker/dockerfile:1

FROM golang:1.24-bookworm AS build
WORKDIR /src
COPY go.mod ./
COPY internal ./internal
COPY integration ./integration
RUN go test -c -o /out/ubuntu-reconcile.test ./integration

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssh-client openssh-server sshpass \
    && mkdir -p /run/sshd \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/ubuntu-reconcile.test /usr/local/bin/ubuntu-reconcile.test
CMD ["bash", "-ceu", "service ssh start; CLUSTER_MANAGER_UBUNTU_INTEGRATION=1 ubuntu-reconcile.test -test.v"]
