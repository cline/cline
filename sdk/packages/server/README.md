# @cline/server

Headless Cline runtime for remote development. Requires Node.js 22 or newer on a Linux or macOS x64/arm64 SSH host. It includes the agent runtime, without the interactive CLI, TUI, or desktop UI.

Install on the remote machine:

```sh
bun add --global @cline/server
cline-server --version
```

The commands below start an authenticated Hub on loopback. Desktop discovery and SSH integration with installed server/CLI executables are a follow-up; desktop currently uses its bundled helper.

See [Architecture and roadmap](./ARCHITECTURE.md) for current ownership and the planned shared-Hub, installation, and upgrade behavior.

## Commands

```sh
cline-server --remote-hub-info
cline-server --remote-hub-ensure --discovery-path /absolute/path/to/hub.json --cwd /path/to/workspace
cline-server --remote-hub-stop --discovery-path /absolute/path/to/hub.json
```

Info and ensure print JSON for automation. Ensure starts or reuses the Hub owned by the specified discovery record. Stop affects only that record. Callers supply a dedicated record; these commands do not take over the default CLI-owned Hub.

## Development and release

From the repository root, run `bun install` and `bun run build:sdk`, then `node sdk/packages/server/dist/index.js --remote-hub-info`.

Run `bun -F @cline/server test` for command checks and `bun -F @cline/server test:e2e` for isolated Hub startup/reuse/shutdown (requires local loopback networking).

This package is versioned and published with the SDK, after `@cline/core`. Packed dependencies pin the matching core and shared release. SDK publishing includes the host package; no CLI release is required. Publishing is not part of a local build.

The CLI bundles `@cline/server/commands` and exposes the same remote commands, so integrations can invoke `cline` without relying on a globally accessible transitive `cline-server` binary.
