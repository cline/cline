# VSCode Extension → Cline SDK Migration Audit

> Status: **living document**. Updated 2026-06-21.
>
> **The extension host has now been demolished to a bare-bones inert shell** so it
> can be rebuilt from near-zero on the Cline SDK, the way `apps/cli` is. See
> [Bare-bones demolition](#bare-bones-demolition-2026-06-21) for exactly what was
> removed and what survived. The earlier sections below describe the architecture
> and the original incremental plan; they remain useful as the blueprint for the
> rebuild.

## TL;DR

The VSCode extension still carries a large amount of **provider-, model-, and
session-specific code that the Cline SDK is designed to own**. The CLI
(`apps/cli`) already proves the target architecture: it is a thin shell that
delegates *everything* — provider selection, auth, model catalog, session
lifecycle, the agent loop, persistence, streaming — to the SDK
(`@cline/core`, `@cline/llms`, `@cline/agents`). The extension should converge on
that same pattern.

This document inventories what should move to the SDK, what was removed in the
first pass, and a prioritized roadmap for the rest.

---

## Rebuilt on the SDK (2026-06-21)

After the demolition (below), the host was **rebuilt on the Cline SDK**, mirroring
how `apps/cli` consumes it. The extension now **builds on the SDK** — verified:
`bun run protos && tsc --noEmit` (host) ✅, webview `tsc --noEmit` ✅,
`bun esbuild.mjs` → `dist/extension.js` ✅, `bun run build` (vite webview) ✅.

### New SDK integration layer (`src/core/sdk/`)

| Module | Role |
|---|---|
| `session-manager.ts` | Wraps `ClineCore.create()` + `start`/`send`/`subscribe`/`abort` (mirrors the CLI's core lifecycle) |
| `session-config.ts` | Maps the legacy `ApiConfiguration` → SDK `CoreSessionConfig` (provider/model/key/reasoning) |
| `message-translator.ts` | Translates SDK `CoreSessionEvent`/`AgentEvent` → webview `ClineMessage[]` (text/reasoning/tool/usage/done/error), with SDK→classic tool-name mapping |
| `message-id-minter.ts` | `ts`/`seq`/`epoch` authority for the webview's convergent-replica merge protocol |
| `webview-bridge.ts` | Holds the active `subscribeToPartialMessage` + `subscribeToState` response streams and pushes to them |
| `state-store.ts` | `ApiConfiguration`/mode/history persisted via `context.globalState`/secrets; builds a valid `ExtensionState` |

The `Controller` (`src/core/controller/index.ts`) was rewritten to own these and
implement `initTask`/`askResponse`/`cancelTask`/`clearTask`/`getStateToPostToWebview`,
delegating all inference to the SDK. The critical-path gRPC handlers were re-wired
to it: `state/{subscribeToState,getLatestState}`, `task/{newTask,askResponse,cancelTask,clearTask}`,
`ui/{subscribeToPartialMessage,initializeWebview}`, `models/{listProviders,resolveProviderModels,updateApiConfiguration*}`.

### Verified vs not

- **Verified (builds):** host tsc, webview tsc, esbuild, vite, and `vsce package`
  all green.
- **Verified (runtime, real VS Code):** using the Playwright/Electron e2e harness
  (`closed-loop-extension` skill), two e2e tests pass in a real VS Code instance
  (`src/test/e2e/sdk-smoke.test.ts`):
  1. *renders the Cline webview* — extension activates, the webview mounts, the
     gRPC state subscription reaches the host, and the host returns a valid
     `ExtensionState` (the chat UI renders).
  2. *submits a chat message and starts a task through the SDK* — sending a
     message clears the input (proves `newTask` dispatched), and the task starts
     with a resolved provider/model (no empty-model error), exercising
     webview → gRPC → `Controller.initTask` → `ClineCore` → `CoreSessionEvent`
     → translator → render.
- **NOT yet verified:** a full assistant *response* rendering end-to-end. The
  default `cline` provider requires account auth (signin) and the cline endpoint
  routed to the mock; the MVP left account/auth and cline-endpoint routing inert,
  so the LLM call doesn't complete in the harness. Wiring those is the next step.
- **MVP scope:** secondary surfaces (MCP, checkpoints, browser, task-history
  persistence, plan/act switching, spawn-agent aggregation, account/auth) are
  minimal/inert but compile. They are the follow-on work to reach feature parity.

### Bugs found & fixed via the closed loop

- **Double `acquireVsCodeApi()`** crashed the webview's VS Code API/gRPC client
  (zero requests reached the host → blank UI). Made acquisition idempotent in
  `webview-ui/src/config/platform.config.ts` (cache on `window`, tolerate a throw).
- **Empty `modelId`** — `session-config` didn't default a model when the user
  hadn't selected one, so `ClineCore` rejected the session (Zod
  `model: expected string to have >=1 characters`). Now falls back to the SDK
  catalog default via `getProviderCollectionSync(...).provider.defaultModelId`
  (imported from `@cline/llms`, not `@cline/core`).
- **Packaging in a git worktree** — `vsce` can't follow the worktree's symlinked
  `dist` / `webview-ui/build` directories, and `.vscodeignore`'s trailing-slash
  entries didn't exclude symlinked-dir entries (`out`, `test-results`, …), so
  `secretlint` crashed with `EISDIR`. Dereferenced the two required dirs and added
  bare-name `.vscodeignore` entries for the worktree symlinks.
- A leftover empty interface (`ProviderCatalogController`) failed lint (blocked
  packaging) and then a naive fix broke types — aliased it to `Controller`.

---

## Bare-bones demolition (2026-06-21)

We decided to stop doing this incrementally and instead **gut the extension host
down to a minimal inert shell**, then rebuild it on the SDK like `apps/cli`. The
demolition was executed by a multi-agent workflow and verified to compile.

### Result

- **571 files changed · 752 insertions · 93,256 deletions** (363 files deleted,
  208 modified).
- **`tsc --noEmit` is green for both the host and the webview.**
  - Host check: `cd apps/vscode && bun run protos && bunx tsc --noEmit`
    (the `protos` step regenerates `src/generated/**`, which is a build artifact
    and not committed — you must run it before typechecking).
  - Webview check: `cd apps/vscode/webview-ui && bunx tsc --noEmit`.
- The webview UI is **fully intact** — it renders and you can click around, but
  every backend action is inert.

### The demolition seam

The webview talks to the host **only** through generated proto service clients
over a postMessage bridge, and never imports handler implementations. So the
strategy was:

1. **Decouple the handler layer.** Every gRPC handler under
   `src/core/controller/<group>/` was gutted to an inert stub that returns an
   empty/default proto response and imports nothing downward. This severed the
   handlers from all implementation.
2. **Delete the implementation** now that nothing references it.
3. **Rewrite the shell** (`extension.ts`, `common.ts`, `Controller`, `hosts/`)
   to the minimum needed to render the webview and route gRPC.
4. **Reconverge** with an iterative `tsc`-fix loop until host + webview were clean.

### What was deleted (entire areas)

- `src/sdk/**` (the entire SDK bridge — ~14.6k lines)
- `src/services/**` (mcp, auth, telemetry, feature-flags, … — ~12.6k lines)
- `src/integrations/**` (~4.5k lines)
- `src/core/task/**`, `src/core/context/**`, `src/core/hooks/**`,
  `src/core/storage/**`, `src/core/prompts/**`, `src/core/mentions/**`,
  `src/core/ignore/**`, `src/core/locks/**`
- Most of `src/hosts/vscode/**` (terminal, diff view, comment review,
  commit-message generation, file migrations, …)
- **All host-side test files** (`src/**/*.test.ts`, `src/__tests__`). Webview
  tests were kept.

### What survived (the shell)

- `src/extension.ts` — **760 → 106 lines**: HostProvider setup, storage context,
  register the sidebar webview provider, route gRPC. Throwing stubs for removed
  host creators (diff/terminal/review).
- `src/core/controller/` — `grpc-handler.ts`, `grpc-request-registry.ts`,
  `grpc-recorder/**`, `index.ts` (a **minimal inert `Controller`** with
  `any`-typed/no-op members), and all the **gutted handler files** (kept because
  the generated `protobus-services.ts` imports them by path; bodies return empty
  responses).
- `src/core/webview/**` — the `WebviewProvider` (slimmed to construct the minimal
  Controller and load the webview HTML).
- `src/hosts/` — `host-provider.ts`, `VscodeWebviewProvider.ts`, and the
  hostbridge client/handler needed for the webview + gRPC path.
- `src/shared/**` (incl. `src/shared/proto/**`), `src/generated/**`,
  `src/utils/**`, `src/registry.ts`, `src/config.ts` — kept (types + generated
  glue the webview and shell compile against).
- `webview-ui/**` — kept entirely (the inert UI).

### Caveats / not-yet-verified

- **Only `tsc` was verified.** The actual bundle builds
  (`bun esbuild.mjs` for the host, `bun run build:webview` for vite) and a real
  Extension-Development-Host launch have **not** been run yet. Compiling ≠ runs.
- `package.json` still declares many `commands`/menus whose handlers were removed.
  They'll be dead/no-op in the UI until cleaned up.
- The minimal `Controller` uses `any` in several places by design — this is
  throwaway scaffolding to be replaced by the SDK-backed implementation.

### Rebuilding on the SDK (next)

The shell is the foundation. Rebuild the host the way `apps/cli` does it
(`apps/cli/src/session/session.ts`, `apps/cli/src/runtime/run-agent.ts`): create a
`ClineCore`, `core.start()` sessions, `core.subscribe()` to events, and translate
those SDK events into the webview's gRPC/`ClineMessage` shape inside the surviving
handler/`Controller` layer. The (now empty) gRPC handlers are the exact insertion
points: re-implement each by delegating to `@cline/core` / `@cline/llms` instead of
the deleted in-extension code. The [target architecture](#the-target-architecture-what-the-cli-demonstrates)
table below is the contract for what the SDK should own.

---

## The target architecture (what the CLI demonstrates)

The CLI hands these responsibilities entirely to the SDK and keeps zero
provider-specific code:

| Responsibility | SDK owner |
|---|---|
| Provider selection / settings persistence | `ProviderSettingsManager` (`@cline/core`) |
| Provider auth / OAuth flows | `@cline/core/auth/*`, `getProviderAuthHandler()` |
| API handler creation (per-protocol HTTP) | `createHandler()` (`@cline/llms`) |
| Model catalog (ids, pricing, context windows) | `getProviderCollection()`, `resolveProviderConfig()` (`@cline/llms`) |
| Session start / resume / events | `ClineCore.create()/start()/send()/subscribe()` (`@cline/core`) |
| Agent loop (model → tools → repeat) | `Agent` / `AgentRuntime` (`@cline/agents`) |
| Conversation history & persistence | `CoreSessionService`, `persistence-service.ts` (`@cline/core`) |
| Context window mgmt / truncation / tokens | `MessageBuilder` (`@cline/core`) |
| Checkpoints / restore | `SessionVersioningService` (`@cline/core`) |
| MCP servers | `createMcpTools()`, `InMemoryMcpManager` (`@cline/core`) |

The CLI's consumer pattern (see `apps/cli/src/session/session.ts`,
`apps/cli/src/runtime/run-agent.ts`, `apps/cli/src/main.ts`):

```
ClineCore.create({ clientName, backendMode, ... })
  → core.start({ config, prompt, localRuntime })
  → core.subscribe(sessionId, event => render(event))
```

**Already done well in the extension:** the legacy per-provider *API handlers*
are gone. `src/core/api/index.ts` is types-only and all inference routes through
`@cline/llms` via `apps/vscode/src/sdk/sdk-api-handler.ts`. The remaining work is
mostly in the **webview settings UI**, the **model-refresh/catalog layer**, and
**proto/config conversion**.

---

## The core anti-pattern: per-provider files

The headline divergence from the CLI is that the extension has **one file (often
several) per provider**:

- **`webview-ui/src/components/settings/providers/*Provider.tsx`** — ~35 bespoke
  settings components (`AnthropicProvider.tsx`, `BedrockProvider.tsx`,
  `GroqProvider.tsx`, …), ~6,000 lines.
- **`webview-ui/src/components/settings/*ModelPicker.tsx`** — ~10 bespoke model
  pickers (`OpenRouterModelPicker.tsx`, `GroqModelPicker.tsx`, …), ~3,200 lines.
- **`src/core/controller/models/refresh*.ts` / `get*Models.ts`** — ~23
  per-provider model-refresh RPC handlers, ~2,350 lines.

The replacement already exists and works: **`GenericProviderSettings.tsx`** is a
fully-featured, catalog-driven settings shell (API key, optional base URL,
model picker, reasoning selector, model info) that takes only a `providerId` plus
presentation metadata. It pulls its model list from the unified
`resolveProviderModels` RPC (`useProviderModels(providerId)`), i.e. the SDK
catalog — not from per-provider state.

`providers/providerSettingsRegistry.ts` is the cutover mechanism:

- `CUSTOM_PROVIDER_SETTINGS_IDS` — providers that *still* have bespoke UIs.
- `getGenericProviderSettings(id, listing)` — builds generic settings from an SDK
  `ProviderListing` (requires `protocol ∈ {anthropic, gemini, openai-chat,
  openai-responses}`).
- `getFallbackGenericProviderSettings(id)` — static fallback so a generic
  provider renders **before** SDK listings load.

In `ApiOptions.tsx`, providers mid-migration are dispatched with a
`&& !genericProviderSettings` guard, meaning the bespoke component is now just a
**pre-listing fallback**. Completing a provider's migration =
make the generic path always resolve, then delete the fallback component, its
model picker, its dispatch block, and its import.

---

## What was removed this pass

Three providers were fully cut over to the generic SDK-driven path and their
bespoke code deleted. These were chosen because they were already dual-pathed
(`&& !genericProviderSettings`) and have simple API-key-only config.

**Deleted (6 files, ~1,066 lines):**

- `webview-ui/src/components/settings/providers/GroqProvider.tsx`
- `webview-ui/src/components/settings/providers/BasetenProvider.tsx`
- `webview-ui/src/components/settings/providers/VercelAIGatewayProvider.tsx`
- `webview-ui/src/components/settings/GroqModelPicker.tsx`
- `webview-ui/src/components/settings/BasetenModelPicker.tsx`
- `webview-ui/src/components/settings/VercelModelPicker.tsx`

**Modified:**

- `providers/providerSettingsRegistry.ts` — added `groq`, `baseten`,
  `vercel-ai-gateway` to `FALLBACK_GENERIC_PROVIDER_NAMES` so the generic path
  *always* renders for them (no dependency on the catalog listing being loaded).
- `ApiOptions.tsx` — removed the 3 imports and the 3 `selectedProvider === …`
  dispatch blocks. These providers now fall through to the single
  `genericProviderSettings && <GenericProviderSettings … />` block.
- `context/ExtensionStateContext.tsx` — updated a now-stale comment about
  `BasetenModelPicker`; flagged the legacy `refreshBasetenModelsRpc` /
  `basetenModels` state as orphaned (see follow-ups).
- `providers/providerSettingsRegistry.test.ts` — added fallback assertions for
  the 3 migrated providers.

**Verification:** `tsc -b` clean; `vitest run src/components/settings/` →
10 files / 87 tests passing.

> ⚠️ **Runtime check still recommended.** Typecheck + unit tests confirm the
> wiring, but the settings UI for these 3 providers should be smoke-tested in a
> running extension host (open Settings → select Groq / Baseten / Vercel AI
> Gateway → confirm API-key field, model picker, and model selection persist).

**Orphaned-but-left (intentional, to keep this pass small):** the legacy
per-provider model-refresh plumbing for baseten/vercel (`refreshBasetenModelsRpc`,
`setBasetenModels`, and the analogous vercel state in `ExtensionStateContext.tsx`
+ `src/core/controller/models/refresh*.ts`) is no longer consumed by the UI but
was not removed here — it touches RPC services and shared state. Queued under
[Roadmap §3](#3-per-provider-model-refresh-layer).

---

## Roadmap (prioritized)

Ordered by value/risk. Each item notes whether it can be done **extension-only**
or **needs SDK changes** (deferred per this pass's scope).

### 1. Finish migrating "simple" providers to `GenericProviderSettings`

**Extension-only. Low risk. High value.** Same recipe as this pass. Candidates
that are already dual-pathed or API-key-only and likely covered by the generic
shell + SDK catalog:

- `huggingface` (already `&& !genericProviderSettings` guarded — next easiest)
- `xai`, `zai`, `qwen`, `moonshot`, `aihubmix`, `asksage`, `dify`, `requesty`

Recipe per provider:
1. Confirm SDK `ProviderListing.protocol` is one of the generic protocols (or add
   to `getFallbackGenericProviderSettings`).
2. Add to `FALLBACK_GENERIC_PROVIDER_NAMES` (+ overrides for base URL / signup).
3. Delete `*Provider.tsx`, its `*ModelPicker.tsx`, the dispatch block, the import.
4. `tsc -b` + settings tests + runtime smoke test.

### 2. Collapse the `ApiOptions.tsx` dispatch chain

**Extension-only. Medium risk.** Today it's a ~30-branch
`selectedProvider === "x" && <XProvider/>` ladder. As §1 empties it, the file
should converge to: `genericProviderSettings ? <GenericProviderSettings/> :
<remaining custom providers>`. The genuinely-custom set that needs bespoke UI
(multi-field auth, special flows) is small: `bedrock`, `vertex`, `sapaicore`,
`oca`, `openai` (compatible), `lmstudio`, `ollama`, `vscode-lm`, `cline`,
`cline-pass`, `claude-code`, `openai-codex`.

### 3. Per-provider model-refresh layer

**Needs SDK alignment. Medium/high value.** `src/core/controller/models/`
contains ~23 `refresh*Models.ts` / `get*Models.ts` handlers that fetch model
lists from provider APIs. The SDK's unified `resolveProviderModels` RPC +
`@cline/llms` catalog is meant to own live model discovery. Migrate consumers to
the unified RPC, then delete the per-provider handlers and their
`ExtensionStateContext` state (`basetenModels`, `vercelAiGatewayModels`,
`groqModels`, `openRouterModels`, …). The orphaned baseten/vercel state from this
pass is the first cleanup here.

### 4. ApiConfiguration ↔ proto conversion & provider type unions

**Needs SDK changes (deferred).** `src/shared/proto-conversions/models/`
(~1,000 lines, esp. `api-configuration-conversion.ts` at ~800) and the provider
type unions / model metadata in `src/shared/api.ts` + `src/shared/providers/*.json`
duplicate what the SDK's `ProviderConfig` / catalog already model. The extension
should consume SDK provider/config types directly rather than maintaining a
parallel `ApiConfiguration` shape. **SDK gap:** needs the SDK to expose its
provider config + listing metadata richly enough that the webview can drive all
settings UIs from it. Document the exact fields needed, then implement on the SDK
side in a follow-up.

### 5. In-extension model catalog (`src/sdk/model-catalog/`)

**Needs SDK changes (deferred).** ~3,000 lines (`catalog.ts`, `store.ts`,
`effective-config.ts`, `contracts.ts`, `shape-adapter.ts`, …) that re-derive an
effective model/provider config inside the extension. Much of this is a shim that
exists because the SDK catalog isn't yet consumed end-to-end. As §3/§4 land, this
layer should shrink to a thin host adapter or disappear.

### 6. Session / task / state overlap

**Mostly SDK-owned already; keep VSCode glue.** The agent loop, context-window
management, truncation, and token counting are already owned by the SDK
(`@cline/agents` `agent-runtime.ts`, `@cline/core` `message-builder.ts`,
`session-runtime-orchestrator.ts`). The extension's `src/sdk/*` is largely a
legitimate bridge (webview gRPC, VSCode UI concerns). Candidates to consolidate
*into* the SDK over time (deferred — needs SDK changes):

- `src/sdk/sdk-task-history.ts` (~747) overlaps `persistence-service.ts` /
  `session-data.ts`.
- `src/sdk/tool-approval-denial.ts` + `sdk-tool-policies.ts` — tool policy logic
  the SDK could own generically.
- `src/core/hooks/*` + `src/sdk/hooks-adapter.ts` overlap the SDK hook system.

Keep in the extension (genuinely VSCode-specific): `message-translator.ts`
(webview message format), `StateManager.ts` (VSCode storage), the
`sdk-*-coordinator.ts` bridge layer, `vscode-run-commands-tool.ts` (terminal),
`McpHub.ts` (connection lifecycle), `vscode-lm/*` (GitHub Copilot models).

---

## Appendix: key files

- Generic settings shell: `webview-ui/src/components/settings/providers/GenericProviderSettings.tsx`
- Cutover registry: `webview-ui/src/components/settings/providers/providerSettingsRegistry.ts`
- Provider dispatch: `webview-ui/src/components/settings/ApiOptions.tsx`
- Unified model RPC hook: `webview-ui/src/hooks/useProviderModels.ts`
- SDK API handler bridge: `apps/vscode/src/sdk/sdk-api-handler.ts`
- Session factory: `apps/vscode/src/sdk/cline-session-factory.ts`
- CLI reference (target pattern): `apps/cli/src/session/session.ts`, `apps/cli/src/runtime/run-agent.ts`
