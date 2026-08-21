#!/usr/bin/env bash
set -Eeuo pipefail

repository="${CLINE_GATE_REPOSITORY:-abeatrix/cline}"
version="${CLINE_GATE_VERSION:-latest}"
install_dir="${CLINE_GATE_BIN_DIR:-${HOME}/.local/bin}"
config_dir="${CLINE_GATE_CONFIG_DIR:-${HOME}/.config/cline-gate}"
data_root="${CLINE_GATE_DATA_ROOT:-${HOME}/.cline/gateway}"
workspace_root="${CLINE_GATE_WORKSPACE_ROOT:-${HOME}/workspaces}"

usage() {
	cat <<'EOF'
Install or update the native Cline Gate server.

Usage:
  curl -fsSL https://get.cline.bot/gate | bash

Environment overrides:
  CLINE_GATE_VERSION       Release tag, or latest (default)
  CLINE_GATE_REPOSITORY    GitHub owner/repository (default: abeatrix/cline)
  CLINE_GATE_BIN_DIR       Binary destination (default: ~/.local/bin)
  CLINE_GATE_CONFIG_DIR    Service configuration (default: ~/.config/cline-gate)
  CLINE_GATE_DATA_ROOT     Gateway state (default: ~/.cline/gateway)
  CLINE_GATE_WORKSPACE_ROOT  Agent workspaces (default: ~/workspaces)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
	usage
	exit 0
fi
if (($# > 0)); then
	echo "Unknown argument: $1" >&2
	usage >&2
	exit 64
fi
for command in curl tar openssl; do
	if ! command -v "${command}" >/dev/null 2>&1; then
		echo "Missing required command: ${command}" >&2
		exit 69
	fi
done

case "$(uname -s)" in
	Linux) platform="linux" ;;
	Darwin) platform="darwin" ;;
	*) echo "Unsupported operating system: $(uname -s)" >&2; exit 65 ;;
esac
case "$(uname -m)" in
	x86_64|amd64) architecture="amd64" ;;
	arm64|aarch64) architecture="arm64" ;;
	*) echo "Unsupported architecture: $(uname -m)" >&2; exit 65 ;;
esac

asset="cline-gate-${platform}-${architecture}.tar.gz"
if [[ "${version}" == "latest" ]]; then
	base_url="https://github.com/${repository}/releases/latest/download"
else
	base_url="https://github.com/${repository}/releases/download/${version}"
fi
temporary_dir="$(mktemp -d)"
trap 'rm -rf "${temporary_dir}"' EXIT

echo "Downloading ${asset} from ${repository}..."
curl --fail --location --silent --show-error \
	"${base_url}/${asset}" --output "${temporary_dir}/${asset}"
curl --fail --location --silent --show-error \
	"${base_url}/${asset}.sha256" --output "${temporary_dir}/${asset}.sha256"

expected="$(awk '{print $1}' "${temporary_dir}/${asset}.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
	actual="$(sha256sum "${temporary_dir}/${asset}" | awk '{print $1}')"
else
	actual="$(shasum -a 256 "${temporary_dir}/${asset}" | awk '{print $1}')"
fi
if [[ -z "${expected}" || "${actual}" != "${expected}" ]]; then
	echo "Checksum verification failed for ${asset}." >&2
	exit 74
fi

tar -xzf "${temporary_dir}/${asset}" -C "${temporary_dir}"
for binary in clinegate cline-sidecar; do
	if [[ ! -f "${temporary_dir}/${binary}" ]]; then
		echo "Release archive is missing ${binary}." >&2
		exit 74
	fi
done
if [[ ! -f "${temporary_dir}/profiles/cline-dad/profile.json" ]]; then
	echo "Release archive is missing the bundled Cline Dad profile." >&2
	exit 74
fi

mkdir -p "${install_dir}" "${config_dir}" "${data_root}" "${workspace_root}"
chmod 0700 "${config_dir}"
install -m 0755 "${temporary_dir}/clinegate" "${install_dir}/clinegate"
install -m 0755 "${temporary_dir}/cline-sidecar" "${install_dir}/cline-sidecar"
rm -rf "${config_dir}/profiles"
cp -R "${temporary_dir}/profiles" "${config_dir}/profiles"

