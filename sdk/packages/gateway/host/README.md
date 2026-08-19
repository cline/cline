# Host execution

The host deployment runs the Gateway authority and its lead/worker engines as
the owner account. This gives approved built-in tools access to that account's
workspaces, provider configuration, and Docker client. Remote clients still
connect through the Gateway protocol and never receive host credentials.

The service reads provider configuration from the standard
`~/.cline/data/settings/providers.json` path. Gateway-owned secrets remain a
supported higher-priority override. The service binds its remote WebSocket
listener to loopback so TLS should terminate in a reverse proxy such as Caddy.

## Install for the current user

```sh
bun -F @cline/gateway host:bundle
install -Dm755 sdk/packages/gateway/dist-bin/cline-gateway ~/.local/bin/cline-gateway
install -Dm644 sdk/packages/gateway/host/cline-gateway.service ~/.config/systemd/user/cline-gateway.service
systemctl --user daemon-reload
systemctl --user enable --now cline-gateway.service
```

Enable lingering once if the service must survive logout:

```sh
sudo loginctl enable-linger "$USER"
```

The account must be allowed to access Docker if approved host commands are
expected to create containerized agents. Do not mount the Docker socket into a
public-facing Gateway container: Docker access is effectively host-root access.

## Data migration from the container deployment

Stop the container, copy (do not move) its `/data/default` directory to
`~/.cline/gateway/default`, and make the copy owner-only. Retain the old Docker
volume until the host deployment has been verified so rollback remains
possible. The remote access token remains at
`~/.cline/gateway/default/secrets/remote-access`.
