#!/usr/bin/env bash
set -euo pipefail

repository="Joshimello/cluster-manager"
install_path="/usr/local/sbin/cluster-node"

if [[ ${EUID} -ne 0 ]]; then
  echo "install-node.sh must run as root (for example: curl ... | sudo bash)." >&2
  exit 1
fi

if [[ -x ${install_path} ]]; then
  if [[ -e /etc/cluster-manager/node.json || -e /etc/systemd/system/cluster-node.service || -e /etc/systemd/system/cluster-manager-node.service ]]; then
    echo "cluster-node is already configured. Run: sudo ${install_path} upgrade" >&2
    exit 2
  fi
  echo "Replacing an existing unconfigured cluster-node CLI."
fi

case "$(uname -m)" in
  x86_64) architecture="amd64" ;;
  aarch64|arm64) architecture="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

temporary_directory="$(mktemp -d)"
trap 'rm -rf -- "${temporary_directory}"' EXIT

curl_options=(
  --fail
  --location
  --show-error
  --retry 3
  --retry-delay 2
  --retry-all-errors
  --connect-timeout 10
  --max-time 600
  --speed-limit 1024
  --speed-time 30
)

echo "[1/4] Resolving the latest stable cluster-node release..."
latest_url="$(curl "${curl_options[@]}" --silent --head -o /dev/null -w '%{url_effective}' "https://github.com/${repository}/releases/latest")"
version="${latest_url##*/}"
if [[ ! ${version} =~ ^v[0-9A-Za-z.+-]+$ ]]; then
  echo "Could not determine the latest stable cluster-node release." >&2
  exit 1
fi

asset="cluster-node-linux-${architecture}"
base="https://github.com/${repository}/releases/download/${version}"
echo "[2/4] Downloading checksums for ${version}..."
curl "${curl_options[@]}" --progress-bar "${base}/checksums.txt" -o "${temporary_directory}/checksums.txt"
echo "[3/4] Downloading ${asset} (${version})..."
curl "${curl_options[@]}" --progress-bar "${base}/${asset}" -o "${temporary_directory}/${asset}"

echo "[4/4] Verifying the downloaded binary..."
expected="$(awk -v asset="${asset}" '$2 == asset || $2 == "*" asset { print $1; exit }' "${temporary_directory}/checksums.txt")"
if [[ ! ${expected} =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "checksums.txt does not contain a valid SHA-256 for ${asset}." >&2
  exit 1
fi
actual="$(sha256sum "${temporary_directory}/${asset}" | awk '{print $1}')"
if [[ ${actual,,} != "${expected,,}" ]]; then
  echo "SHA-256 verification failed for ${asset}." >&2
  exit 1
fi

install -m 0755 "${temporary_directory}/${asset}" "${install_path}.new"
mv -f "${install_path}.new" "${install_path}"

echo "Verified and installed cluster-node ${version} at ${install_path}."
echo "Run interactive setup next:"
echo "  sudo ${install_path} setup"
