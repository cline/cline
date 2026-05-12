# SDK-backed Model Catalog Design Notes (Temporary)

> Temporary working note. This captures current learnings and a proposed architecture for moving VSCode extension model lists/defaults behind the SDK-backed host-side model catalog.

## Summary

The VSCode extension should get out of the model-catalog business wherever possible. The desired end state is:

- The **SDK** owns provider model catalogs, defaults, and provider-specific dynamic model resolution where feasible.
- The **extension host** is the canonical bridge between VSCode/webview state and the SDK.
- The **webview** does not import SDK packages and does not bundle model catalogs. It asks the extension host for provider models.
- Some providers remain host/extension-specific because they require host APIs or bespoke authentication/inference behavior. These should still sit behind the same model-catalog interface so the webview has one model-loading path.

This creates a dialectric architecture:

1. **SDK-supported providers**: model list/defaults/dynamic fetching should come from SDK APIs.
2. **Host-specific or extension-specific providers**: the extension host resolves them, but behind the same service contract.
3. **Compatibility, adaptivions**: existing extension fetchers/hardcoded maps can remain only as last-resort migration scaffolding, with logging, until SDK coverage catches up. Meanwhile, some things simply must live in the extension for example the archetypal configuration UIs for SDK-supported providers, because I believe they are not self-describing and we want to have a first class UX for configuring the SDK-supported providers in the webview.

## Current Findings

### Published SDK packages

There are two relevant npm scopes:

- `@cline/*`
  - Example: `@cline/llms@0.0.38`
  - Published package still contains internal dependencies like `"@cline/shared": "workspace:*"`.
  - This fails under normal `npm install` outside the SDK monorepo with `EUNSUPPORTEDPROTOCOL`.
- `@clinebot/*`
  - Example: `@clinebot/llms@0.0.38`
  - Published dependencies are rewritten/pinned, e.g. `"@clinebot/shared": "0.0.38"`.
  - This is installable from npm and appears to be the external-consumer scope.

Recommendation for VSCode extension consumption: use `@clinebot/*`, not `@cline/*`, so we do not depend on publishing process changes.

### SDK model catalog boundary

The extension should treat the SDK as the model-catalog authority and should not encode SDK implementation details (generated catalog vs provider collection vs live fetch) in webview or provider components.

The host-side resolver may need to call multiple SDK APIs internally, but that is an implementation detail of the host adapter. The extension-facing contract should be simply:

```ts
resolveProviderModels(providerId, effectiveProviderConfig) => {
  models,
  defaultModelId,
  source,
}
```

The SDK decides, as much as possible, whether a provider's model list comes from a live/dynamic fetch or a prebaked/bundled catalog. If the SDK does not yet expose a single API with the exact desired behavior, the extension host should wrap the SDK APIs behind one local adapter and avoid leaking that distinction to the webview.

### SDK dynamic model fetching

The SDK has dynamic model-fetching mechanics, but provider support varies.

Observed SDK/core behavior:

- Dynamic/public fetching is tied to provider metadata like `modelsSourceUrl`.
- Ollama and LM Studio are examples where `modelsSourceUrl` is configured.
- DeepSeek does **not** currently appear wired to fetch `https://api.deepseek.com/v1/models`; its 4-model list comes from the bundled generated catalog.
- Some providers may need auth/private fetchers through SDK core rather than `@clinebot/llms` alone.

Implication: if the extension wants “SDK dynamic if available, SDK bundled otherwise,” the extension host should call the SDK model-resolution layer that has access to provider config and model catalog behavior. If `@clinebot/core` exposes the right function, prefer that; otherwise the extension host can wrap lower-level SDK APIs as a temporary adapter, but webview/feature code should not care which SDK surface was used.

### Current dependency status in this branch

The VSCode extension already has SDK runtime dependencies in `package.json`:

- `@clinebot/core`: `^0.0.38`
- `@clinebot/llms`: `^0.0.38`

So the model-catalog work should **reuse the existing SDK dependency** rather than adding a new package. The earlier concern about npm-installing `@cline/llms` does not apply to this branch as long as we use the `@clinebot/*` packages.

Avoid expanding discussion of `@cline/llms` internals in implementation docs. The only user-relevant packaging detail is: use `@clinebot/*` packages, not `@cline/*`, because current `@cline/*` packages contain `workspace:*` dependencies that are not npm-installable outside the SDK monorepo.

## Current Extension Situation

`src/shared/api.ts` currently contains many hardcoded model maps and defaults, e.g.:

- `anthropicModels`, `anthropicDefaultModelId`
- `bedrockModels`, `bedrockDefaultModelId`
- `geminiModels`, `geminiDefaultModelId`
- `openAiNativeModels`, `openAiNativeDefaultModelId`
- `deepSeekModels`, `deepSeekDefaultModelId`
- many others

The webview imports these maps directly in provider settings components and in `providerUtils.ts`. This makes the webview a model-catalog owner and prevents consistent dynamic resolution from the host/SDK.

There are also many provider-specific RPCs in `proto/cline/models.proto`, e.g.:

- `refreshOpenRouterModelsRpc`
- `refreshClineModelsRpc`
- `refreshGroqModelsRpc`
- `refreshBasetenModelsRpc`
- `refreshLiteLlmModelsRpc`
- `getOllamaModels`
- `getLmStudioModels`
- `refreshOpenAiModels`
- `refreshOcaModels`
- etc.

These should eventually be replaced or wrapped by a single provider model catalog RPC.

## Critical Code Review Findings / Holes in the Initial Plan

The initial plan was directionally right but underspecified around state consistency and cache identity. The following issues must be designed out up front.

### 1. Torn state between settings updates and model refreshes

Current webview code often does:

1. update a setting, e.g. `ollamaBaseUrl`;
2. separately start a model refresh;
3. model refresh reads whichever config the host happens to have at that moment.

This can tear in several ways:

- The refresh reaches the host before the settings update is applied, so it fetches with the old base URL.
- The refresh uses a closure over an old webview `apiConfiguration` snapshot.
- A slow response for old config arrives after a fast response for new config and overwrites the model list.
- The host cache is keyed only by provider, so a response fetched for `http://localhost:11434` can be served after the user switches to `http://tailscale-host:11434`.

The existing `useApiConfigurationHandlers.handleFieldChange()` warns about stale merges when called rapidly. This is directly relevant to model-catalog refreshes: model-affecting fields must not use stale full-config writes.

### 2. Existing model caches are provider-only

`StateManager` currently caches dynamic models under keys like:

- `openRouterModels`
- `groqModels`
- `basetenModels`
- `liteLlmModels`
- `vercelModels`

These caches do not include a config fingerprint. That is unsafe for providers whose model list depends on:

- base URL (`ollama`, `lmstudio`, `litellm`, OpenAI-compatible, Dify, Aihubmix);
- API key/account/entitlements (`groq`, Baseten, LiteLLM, Hugging Face, OCA, SAP AI Core, etc.);
- API line/region/mode (`qwenApiLine`, `zaiApiLine`, `moonshotApiLine`, AWS/Vertex regions, OCA mode).

The new model catalog cache must be keyed by an explicit config fingerprint, not just provider id.

### 3. Existing in-flight refresh promises are provider-only

Several fetchers use module-level `pendingRefresh` promises keyed only by provider. That prevents duplicate requests, but it also means a request for old config can be reused by a request for new config.

Example: user changes LiteLLM base URL while an old LiteLLM refresh is in flight. A provider-only pending promise would incorrectly satisfy the new request with old data.

The new in-flight map must be keyed by the same config fingerprint as the cache.

### 4. Webview currently cannot validate response freshness

Current webview model states like `openRouterModels`, `liteLlmModels`, `basetenModels` store only the model map. They do not store:

- request id;
- config fingerprint;
- source;
- started/finished timestamp;
- error state.

Therefore the webview cannot know whether an incoming model list corresponds to the current base URL/API key/provider options.

The new response must include an opaque `config_fingerprint` and `request_id`, and the webview must ignore stale responses.

### 5. Disk caches are also config-insensitive and likely unnecessary

Some existing dynamic fetchers write cache files like `groqModels`, `basetenModels`, etc. These are provider-global and therefore unsafe for config-dependent model lists.

Recommendation: **do not introduce new disk caches for provider model catalogs**. Prefer:

- SDK bundled/prebaked catalog for fast/offline fallback;
- in-memory config-fingerprint cache for dynamic results;
- SDK's own cache behavior if/when the SDK owns dynamic fetching.

If an existing disk cache remains during migration, treat it as last-resort stale fallback only, never as authoritative for a changed config. Delete provider model disk caches as soon as the unified in-memory cache + SDK fallback path exists.

### 6. Local provider polling amplifies races

Ollama currently polls every 2 seconds and LM Studio every 6 seconds from their settings provider components while those components are mounted. This is not global/background polling all the time, but 2 seconds is still aggressive and can amplify stale-response races while the settings UI is open.

With host-side SDK resolution, direct component polling should be removed or centralized. If any polling remains, it must:

- be scoped to the visible settings panel;
- use request IDs/config fingerprints;
- pause/cancel when the base URL changes;
- back off on repeated failures;
- never overwrite a newer config's model list.

