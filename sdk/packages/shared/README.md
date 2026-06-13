# [experimental] @cline/shared

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

`@cline/shared` owns shared cross-package primitives (session common types/utilities).

Node-only filesystem path resolvers live under the storage subpath export:

- `@cline/shared/storage`
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

It also exports cross-client runtime payload DTOs used by multiple hosts
(`@cline/cli`, `@cline/code`) so request/response contracts are not duplicated
outside transport wiring:

- chat runtime payloads (`ChatStartSessionRequest`, `ChatRunTurnRequest`, `ChatTurnResult`)
- provider runtime payloads (`ProviderActionRequest`, `ProviderCatalogResponse`, `ProviderOAuthLoginResponse`)
- Cline account action payloads (`ClineAccountActionRequest`)
- provider action requests include provider catalog/model operations plus provider add/save operations for settings hosts
- provider action payloads now expose granular request/type contracts for reuse:
  `AddProviderActionRequest`, `SaveProviderSettingsActionRequest`,
  `ProviderCapability`, and `OAuthProviderId`

Chat runtime payload notes:
- `ChatStartSessionRequest` supports `initialMessages`, optional `toolPolicies`, optional `rules` for default system prompt assembly, and optional `logger` runtime config (`RuntimeLoggerConfig`) so hosts can pass serialized logger settings across transport boundaries.
- `RuntimeLoggerConfig.bindings` lets hosts attach stable context fields (for example `clientId`, `clientType`, `clientApp`) to all runtime log records.

Provider media budgeting helpers live under the shared LLM exports so provider
request builders can enforce one media policy:

- Supported image media types: PNG, JPEG, GIF, and WebP.
- Raw base64 and matching `data:<type>;base64,...` image URLs are validated
  before provider formatting.
- Defaults cap a single image at 5 MiB encoded base64 and 6 MiB decoded bytes;
  the whole provider request has an 8 MiB aggregate media budget.
- Remote media URLs have unknown byte size at formatting time, so request
  builders charge them against the conservative per-image cap.
- Invalid or over-budget media is replaced with
  `[media omitted: invalid or exceeds size limit]`; callers can inspect
  `MediaBudgetState` counters and omission reasons when they keep that state.
