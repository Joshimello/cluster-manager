#!/usr/bin/env bash
set -euo pipefail

repository="Joshimello/cluster-manager"
install_path="/usr/local/sbin/cluster-node"

if [[ ${EUID} -ne 0 ]]; then
  echo "install-node.sh must run as root (for example: curl ... | sudo bash)." >&2
  exit 1
fi

if [[ -x ${install_path} ]]; then
  echo "cluster-node is already installed. Run: sudo cluster-node upgrade" >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64) architecture="amd64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [[ ! -r /dev/tty ]]; then
  echo "Interactive setup requires a terminal. Download and inspect this script, then run it from a terminal." >&2
  exit 1
fi

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT

latest_url="$(curl -fsSIL -o /dev/null -w '%{url_effective}' "https://github.com/${repository}/releases/latest")"
version="${latest_url##*/}"
if [[ ! ${version} =~ ^v[0-9A-Za-z.+-]+$ ]]; then
  echo "Could not determine the latest stable cluster-node release." >&2
  exit 1
fi

asset="cluster-node-linux-${architecture}"
base="https://github.com/${repository}/releases/download/${version}"
curl -fsSL "${base}/checksums.txt" -o "${temporary_directory}/checksums.txt"
curl -fsSL "${base}/${asset}" -o "${temporary_directory}/${asset}"

expected="$(awk -v asset="${asset}" '$2 == asset || $2 == "*" asset { print $1; exit }' "${temporary_directory}/checksums.txt")"
if [[ ! ${expected} =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "checksums.txt does not contain a valid SHA-256 for ${asset}." >&2
  exit 1
fi
actual="$(sha256sum "${temporary_directory}/${asset}" | awk '{print $1}')"
if [[ ${actual,,} != ${expected,,} ]]; then
  echo "SHA-256 verification failed for ${asset}." >&2
  exit 1
fi

chmod 0755 "${temporary_directory}/${asset}"
echo "Verified cluster-node ${version}; starting interactive setup."
"${temporary_directory}/${asset}" setup </dev/tty >/dev/tty