### 7. SDK resolution must be treated as an abstraction

Provider defaults and model-list sources are SDK concerns. The extension should not care whether the SDK used a live fetch, a models.dev snapshot, a provider registry collection, or another source.

The host adapter does need to be careful if the SDK does not yet expose one canonical model-resolution function. But the desired interface remains: ask SDK/core for provider models/defaults using effective provider config, then return the resulting models/default to the webview.

If the host adapter must compose lower-level SDK calls temporarily, that should be isolated in one module and treated as SDK glue, not as extension model-catalog logic.

### 8. Runtime API handlers also need model info

The plan cannot stop at settings UI. Runtime providers (`src/core/api/providers/...`) call `getModel()` and often use model metadata for request shaping/cost/reasoning behavior. If the webview uses SDK models but runtime handlers still use old hardcoded maps, UI and execution can diverge.

The host-side model catalog service should be reusable by runtime providers, or there must be a shared host-side catalog cache/API so runtime model lookup and webview model lookup are consistent.

### 9. Remote config and enterprise policy can override local state

StateManager has a separate `remoteConfigCache`, and remote-configured providers/keys/base URLs can lock fields. Model catalog fingerprints must include effective config after remote config is applied, not merely raw user settings.

### 10. Secrets are async-persisted but cache-updated immediately

StateManager updates its in-memory cache immediately and persists to disk later. The model resolver should read from StateManager's cache, not from disk, so a refresh after an awaited settings update sees the new secret/base URL even before disk persistence completes.

### 11. Multiple windows have independent StateManager caches

StateManager explicitly does not sync live settings across multiple VS Code windows. Model catalog caches should be treated as per-window, in-memory state. Do not assume a model list fetched in one window is valid/current in another.

### 12. Version skew between SDK packages and extension expectations

The SDK package already exists in this branch, but SDK catalog/default semantics can change independently. The extension should log SDK package version/source and tolerate missing SDK support for providers during migration.

## Proposed Architecture

### Single host-side model catalog gateway

Add one canonical RPC, conceptually:

```proto
message ProviderModelsRequest {
  string provider_id = 1;
  bool force_refresh = 2;
  // Optional: set by webview when it already knows the config fingerprint it expects.
  // The host is still authoritative and recomputes it.
  string expected_config_fingerprint = 3;
}

message ProviderModelsResponse {
  string provider_id = 1;
  string default_model_id = 2;
  map<string, OpenRouterModelInfo> models = 3;
  string source = 4;
  string error = 5;
  string config_fingerprint = 6;
  string request_id = 7;
  int64 fetched_at = 8;
  bool stale = 9;
}

rpc getProviderModels(ProviderModelsRequest) returns (ProviderModelsResponse);
```

The exact proto types can be adjusted to reuse existing `OpenRouterCompatibleModelInfo`, but the response should include a `default_model_id` eventually. The default should come from SDK provider metadata when possible.

### Consistency invariants

The model catalog system must satisfy these invariants:

1. **Model list identity includes provider config.** A model list is not just “models for Ollama”; it is “models for Ollama at base URL X with auth identity Y and region/options Z.”
2. **No stale response may overwrite newer state.** Every request/response pair carries a `request_id` and `config_fingerprint`; the webview only applies a response if it still matches the latest request for that provider.
3. **Settings update and refresh are ordered.** If a user changes a model-affecting setting, the host must apply the setting before resolving models for that setting.
4. **Host recomputes the fingerprint.** The webview can pass an expected fingerprint for debugging/guarding, but the host is authoritative because it owns effective settings, secrets, and remote config.
5. **Cache and in-flight keys match response identity.** Cache keys and pending promise keys use the same fingerprint that is returned to the webview.
6. **Runtime and webview use the same catalog source.** The model map used to render pickers and the model info used to build runtime API requests must come from the same host-side resolver/cache.

### Data flow

```text
webview provider settings UI
  -> update model-affecting setting, if any
  -> wait for host ack / returned state revision
  -> refreshProviderModels(providerId, { forceRefresh, expectedConfigFingerprint })
  -> ModelsService.getProviderModels({ providerId, forceRefresh, expectedConfigFingerprint })
  -> extension host reads effective StateManager apiConfiguration/secrets/remote config
  -> host computes config fingerprint
  -> host builds SDK ProviderConfig
  -> host asks SDK for provider models/defaults
  -> host adapts SDK ModelInfo shape to extension/webview ModelInfo shape
  -> response includes request_id + config_fingerprint + source
  -> ExtensionStateContext applies response only if it matches latest provider request/fingerprint
  -> webview renders model picker from providerModelsByProvider[providerId]
```

The webview should not import `@clinebot/llms/browser` unless we later intentionally choose a browser fallback. Current preference: no SDK in webview.

## Provider Categories

### 1. SDK-supported, simple cloud providers

These should be resolved primarily by SDK catalog/default APIs and dynamic SDK fetchers where available.

Examples:

- Anthropic
- DeepSeek
- Gemini
- OpenAI Native
- OpenRouter
- xAI
- Moonshot
- Minimax
- Groq
- Cerebras
- Nebius
- Hugging Face
- Fireworks
- WandB
- Vercel AI Gateway
- Requesty
- Together
- Baseten

Host responsibility:

- read API key from existing extension state/secrets;
- pass `providerId`, selected model id, key, and any configured base URL to SDK;
- adapt response shape.

### 2. SDK-supported or partially-supported local/base-url providers

These require user-provided base URLs and possibly API keys.

Examples:

- Ollama
- LM Studio
- LiteLLM
- OpenAI-compatible/custom OpenAI endpoint
- Dify
- Aihubmix

Host responsibility:

- read latest base URL from `StateManager` (`ollamaBaseUrl`, `lmStudioBaseUrl`, `liteLlmBaseUrl`, etc.);
- normalize when needed;
- include base URL in SDK provider config;
- ensure cache keys include base URL identity;
- on base URL changes, force refresh.

Example Ollama flow:

```text
User edits Ollama base URL in webview
  -> settings update persists ollamaBaseUrl
  -> webview calls refreshProviderModels("ollama", forceRefresh=true)
  -> host reads current ollamaBaseUrl
  -> host passes it to SDK
  -> SDK resolves/fetches models from that endpoint
  -> webview updates model picker
```

### 3. Region/API-line providers

These need extra provider-specific config in addition to API key/base URL.

Examples:

- Qwen (`qwenApiLine`: China vs international)
- Z.AI (`zaiApiLine`: China vs international)
- Moonshot (`moonshotApiLine`)
- Minimax (`minimaxApiLine`)
- AWS Bedrock / Vertex style regions and flags

Host responsibility:

- map extension-specific fields into SDK provider config if SDK supports them;
- otherwise use a temporary compatibility implementation behind the same RPC;
- avoid webview-side hardcoded switching where possible.

### 4. Host-specific or extension-specific providers

These may never be purely SDK-owned because they depend on VSCode host APIs, extension auth services, or internal/enterprise behavior.

Examples:

- `vscode-lm`: depends on VSCode LM APIs.
- `oca`: depends on OCA auth service, mode, endpoint, `/v1/model/info`, and extended metadata.
- Possibly SAP AI Core if its deployment discovery remains extension-specific.
- Cline provider may remain special due to feature flags, Cline API endpoint behavior, and recommended/free model UX.

Host responsibility:

- implement these directly, but behind the same `getProviderModels` contract;
- expose the same response shape to webview;
- avoid per-provider webview code paths.

## Fallback Strategy

The fallback ladder should be explicit and logged.

### Preferred ladder

```text
1. SDK dynamic/live resolution using current provider config
2. SDK bundled/generated catalog
3. Existing extension dynamic fetcher, for providers not yet represented in SDK
4. Existing extension hardcoded map, last resort only
5. Empty/error response
```

### SDK dynamic/live resolution

Use when SDK has dynamic model source/fetcher support for the provider and current config contains what it needs.

Inputs can include:

- API key / access token
- base URL
- model catalog config
- region / API line / provider-specific options

### SDK bundled/generated catalog

Permanent fallback. This is still SDK-owned, not extension-owned.

For DeepSeek, this is currently the useful path that exposes the 4-model list.

### Existing extension dynamic fetcher

Temporary compatibility for provider-specific logic that already exists in the extension and is not yet in the SDK.

Current examples:

- OpenRouter model refresh with extension-specific Claude 1M variants.
- Cline model refresh and feature-flag fallback to OpenRouter.
- Groq, Baseten, Hugging Face, Requesty, Vercel AI Gateway fetchers.
- LiteLLM fetcher if SDK does not yet fully match extension behavior.
- OpenAI-compatible `/models` fetcher.
- SAP AI Core deployment fetcher.
- Aihubmix/Hicap provider-specific fetchers.

These should be wrapped by the unified host service, not called directly from webview long-term.

### Existing hardcoded extension maps

Last-resort migration fallback only.

Use when:

- SDK returns no models;
- no SDK dynamic fetcher is available;
- no existing dynamic extension fetcher is available;
- and provider would otherwise be unusable.

Log loudly:

