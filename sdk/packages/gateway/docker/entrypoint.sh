#!/bin/sh
set -eu

data_root="${CLINE_GATEWAY_DATA_ROOT:-/data}"
namespace="${CLINE_GATEWAY_NAMESPACE:-default}"
remote_host="${CLINE_GATEWAY_REMOTE_HOST:-0.0.0.0}"
remote_port="${CLINE_GATEWAY_REMOTE_PORT:-8080}"
token_name="${CLINE_GATEWAY_REMOTE_TOKEN_NAME:-remote-access}"
token_source="${CLINE_GATEWAY_REMOTE_TOKEN_FILE:-/run/secrets/cline_gateway_remote_token}"
secret_dir="${data_root}/${namespace}/secrets"
token_target="${secret_dir}/${token_name}"

case "${token_name}" in
	""|*/*|.*) echo "Invalid CLINE_GATEWAY_REMOTE_TOKEN_NAME" >&2; exit 64 ;;
esac

mkdir -p "${secret_dir}"
chmod 0700 "${secret_dir}"

if [ -f "${token_source}" ] && [ "${token_source}" != "${token_target}" ]; then
	install -m 0600 "${token_source}" "${token_target}"
fi

if [ ! -s "${token_target}" ]; then
	echo "Missing remote access token. Mount it at ${token_source}, or provision ${token_target} in the data volume." >&2
	exit 78
fi
chmod 0600 "${token_target}"

set -- serve \
	--data-root "${data_root}" \
	--namespace "${namespace}" \
	--remote-host "${remote_host}" \
	--remote-port "${remote_port}" \
	--remote-token "${token_name}" \
	"$@"

tls_cert="${CLINE_GATEWAY_TLS_CERT_FILE:-}"
tls_key="${CLINE_GATEWAY_TLS_KEY_FILE:-}"
if [ -n "${tls_cert}" ] || [ -n "${tls_key}" ]; then
	if [ -z "${tls_cert}" ] || [ -z "${tls_key}" ]; then
		echo "CLINE_GATEWAY_TLS_CERT_FILE and CLINE_GATEWAY_TLS_KEY_FILE must be set together" >&2
		exit 64
	fi
	set -- "$@" --tls-cert "${tls_cert}" --tls-key "${tls_key}"
else
	# Plaintext is suitable only inside a trusted network behind a TLS proxy.
	set -- "$@" --allow-insecure-remote
fi

exec clinegate "$@"
