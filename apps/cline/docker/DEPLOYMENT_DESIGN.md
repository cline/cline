# Cline Gate deployment and stable-address design

## Status

Proposed design. This document defines the intended addressing, routing, and
quickstart behavior for local, single-container, and multi-user deployments.

## Goals

- Give a locally running Cline Gate a stable browser-safe address.
- Keep the official Gateway UI independent from the machine running the bot.
- Let a single Docker command start one complete Cline Gate deployment.
- Let many teammates run isolated Cline Gate containers behind one public VM
  address and one public TLS port.
- Keep access tokens, state, workspaces, and provider credentials isolated.

## Names and endpoints

The user-facing product name is **Cline Gate**. The local hostnames are:

```text
Local UI:  http://127.0.0.1:3135/
Cline Gate: ws://127.0.0.1:43126/
```

The WebSocket upgrade happens at `/`. HTTP endpoints remain explicit:

```text
GET http://127.0.0.1:43126/health
GET http://127.0.0.1:43126/version
```

An HTTP request to `/` is not a Gateway connection. Only a WebSocket upgrade
request to `/` opens the authenticated transport.

The WebSocket endpoint was moved from `/transport` to `/` as one coordinated
protocol change across the sidecar, clients, pairing URIs, tests, and
documentation. There is no permanent compatibility alias.

## Two different kinds of address

Loopback and public DNS solve different problems and must not be conflated.

### Local address

The local deployment binds plain HTTP and WebSocket ports only to `127.0.0.1`.
It requires no local proxy, certificate authority, DNS, or administrator access.
It is reachable only from a browser running on the same computer.

### Public address

A remote VM needs a real hostname resolving to that VM. Caddy or another ingress
proxy terminates publicly trusted TLS and forwards the WebSocket connection to
the appropriate container.

Examples:

```text
wss://gateway.example.com/
wss://alice.gate.example.com/
```

## Quickstart interface

`quickstart.sh` should make the deployment mode explicit.

### Local mode

```sh
apps/cline/docker/quickstart.sh --local
```

Local mode:

1. Starts the all-in-one container without publishing it to the LAN.
2. Runs the bundled Caddy in private plain-HTTP mode.
3. Configures the allowed local UI origins.
4. Prints `ws://127.0.0.1:43126/` and the generated access token.
5. Prints the command for starting the local Gateway UI on port 3135.

### Public single-server mode

```sh
apps/cline/docker/quickstart.sh --domain gateway.example.com
```

`--domain` always means a real hostname that already resolves to the machine.
The script:

1. Writes `CLINE_GATEWAY_DOMAIN=gateway.example.com`.
2. Starts the all-in-one Cline Gate container.
3. Publishes ports 80 and 443 for Caddy.
4. Lets Caddy obtain and renew the public certificate.
5. Waits for health and prints `wss://gateway.example.com/` plus the generated
   token.

When no mode is supplied, quickstart selects local mode and replaces the
generated deployment environment, equivalent to `--local --force`. Public VM
deployment is always explicit through `--domain` or `--public-ip`.

## Deployment A: one local root bot

This mode runs one root bot and its Gate on a user's workstation.

```text
Browser
  | http://127.0.0.1:3135
  v
local Gateway UI

Browser UI
  | ws://127.0.0.1:43126/
  v
loopback-only Docker port -> Cline Gate -> root bot
```

Properties:

- One Cline Gate access token stored with mode `0600` permissions.
- Gate ports bind only to loopback.
- Bot state and the default chat workspace persist locally.
- The local HTTP UI connects to the local `ws://` Gate. An HTTPS-hosted UI
  cannot open this connection because browsers block insecure mixed content.

## Deployment B: one all-in-one Docker container

This is the fastest remote VM setup.

```text
Internet :443
  v
Caddy (public TLS)
  v
Cline Gate / sidecar
  v
Bundled Gateway server and root bot
```

The image contains the bundled Gateway server, sidecar bridge, and Caddy. It
uses two persistent volumes:

- Cline data: identity, access token, configuration, sessions, and credentials.
- Workspaces: files available to agent sessions.

Only Caddy is publicly reachable. The server and sidecar are private processes
inside the container. Replacing the container updates the binaries without
replacing the volumes or access identity.

The official hosted UI connects directly to the public WebSocket endpoint. It
does not need to be hosted on the VM.

## Deployment C: multiple users on one machine

Run one isolated Cline Gate container per user and one shared routing proxy.
Only the proxy publishes ports 80 and 443.

```text
                         +-> alice container:3126 + alice volumes
Internet -> ingress:443 -+-> bob container:3126   + bob volumes
                         +-> carol container:3126 + carol volumes
```

Use wildcard DNS:

```text
*.gate.example.com -> VM public IP
```

Give every user a stable hostname:

```text
wss://alice.gate.example.com/
wss://bob.gate.example.com/
wss://carol.gate.example.com/
```

Hostname routing is preferred over a query such as `?user=alice`. A hostname is
straightforward for TLS, routing, logs, rate limits, and revocation. It selects
a destination but does not authenticate the caller; every Gate still requires
its own access token.

Each user deployment must have:

