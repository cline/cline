# Hybrid native-root team deployment

This mode preserves an existing native root Cline Gate and host Caddy while
placing new teammate Gates in isolated Docker Compose projects.

```text
host Caddy :443
├── root hostname  -> native sidecar on 127.0.0.1
├── alice hostname -> Docker port 127.0.0.1:18201
└── bob hostname   -> Docker port 127.0.0.1:18202
```

The root Gate, its Slack connector, credentials, sessions, and workspaces are
not moved or restarted by this setup.

The future admin provisioner will allocate the project name, hostname, port,
volumes, access token, and resource limits and then update host Caddy. Until it
exists, `gate.compose.yaml` is the internal provisioning template.

Every teammate must receive a unique Gate access token. Never distribute the
native root Gate token as a team-wide credential.

Example development-only manual provisioning:

```sh
cp gate.env.example alice.env
docker compose -p cline-user-alice \
  --env-file alice.env \
  -f gate.compose.yaml up -d
```

Add the corresponding hostname to the host Caddy configuration and reverse
proxy it to the selected loopback port. Do not publish a teammate container on
all interfaces.