```text
Using legacy hardcoded model fallback for provider=<providerId>; SDK returned no models.
```

Goal: reduce this fallback to zero over time, except perhaps host-only providers.

## Provider Configuration Mapping

The host must build SDK-compatible provider config from the extension’s `ApiConfiguration` / `StateManager`.

The host should build this from **effective** configuration, not just the raw webview object:

1. global/task/session settings from `StateManager.getApiConfiguration()`;
2. secrets from StateManager cache;
3. remote-config overlays/locked fields;
4. provider-specific auth services (e.g. OCA/Cline OAuth tokens);
5. mode-specific selected model if needed.

This mapping should return both:

```ts
{
  providerConfig: SdkProviderConfig
  fingerprintInputs: Record<string, string | boolean | number | undefined>
}
```

Do **not** compute the fingerprint from a partial update payload. Compute it from the same effective config that will be used for resolution.

Examples:

### DeepSeek

```ts
{
  providerId: "deepseek",
  modelId: selectedModelId,
  apiKey: apiConfiguration.deepSeekApiKey,
  baseUrl: "https://api.deepseek.com/v1",
}
```

Fingerprint inputs:

```text
providerId=deepseek
apiKeyHash=<hash/deepseekApiKey or none>
baseUrl=https://api.deepseek.com/v1
```

### Ollama

```ts
{
  providerId: "ollama",
  modelId: selectedModelId,
  apiKey: apiConfiguration.ollamaApiKey,
  baseUrl: apiConfiguration.ollamaBaseUrl ?? "http://localhost:11434/v1",
}
```

Need care around whether the SDK expects Ollama base URL with or without `/v1`. The SDK model-source helper can resolve from provider defaults and `modelsSourceUrl`, so the host should pass the user’s configured base URL consistently and test URL rewriting.

Fingerprint inputs:

```text
providerId=ollama
baseUrl=<normalized user or default base URL>
apiKeyHash=<hash/ollamaApiKey or none>
```

Do not serve cached Ollama models across base URLs. If the user changes `ollamaBaseUrl`, the previous model list must be marked stale/hidden until a matching response arrives, except where the UI explicitly offers manual model entry.

### LM Studio

```ts
{
  providerId: "lmstudio",
  modelId: selectedModelId,
  baseUrl: apiConfiguration.lmStudioBaseUrl ?? "http://localhost:1234/v1",
}
```

Fingerprint inputs:

```text
providerId=lmstudio
baseUrl=<normalized user or default base URL>
```

LM Studio additionally returns loaded/max context metadata today. If SDK metadata does not include this, keep host-side dynamic metadata as part of the response, but still guard it with the same fingerprint.

### LiteLLM

```ts
{
  providerId: "litellm",
  modelId: selectedModelId,
  apiKey: apiConfiguration.liteLlmApiKey,
  baseUrl: apiConfiguration.liteLlmBaseUrl ?? "http://localhost:4000/v1",
}
```

Fingerprint inputs:

```text
providerId=litellm
baseUrl=<normalized liteLlmBaseUrl>
apiKeyHash=<hash/liteLlmApiKey or none>
```

LiteLLM model lists can vary by key and server; provider-only cache is unsafe.

### Qwen/Z.AI style API-line providers

```ts
{
  providerId: "qwen",
  modelId: selectedModelId,
  apiKey: apiConfiguration.qwenApiKey,
  apiLine: apiConfiguration.qwenApiLine,
}
```

Only if SDK supports `apiLine`; otherwise route through compatibility logic.

Fingerprint inputs:

```text
providerId=qwen
apiLine=<china|international|unset>
apiKeyHash=<hash/qwenApiKey or none>
```

Region/API-line fields must be included in both the cache key and the webview freshness guard.

## Atomic Update + Refresh Protocol

To avoid torn settings/model state, model-affecting setting changes need an atomic pattern.

### Problematic pattern to avoid

```ts
handleFieldChange("ollamaBaseUrl", newUrl) // async, not awaited or not state-acknowledged
refreshProviderModels("ollama")            // may read old base URL on host
```

Also avoid building a refresh request from a stale React `apiConfiguration` closure.

### Required pattern

Use one of these approaches.

#### Option A: await settings update, then refresh

```ts
await updateApiConfigurationField("ollamaBaseUrl", newUrl)
await refreshProviderModels("ollama", { forceRefresh: true })
```

The update RPC must not resolve until the host has updated StateManager's in-memory cache. Disk persistence can remain debounced.

#### Option B: combined host RPC for model-affecting setting update + refresh

Preferred for base URL/API key fields that immediately drive model fetches:

```proto
rpc updateProviderModelConfigAndRefresh(UpdateProviderModelConfigAndRefreshRequest)
  returns (ProviderModelsResponse);
```

The host applies the settings update and resolves models under a single critical section / sequential operation:

```text
apply settings to StateManager cache
compute effective config
compute fingerprint
resolve models
return response with same fingerprint
post updated extension state
```

This removes the race between “settings update” and “model refresh” entirely for user-edited model-affecting settings.

### Recommended implementation choice

For the first implementation, use Option A for simple provider switches and Option B for fields that commonly trigger immediate refreshes:

- base URL fields;
- API key/token fields when refresh-on-key-entry is supported;
- API line/region selectors;
- provider switch events that set provider + default model together.

If Option B is too much for the first pass, Option A is acceptable only if every caller awaits the update RPC and uses response/fingerprint guards.

## Caching Strategy

Model lists should be cached in the extension host, but cache identity must include relevant provider config.

### Cache record shape

Use a generic provider-model cache instead of the current provider-specific `modelInfoCache` fields.

```ts
interface ProviderModelsCacheRecord {
  providerId: ApiProvider
  configFingerprint: string
  models: Record<string, ModelInfo>
  defaultModelId: string
  source: "sdk-dynamic" | "sdk-bundled" | "extension-dynamic" | "legacy-static" | "empty"
  fetchedAt: number
  expiresAt: number
  error?: string
}
```

Store records in:

```ts
Map<string, ProviderModelsCacheRecord> // key = `${providerId}:${configFingerprint}`
```

Pending/in-flight requests should use the same key:

```ts
Map<string, Promise<ProviderModelsCacheRecord>>
```

Do not reuse a pending promise with a different fingerprint.

### Cache key inputs

General form:

```text
providerId + normalized relevant config fingerprint
```

Examples:

```text
ollama:http://localhost:11434/v1
lmstudio:http://localhost:1234/v1
litellm:http://localhost:4000/v1:apiKeyHash=abc12345
openai:https://api.example.com/v1:headersHash=def67890:apiKeyHash=abc12345
deepseek:apiKeyHash=abc12345
qwen:china:apiKeyHash=abc12345
zai:international:apiKeyHash=abc12345
oca:internal:https://...:authPresent=true
```

Never include raw secrets in cache keys or logs. Use:

- boolean `hasApiKey`, or
- short hash of key/token if different keys may expose different private models.

For private/authenticated model lists, a short hash is safer than a boolean because model access can differ by account/API key.

### Cache invalidation

Invalidate/force refresh when:

- provider changes;
- base URL changes;
- API key/access token changes;
- region/API line changes;
- model catalog TTL expires;
- user clicks refresh;
- provider-specific auth state changes (e.g. OCA token refresh, Cline account changes).

### Freshness semantics

For a provider with no matching cache record:

- If SDK bundled catalog is available, the host may return it immediately with `source=sdk-bundled` while also optionally starting background dynamic refresh.
- If dynamic/local fetch is the only meaningful list (e.g. local Ollama installed models), the host should return `source=empty` or stale previous data marked as `stale=true`, not silently treat a previous base URL's list as current.

If stale data is returned for UX continuity, it must include the old `configFingerprint` and `stale=true`; the webview should visually indicate it is stale and should not auto-select a model from it for the new config.

### Disk cache plan

Do **not** create a new extension-side disk cache for provider model catalogs.

Rationale:

- The SDK already provides a bundled/prebaked catalog for fast/offline fallback.
- Dynamic model results are config-dependent and easy to misuse if persisted without perfect fingerprinting.
- Disk caches complicate invalidation across API key/base URL/region/remote-config changes.
- StateManager caches are per-window anyway; model catalogs are low-value persistence compared to the risk of stale state.

Plan:

1. Use an in-memory, config-fingerprint keyed cache for dynamic results.
2. Use SDK bundled/prebaked catalog as fallback when dynamic fetch is unavailable or fails.
3. Disable or bypass existing provider model disk caches when those fetchers are wrapped by the unified resolver.
4. Delete existing provider model disk cache files and constants after their fetchers migrate.

If a provider truly needs persistent model-cache behavior in the future, push that caching into the SDK so all clients share one policy and file format.

## Webview Behavior

The webview should maintain a provider model state map:

```ts
providerModelsByProvider: Partial<Record<ApiProvider, Record<string, ModelInfo>>>
providerModelDefaults: Partial<Record<ApiProvider, string>>
providerModelSources: Partial<Record<ApiProvider, string>>
providerModelErrors: Partial<Record<ApiProvider, string>>
providerModelFingerprints: Partial<Record<ApiProvider, string>>
providerModelRequestIds: Partial<Record<ApiProvider, string>>
```

