#!/bin/bash
# Complete first installation after Node, dependencies and private state exist.
set -euo pipefail
umask 077
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  printf 'Usage: bash activate.sh PUBLIC_IP MODEL_BASE_URL MODEL_ID [MODEL_API]\n' >&2
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
test "$source_root" = /opt/pa-rtos
test -x "$runtime/bin/node"
test -f "$state/private.env"
test -f "$state/devices.json"
if [ "$(systemctl show pa-rtos.service -p LoadState --value)" != not-found ]; then
  printf 'PA service already exists; inspect its status instead of activating again.\n' >&2
  exit 1
fi
# npm inherits the installer's private umask. Restore read/traverse access after
# ownership returns to root so the service user can load installed dependencies.
chown -R root:root "$source_root"
chmod -R a+rX "$source_root"
cd "$source_root/cloud"
runuser -u pa-rtos -- "$runtime/bin/node" node_modules/openclaw/openclaw.mjs --version
runuser -u pa-rtos -- "$runtime/bin/node" --test test/bridge.test.mjs
printf 'Model API key (hidden input): ' >/dev/tty
IFS= read -r -s model_key </dev/tty
printf '\n' >/dev/tty
test -n "$model_key"
printf '%s' "$model_key" | runuser -u pa-rtos -- "$runtime/bin/node" deploy/configure.mjs \
  "$state" "$public_ip" "$model_base" "$model_id" "$model_api"
unset model_key
if [ ! -e "$state/server.key" ] && [ ! -e "$state/server.pem" ]; then
  runuser -u pa-rtos -- openssl req -x509 -newkey rsa:2048 -sha256 -days 90 -nodes \
    -subj "/CN=$public_ip" -addext "subjectAltName=IP:$public_ip,IP:127.0.0.1" \
    -keyout "$state/server.key" -out "$state/server.pem" 2>"$state/certificate-creation.log"
fi
test -s "$state/server.key"
test -s "$state/server.pem"
runuser -u pa-rtos -- openssl x509 -in "$state/server.pem" -noout -checkip "$public_ip"
runuser -u pa-rtos -- openssl x509 -in "$state/server.pem" -noout -checkip 127.0.0.1
install -m 0644 deploy/pa-rtos.service /etc/systemd/system/pa-rtos.service
systemctl daemon-reload
systemctl enable --now pa-rtos.service
runuser -u pa-rtos -- "$runtime/bin/node" deploy/verify.mjs "$state" "$public_ip"
printf '\nPA installed. Device connection file: %s/connection.json\n' "$state"
printf 'The installer does not change SSH, nginx, host firewall or ECS security groups.\n'
