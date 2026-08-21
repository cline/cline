#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../../.." && pwd)"
env_file="${script_dir}/.env"
token_file="${script_dir}/.access-token"
compose_file="${script_dir}/compose.yaml"

domain=""
public_ip=""
local_mode=false
project_name="cline-bots"
lead_profile="cline"
force=false
build=true

urlencode() {
	local string="${1}" out="" c
	local i
	for ((i = 0; i < ${#string}; i++)); do
		c="${string:i:1}"
		case "${c}" in
			[a-zA-Z0-9.~_-]) out+="${c}" ;;
			*) out+=$(printf '%%%02X' "'${c}") ;;
		esac
	done
	printf '%s' "${out}"
}

usage() {
	cat <<'EOF'
Usage: apps/cline/docker/quickstart.sh [options]

Options:
  --local             Local-only Gate via ws://127.0.0.1:43126/
  --domain HOST       Public hostname already resolving to this VM
  --public-ip IP      Build gateway.<hyphenated-ip>.nip.io automatically
  --project NAME      Compose project name (default: cline-bots)
  --lead-profile NAME cline or cline-dad (default: cline)
  --no-build          Start an image that has already been built
  --force             Replace an existing apps/cline/docker/.env
  -h, --help          Show this help

With no options, the script runs as --local --force. Public deployments must
explicitly pass --domain or --public-ip.
EOF
}

while (($# > 0)); do
	case "$1" in
		--local) local_mode=true; shift ;;
		--domain) domain="${2:?--domain requires a hostname}"; shift 2 ;;
		--public-ip) public_ip="${2:?--public-ip requires an address}"; shift 2 ;;
		--project) project_name="${2:?--project requires a name}"; shift 2 ;;
		--lead-profile) lead_profile="${2:?--lead-profile requires a name}"; shift 2 ;;
		--no-build) build=false; shift ;;
		--force) force=true; shift ;;
		-h|--help) usage; exit 0 ;;
		*) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
	esac
done

if [[ "${local_mode}" != true && -z "${domain}" && -z "${public_ip}" ]]; then
	local_mode=true
	force=true
fi

if [[ "${lead_profile}" != "cline" && "${lead_profile}" != "cline-dad" ]]; then
	echo "--lead-profile must be cline or cline-dad." >&2
	exit 64
fi
mode_count=0
[[ "${local_mode}" == true ]] && ((mode_count += 1))
[[ -n "${domain}" ]] && ((mode_count += 1))
[[ -n "${public_ip}" ]] && ((mode_count += 1))
if ((mode_count != 1)); then
	echo "Use exactly one of --local, --domain, or --public-ip." >&2
	exit 64
fi

for command in docker; do
	if ! command -v "${command}" >/dev/null 2>&1; then
		echo "Missing required command: ${command}" >&2
		exit 69
	fi
done
if ! docker compose version >/dev/null 2>&1; then
	echo "Docker Compose v2 is required (docker compose)." >&2
	exit 69
fi

if [[ -f "${env_file}" && "${force}" != true ]]; then
	echo "${env_file} already exists; use --force to replace it." >&2
	exit 73
