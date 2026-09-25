# Cline Server architecture

This document distinguishes the implemented host package from the proposed shared-host experience. Everything in **Roadmap** is future work unless explicitly described as an existing foundation.

## Terminology and boundaries

| Component | Responsibility |
| --- | --- |
| `@cline/server` | Installable headless package providing the `cline-server` executable. Starts and manages a Hub using core. |
| Hub (`@cline/core/hub`) | Authenticated session server: agent sessions, tools, persistence, scheduling, and connector services. |
| Hub contract (`@cline/shared/hub-contract`) | Schemas for client commands, replies, and events; defines the WebSocket protocol. |
| Clients | CLI, desktop, VS Code, and SDK consumers that communicate with a Hub. |
| Desktop sidecar | Native desktop integration and remote connection orchestration, including discovery, SSH tunnels, and environment bindings. |

Host and Hub are not two servers. `cline-server` is a way to launch the existing Hub. The “runtime host” inside Hub architecture diagrams is the internal session execution component, not this package.

Dependency direction is `@cline/server → @cline/core → runtime dependencies`. Core must not depend on host: that would create a cycle. Clients can use core's client APIs without depending on the host executable; clients that distribute a host runtime can depend on the host package separately.

## Implemented today

- `@cline/server` provides a Node.js executable, without the interactive CLI/TUI. It still depends on the full agent runtime; total installation-size savings have not been measured.
- Node.js 22 or newer is required. Installing the package with Bun does not remove that requirement: the executable uses a Node shebang. Bun execution is not an established supported alternative.
- The commands are `--version`, `--help`, `--remote-hub-info`, `--remote-hub-ensure`, and `--remote-hub-stop`. Ensure and stop use `--discovery-path`; ensure can also receive `--cwd`.
- Ensure and stop operate on the explicit discovery record, separate from the default CLI-owned Hub. Ensure binds to loopback.
- Connector management is explicitly disabled for these explicitly managed remote Hubs to avoid interfering with another Hub's connectors.
- Scheduling already belongs to the Hub. Its definitions are persisted, but this remote Hub cannot execute schedules after it is shut down.
- The CLI already has an existing detached Hub lifecycle: its Hub can remain alive after the CLI exits. Persistent execution is an existing foundation, not something introduced by this package.
- SDK build, publishing, and package verification include host. Release wiring does not mean a package has been published. No CLI release is required to publish host through the SDK release process.

The CLI bundles `@cline/server/commands` and forwards `--remote-hub-*` commands through that API. This neither starts a Hub at install time nor guarantees a transitive `cline-server` executable is globally on PATH.

## Roadmap

### Desktop integration with installed runtimes

Replace bundled helper uploads with login-shell discovery of `cline-server`, falling back to a compatible `cline`. Probe remote command and Hub protocol versions plus a minimum core release before starting a tunnel. Report missing/incompatible installations with actionable instructions. Propagate cancellation through SSH startup and roll back partially started owned Hubs. Keep this integration separate from the shared-Hub lifecycle below.

### Shared persistent Hub ownership

Reuse the existing detached Hub lifecycle rather than inventing a new persistence or scheduling architecture. The target is one default shared Hub per remote account/data-directory scope, discoverable by all compatible clients. Explicitly isolated configurations can remain separate.

- CLI, desktop, VS Code, and SDK clients should attach to the same compatible Hub regardless of which client or host installation started it.
- Use common discovery, authentication, and startup locking so simultaneous connections converge on one Hub.
- Desktop disconnect should close its tunnel and release its client resources, leaving the shared Hub alive. Cancelling a connection must not stop a shared Hub, including one started during that attempt.
- Remove desktop's per-connection Hub ownership and shutdown cleanup once shared attachment is implemented. Keep cleanup of local SSH processes and tunnels.
- Provide explicit host start, status, stop, and restart administration. Stopping the shared Hub is a deliberate operation affecting all clients.
- Surviving a client disconnect is required. Automatic startup after an OS reboot is a separate, later service-management feature.

### Connectors and schedules

Keep scheduling in the Hub. The required change is keeping the Hub alive, not moving the scheduler.

