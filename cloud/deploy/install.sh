#!/bin/bash
# Run from a fresh checkout at /opt/pa-rtos, including in Alibaba Workbench.
set -euo pipefail
umask 077
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  printf 'Usage: bash install.sh PUBLIC_IP MODEL_BASE_URL MODEL_ID [MODEL_API]\n' >&2
  exit 2
fi
public_ip=$1
model_base=$2
model_id=$3
model_api=${4:-openai-completions}
source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
runtime=/opt/pa-rtos-node
state=/var/lib/pa-rtos
test "$(id -u)" = 0
test "$(uname -s)" = Linux
test "$(uname -m)" = x86_64
test "$source_root" = /opt/pa-rtos
for command in python3 tar xz openssl sha256sum ss systemctl useradd runuser; do
  command -v "$command" >/dev/null || { printf 'Missing command: %s\n' "$command" >&2; exit 1; }
done
if [ -z "${PA_NODE_ARCHIVE:-}" ]; then command -v curl >/dev/null; fi
test ! -e "$runtime"
test ! -e "$state"
test ! -e /etc/systemd/system/pa-rtos.service
if getent passwd pa-rtos >/dev/null || getent group pa-rtos >/dev/null; then
  printf 'Existing pa-rtos account/group: inspect before installing.\n' >&2; exit 1
fi
python3 - "$public_ip" "$model_base" "$model_id" "$model_api" <<'PY'
import ipaddress,pathlib,shutil,subprocess,sys,urllib.parse
ipaddress.ip_address(sys.argv[1])
url=urllib.parse.urlsplit(sys.argv[2])
assert url.scheme in ('http','https') and url.hostname and not (url.username or url.password or url.query or url.fragment), 'Invalid model URL'
assert sys.argv[3] and not any(c.isspace() for c in sys.argv[3]), 'Invalid model ID'
assert sys.argv[4] in ('openai-completions','openai-responses','anthropic-messages','google-generative-ai'), 'Invalid model API'
mem=dict(line.split(':',1) for line in pathlib.Path('/proc/meminfo').read_text().splitlines())
available=int(mem['MemAvailable'].split()[0])*1024
disk=shutil.disk_usage('/opt').free
assert available >= 3*1024**3, 'Require at least 3 GiB available memory'
assert disk >= 3*1024**3, 'Require at least 3 GiB available disk'
listeners=subprocess.check_output(['ss','-ltnH'],text=True)
ports={line.split()[3].rsplit(':',1)[-1] for line in listeners.splitlines()}
assert not ports.intersection({'19870','19871'}), 'PA ports already in use'
print('Preflight passed: dedicated paths/ports; memory %.1f GiB; disk %.1f GiB' % (available/1024**3,disk/1024**3))
PY
stage=$(mktemp -d /tmp/pa-rtos-install.XXXXXXXX)
trap 'rm -rf -- "$stage"' EXIT
node_archive=node-v26.12.1-linux-x64.tar.xz
if [ -n "${PA_NODE_ARCHIVE:-}" ]; then
  cp -- "$PA_NODE_ARCHIVE" "$stage/$node_archive"
else
  curl --fail --location --show-error --retry 2 --connect-timeout 15 --max-time 300 \
    "https://nodejs.org/dist/v26.12.1/$node_archive" -o "$stage/$node_archive"
fi
printf '%s  %s\n' 6170b2d474e1c626f43cff3adc118df9fe3b573258a4fc3d850c8dbc6b079bbd "$stage/$node_archive" | sha256sum --check
install -d -m 0755 "$runtime"
tar -xJf "$stage/$node_archive" -C "$runtime" --strip-components=1
chmod -R a+rX "$source_root" "$runtime"
useradd --system --user-group --home-dir "$state" --shell /usr/sbin/nologin pa-rtos
install -d -o pa-rtos -g pa-rtos -m 0700 "$state"
cd "$source_root/cloud"
runuser -u pa-rtos -- "$runtime/bin/node" src/init.mjs --root "$state"
chown -R pa-rtos:pa-rtos "$source_root/cloud"
runuser -u pa-rtos -- env PATH="$runtime/bin:$PATH" npm ci --omit=dev --no-audit --no-fund
bash deploy/activate.sh "$public_ip" "$model_base" "$model_id" "$model_api"