A hook could expose:

```ts
const { models, defaultModelId, isLoading, error, refresh } = useProviderModels(providerId)
```

### Webview request tracking

`refreshProviderModels(providerId)` should:

1. create a unique `requestId`;
2. optimistically set loading state for `providerId` and remember `latestRequestIdByProvider[providerId] = requestId`;
3. call host RPC;
4. apply the response only if `response.requestId === latestRequestIdByProvider[providerId]`;
5. also verify `response.configFingerprint` matches the latest expected/effective fingerprint if the webview knows it.

This protects against out-of-order responses.

### Webview state shape

Prefer one normalized object rather than many provider-specific state variables:

```ts
interface ProviderModelsState {
  providerId: ApiProvider
  models: Record<string, ModelInfo>
  defaultModelId: string
  configFingerprint: string
  requestId: string
  source: string
  fetchedAt: number
  isLoading: boolean
  isStale: boolean
  error?: string
}

type ProviderModelsByProvider = Partial<Record<ApiProvider, ProviderModelsState>>
```

This should replace scattered state like `openRouterModels`, `clineModels`, `liteLlmModels`, `basetenModels`, etc. Compatibility accessors can be provided during migration.

Provider settings components should:

1. call `refreshProviderModels(providerId)` on mount or provider-specific config changes;
2. show loading state while no model map exists;
3. render `ModelSelector` once models are present;
4. use SDK-provided default model if no user selection exists;
5. preserve user selection if it still exists in the returned model map;
6. allow custom model entry only for providers where that makes sense.

For base-url/local providers, if `isLoading` is true after a base URL change, prefer showing a loading indicator plus manual-entry field rather than continuing to show the old server's models as current.

The webview should not know whether the model list came from SDK dynamic fetch, SDK bundled catalog, or host compatibility fallback, except perhaps for debug/source messaging.

### Custom/manual model IDs (align with clite)

The CLI (`clite`) supports manual model entry through a “Create custom model ID” action in the model picker. This is important for:

- providers whose model endpoint is unreachable;
- providers with models not yet in the SDK catalog;
- self-hosted/OpenAI-compatible providers;
- account-specific private models that dynamic fetch cannot see.

The VSCode model picker should copy this capability where safe:

1. For providers that allow arbitrary model IDs, show a “Use custom model ID…” / manual entry path alongside catalog choices.
2. Persist the chosen custom model ID exactly like any selected model.
3. If the model is not in `knownModels`, store model info as `undefined`/unknown and let runtime use SDK/custom provider config with that raw model ID.
4. Do not force-reset a manually entered model just because it is absent from the latest catalog.
5. For providers requiring known deployment IDs (some enterprise/cloud flows), manual entry may be disabled or clearly marked advanced.

This matches clite's practice of building options from `knownModels`, then allowing manual custom IDs when the desired model is absent.

### SDK/provider settings file-format alignment

clite and SDK use provider settings concepts and files such as:

- `provider-settings.json` / `providers.json` for provider settings and selected model;
- `models.json` for user-added OpenAI-compatible provider model catalogs;
- `knownModels` in runtime config for catalog metadata.

The VSCode extension currently stores provider settings in file-backed StateManager keys plus secrets. Because we are planning to ship the SDK and do not want to request SDK schema changes right now, this migration should use the existing SDK schema as-is.

For this migration:

- Do not introduce a second persistent provider-settings source for VSCode model selection.
- The host adapter should translate current StateManager config into SDK `ProviderSettings` / `ProviderConfig` at runtime.
- Custom model IDs should be stored in existing VSCode mode-specific model fields for now, but the model-catalog service should shape them the same way SDK/clite expects: selected `modelId` plus optional `knownModels` metadata.
- TODO: when clite/SDK supports separate Plan/Act model selections, migrate VSCode's Plan/Act choices into the shared SDK storage shape so clients can share that state.

## Provider Settings Storage Convergence

There is a separate, larger design choice: how far should VSCode provider settings move from StateManager keys/secrets to the SDK `ProviderSettingsManager` (`providers.json`) now?

Decision for this plan: **do not require SDK schema changes**. Use SDK `ProviderSettingsManager` only for fields it already supports, and keep VSCode Plan/Act selection state in StateManager with an explicit TODO to migrate when the SDK/clite support profile-specific Plan/Act choices.

### Current SDK storage shape

SDK `ProviderSettingsManager` stores a `StoredProviderSettings` file:

```ts
interface StoredProviderSettings {
  version: 1
  lastUsedProvider?: string
  providers: Record<string, {
    settings: ProviderSettings
    updatedAt: string
    tokenSource: "manual" | "oauth" | "migration"
  }>
}
```

`ProviderSettings` supports many shared provider fields:

- `provider`
- `apiKey`
- `auth`
- `model`
- `baseUrl`
- `headers`
- `timeout`
- `reasoning`
- `aws`
- `gcp`
- `azure`
- `sap`
- `oca`
- `region`
- `apiLine`
- `capabilities`
- `modelCatalog`

This is a good fit for provider-owned configuration shared across clients: credentials, base URL, default/last model, region/API line, OAuth tokens, custom provider metadata, and catalog options.

### Critical mismatch with VSCode state

VSCode currently supports state that the SDK file does not directly model:

- separate Plan/Act providers and models (`planModeApiProvider`, `actModeApiProvider`, etc.);
- provider-specific Plan/Act model fields (`planModeOllamaModelId`, `actModeOllamaModelId`, etc.);
- cached selected model metadata fields (`planModeOpenRouterModelInfo`, `actModeLiteLlmModelInfo`, etc.);
- host-only selector objects like `LanguageModelChatSelector` for `vscode-lm`;
- extension-only UI settings and toggles unrelated to provider configuration.

SDK `ProviderSettings` has one `model` per provider, not a multi-profile/multi-mode selection model. It also strips unknown fields during validation, so we cannot safely store VSCode-only Plan/Act fields inside provider settings without changing SDK schema.

Therefore, if VSCode fully moved active Plan/Act model selection into `ProviderSettingsManager` today, it would either lose Plan/Act separation or require non-standard provider IDs/fields. Avoid both for now.

### Recommendation: converge provider-owned settings now; keep Plan/Act choices in StateManager

Do not make the model-catalog migration depend on SDK schema changes. Use the existing SDK schema and keep the unsupported VSCode-specific selection state in StateManager.

Use SDK `ProviderSettingsManager` as source of truth for provider-owned settings:

- API keys / auth tokens;
- base URLs;
- headers;
- region / API line;
- provider capabilities;
- custom provider registrations;
- catalog options;
- provider-level default/last model.

Keep VSCode StateManager as source of truth for VSCode-specific active UI/session selection:

- Plan/Act selected provider;
- Plan/Act selected model IDs;
- VSCode LM selector object;
- host-only per-mode model metadata while it exists;
- extension UI settings.

The host model resolver builds effective SDK config by merging:

```text
ProviderSettingsManager provider-owned settings
+ StateManager active mode/provider/model selection
+ remote config overlays
+ host-only auth/services
```

This gets most storage convergence benefits without forcing a risky SDK schema change.

Future TODO: when SDK/clite support different Plan/Act models, move the Plan/Act active selection state into the shared SDK storage shape.

### Future full convergence (blocked on SDK/clite profile support)

Extend SDK provider settings to support client profiles/modes, for example:

```ts
interface StoredProviderSettings {
  version: 2
  providers: Record<string, StoredProviderSettingsEntry>
  profiles?: Record<string, {
    plan?: ProviderSelection
    act?: ProviderSelection
  }>
}

interface ProviderSelection {
  provider: string
  model?: string
  reasoning?: ReasoningSettings
  knownModelInfo?: ModelInfo
}
```

Or add a generic client-specific metadata bag:

```ts
clientState?: Record<string, unknown>
```

Only after this exists should VSCode move Plan/Act selected providers/models out of StateManager.

### Avoid: full convergence via synthetic provider IDs

Store things like `vscode-plan:anthropic` and `vscode-act:anthropic` as separate provider IDs in `providers.json`.

This would preserve Plan/Act separation but pollute provider identity, make cross-client behavior confusing, and diverge from clite's provider settings practice. Avoid.

### Where to store extension-specific provider settings

Use this rule:

1. If a setting is meaningful to all clients and maps to SDK `ProviderSettings`, store it in SDK `ProviderSettingsManager`.
2. If a setting is host-only but likely useful to SDK as an abstraction (e.g. VSCode LM provider selector), upstream a schema extension or host-provider adapter contract to SDK.
3. If a setting is truly VSCode UI-only, keep it in StateManager.

Examples:

| Setting | Store in SDK ProviderSettingsManager? | Notes |
|---|---:|---|
| DeepSeek API key/base URL/model | Yes | Shared provider settings. |
| Ollama base URL/API key | Yes | Shared local provider settings. |
| LM Studio base URL | Yes | Shared local provider settings. |
| LiteLLM base URL/API key | Yes | Shared provider settings. |
| Qwen/Z.AI API line | Yes | SDK schema already has `apiLine`. |
| AWS/GCP/Azure/SAP/OCA structured settings | Yes, where schema supports them | SDK has `aws`, `gcp`, `azure`, `sap`, `oca`. Verify parity. |
| VSCode LM `LanguageModelChatSelector` | Not today | Requires SDK schema/host adapter extension or remains StateManager. |
| Plan/Act selected provider/model pairs | Not today | Keep in StateManager for now. TODO: move to SDK storage when SDK/clite supports Plan/Act model profiles. |
| UI panel state / settings target section | No | VSCode-only UI state. |
| OCA dynamic model metadata (survey/banner/apiFormat/etc.) | Not as provider settings | This is dynamic catalog/model metadata, not persistent provider settings. |

### Existing VSCode SDK migration status

This branch already has `src/sdk/provider-migration.ts`, which constructs an SDK `ProviderSettingsManager` at:

```text
~/.cline/data/settings/providers.json
```

and uses the SDK's legacy migration from file-backed `globalState.json` + `secrets.json`. However, most VSCode UI settings still read/write StateManager. The migration exists, but full read/write convergence is incomplete.

### Practical path

1. Model-catalog resolver reads both ProviderSettingsManager and StateManager and computes an effective provider config.
2. For provider-owned settings, start dual-writing or migrating writes to ProviderSettingsManager behind a compatibility layer.
3. Keep Plan/Act selections in StateManager until SDK/clite supports multi-profile/mode provider selection.
4. Add a clear TODO in code where Plan/Act model IDs are read/written: “move to SDK ProviderSettingsManager when SDK/clite support separate Plan/Act models.”
5. Delete duplicate StateManager provider credential/base URL keys only after all VSCode surfaces read those provider-owned settings from ProviderSettingsManager.

### Model-affecting config fields

The webview should centralize model-affecting field changes so they can invalidate/request model catalogs consistently. Examples:

- provider id for current mode;
- base URL fields;
- API key fields if model access is key-dependent;
- API line/region fields;
- custom headers for OpenAI-compatible providers;
- auth sign-in/sign-out events;
- remote config updates.

Avoid each provider component independently deciding when/how to refresh.

## Defaults Strategy

Defaults should come from SDK first.

Algorithm:

```ts
const defaultModelId =
  sdkDefaultModelId && models[sdkDefaultModelId]
    ? sdkDefaultModelId
    : Object.keys(models)[0] ?? ""
```

User selection should be preserved if valid:

```ts
const selectedModelId =
  savedModelId && models[savedModelId]
    ? savedModelId
    : defaultModelId
```

The extension should stop hardcoding provider defaults as primary defaults.

### Default update atomicity

When a model list refresh changes the default model, do not immediately overwrite the user's saved selected model unless it is invalid for the returned model map.

Rules:

1. If saved selected model exists in `models`, keep it.
2. If saved selected model is absent and provider supports manual custom IDs, keep the typed value but mark model info as unknown.
3. If saved selected model is absent and provider requires known IDs, replace with `defaultModelId` in a single API-configuration update that also stores the selected model info (if that provider stores model info separately).
4. Do not write a default from a stale response.

For plan/act separate models, apply the same rule independently to the active mode unless the user's settings say plan/act models are synchronized.

## Shape Adapter

The extension still needs a protocol/shape adapter from SDK model metadata to the extension/webview `ModelInfo` shape.

SDK-like shape:

```ts
{
  id,
  name,
  contextWindow,
  maxTokens,
  capabilities: ["tools", "reasoning", "prompt-cache"],
  pricing: { input, output, cacheRead, cacheWrite },
  description,
}
```

Extension/webview shape:

```ts
{
  name,
  contextWindow,
  maxTokens,
  supportsImages,
  supportsPromptCache,
  supportsReasoning,
  inputPrice,
  outputPrice,
  cacheReadsPrice,
  cacheWritesPrice,
  description,
}
```

Mapping:

```ts
supportsImages = capabilities.includes("images")
supportsPromptCache = capabilities.includes("prompt-cache")
supportsReasoning = capabilities.includes("reasoning")
inputPrice = pricing.input
outputPrice = pricing.output
cacheReadsPrice = pricing.cacheRead
cacheWritesPrice = pricing.cacheWrite
```

This adapter is not model-business logic; it is API boundary translation.

### Adapter lossiness risks

Some extension model metadata may not exist in SDK metadata today:

- `thinkingConfig` variants for Gemini/Anthropic/OpenRouter/Vercel;
- tiered pricing structures;
- provider-specific `apiFormat` (notably OCA and some OpenAI-compatible paths);
- temperature recommendations;
- survey/banner metadata for OCA;
- custom context-window overrides from user settings (`ollamaApiOptionsCtxNum`, `lmStudioMaxTokens`).

The adapter must define deterministic defaults for absent fields and identify metadata that must remain host-specific.

Recommendation:

- SDK-owned metadata is used whenever available.
- Host-specific metadata is added only where it is required for host/provider behavior, not for general model curation.
- The response `source` or debug metadata should make it clear when host-specific enrichment was applied.

### Runtime lookup requirement

Add a host-side API like:

```ts
resolveCurrentModelInfo(providerId, modelId, effectiveConfig): Promise<ModelInfo | undefined>
```

Runtime API providers should use this same model catalog cache/resolver instead of importing static maps. This prevents a model picker from showing SDK data while request execution still uses old extension data.

Implementation can be incremental: providers that already require model info dynamically (OpenRouter/Cline/Groq/Baseten/etc.) migrate first; static providers can use SDK-bundled lookup through the same API.

## Request/Response and State Revision Design

To address torn state, model catalog requests should carry both request identity and effective config identity.

### Host-side request processing

Pseudo-flow:

```ts
async function getProviderModels(request) {
  const requestId = request.requestId || generateId()
  const effectiveConfig = buildEffectiveProviderConfig(request.providerId)
  const configFingerprint = fingerprintProviderConfig(effectiveConfig)
  const cacheKey = `${request.providerId}:${configFingerprint}`

  if (!request.forceRefresh) {
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return toResponse(cached, { requestId })
    }
  }

  const record = await getOrCreateInFlight(cacheKey, () => resolveViaSdkAndFallbacks(effectiveConfig))
  return toResponse(record, { requestId })
}
```

### Webview-side apply rule

Pseudo-flow:

```ts
const requestId = nanoid()
latestModelRequestIdByProvider[providerId] = requestId
setProviderModelsState(providerId, { isLoading: true, requestId })

const response = await getProviderModels({ providerId, forceRefresh, requestId })

if (latestModelRequestIdByProvider[providerId] !== response.requestId) {
  return // stale/out-of-order response
}

setProviderModelsState(providerId, response)
```

If the webview knows a local expected fingerprint (e.g. from a prior host response or from a settings-update response), it should also reject mismatches.

### Settings update response should include state revision

For stronger ordering, settings update RPCs that affect model catalogs should return:

```proto
message UpdateApiConfigurationResponse {
  string state_revision = 1;
}
```

or the model-refresh RPC should be combined with settings update. The key is that callers can await a host-acknowledged state update before refreshing.

Current `updateApiConfiguration` returns `Empty`, which makes ordering implicit. It works only if callers await it and trust the host has updated memory before returning. A state revision makes this explicit and testable.

## Current Implementation Hazards to Fix

### Webview stale closure writes

`useApiConfigurationHandlers.handleFieldChange()` builds a full updated config from the current React `apiConfiguration` object. Multiple rapid calls can overwrite each other. For model-affecting settings, prefer field-mask/partial update RPCs or a combined update+refresh RPC.

### Provider components triggering refresh before update ack

Examples today include OpenAI-compatible base URL/API key changes that call `handleFieldChange(...)` and trigger a debounced model refresh using values from closures. This should be replaced by a central update+refresh path.

### Local provider polling

Ollama and LM Studio polling should not continue to overwrite provider state with responses for an old endpoint after a base URL change. Polling should use the same request id/fingerprint apply rules or be paused while a config change is pending.

### Provider-only pending promises

Existing module-level `pendingRefresh` variables must not be reused in the unified resolver unless they are keyed by config fingerprint.

### Provider-only disk/in-memory caches

Existing `StateManager.getModelsCache("provider")` style caches should either be replaced or wrapped in a config-aware layer.

### Remote config changes

When remote config is fetched/replaced, model catalogs for affected providers must be invalidated. This includes remote-configured base URLs, API keys, and provider allowlists.

## SDK Model Resolution API Usage

The extension should prefer a high-level SDK model resolution path and ignore low-level refresh APIs unless it needs a specific behavior.

### What SDK/core exposes today

Relevant exports observed from `@clinebot/core` / SDK source:

- `resolveProviderConfig(providerId, modelCatalog?, config?)`
  - Returns provider defaults plus `knownModels`.
  - Handles generated/bundled catalog, optional live `models.dev` catalog, private model fetchers, and public model sources where supported.
- `getLocalProviderModels(providerId, config?)`
  - Returns a UI-friendly model list from registered models plus resolved known models.