else
	if [[ "${local_mode}" == true ]]; then
		domain="127.0.0.1"
	elif [[ -n "${public_ip}" ]]; then
		if [[ ! "${public_ip}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
			echo "Expected an IPv4 address, got: ${public_ip}" >&2
			exit 65
		fi
		IFS=. read -r -a octets <<<"${public_ip}"
		for octet in "${octets[@]}"; do
			if ((10#${octet} > 255)); then
				echo "Invalid IPv4 address: ${public_ip}" >&2
				exit 65
			fi
		done
		domain="gateway.${public_ip//./-}.nip.io"
	fi
	if [[ "${domain}" == *://* || "${domain}" == */* ]]; then
		echo "The domain must be a bare hostname without a scheme or path." >&2
		exit 65
	fi

	if [[ "${local_mode}" == true ]]; then
		cat >"${env_file}" <<EOF
CLINE_GATEWAY_DOMAIN=${domain}
CLINE_SIDECAR_TRUSTED_ORIGINS=http://127.0.0.1:3135,http://localhost:3135
CLINE_GATEWAY_LEAD_PROFILE=${lead_profile}
CLINE_HTTP_PORT=43126
CLINE_HTTPS_PORT=43443
CLINE_CADDY_SITE_ADDRESS=:8080
CLINE_BIND_ADDRESS=127.0.0.1
EOF
	else
		cat >"${env_file}" <<EOF
CLINE_GATEWAY_DOMAIN=${domain}
CLINE_SIDECAR_TRUSTED_ORIGINS=https://cline-gateway-connect.cline-8362.chatgpt.site
CLINE_GATEWAY_LEAD_PROFILE=${lead_profile}
CLINE_HTTP_PORT=80
CLINE_HTTPS_PORT=443
CLINE_CADDY_SITE_ADDRESS=
CLINE_BIND_ADDRESS=0.0.0.0
EOF
	fi
	chmod 0600 "${env_file}"
fi

compose=(docker compose -p "${project_name}" --env-file "${env_file}" -f "${compose_file}")
up_args=(up -d)
if [[ "${build}" == true ]]; then
	up_args+=(--build)
fi

echo "Starting Cline Bots at ${domain}..."
(cd "${repo_root}" && "${compose[@]}" "${up_args[@]}")

container_id="$("${compose[@]}" ps -q cline-bots)"
if [[ -z "${container_id}" ]]; then
	echo "Compose did not create the cline-bots container." >&2
	exit 70
fi

health=""
for _ in {1..120}; do
	health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
	if [[ "${health}" == "healthy" ]]; then
		break
	fi
	if [[ "${health}" == "unhealthy" || "${health}" == "exited" || "${health}" == "dead" ]]; then
		"${compose[@]}" logs --tail 100 cline-bots >&2
		echo "Cline Bots failed to start (${health})." >&2
		exit 70
	fi
	sleep 1
done
if [[ "${health}" != "healthy" ]]; then
	"${compose[@]}" logs --tail 100 cline-bots >&2
	echo "Timed out waiting for Cline Bots to become healthy." >&2
	exit 70
fi

token="$("${compose[@]}" exec -T cline-bots sh -c 'cat /data/sidecar-access-token')"
umask 077
printf '%s\n' "${token}" >"${token_file}"
chmod 0600 "${token_file}"

if [[ "${local_mode}" == true ]]; then
	gateway_address="ws://127.0.0.1:43126/"
else
	gateway_address="wss://${domain}/"
fi
pairing_uri="clinegateway://connect?address=$(urlencode "${gateway_address}")&token=$(urlencode "${token}")"

cat <<EOF

Cline Bots is ready.

Gateway address: ${gateway_address}
Access token: ${token}

The token was also saved to:
  ${token_file}

Configuration was saved to:
  ${env_file}
EOF

if [[ "${local_mode}" == true ]]; then
	cat <<EOF

Local UI address: http://127.0.0.1:3135/
To start the local UI, run in another terminal:
  bun -F @cline/gateway-ui dev
EOF
else
	cat <<EOF

Hosted UI: https://cline-gateway-connect.cline-8362.chatgpt.site/
EOF
fi

if command -v qrencode >/dev/null 2>&1; then
	echo
	echo "Scan with the Gateway app to pair (Scan QR Code):"
	qrencode -t ANSIUTF8 -o - "${pairing_uri}"
else
	echo
	echo "Install 'qrencode' to pair by scanning a QR code instead of copying the token above."
fi

pairing_pin="$("${compose[@]}" logs cline-bots 2>/dev/null | grep -o 'One-time pairing PIN.*: [0-9]\{6\}' | tail -1 | grep -o '[0-9]\{6\}$' || true)"
if [[ -n "${pairing_pin}" ]]; then
	echo
	echo "Or pair with a one-time PIN (use One-Time PIN in the app, valid 10 min, single use):"
	echo "  ${pairing_pin}"
fi
