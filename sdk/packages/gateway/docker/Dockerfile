# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.13 AS builder

WORKDIR /src

COPY sdk/packages/gateway/docker/build-package.json ./package.json
COPY sdk/packages/gateway/docker/build-bun.lock ./bun.lock
COPY sdk ./sdk

RUN bun install --frozen-lockfile --ignore-scripts
RUN test -e sdk/packages/llms/node_modules/@cline/shared \
	&& test -x node_modules/.bin/tsc
RUN bun -F @cline/shared build \
	&& bun -F @cline/llms build \
	&& bun -F @cline/agents build \
	&& bun -F @cline/engine build \
	&& bun -F @cline/bot build \
	&& bun -F @cline/gateway build
RUN mkdir -p /out \
	&& bun build sdk/packages/gateway/bin/clinegate.mjs --target=node --outfile /out/clinegate \
	&& bun build sdk/packages/gateway/bin/clinegate-worker.mjs --target=node --outfile /out/clinegate-worker

FROM node:22-bookworm-slim AS runtime

ARG CLINE_GATEWAY_UID=10001
ARG CLINE_GATEWAY_GID=10001

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates git ripgrep bubblewrap socat \
	&& rm -rf /var/lib/apt/lists/* \
	&& groupadd --gid "${CLINE_GATEWAY_GID}" cline \
	&& useradd --uid "${CLINE_GATEWAY_UID}" --gid "${CLINE_GATEWAY_GID}" \
		--create-home --home-dir /home/cline --shell /bin/sh cline

COPY --from=builder /out/clinegate /usr/local/bin/clinegate
COPY --from=builder /out/clinegate-worker /usr/local/bin/clinegate-worker
COPY sdk/packages/gateway/docker/entrypoint.sh /usr/local/bin/clinegate-container

RUN chmod 0755 \
	/usr/local/bin/clinegate \
	/usr/local/bin/clinegate-worker \
	/usr/local/bin/clinegate-container \
	&& mkdir -p /data \
	&& chown cline:cline /data

ENV CLINE_GATEWAY_DATA_ROOT=/data \
	CLINE_GATEWAY_NAMESPACE=default \
	CLINE_GATEWAY_REMOTE_HOST=0.0.0.0 \
	CLINE_GATEWAY_REMOTE_PORT=8080 \
	CLINE_GATEWAY_REMOTE_TOKEN_NAME=remote-access \
	LANG=C.UTF-8 \
	LC_ALL=C.UTF-8

USER cline:cline
WORKDIR /home/cline

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
	CMD clinegate status --data-root "$CLINE_GATEWAY_DATA_ROOT" --namespace "$CLINE_GATEWAY_NAMESPACE"

ENTRYPOINT ["clinegate-container"]
