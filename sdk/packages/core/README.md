# `@cline/core`

`@cline/core` is the stateful orchestration layer of the Cline SDK. It composes
the Bedrock agent runtime with sessions, storage, built-in tools, plugins,
automation, and local or hub-backed execution.

The public runtime accepts only `providerId: "bedrock"`. AWS connection
settings are stored by `BedrockSettingsStore`, while credentials remain in the
AWS SDK credential chain.

Main host-facing entry points include:

- `ClineCore`
- `createRuntimeHost`
- `LocalRuntimeHost`, `HubRuntimeHost`, and `RemoteRuntimeHost`
- `DefaultRuntimeBuilder`
- `BedrockSettingsStore`

If `cwd` and `workspaceRoot` are omitted, the execution host uses the shared
chat workspace under the Cline data directory. Read the resolved paths from
the returned session manifest.

SDK workspace dependencies resolve through compiled `dist/` exports. Run
`bun run build:sdk` from the repository root after SDK source changes.
