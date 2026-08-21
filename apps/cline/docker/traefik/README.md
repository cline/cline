# Shared Traefik ingress for Cline Gate

This deployment exposes one VM port pair (`80` and `443`) and routes a distinct
hostname to each user's isolated Cline Gate container. Personal and team
deployments use the same image; only the routing topology differs.

## Prerequisites

- Docker Engine and Docker Compose v2
- Public TCP ports 80 and 443 open on the VM
- A real DNS record for every Gate hostname, typically
  `*.gate.example.com`, resolving to the VM
- A built or pulled Cline Gate image

Loopback hostnames are intentionally not used here because they resolve on the
browser's machine and cannot address a shared remote VM.

## Start a team installation

```sh
cp apps/cline/docker/traefik/global.env.example global.env
# Configure the email, image, root hostname, and trusted UI origin.
docker compose -p cline-team \
  --env-file global.env \
  -f apps/cline/docker/traefik/team.compose.yaml up -d
```

This single command starts Traefik and an initial root/admin Gate. Only Traefik
publishes host ports. It creates `cline-gate-ingress` and obtains public
certificates; the root Gate has isolated persistent data and workspace volumes.

Read the root Gate token:

```sh
docker compose -p cline-team \
  --env-file global.env \
  -f apps/cline/docker/traefik/team.compose.yaml exec -T root-gate \
  sh -c 'cat /data/sidecar-access-token'
```

The future admin panel belongs in this team project. Its provisioning service
will create per-user containers, volumes, resource allocations, access tokens,
and Traefik labels through the Docker API. Administrators will not run the
per-user commands below; they are retained as the provisioning contract and as
a development/testing workflow until that service exists.

## Internal per-user provisioning template

Build the common image once from the repository root if it is not pulled from a
registry:

```sh
docker build -f apps/cline/docker/Dockerfile -t cline-bots-gateway:dev .
```

For development before the admin provisioner exists, create a private
environment file for the user:

```sh
cp apps/cline/docker/traefik/gate.env.example alice.env
# Set alice.gate.example.com and CLINE_GATE_ROUTE_ID=alice.
```

Start the user's isolated Compose project:

```sh
docker compose -p cline-alice \
  --env-file alice.env \
  -f apps/cline/docker/traefik/gate.compose.yaml up -d
```

Read the user's generated access token:

```sh
docker compose -p cline-alice \
  --env-file alice.env \
  -f apps/cline/docker/traefik/gate.compose.yaml exec -T cline-gate \
  sh -c 'cat /data/sidecar-access-token'
```

The admin provisioner will perform the equivalent operation programmatically.
Every generated user gets distinct data and workspace volumes.

The current WebSocket address is:

```text
wss://alice.gate.example.com/
```

The WebSocket upgrade is served directly at `/`; health remains available at
`/health`.

## Personal/non-team deployment

A single user can use this same shared-ingress layout with one Gate container,
but the existing direct Compose deployment is simpler:

```sh
apps/cline/docker/quickstart.sh --domain gateway.example.com
```

That command runs the same image and lets its bundled Caddy own ports 80 and
443. Use Traefik when the machine will host more than one Gate or when a shared
ingress is already present.

## Security note

The Docker provider needs visibility into container metadata. This initial
configuration mounts the Docker socket read-only. Before exposing provisioning
to untrusted users, put a restricted Docker socket proxy in front of Traefik and
ensure only administrators can modify container labels; access to the Docker
API is security-sensitive.
