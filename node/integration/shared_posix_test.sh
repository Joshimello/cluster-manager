#!/usr/bin/env bash
set -euo pipefail

test_id="cluster-manager-posix-$$"
volume_name="${test_id}-volume"
node_a="${test_id}-a"
node_b="${test_id}-b"

cleanup() {
  docker rm -f "${node_a}" "${node_b}" >/dev/null 2>&1 || true
  docker volume rm "${volume_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "${volume_name}" >/dev/null
for container in "${node_a}" "${node_b}"; do
  docker run -d --name "${container}" --mount "source=${volume_name},target=/shared" \
    ubuntu:24.04 sleep infinity >/dev/null
  docker exec "${container}" groupadd --gid 20000 alice
  docker exec "${container}" useradd --uid 20000 --gid 20000 --no-create-home alice
  docker exec "${container}" groupadd --gid 20001 bob
  docker exec "${container}" useradd --uid 20001 --gid 20001 --no-create-home bob
done

docker exec "${node_a}" install -d -o alice -g alice -m 0700 /shared/alice
docker exec "${node_a}" runuser -u alice -- sh -c \
  'umask 077; printf "%s\n" "written-on-node-a" > /shared/alice/file.txt'

test "$(docker exec "${node_b}" stat -c '%u:%g' /shared/alice/file.txt)" = "20000:20000"
test "$(docker exec "${node_b}" runuser -u alice -- cat /shared/alice/file.txt)" = "written-on-node-a"
docker exec "${node_b}" runuser -u alice -- sh -c \
  'printf "%s\n" "updated-on-node-b" >> /shared/alice/file.txt'

if docker exec "${node_b}" runuser -u bob -- cat /shared/alice/file.txt >/dev/null 2>&1; then
  echo "different managed UID unexpectedly read the mode-0600 shared file" >&2
  exit 1
fi

test "$(docker exec "${node_a}" tail -n 1 /shared/alice/file.txt)" = "updated-on-node-b"
echo "dual-client shared POSIX ownership test passed"