- `refreshProviderModelsFromSource(manager, providerId)`
  - Updates SDK `models.json` for providers with `modelsSourceUrl`.
  - This is a persistence/update helper used by clite/onboarding, not necessarily needed for VSCode's host-side transient model picker.
- `ProviderSettingsManager.getProviderConfig(providerId, { includeKnownModels })`
  - Builds SDK provider config from SDK provider settings.
- `toProviderConfig(settings, options)` / `createProviderConfig(...)`
  - Converts SDK `ProviderSettings` into SDK `ProviderConfig`.

### Recommendation

For VSCode model listing, start with:

```ts
resolveProviderConfig(providerId, {
  loadLatestOnInit: true,
  loadPrivateOnAuth: true,
  failOnError: false,
}, effectiveProviderConfig)
```

Use the returned `knownModels` and default model metadata as the primary model catalog response.

Do **not** call `refreshProviderModelsFromSource(...)` by default. That function persists refreshed model lists into SDK `models.json`, which is useful for clite/local provider management, but VSCode's immediate picker can use transient in-memory results. Persisting model-source refreshes in VSCode would reintroduce disk-cache/staleness concerns unless we intentionally adopt SDK `models.json` behavior.

Use `refreshProviderModelsFromSource(...)` only if we deliberately choose to manage SDK local/custom provider registries through VSCode in the same way clite does.

### Desired SDK improvement

If `resolveProviderConfig(...)` is too config-oriented or does not expose enough source/default metadata, upstream a dedicated SDK API:

```ts
resolveProviderModels({ providerId, config, modelCatalog }): Promise<{
  providerId: string
  defaultModelId: string
  models: Record<string, ModelInfo>
  source: "dynamic" | "bundled" | "mixed"
}>
```

Then the extension host can call one canonical SDK method and avoid knowing about SDK internals.

## Provider Disposition and Deletion Plan

The extension currently still contains classic provider handlers in `src/core/api/providers/*`, even though the main task runtime on this SDK branch is SDK-backed through `@clinebot/core`. These classic handlers should not remain as parallel runtime implementations unless they are truly host-specific.

### Decision framework

Classify each provider into one of three categories:

1. **Delete**: SDK owns inference and model catalog/defaults. The extension should only translate VSCode settings into SDK config and should not keep a classic provider implementation.
2. **Keep**: provider depends on VSCode host APIs or extension-only auth/enterprise behavior. Keep a host adapter, but still expose it through the unified provider model catalog interface.
3. **Thin out**: SDK should own inference/catalog, but some host-side UX/config/auth/model-discovery glue remains temporarily. Delete the classic inference handler as soon as the glue is isolated from inference.

### Extension providers to delete (SDK should handle inference)

These classic extension-side provider handlers should be deleted once:

- normal chat/task runtime uses SDK (already true on this branch);
- auxiliary inference paths (`commit-message-generator`, `explainChangesShared`, comment replies, etc.) stop using `buildApiHandler()` and call SDK runtime instead;
- runtime model metadata lookup comes from the unified host model catalog resolver;
- no imports remain from `src/core/api/providers/<provider>.ts`.

Target delete list:

| Extension handler | SDK provider exists? | Notes / prerequisites before delete |
|---|---:|---|
| `anthropic.ts` | Yes (`anthropic`) | Migrate auxiliary inference + thinking/context metadata to SDK/config adapter. |
| `bedrock.ts` | Yes (`bedrock`) | Ensure AWS credential modes, regions, cross-region/global inference flags are represented in SDK config. |
| `vertex.ts` | Yes (`vertex`) | Ensure project/region + Anthropic-on-Vertex mappings are SDK-compatible. |
| `gemini.ts` | Yes (`gemini`) | Ensure base URL, thinking budget/effort, and Gemini thinking-level metadata are preserved/upstreamed. |
| `openai-native.ts` | Yes (`openai-native`) | SDK default uses Responses API; ensure extension settings map correctly. |
| `openai-codex.ts` | Yes (`openai-codex`) | SDK has Codex/OAuth support; delete classic once VSCode auth bridge uses SDK config. |
| `claude-code.ts` | Yes (`claude-code`) | SDK has Claude Code provider; keep only path/config adapter if needed. |
| `deepseek.ts` | Yes (`deepseek`) | High-priority delete after DeepSeek SDK model catalog path lands. |
| `xai.ts` | Yes (`xai`) | Delete after SDK config adapter covers reasoning settings. |
| `together.ts` | Yes (`together`) | Delete after model id/base config adapter. |
| `fireworks.ts` | Yes (`fireworks`) | Delete after max token/completion token settings are represented or no longer needed. |
| `groq.ts` | Yes (`groq`) | Existing dynamic model fetch can become unified catalog fallback; inference should be SDK. |
| `cerebras.ts` | Yes (`cerebras`) | Ensure reasoning/model-family behavior is represented. |
| `sambanova.ts` | Yes (`sambanova`) | SDK provider exists but generated catalog may be sparse; use SDK/provider default + compatibility catalog until SDK coverage is verified. |
| `nebius.ts` | Yes (`nebius`) | Delete after SDK config adapter. |
| `baseten.ts` | Yes (`baseten`) | Existing dynamic model fetch can become unified catalog fallback; inference should be SDK. |
| `requesty.ts` | Yes (`requesty`) | Existing dynamic model fetch can become unified catalog fallback; inference should be SDK. |
| `litellm.ts` | Yes (`litellm`) | SDK supports provider; ensure LiteLLM model-info enrichment and prompt-cache metadata are preserved/upstreamed. |
| `huggingface.ts` | Yes (`huggingface`) | Existing dynamic fetch can be compatibility catalog fallback until SDK parity. |
| `vercel-ai-gateway.ts` | Yes (`vercel-ai-gateway`) | Preserve thinking/temperature derivation or move it to SDK. |
| `aihubmix.ts` | Yes (`aihubmix`) | Ensure appCode/base URL fields are mapped to SDK config. |
| `hicap.ts` | Yes (`hicap`) | SDK has provider id; verify auth/catalog support. |
| `nousresearch.ts` | Yes (`nousResearch`) | Note filename casing differs from provider id. Delete after SDK config adapter. |
| `huawei-cloud-maas.ts` | Yes (`huawei-cloud-maas`) | Ensure Huawei endpoint/model mappings are SDK-compatible. |
| `wandb.ts` | Yes (`wandb`) | Delete after SDK config adapter. |
| `qwen.ts` | Yes (`qwen`) | Ensure China/international `qwenApiLine` is represented; otherwise thin until SDK supports it. |
| `qwen-code.ts` | Yes (`qwen-code`) | Ensure OAuth/path config is represented. |
| `doubao.ts` | Yes (`doubao`) | Delete after SDK config adapter. |
| `mistral.ts` | Yes (`mistral`) | Delete after SDK config adapter. |
| `moonshot.ts` | Yes (`moonshot`) | Ensure `moonshotApiLine` is represented; otherwise thin until SDK supports it. |
| `asksage.ts` | Yes (`asksage`) | SDK has `fetch` client; verify API URL/header behavior before delete. |
| `minimax.ts` | Yes (`minimax`) | Ensure `minimaxApiLine` and Anthropic-like protocol are SDK-compatible. |
| `dify.ts` | Yes (`dify`) | SDK has Dify community provider; verify streaming and base URL behavior. |
| `openrouter.ts` | Yes (`openrouter`) | Preserve provider sorting and custom Claude 1M variants; preferably move variants to SDK, then delete classic inference handler. |
| `ollama.ts` | Yes (`ollama`) | SDK supports Ollama provider/model source; delete classic inference after local base URL/auth/options mapping is complete. |
| `lmstudio.ts` | Yes (`lmstudio`) | SDK supports LM Studio provider/model source; preserve loaded/max context metadata where needed. |

### Extension providers to keep

These should remain extension/host-side, at least for the foreseeable future, because they require VSCode APIs or extension-specific auth/enterprise behavior.

| Provider | Keep what? | Why |
|---|---|---|
| `vscode-lm` | Host adapter / provider implementation | Depends on VS Code LM APIs (`vscode.lm`) that the SDK cannot call directly without host injection. Could eventually be registered into SDK as a host-provided provider, but the VSCode extension still owns the adapter. |
| `oca` | Host adapter, auth/model discovery glue, possibly inference until SDK parity | OCA uses extension auth services, internal/external mode, custom headers/OPC request IDs, `/v1/model/info`, `apiFormat`, reasoning effort options, survey/banner metadata. SDK has OCA-related support, but parity must be verified before deleting extension-side implementation. |

Keep does **not** mean keeping old ad-hoc webview model logic. These providers should still use the unified `getProviderModels` RPC and provider-model state shape.

### Providers/features to thin out

These are not “keep full classic provider forever,” but they have host-specific glue that should be isolated from inference so most code can be deleted.