- A distinct Compose project or orchestrator identity.
- A distinct data volume and workspace volume.
- A distinct Gate access token and provider credentials.
- CPU and memory limits.
- No public container port.
- A routing label or ingress entry for its hostname.

For a handful of static users, host-level Caddy is sufficient. For dynamic
container creation, Traefik is the recommended routing proxy because Docker
labels can add and remove hostname routes with the container lifecycle. K3s is
appropriate only when scheduling, reconciliation, multi-node growth, or
Kubernetes policy is required; it is unnecessary merely to share port 443.

Loopback addresses are not part of this VM ingress path because they resolve to
each teammate's laptop rather than the shared VM.

## Authentication and authorization

Routing and authentication are separate layers:

1. DNS and the ingress select a Cline Gate container.
2. TLS protects the connection.
3. The Gate validates its per-user access token during the WebSocket handshake.
4. The selected bot and workspace policy constrain the session.

Tokens must not appear in URLs, proxy labels, images, Compose files, or access
logs. The quickstart script saves the generated token to a mode-`0600` file.

## Updates

Stable hostnames survive updates.

- Local: update Cline Gate/UI binaries and restart their processes; loopback
  addresses remain unchanged.
- Single Docker: pull or build the new image, then recreate the container while
  retaining its named volumes.
- Multi-user: update containers individually or roll them through the
  orchestrator. The shared proxy and wildcard DNS remain unchanged.

Every UI/Gate connection should exchange client, server, and protocol versions
before enabling controls. An incompatible Gate must produce an explicit update
requirement rather than silently connecting to an older server.

## Recommended implementation order

1. Rename remaining user-facing Gateway references to Cline Gate.
2. Add a shared-ingress Compose example using Traefik and per-user labels.
3. Add version negotiation and update-state UI.
4. Add an administrative provisioning service and UI.
5. Test local HTTPS, hosted-UI-to-local-Gate WebSockets, public Caddy routing,
   and two isolated user containers behind one ingress.

## Adopted progression

The deployment progression is:

1. **Now: one team Compose project plus Traefik.** A single operator command
   starts shared ingress and the root/admin Gate. Reuse the all-in-one Cline
   Gate image, isolate user volumes and credentials, and route by hostname.
2. **Next: add the admin control plane.** The admin UI calls a provisioning
   service that creates, updates, suspends, and deletes per-user Gate containers
   through an orchestration interface. The Docker implementation uses the
   Docker API; the future k3s implementation uses the Kubernetes API. Operators
   do not run a Compose command for every user.
3. **Then: package the same contract for k3s.** Express the image, ports,
   health checks, persistent volumes, secrets, resource limits, and hostname
   routes as a Helm chart. Do not change the container contract during this
   migration.
4. **Before external multi-tenancy: strengthen isolation.** Add network policy,
   restricted security contexts, admission policy, and a sandboxed runtime such
   as gVisor or Kata Containers. Kubernetes namespaces alone are not a security
   boundary for agents that can execute code.
5. **Scale out when required.** Add k3s worker machines when a single VM lacks
   capacity. Kubernetes then handles scheduling, reconciliation, and rolling
   updates across the pool.

Minikube is not a production stage in this progression. It may be used to test
Kubernetes manifests locally, but k3s is the intended lightweight production
distribution.

## Image decision

Personal, team, and future k3s deployments use the **same Cline Gate image**.
The deployment layer changes only its environment and routing:

| Mode | Public TLS owner | Image's Caddy address | Public ports from Gate container |
| --- | --- | --- | --- |
| Personal/direct | Bundled Caddy | Public hostname | `80`, `443` |
| Local | None | `:8080` | Loopback HTTP only |
| Team/Compose | Shared Traefik | `:8080` | None |
| Future/k3s | Cluster ingress | `:8080` | None |

Keeping one image prevents local, team, and cluster releases from drifting.
Persistent data and access identity live outside the image, so the same image
can be replaced during an update without losing sessions or workspaces.

## Team control-plane boundary

The team-level Compose project owns shared infrastructure:

- Traefik and its certificate state.
- The initial root/admin Cline Gate.
- Later, the admin API and admin UI.
- Later, the provisioning database and audit log.

The per-user container definition remains an internal template, not an
operator-facing workflow. The future provisioner applies that template with a
unique hostname, token, volumes, and resource allocation. Keeping provisioning
behind an interface allows the admin panel to move from Docker to k3s without
changing its product workflow.

The admin API must not receive unrestricted access to the Docker socket. Use a
small privileged provisioner with a narrow operation set, strict input
validation, and an audit log. Traefik only needs read access to routing metadata.

## Hybrid migration for an existing native root Gate

An existing native root Gate does not need to move into Docker when a machine
becomes a team host. During the transition, host Caddy remains the single public
TLS ingress. It routes the existing root hostname to the native sidecar and
routes each teammate hostname to a distinct loopback-only Docker port.

The root remote token remains a credential for the root Gate only. Each Docker
Gate generates and persists its own token. Sharing the root token would attach
all teammates to the same authority and expose the same bots and sessions; it
is not tenant provisioning.

The future admin provisioner owns allocation of loopback ports, Compose project
identities, volumes, resource limits, hostnames, Caddy routes, and tokens. The
native root process can remain in place indefinitely or migrate during a later
maintenance window.
