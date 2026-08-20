#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/../../.." && pwd)"
env_file="${script_dir}/.env"
token_file="${script_dir}/.access-token"
compose_file="${script_dir}/compose.yaml"

domain=""
public_ip=""
project_name="cline-bots"
lead_profile="cline"
force=false
build=true

usage() {
	cat <<'EOF'
Usage: apps/cline/docker/quickstart.sh [options]

Options:
  --domain HOST       Public hostname already resolving to this VM
  --public-ip IP      Build gateway.<hyphenated-ip>.nip.io automatically
  --project NAME      Compose project name (default: cline-bots)
  --lead-profile NAME cline or cline-dad (default: cline)
  --no-build          Start an image that has already been built
  --force             Replace an existing apps/cline/docker/.env
  -h, --help          Show this help

With no domain or public IP, the script detects the VM's public IPv4 address.
EOF
}

while (($# > 0)); do
	case "$1" in
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

if [[ "${lead_profile}" != "cline" && "${lead_profile}" != "cline-dad" ]]; then
	echo "--lead-profile must be cline or cline-dad." >&2
	exit 64
fi
if [[ -n "${domain}" && -n "${public_ip}" ]]; then
	echo "Use either --domain or --public-ip, not both." >&2
	exit 64
fi

for command in docker curl; do
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
	if [[ -n "${domain}" || -n "${public_ip}" ]]; then
		echo "${env_file} already exists; use --force to replace it." >&2
		exit 73
	fi
	domain="$(sed -n 's/^CLINE_GATEWAY_DOMAIN=//p' "${env_file}" | tail -1)"
	if [[ -z "${domain}" ]]; then
		echo "Existing ${env_file} has no CLINE_GATEWAY_DOMAIN." >&2
		exit 65
	fi
else
	if [[ -z "${domain}" ]]; then
		if [[ -z "${public_ip}" ]]; then
			public_ip="$(curl -4fsS --max-time 10 https://api.ipify.org)" || {
				echo "Could not detect the public IPv4 address; pass --public-ip or --domain." >&2
				exit 69
			}
		fi
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

	cat >"${env_file}" <<EOF
CLINE_GATEWAY_DOMAIN=${domain}
CLINE_SIDECAR_TRUSTED_ORIGINS=https://cline-gateway-connect.cline-8362.chatgpt.site
CLINE_GATEWAY_LEAD_PROFILE=${lead_profile}
CLINE_HTTP_PORT=80
CLINE_HTTPS_PORT=443
CLINE_CADDY_SITE_ADDRESS=
CLINE_BIND_ADDRESS=0.0.0.0
EOF
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

cat <<EOF

Cline Bots is ready.

Hosted UI: https://cline-gateway-connect.cline-8362.chatgpt.site/
Gateway address: wss://${domain}/transport
Access token: ${token}

The token was also saved to:
  ${token_file}

Configuration was saved to:
  ${env_file}
EOF