| Provider/feature | Keep temporarily | Delete/Move |
|---|---|---|
| `cline` | Account/env/auth bridge, recommended/free model UX, Cline API model endpoint behavior, feature flags. | Inference should remain SDK-side. Classic `ClineHandler` should be deleted once auxiliary inference and model metadata no longer depend on it. Cline model list logic should either move into SDK or be wrapped by unified host catalog as Cline-specific catalog source. |
| OpenAI-compatible custom provider (`openai` in extension) | UI/config bridge for arbitrary base URL/API key/headers and manual model entry. | The extension's `OpenAiHandler` should be replaced by SDK openai-compatible/custom provider config. Be careful: SDK `openai` alias means `openai-native`, while extension `openai` means custom OpenAI-compatible. This semantic mismatch must be resolved before deletion. |
| `sapaicore` | Deployment discovery, resource group, token URL, orchestration-mode UI/config if SDK does not cover all of it. | Inference should use SDK once config mapping is complete. Delete classic handler after deployment/model discovery is behind unified host catalog. |
| `openrouter` / `cline` Claude 1M variants | Variant generation/enrichment until SDK owns it. | Move custom variant metadata into SDK catalog/provider layer; then delete extension-side enrichment. |
| `groq`, `baseten`, `huggingface`, `requesty`, `vercel-ai-gateway`, `aihubmix`, `hicap` dynamic fetchers | Temporary compatibility model-catalog sources behind unified resolver. | Delete provider-specific RPCs/fetchers once SDK dynamic catalog support is verified or upstreamed. |
| `ollama`, `lmstudio`, `litellm` local/base-url UX | Base URL/API key inputs, manual model entry, loading/error UX. | Delete direct webview polling and classic inference handlers. Model discovery should route through SDK/core behind unified host RPC. |

### Things to delete early

Delete as soon as their replacements land and tests pass. Do not keep stale code “just in case.”

1. **Direct webview imports of provider model maps**
   - Delete callsites first; keep `src/shared/api.ts` exports only while runtime/other code imports them.
   - Once no imports remain, delete the corresponding hardcoded maps.
2. **Provider-specific webview refresh functions/state**
   - Replace `openRouterModels`, `clineModels`, `liteLlmModels`, `basetenModels`, etc. with normalized `providerModelsByProvider` state.
   - Delete compatibility accessors after all components migrate.
3. **Provider-specific model RPCs**
   - Delete or turn into shims immediately after webview callsites migrate to `getProviderModels`.
   - If proto compatibility is not needed for non-VSCode clients, delete in same PR; otherwise keep shims for one release and mark deprecated.
4. **Provider-only caches**
   - Delete `StateManager.getModelsCache("provider")` / `setModelsCache("provider")` after config-fingerprint cache exists and old fetchers no longer use it.
5. **Classic inference handlers in the delete list**
   - Delete once no `buildApiHandler()` callsite can instantiate them and auxiliary inference uses SDK.

### Delete gates

Do not delete a classic handler until all gates pass:

1. SDK runtime can send requests for that provider with the extension's relevant config fields.
2. Unified catalog can return models/defaults for that provider.
3. UI model picker no longer imports that provider's static map.
4. Runtime model lookup no longer imports that provider's static map.
5. Auxiliary inference features no longer use `buildApiHandler()` for that provider.
6. Tests cover at least one request/config for that provider through the SDK path.

### Current classic provider files that should remain only temporarily

The following directory should shrink dramatically:

```text
src/core/api/providers/
```

Long-term target:

- keep host adapters such as `vscode-lm` and likely `oca`;
- keep shared types/helpers only if still needed;
- delete SDK-covered provider inference handlers;
- delete `src/core/api/index.ts` or reduce it to a compatibility shim that routes to SDK/host adapters.

### Auxiliary inference deletion plan

The known extension-side auxiliary inference users of `buildApiHandler()` are:

- `src/hosts/vscode/commit-message-generator.ts`
- `src/core/controller/task/explainChangesShared.ts`
- update/settings handlers that set `controller.task.api` for task-proxy compatibility

Deletion path:

1. Add SDK-backed helper for single-turn auxiliary inference.
2. Migrate commit message generation.
3. Migrate explain-changes/comment replies.
4. Replace task-proxy `api.getModel()` compatibility with unified catalog current-model lookup.
5. Remove `buildApiHandler()` usages outside tests.
6. Delete classic provider handlers in the delete list.

This should happen as early as practical because otherwise engineers will keep reading and updating dead/parallel provider code.

## Open Questions / Decisions

1. Which exported SDK/core model resolver should be considered canonical for VSCode host use?
   - The extension already depends on `@clinebot/core` and `@clinebot/llms`.
   - Prefer a single SDK/core API that returns models/defaults from effective provider config.
2. Does `@clinebot/core` expose the dynamic model resolution API in a form suitable for the extension host, or should we upstream a small API for that?
3. How do we map all existing extension provider config fields into SDK config?
4. Which existing extension model fetchers should be kept as temporary compatibility fallbacks?
5. How aggressively should hardcoded maps be deleted in the first PR?
6. For providers with SDK-generated catalogs but extension-specific custom variants (e.g. OpenRouter/Cline Claude 1M variants), should those variants move into SDK or remain host-side compatibility until SDK supports them?
7. Should model-affecting settings use a combined update+refresh RPC from day one, or is awaited field-mask update + refresh acceptable for the first pass?
8. Should stale previous model lists be hidden or displayed with a stale indicator during refresh after base URL/API key changes?
9. Which current provider model disk caches can be deleted immediately once the unified config-fingerprint memory cache lands? Default answer should be: all provider model disk caches, unless a provider has a demonstrated need.
10. Can SDK core expose a stable public model resolver so the extension does not need to duplicate SDK internal resolution logic?

## Recommended Implementation Phasing

Even if the overall PR is broad, keep commits logically separated:

1. Identify the SDK public API to call for dynamic model resolution, or add/upstream one if the current exports are too low-level.
2. Add host-side SDK model resolver + shape adapter.
3. Add config fingerprinting, request IDs, config-aware cache, and config-aware in-flight dedupe before migrating UI callsites.
4. Add unified proto RPC and generated code.
5. Add webview context state and `refreshProviderModels` with stale-response rejection.
6. Add a safe model-affecting settings update pattern (prefer combined update+refresh for base URLs/API keys/API lines; otherwise require awaited field-mask updates).
7. Migrate one provider end-to-end (DeepSeek) to prove the path and SDK default behavior.
8. Migrate local/base-url providers (Ollama, LM Studio, LiteLLM) with cache key and race tests.
9. Migrate dynamic providers behind compatibility wrappers, ensuring wrappers are fingerprint-aware.
10. Migrate remaining static providers.
11. Add logs/tests documenting fallback usage.
12. Leave deletion of old hardcoded maps/RPCs to follow-up once runtime coverage is verified and fallback logs show low/no usage.

## Required Tests

### Unit tests

- Fingerprint changes when base URL changes.
- Fingerprint changes when API key hash changes.
- Fingerprint changes when API line/region changes.
- Fingerprint does not include raw secrets.
- Cache hit only when provider + fingerprint match.
- In-flight promise is reused only when provider + fingerprint match.
- SDK default is used when present in model map.
- Missing SDK default falls back to first model deterministically.
- SDK model metadata adapter maps capabilities/pricing correctly.

### Race/concurrency tests

- Start refresh for Ollama URL A, then update to URL B and start refresh; response for A arrives last and is ignored.
- Start refresh with old API key hash, then change key and refresh; old response is ignored.
- Rapid base URL edits result in only latest request updating webview state.
- Provider switch from A to B while A refresh is in flight does not populate B's picker with A's models.
- Existing polling for local providers cannot overwrite state for a newer config.

### Integration/UI tests

- DeepSeek shows SDK-generated 4-model list and SDK default.
- Ollama uses typed base URL for model fetch and invalidates old list on URL change.
- LM Studio preserves returned context metadata for selected model.
- LiteLLM refresh uses latest base URL and API key after update ack.
- OpenRouter/Cline still preserve existing dynamic behavior and special variants during compatibility phase.
- Webview can render a provider with no models as loading/error/manual-entry instead of crashing.

## Practical Initial Success Criteria

- DeepSeek settings panel shows 4 SDK-provided models and default `deepseek-v4-flash`.
- Ollama respects edited base URL and cache invalidates when base URL changes.
- Webview imports no SDK packages.
- Existing OpenRouter/Cline dynamic fetch behavior remains unchanged from the user perspective.
- If SDK errors, webview shows a usable fallback or clear error; no blank/crashing settings panels.
- No secrets appear in cache keys/logs.
- A stale response for an old base URL/API key/provider cannot overwrite a newer model list.
- Runtime model lookup and settings UI model lookup use the same host-side catalog record/fingerprint.

## Pre-mortem: How This Plan Fails

Assume this migration shipped and caused regressions. These are the most likely failure modes.

### Failure 1: We call the wrong SDK API and silently lose models

`@clinebot/llms` exposes multiple catalog surfaces with different meanings. DeepSeek demonstrates the trap:

- `getGeneratedModelsForProvider("deepseek")` returns the 4-model generated catalog.
- `getProvider("deepseek")` gives the SDK default `deepseek-v4-flash`.
- `getProviderCollection("deepseek")` / `getModelsForProvider("deepseek")` can return a smaller curated provider collection.

If the extension naively uses only `getModelsForProvider(providerId)`, some providers may shrink unexpectedly. DeepSeek could regress to a one-model list even though the generated catalog has four.

