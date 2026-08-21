#!/usr/bin/env bash
set -Eeuo pipefail

image="${CLINE_GATE_DOCKER_IMAGE:-ghcr.io/abeatrix/cline-bots-gateway:latest}"
name="${CLINE_GATE_CONTAINER_NAME:-cline-bots}"
data_volume="${CLINE_GATE_DATA_VOLUME:-cline-bots-data}"
workspace_volume="${CLINE_GATE_WORKSPACE_VOLUME:-cline-bots-workspaces}"
host_port="${CLINE_GATE_PORT:-43126}"
lead_profile="${CLINE_GATE_LEAD_PROFILE:-cline-dad}"

if [[ "${1:-}" == "--plain-cline" ]]; then lead_profile="cline"; shift; fi
if (($# > 0)); then
	echo "Usage: curl -fsSL https://get.cline.bot/gate/docker | bash [-s -- --plain-cline]" >&2
	exit 64
fi
if ! command -v docker >/dev/null 2>&1; then
	echo "Docker is required. Install it and run this command again." >&2
	exit 69
fi
if ! docker info >/dev/null 2>&1; then
	echo "Docker is installed but its daemon is not available." >&2
	exit 69
fi

echo "Pulling ${image}..."
docker pull "${image}"
if docker container inspect "${name}" >/dev/null 2>&1; then
	docker rm --force "${name}" >/dev/null
fi
docker volume create "${data_volume}" >/dev/null
docker volume create "${workspace_volume}" >/dev/null
docker run -d --name "${name}" --restart unless-stopped \
	-p "127.0.0.1:${host_port}:8080" \
	-e CLINE_GATEWAY_DOMAIN=127.0.0.1 \
	-e CLINE_CADDY_SITE_ADDRESS=:8080 \
	-e CLINE_GATEWAY_LEAD_PROFILE="${lead_profile}" \
	-e CLINE_SIDECAR_TRUSTED_ORIGINS=http://127.0.0.1:3135,http://localhost:3135,https://cline-gateway-connect.cline-8362.chatgpt.site \
	-v "${data_volume}:/data" -v "${workspace_volume}:/workspaces" \
	"${image}" >/dev/null

health=""
for _ in {1..120}; do
	health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${name}" 2>/dev/null || true)"
	[[ "${health}" == "healthy" ]] && break
	if [[ "${health}" == "unhealthy" || "${health}" == "exited" || "${health}" == "dead" ]]; then
		docker logs --tail 100 "${name}" >&2
		exit 70
	fi
	sleep 1
done
if [[ "${health}" != "healthy" ]]; then
	docker logs --tail 100 "${name}" >&2
	echo "Timed out waiting for Cline Gate." >&2
	exit 70
fi

token="$(docker exec "${name}" sh -c 'cat /data/sidecar-access-token')"
config_dir="${HOME}/.config/cline-gate"
mkdir -p "${config_dir}"
chmod 0700 "${config_dir}"
printf '%s\n' "${token}" >"${config_dir}/docker-access-token"
chmod 0600 "${config_dir}/docker-access-token"

cat <<EOF

Cline Gate is running in Docker.

Gateway address: ws://127.0.0.1:${host_port}/
Access token: ${token}
Token file: ${config_dir}/docker-access-token
Container: ${name}

Run this installer again to update the image without replacing Gate state or workspaces.
EOF