- Enable connector management in the shared Hub, with a single owner for connector processes and scheduled execution.
- Remove CLI-dependent connector launch and cleanup paths by moving execution into the shared runtime, accessible through the host executable. A machine with only host installed must support these services.
- Ensure recovery and concurrent clients cannot create duplicate connector processes or duplicate scheduled runs.
- Preserve connector and schedule operation when every interactive client disconnects. Define shutdown/restart recovery explicitly.

### Shared installation discovery

- Discover a compatible running Hub first.
- If none exists, locate an available compatible host installation and start it. Define an explicit way to discover client-provided and desktop-managed installations; do not rely solely on PATH.
- If no suitable installation exists, offer installation.
- Multiple installed versions are allowed. Separate client distributions may contain separate copies; this must not imply multiple default running Hubs.
- Installing CLI must not silently replace a separately installed host. Core must remain independent of host packaging.

### Remote bootstrap and managed installation

Bundle a small bootstrap script with desktop and execute it on the **remote machine over SSH**. This script is an installer and prerequisite checker, not another agent server or a return to uploading an opaque helper runtime.

- Run read-only discovery and compatibility checks on connection.
- Offer **Install and connect** or **Update and reconnect**, showing what will be installed, before making installation changes.
- Make installation repeatable, concurrency-safe, and recoverable after interruption; verify downloaded artifacts and report structured progress/errors.
- Install into a private user-owned directory, without sudo, shell-profile edits, or replacing the user's Node/Bun installation.
- Reuse a suitable existing Node runtime where available; otherwise provision a private Node runtime and launch it by absolute path. Users should not have to install Node or the interactive CLI manually.
- Installing Bun alone is not the current solution. Bun execution would require explicit dependency and subprocess compatibility validation.
- Allow downloading artifacts locally and transferring them over SSH when the remote machine cannot reach the download service.
- A future platform-specific host distribution could include its runtime, similar to the managed server installation experience in VS Code Remote SSH. The bootstrap flow can remain the same while its download target changes.

A published host artifact is required before this normal installation flow can work. Source builds remain a development/testing option.

### Compatibility and upgrades

Package installation and running-Hub replacement are separate operations. Installing new files must not interrupt active work.

- Evolve acceptance toward protocol and required-capability compatibility rather than package-version equality or the current conservative core-version floor.
- Attach to a compatible running Hub even when client and host package versions differ. An available update should not block a compatible connection.
- If the Hub is too old, explain the installed and required versions and offer an update/restart. Do not silently launch a second default Hub.
- If a newer Hub cannot support an older client, require a client update; never downgrade that Hub automatically.
- Make the running version and owning installation/executable location available through discovery/status so clients can explain what is serving them and what needs updating.
- For managed installations, download and verify a new version in a separate directory, switch future launches atomically, and retain a previous installation for rollback. Define storage/schema compatibility before promising rollback of a running service.
- Treat user-managed installations separately: offer instructions or an explicit supported update action rather than silently replacing their installation.
- Coordinate restart through the Hub: stop admitting new work, finish active runs, persist state, restart, and reconnect clients. Offer **Restart when idle**; interruption requires an explicit choice. Account for connectors and schedules during this transition.

### Desktop transport

Sharing a Hub does not require removing the sidecar. The sidecar can discover/start the shared Hub and manage the SSH tunnel while retaining the current UI transport.

Direct UI-to-Hub WebSocket access is an optional later change. It would require endpoint/token handoff, authentication, and reconnection handling; native services would still be needed for SSH and desktop integrations. Implement shared-Hub reuse first.

### Migration sequence and validation

1. Establish shared discovery, startup locking, and persistent ownership using the existing detached Hub lifecycle.
2. Make connector execution independent of the CLI and validate single-owner connector/schedule behavior.
3. Switch client attachment and disconnect/cancellation behavior; remove desktop-owned Hub shutdown paths.
4. Add managed bootstrap installation and coordinated upgrades as separate deliverables.
5. Publish SDK/host artifacts before distributing desktop versions that require them.

Use reviewable changes for ownership, connector execution, and client migration. This is unreleased work: update call sites directly rather than keeping compatibility shims for the temporary desktop-owned design.

Validate concurrent startup, multiple client versions/installations, client disconnect, cancellation, SSH loss, Hub crashes, upgrade/restart recovery, and connector/schedule execution with no clients connected. Include machines without CLI, host, or Node installed and interrupted bootstrap installs.
