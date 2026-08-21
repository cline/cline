# Gateway container

This image bundles the Phase 7 Gateway and worker executables on the supported
Node 22 runtime. It runs as UID/GID `10001`, stores all durable Gateway state
under `/data`, and exposes the remote WebSocket listener on port `8080`.

## Build

Run from the repository root:

```sh
docker build \
  -f sdk/packages/gateway/docker/Dockerfile \
  -t clinegate:dev \
  .
```

## Run behind a TLS-terminating proxy

Create a random token. Do not put it in the image, URL, or command line.

```sh
mkdir -p sdk/packages/gateway/docker/secrets
openssl rand -hex 32 > sdk/packages/gateway/docker/secrets/remote-access-token
chmod 600 sdk/packages/gateway/docker/secrets/remote-access-token

docker compose -f sdk/packages/gateway/docker/compose.yaml up --build
```

The sample binds only to host loopback. A reverse proxy should terminate TLS at
`wss://gateway.example.com` and forward WebSocket traffic to
`ws://127.0.0.1:8080`. If the proxy runs in another container, put both services
on a private Docker network, remove the host `ports` mapping, and route to
`gateway:8080`.

The desktop client uses the public `wss://` URL and the contents of the token
file. Remote credentials are sent in the authenticated protocol handshake, not
in the URL.

## Run with TLS in the Gateway

Mount the certificate, private key, and token as read-only files:

```sh
docker run --rm \
  -p 443:8080 \
  -v cline-gateway-data:/data \
  -v "$PWD/remote-access-token:/run/secrets/cline_gateway_remote_token:ro" \
  -v "$PWD/fullchain.pem:/run/tls/fullchain.pem:ro" \
  -v "$PWD/privkey.pem:/run/tls/privkey.pem:ro" \
  -e CLINE_GATEWAY_TLS_CERT_FILE=/run/tls/fullchain.pem \
  -e CLINE_GATEWAY_TLS_KEY_FILE=/run/tls/privkey.pem \
  clinegate:dev
```

Without the TLS variables, the entrypoint deliberately enables Gateway's
plaintext escape hatch. Never publish that listener directly to an untrusted
network; use it only on loopback or a private network behind TLS.

## Persistent state and provider credentials

The `/data` volume contains the database, sessions, bot workspaces, memories,
projections, and owner-only credential files. Keep this volume private and back
it up as one authority.

The entrypoint copies `/run/secrets/cline_gateway_remote_token` into the
Gateway's owner-only secret store on startup. Provision provider credentials in
the same persistent volume at:

```text
/data/<namespace>/secrets/<provider-id>
```

Each credential file must be owned by UID `10001` and have mode `0600`. For
example, a one-off provisioning command can read a secret from standard input:

```sh
printf '%s' "$ANTHROPIC_API_KEY" | docker exec -i <container> \
  clinegate secret-put anthropic --data-root /data --namespace default
```

## VM deployment

Install Docker on the VM, build or pull the same image, attach a persistent
volume for `/data`, and expose it through TLS. Firewall the local discovery
listener (it is not a remote API) and allow only the public TLS port. The image
does not introduce Gateway federation: clients connect to this Gateway and see
only the bots it owns.
