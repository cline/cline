# Cline Bots all-in-one container

This image runs the bundled Cline Gateway, desktop-compatible WebSocket
sidecar, and Caddy. Caddy obtains and renews TLS certificates automatically.
Gateway state, access credentials, sessions, and workspaces survive container
replacement in named volumes.

## Start one server

Requirements:

- Docker Engine with Compose and BuildKit
- for public mode, a VM with TCP ports 80 and 443 open and either a hostname or
  public IPv4 address

### One-command setup

From the repository root, the default is a local-only deployment. It replaces
the generated `.env`, binds Docker to loopback, builds and starts the container,
waits for health, and prints and saves the token:

```sh
apps/cline/docker/quickstart.sh
```

This is equivalent to:

```sh
apps/cline/docker/quickstart.sh --local --force
```

It exposes `ws://127.0.0.1:43126/`. Start the local UI with
`bun -F @cline/gateway-ui dev` and open `http://127.0.0.1:3135/`.

For an explicit public deployment:

```sh
apps/cline/docker/quickstart.sh --public-ip 35.254.245.28
apps/cline/docker/quickstart.sh --domain gateway.example.com
```

The generated files are deliberately ignored by Git:

- `apps/cline/docker/.env` — non-secret deployment configuration
- `apps/cline/docker/.access-token` — mode-0600 browser access token

Run `apps/cline/docker/quickstart.sh --help` for project-name, lead-profile,
rebuild, and replacement options.

### Manual setup

From the repository root:

```sh
cp apps/cline/docker/.env.example apps/cline/docker/.env
# Edit CLINE_GATEWAY_DOMAIN in apps/cline/docker/.env.
docker compose --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml up --build -d
```

The complete `.env` for a directly exposed single server is:

```dotenv
# Bare public hostname resolving to this VM. Do not include https:// or a path.
CLINE_GATEWAY_DOMAIN=gateway.35-254-245-28.nip.io

# Browser origins allowed to open the authenticated WebSocket.
CLINE_SIDECAR_TRUSTED_ORIGINS=https://cline-gateway-connect.cline-8362.chatgpt.site

# Built-in initial bot profile: cline or cline-dad.
CLINE_GATEWAY_LEAD_PROFILE=cline

# Public host ports mapped to Caddy inside the container.
CLINE_HTTP_PORT=80
CLINE_HTTPS_PORT=443

# Empty means Caddy serves CLINE_GATEWAY_DOMAIN with automatic HTTPS.
CLINE_CADDY_SITE_ADDRESS=

# Direct deployments listen publicly. Shared-ingress stacks use 127.0.0.1.
CLINE_BIND_ADDRESS=0.0.0.0
```

`.env` does not contain the access token. The container generates it once in
the persistent `cline-data` volume. The quickstart script copies it to
`.access-token`; manual users can read it with the command below.

Read the generated browser access token:

```sh
docker compose --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml exec cline-bots \
  sh -c 'cat /data/sidecar-access-token'
```

Connect the official UI using:

```text
wss://<CLINE_GATEWAY_DOMAIN>/
```

and the token printed above. The token is generated once and retained in the
`cline-data` volume. It is not placed in the image, Compose file, URL, or logs.

Provision a provider credential without putting it on the command line:

```sh
printf '%s' "$ANTHROPIC_API_KEY" | docker compose \
  --env-file apps/cline/docker/.env \
  -f apps/cline/docker/compose.yaml exec -T cline-bots \
  clinegate secret-put anthropic \
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
`wss://<that-teammate-hostname>/`.

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
