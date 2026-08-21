# Team Gate provisioning

This VM uses a hybrid deployment. The root Cline Gate, its Slack connector,
sessions, credentials, and workspaces run natively and must remain untouched.
New teammate Gates run as isolated Docker Compose projects behind host Caddy.

The provisioning template is installed at `/home/beatrix/cline-team`.

## Security boundary

- Never share the native root Gate remote token with a teammate.
- Every teammate requires a unique hostname, access token, data volume,
  workspace volume, Compose project, loopback port, and resource allocation.
- Never provision from a public channel or from an identity that has not been
  verified as an administrator.
- Until the admin identity and provisioning service are implemented, do not run
  Docker or modify Caddy on a chat request. Explain the proposed configuration
  and ask the administrator to perform or explicitly authorize the operation.
- Never print provider credentials. Return a newly generated Gate token only in
  an administrator-private response and recommend rotating it if exposed.

## Current manual contract

For a teammate slug such as `alice`, an administrator creates an owner-only env
file from `gate.env.example`, assigns an unused loopback port, and starts:

```sh
docker compose -p cline-user-alice \
  --env-file /home/beatrix/cline-team/users/alice.env \
  -f /home/beatrix/cline-team/gate.compose.yaml up -d
```

Host Caddy then receives an explicit hostname route to that loopback port. The
configuration must be validated before an atomic reload. The teammate receives
the public WebSocket address and that container's token, never the root token.

Do not claim provisioning is complete unless container health, the public
WebSocket route, token authentication, volume isolation, and root Slack health
have all been verified.

## Image prerequisite

The template requires the all-in-one `cline-bots-gateway` image containing the
Gateway, authenticated desktop bridge, and internal Caddy. The older
`clinegate:phase-7-amd64` image exposes only the raw Gateway protocol and is
not a substitute for the hosted UI bridge.
