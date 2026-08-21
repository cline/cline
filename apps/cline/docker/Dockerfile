# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.13 AS builder

WORKDIR /src
COPY package.json bun.lock ./
COPY patches ./patches
COPY sdk ./sdk
COPY apps ./apps

RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run build:sdk

ARG TARGETARCH
RUN case "${TARGETARCH}" in \
		amd64) target="x86_64-unknown-linux-gnu" ;; \
		arm64) target="aarch64-unknown-linux-gnu" ;; \
		*) echo "Unsupported Docker architecture: ${TARGETARCH}" >&2; exit 64 ;; \
	esac \
	&& cd apps/cline \
	&& TARGET="${target}" bun run scripts/build-sidecar-bin.ts \
	&& cp "src-tauri/bin/cline-sidecar-${target}" /tmp/cline-sidecar \
	&& cp "src-tauri/bin/clinegate-${target}" /tmp/clinegate

FROM caddy:2.10-alpine AS caddy

FROM debian:bookworm-slim AS runtime

ARG CLINE_UID=10001
ARG CLINE_GID=10001

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		bash ca-certificates curl git openssl ripgrep bubblewrap socat \
	&& rm -rf /var/lib/apt/lists/* \
	&& groupadd --gid "${CLINE_GID}" cline \
	&& useradd --uid "${CLINE_UID}" --gid "${CLINE_GID}" \
		--create-home --home-dir /home/cline --shell /bin/bash cline \
	&& mkdir -p /data /workspaces /etc/caddy \
	&& chown -R cline:cline /data /workspaces /etc/caddy

COPY --from=caddy /usr/bin/caddy /usr/local/bin/caddy
COPY --from=builder /tmp/cline-sidecar /usr/local/bin/cline-sidecar
COPY --from=builder /tmp/clinegate /usr/local/bin/clinegate
COPY apps/cline/docker/Caddyfile /etc/caddy/Caddyfile
COPY apps/cline/docker/entrypoint.sh /usr/local/bin/cline-bots-container

RUN chmod 0755 \
	/usr/local/bin/caddy \
	/usr/local/bin/cline-sidecar \
	/usr/local/bin/clinegate \
	/usr/local/bin/cline-bots-container

ENV CLINE_GATEWAY_DATA_ROOT=/data/gateway \
	CLINE_GATEWAY_NAMESPACE=desktop \
	CLINE_GATEWAY_LEAD_PROFILE=cline \
	CLINE_SIDECAR_HOST=127.0.0.1 \
	CLINE_SIDECAR_PORT=3126 \
	CLINE_WORKSPACE_ROOT=/workspaces \
	CLINE_SIDECAR_TRUSTED_ORIGINS=https://cline-gateway-connect.cline-8362.chatgpt.site \
	CLINE_SIDECAR_REMOTE_TOKEN_FILE=/data/sidecar-access-token \
	XDG_CONFIG_HOME=/data/caddy/config \
	XDG_DATA_HOME=/data/caddy/data

USER cline:cline
WORKDIR /workspaces

VOLUME ["/data", "/workspaces"]
EXPOSE 8080 8443

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
	CMD curl --fail --silent http://127.0.0.1:3126/health >/dev/null || exit 1

ENTRYPOINT ["cline-bots-container"]
