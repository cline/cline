# Cline Bots all-in-one container

This image runs the bundled Cline Gateway, desktop-compatible `/transport`
sidecar, and Caddy. Caddy obtains and renews TLS certificates automatically.
Gateway state, access credentials, sessions, and workspaces survive container
replacement in named volumes.

## Start one server

Requirements:

- Docker Engine with Compose and BuildKit
- a VM with public TCP ports 80 and 443 open
- a hostname resolving to that VM (a `nip.io` hostname is sufficient)

From the repository root:

```sh
cp apps/cline/docker/.env.example apps/cline/docker/.env
# Edit CLINE_GATEWAY_DOMAIN in apps/cline/docker/.env.
docker compose --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml up --build -d
```

Read the generated browser access token:

```sh
docker compose --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml exec cline-bots \
  sh -c 'cat /data/sidecar-access-token'
```

Connect the official UI using:

```text
wss://<CLINE_GATEWAY_DOMAIN>/transport
```

and the token printed above. The token is generated once and retained in the
`cline-data` volume. It is not placed in the image, Compose file, URL, or logs.

Provision a provider credential without putting it on the command line:

```sh
printf '%s' "$ANTHROPIC_API_KEY" | docker compose \
  --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml exec -T cline-bots \
  cline-gateway secret-put anthropic \
    --data-root /data/gateway --namespace desktop
```

Check health and logs:

```sh
docker compose --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml ps
docker compose --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml logs -f
```

## Multiple teammates on one VM

Each teammate must have a separate Compose project, data volume, workspace
volume, hostname, and access token. Do not publish each stack directly on the
same host ports. Put one host-level Caddy instance on ports 80/443 and route
each hostname to a distinct loopback port pair, or use a container ingress
network.

For stacks behind that shared ingress, set these values in each teammate's env
file so the container accepts private plaintext HTTP and does not request its
own certificate:

```text
CLINE_CADDY_SITE_ADDRESS=:8080
CLINE_BIND_ADDRESS=127.0.0.1
```

The outer ingress terminates TLS and proxies each public hostname to that
teammate's distinct `CLINE_HTTP_PORT`. The public browser endpoint remains
`wss://<that-teammate-hostname>/transport`.

For example, use project names `alice` and `bob`, distinct domains, and port
pairs `18080/18443` and `28080/28443`:

```sh
docker compose -p alice --env-file alice.env \
  -f apps/cline/docker/compose.yaml up -d
docker compose -p bob --env-file bob.env \
  -f apps/cline/docker/compose.yaml up -d
```

Compose project names keep the named volumes isolated. For more than a few
instances, use a single ingress proxy and do not expose every container's HTTP
port publicly.