token_file="${config_dir}/access-token"
if [[ ! -s "${token_file}" ]]; then
	openssl rand -hex 32 >"${token_file}"
fi
chmod 0600 "${token_file}"
token="$(<"${token_file}")"
env_file="${config_dir}/service.env"
cat >"${env_file}" <<EOF
CLINE_GATEWAY_DATA_ROOT=${data_root}
CLINE_GATEWAY_NAMESPACE=desktop
CLINE_GATEWAY_LEAD_PROFILE=cline-dad
CLINE_GATEWAY_PROFILES_DIR=${config_dir}/profiles
CLINE_WORKSPACE_ROOT=${workspace_root}
CLINE_SIDECAR_HOST=127.0.0.1
CLINE_SIDECAR_PORT=3126
CLINE_SIDECAR_REMOTE_TOKEN=${token}
CLINE_SIDECAR_TRUSTED_ORIGINS=http://127.0.0.1:3135,http://localhost:3135
EOF
chmod 0600 "${env_file}"

if [[ "${platform}" == "linux" ]] && command -v systemctl >/dev/null 2>&1; then
	service_dir="${HOME}/.config/systemd/user"
	mkdir -p "${service_dir}"
	cat >"${service_dir}/cline-gate.service" <<EOF
[Unit]
Description=Cline Gate server
After=network-online.target

[Service]
Type=simple
EnvironmentFile=${env_file}
WorkingDirectory=${workspace_root}
ExecStart=${install_dir}/cline-sidecar
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF
	systemctl --user daemon-reload
	systemctl --user enable --now cline-gate.service
	service_hint="systemctl --user status cline-gate.service"
elif [[ "${platform}" == "darwin" ]]; then
	launch_agents="${HOME}/Library/LaunchAgents"
	mkdir -p "${launch_agents}"
	plist="${launch_agents}/bot.cline.gate.plist"
	cat >"${plist}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>bot.cline.gate</string>
<key>ProgramArguments</key><array><string>${install_dir}/cline-sidecar</string></array>
<key>WorkingDirectory</key><string>${workspace_root}</string>
<key>EnvironmentVariables</key><dict>
<key>CLINE_GATEWAY_DATA_ROOT</key><string>${data_root}</string>
<key>CLINE_GATEWAY_NAMESPACE</key><string>desktop</string>
<key>CLINE_GATEWAY_LEAD_PROFILE</key><string>cline-dad</string>
<key>CLINE_GATEWAY_PROFILES_DIR</key><string>${config_dir}/profiles</string>
<key>CLINE_WORKSPACE_ROOT</key><string>${workspace_root}</string>
<key>CLINE_SIDECAR_HOST</key><string>127.0.0.1</string>
<key>CLINE_SIDECAR_PORT</key><string>3126</string>
<key>CLINE_SIDECAR_REMOTE_TOKEN</key><string>${token}</string>
<key>CLINE_SIDECAR_TRUSTED_ORIGINS</key><string>http://127.0.0.1:3135,http://localhost:3135</string>
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${config_dir}/server.log</string>
<key>StandardErrorPath</key><string>${config_dir}/server.log</string>
</dict></plist>
EOF
	chmod 0600 "${plist}"
	launchctl bootout "gui/${UID}/bot.cline.gate" >/dev/null 2>&1 || true
	launchctl bootstrap "gui/${UID}" "${plist}"
	service_hint="launchctl print gui/${UID}/bot.cline.gate"
else
	echo "No supported user service manager was found." >&2
	echo "Run ${install_dir}/cline-sidecar with variables from ${env_file}." >&2
	exit 69
fi

cat <<EOF

Cline Gate is installed and running.

Gateway address: ws://127.0.0.1:3126/
Access token: ${token}
Token file: ${token_file}
Workspace root: ${workspace_root}

CLI: ${install_dir}/clinegate
Service: ${service_hint}

Run this installer again to update the binaries without replacing state,
workspaces, or the access token.
EOF
