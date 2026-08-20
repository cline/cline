#!/usr/bin/env bash
set -Eeuo pipefail

domain="${CLINE_GATEWAY_DOMAIN:-}"
token_file="${CLINE_SIDECAR_REMOTE_TOKEN_FILE:-/data/sidecar-access-token}"

if [[ -z "${domain}" ]]; then
	echo "CLINE_GATEWAY_DOMAIN is required (for example gateway.203-0-113-10.nip.io)." >&2
	exit 64
fi
if [[ "${domain}" == *://* || "${domain}" == */* ]]; then
	echo "CLINE_GATEWAY_DOMAIN must be a bare hostname without a scheme or path." >&2
	exit 64
fi

mkdir -p "$(dirname "${token_file}")" /data/gateway /workspaces
umask 077
if [[ -n "${CLINE_SIDECAR_REMOTE_TOKEN:-}" ]]; then
	printf '%s' "${CLINE_SIDECAR_REMOTE_TOKEN}" >"${token_file}"
elif [[ ! -s "${token_file}" ]]; then
	openssl rand -hex 32 >"${token_file}"
fi
chmod 0600 "${token_file}"
export CLINE_SIDECAR_REMOTE_TOKEN="$(<"${token_file}")"
export CLINE_CADDY_SITE_ADDRESS="${CLINE_CADDY_SITE_ADDRESS:-${domain}}"

cline-sidecar &
sidecar_pid=$!
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid=$!

shutdown() {
	kill -TERM "${sidecar_pid}" "${caddy_pid}" 2>/dev/null || true
	wait "${sidecar_pid}" "${caddy_pid}" 2>/dev/null || true
}
trap shutdown EXIT INT TERM

wait -n "${sidecar_pid}" "${caddy_pid}"
status=$?
echo "A required service exited; stopping the container." >&2
exit "${status}"
