# [experimental] @clinebot/shared

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

`@clinebot/shared` owns shared cross-package primitives (session common types/utilities).

Node-only filesystem path resolvers live under the storage subpath export:

- `@clinebot/shared/storage`
- examples: `resolveClineDataDir`, `resolveDbDataDir`, `resolveSessionDataDir`, `resolveTeamDataDir`

It also exports cross-client logging contracts, including `BasicLogger`, so
runtime, SDK, and host applications can share a single logger type.

Session config primitives are also centralized here so hosts/runtimes can
compose one base shape instead of redefining similar fields repeatedly:

- `AgentMode`
- `SessionPromptConfig`
- `SessionWorkspaceConfig`
- `SessionExecutionConfig` (includes canonical `ToolPolicy` map shape)

It now also exports hook session context primitives used across agents/core/CLI:

- `HookSessionContext`
- `resolveHookSessionContext(...)`
- `resolveRootSessionId(...)`
- `resolveHookLogPath(...)`

It also exports cross-client RPC runtime payload DTOs used by multiple hosts
(`@clinebot/cli`, `@clinebot/code`) so request/response contracts are not duplicated
outside transport wiring:

- chat runtime payloads (`RpcChatStartSessionRequest`, `RpcChatRunTurnRequest`, `RpcChatTurnResult`)
- provider runtime payloads (`RpcProviderActionRequest`, `RpcProviderCatalogResponse`, `RpcProviderOAuthLoginResponse`)
- Cline account runtime payloads (`RpcClineAccountActionRequest`, `RpcClineAccountUser`, `RpcClineAccountBalance`)
- provider action requests include provider catalog/model operations plus provider add/save operations for settings hosts
- provider action payloads now expose granular request/type contracts for reuse:
  `RpcAddProviderActionRequest`, `RpcSaveProviderSettingsActionRequest`,
  `RpcProviderCapability`, and `RpcOAuthProviderId`

Chat runtime payload notes:
- `RpcChatStartSessionRequest` supports `initialMessages`, optional `toolPolicies`, optional `rules` for default system prompt assembly, and optional `logger` runtime config (`RpcChatRuntimeLoggerConfig`) so hosts can pass serialized logger settings to remote runtimes.
- `RpcChatRuntimeLoggerConfig.bindings` lets hosts attach stable context fields (for example `clientId`, `clientType`, `clientApp`) to all runtime log records.
- `RpcChatRunTurnRequest` supports `promptPreformatted` for callers that already built CLI-style user input envelopes.