Mitigation:

- Build and test a resolver that intentionally combines SDK surfaces:
  1. generated catalog for breadth;
  2. provider collection for curated metadata/default fallback;
  3. provider default from `getProvider`;
  4. dynamic SDK/core resolution where available.
- Add provider-specific regression tests for model counts/defaults for high-risk providers.

### Failure 2: SDK dynamic resolution is not actually exposed/stable enough

The published `@clinebot/core` package exports useful APIs, including:

- `resolveProviderConfig`
- `getLocalProviderModels`
- `refreshProviderModelsFromSource`
- `ProviderSettingsManager`
- `toProviderConfig`
- `getProviderConfig`

However, these were designed for SDK/local provider settings, not necessarily for the VSCode extension's existing `ApiConfiguration` shape. The extension may need to construct SDK `ProviderSettings` or `ProviderConfig` objects carefully, and that mapping may be incomplete.

Mitigation:

- First spike the exact SDK call sequence in host code for:
  - DeepSeek bundled catalog/default;
  - Ollama custom base URL dynamic fetch;
  - LiteLLM base URL + API key;
  - one API-line provider.
- Treat any SDK API not documented as stable as a risk; add a small wrapper layer in the extension so SDK API changes are isolated.
- Prefer upstreaming missing provider-config fields to SDK instead of inventing long-lived extension-only mappings.

### Failure 3: We solve the picker but not runtime execution

Many runtime handlers still import static model maps in `src/core/api/providers/*` and use them in `getModel()`. Examples include Anthropic, DeepSeek, Mistral, Cerebras, Bedrock, Qwen, Moonshot, Minimax, Fireworks, etc. Other dynamic providers depend on mode-specific `*ModelInfo` stored in state.

If the webview picker uses SDK catalogs but runtime execution still uses old static maps, users can select a model that the UI knows but the API handler doesn't. The task then falls back to an old default or sends incorrect metadata.

Mitigation:

- The host-side model catalog resolver must expose a runtime lookup API.
- Migrate runtime handlers to call the same resolver/cache, or ensure `updateApiConfiguration` stores the selected SDK-derived `ModelInfo` in state for handlers that already accept `*ModelInfo`.
- Add tests that selecting a newly SDK-provided model (e.g. `deepseek-v4-pro`) results in `buildApiHandler(...).getModel().id === "deepseek-v4-pro"` and correct metadata.

### Failure 4: Config tearing persists despite the new RPC

The biggest historical risk is unchanged if callers still do separate, unordered operations:

```ts
handleFieldChange("providerBaseUrl", newUrl)
refreshProviderModels(providerId)
```

or if a component uses a stale `apiConfiguration` closure while firing a refresh.

Mitigation:

- Do not let provider components call refresh directly after updating model-affecting fields unless the update RPC was awaited and acknowledged.
- Prefer combined update+refresh RPCs for base URL/API key/API-line changes.
- Add request id and config fingerprint to responses and ignore stale responses in the webview.
- Add tests that intentionally deliver responses out of order.

### Failure 5: Cache key misses a relevant config field

If the fingerprint excludes a field that changes model availability, stale results can be served as fresh. Likely missed fields:

- OpenAI-compatible custom headers;
- API line / region;
- remote-config locked base URL/API key;
- OCA mode/internal-vs-external URL;
- Cline account/org/environment;
- provider sorting or routing settings if they affect visible model list;
- selected custom deployment ID for cloud providers.

Mitigation:

- Define a per-provider `fingerprintInputs(providerId, effectiveConfig)` function.
- Unit test every model-affecting setting listed in `state-keys.ts`.
- Default to over-invalidation rather than under-invalidation.

### Failure 6: Secrets leak through fingerprints/logs

Hashing API keys is safer than booleans for entitlement-varying providers, but raw secrets must never appear in cache keys, logs, errors, or webview state.

Mitigation:

- Use a one-way hash with a short prefix, e.g. `sha256(secret).slice(0, 12)`.
- Never expose raw hash inputs.
- Keep fingerprints opaque in UI if possible.
- Add tests that serialized request/response/log payloads do not contain configured secret values.

### Failure 7: SDK metadata is less rich than extension-specific metadata

Some extension model maps and fetchers encode behavior that may not yet exist in SDK metadata:

- Claude/Gemini/OpenRouter/Vercel thinking configs;
- Anthropic/OpenRouter 1M context variants;
- Bedrock cross-region/global endpoint rules;
- OCA `apiFormat`, reasoning effort options, survey/banner metadata;
- LiteLLM/OCA provider-returned prices and cache details;
- LM Studio loaded context length.

If we drop this metadata, request shaping, reasoning UI, cost display, or provider-specific API behavior can regress.

Mitigation:

- Treat host-specific enrichment as behavior metadata, not catalog curation.
- Add an explicit enrichment step after SDK catalog resolution for fields required by runtime behavior.
- Track each enrichment as a candidate to upstream into SDK.
- Add tests around reasoning controls, context window display, and provider-specific API format selection.

### Failure 8: Webview loading states degrade UX

Moving from synchronous static imports to async host fetches can create flicker, disabled dropdowns, or blank panels. For local providers, hiding stale models may be correct but can feel worse if the server is slow.

Mitigation:

- Use explicit states: `idle`, `loading`, `ready`, `stale`, `error`.
- For providers with manual model entry, show manual entry even while loading.
- For SDK-bundled catalog providers, return bundled models quickly, then refresh dynamic data in background if applicable.
- Avoid blank `ModelInfoView`; display “model metadata loading” or “unknown model info” instead.

### Failure 9: Local provider polling fights request/fingerprint guards

Current Ollama/LM Studio components poll directly. If polling remains distributed in components, it can overwrite newer state or create excessive requests.

Mitigation:

- Move polling into `refreshProviderModels`/host-side model service or central webview hook.
- Key every poll response by request id/fingerprint.
- Pause/cancel previous polling loop on base URL change.
- Consider exponential backoff after repeated failures.

### Failure 10: Existing provider-specific RPCs and new unified RPC diverge

If old RPCs remain and some callsites keep using them, two model sources can coexist and disagree.

Mitigation:

- Keep old RPCs as shims that delegate to the unified resolver, or mark them deprecated and migrate callsites quickly.
- Add a lint/search checklist: no provider settings component should call `refreshOpenRouterModelsRpc`, `getOllamaModels`, etc. directly after migration.
- Remove old webview context state fields or keep compatibility getters backed by the new normalized state.

### Failure 11: The PR is too large to review safely

Migrating every provider, every picker, the runtime handlers, proto, state, caches, and tests in one PR can obscure subtle provider-specific regressions.

Mitigation:

- Even if delivered as one PR, structure it as reviewable commits:
  1. resolver/cache/fingerprint foundation;
  2. proto/context plumbing;
  3. DeepSeek proof;
  4. local/base-url providers;
  5. dynamic providers;
  6. remaining static providers;
  7. runtime handler alignment;
  8. cleanup.
- Maintain a migration checklist table per provider with old source, new SDK source, dynamic behavior, config fields, tests.

### Failure 12: SDK package/bundling assumptions break VSCode builds

The extension already depends on `@clinebot/core` and `@clinebot/llms`, and esbuild bundles the extension host as CJS. But adding new import paths can still pull in unexpected Node-only or large dependencies.

Mitigation:

- Import only from host-side code, never webview.
- Prefer narrow imports if exposed by the package.
- Measure bundle size before/after.
- Run `npm run compile` and a packaged extension smoke test.

### Failure 13: Remote config invalidation is forgotten

Remote config can change base URLs, API keys, allowed providers, and locked settings. If a remote config refresh updates effective provider config but model caches are not invalidated, the UI can show disallowed/stale models.

Mitigation:

- When `replaceRemoteConfig` or remote config fetch changes model-affecting fields, invalidate affected provider model cache entries.
- Include remote-config-derived values in fingerprints.

### Failure 14: Model selection state writes race with defaults

A refresh may choose a new SDK default and write it to API configuration while the user is actively selecting/typing another model. This can produce confusing jumps.

Mitigation:

- Refresh should not write model selection by default.
- Only write a default when initializing a provider with no selected model, or when current selection is invalid and provider requires known IDs.
- User-initiated model selection wins over refresh-derived defaults.

### Failure 15: We over-trust SDK-generated catalog for providers requiring account-specific availability

SDK bundled catalogs can list models the user's account cannot access. Dynamic/private fetches are more accurate when available.

Mitigation:

- Response `source` should distinguish `sdk-bundled` vs `sdk-dynamic`.
- If provider has API key and SDK/private fetch fails, consider showing bundled list with a warning/source marker, not as authoritative availability.

### Failure 16: We do not upstream enough to SDK

If host compatibility/enrichment grows, the extension may simply recreate a second SDK-adjacent catalog layer.

Mitigation:

- Every compatibility/enrichment path should have an owner and upstream decision:
  - belongs in SDK provider catalog;
  - belongs in SDK dynamic fetcher;
  - truly host-specific and should remain in extension.
- Track fallback usage telemetry/logs to prioritize upstreaming.
