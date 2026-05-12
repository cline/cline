# SDK Model Catalog Decisions / Findings

## 2026-05-12 — Phase 1.5 settings-update RPC audit

Audited:

- `src/core/controller/state/updateSettings.ts`
- `src/core/controller/state/updateSettingsCli.ts`
- Relevant `StateManager` write methods in `src/core/storage/StateManager.ts`

Finding: **no Phase 1.5 storage-ordering gap found.**

Evidence:

- `updateSettings.ts`
  - API configuration updates call `controller.stateManager.setApiConfiguration(...)` before rebuilding task API handlers or posting state to the webview.
  - Direct settings updates call `controller.stateManager.setGlobalState(...)` synchronously before `postStateToWebview()` returns.
  - Browser/default-terminal/feature-toggle updates also write through `setGlobalState(...)` before returning.
  - Remote-config opt-out updates write `optOutOfRemoteConfig` synchronously before clearing/fetching remote config. Re-enable fetch remains fire-and-forget, but the user's immediate setting intent is already in StateManager.

- `updateSettingsCli.ts`
  - Simple settings call `controller.stateManager.setGlobalStateBatch(...)` synchronously.
  - Special converted settings call `controller.stateManager.setGlobalState(...)` synchronously.
  - Secret updates call `controller.stateManager.setSecretsBatch(...)` synchronously.
  - Task API handler rebuilds read from `controller.stateManager.getApiConfiguration()` after the synchronous settings writes.

- `StateManager`
  - `setGlobalState(...)` updates `globalStateCache` before scheduling debounced persistence.
  - `setGlobalStateBatch(...)` updates `globalStateCache` via `Object.assign(...)` before scheduling debounced persistence.
  - `setSecret(...)` updates `secretsCache` before scheduling debounced persistence.
  - `setSecretsBatch(...)` updates `secretsCache` entries before scheduling debounced persistence.
  - `setApiConfiguration(...)` categorizes settings/secrets and delegates to the synchronous batch setters. It also updates remote-config state for settings overlays before writing global state.
  - `getApiConfiguration()` reads from in-memory caches and applies remote LiteLLM key precedence from `secretsCache`, so a read after an awaited update observes the updated effective config even before disk flush.

Decision:

- Proceed past Phase 1.5 without code changes.
- No Step 1.5a is needed.

## 2026-05-12 — CHECKPOINT 1 store review

Validation performed after Phase 1.5:

- `NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/sdk/model-catalog/provider-id.test.ts src/sdk/model-catalog/fingerprint.test.ts src/sdk/model-catalog/effective-config.test.ts src/sdk/model-catalog/store.test.ts --reporter=dot`
  - Passed: 4 test files, 43 tests.
- `npm run check-types -- --pretty false`
  - Passed.
- Grep: `grep -R "StateManager\|getProviderSettingsManager\|ProviderSettingsManager\|saveProviderSettings" -n src/sdk/model-catalog --include='*.ts'`
  - Production write-capable provider settings API usage is localized to `store.ts`.
  - `effective-config.ts` reads from `StateManager` and `getProviderSettingsManager().getProviderSettings(...)`, but does not write.
- Grep: `grep -R "as ProviderId\|as Fingerprint" -n src/sdk/model-catalog --include='*.ts'`
  - Branded casts are only in `provider-id.ts` and `fingerprint.ts`, the allowed parse/compute boundary functions.

Decision:

- CHECKPOINT 1 passed.
- Proceed to Phase 2.1 SDK spike.

## 2026-05-12 — Opus review follow-up hardening

Follow-up from Opus 4.7 review of commits `63ed64594..b9f639e49`:

- Added explicit `nousResearch`/`nousresearch` casing coverage for `ProviderConfigStore.write`, `commitSelection`, and `readSelection`.
- Added explicit `nousResearch` casing coverage for `buildEffectiveProviderConfig` reading `nousResearchApiKey` from StateManager after provider id normalization.
- Documented the generic-provider `ModelInfo` in-process selection map in `store.ts` as transitional Phase 1.4 compatibility only. Runtime correctness must not depend on it across reloads; durable selection-envelope storage remains a required follow-up before runtime reads generic selections directly.

Decision:

- This hardening addresses the concrete casing concern before Phase 2.2.
- Mapping-table drift remains a known refactor candidate, but not a Phase 2.2 blocker.

## 2026-05-12 — Phase 2.2 shape-adapter metadata gaps

Decision for the initial `adaptSdkModelInfo` implementation:

- Map only SDK-owned metadata observed in `tmp/sdk-spike-findings.md`: `id`, `name`, `contextWindow`, `maxTokens`, `capabilities`, `pricing`, and `description`.
- Validate sparse SDK model info; only `id: string` is required.
- Do not invent extension-only behavior metadata in the adapter.

Fields intentionally left for host enrichment or upstream SDK metadata:

- `thinkingConfig`
- `tiers` / tiered pricing
- `temperature`
- `apiFormat`
- `supportsGlobalEndpoint`
- LM Studio loaded/max context metadata beyond generic `contextWindow`
- OCA survey/banner/reasoning-effort metadata

Rationale:

The adapter is a boundary translation layer, not model-business logic. Host-specific behavior metadata should be added later in an explicit enrichment step inside the catalog or upstreamed into the SDK, with tests per provider.

## 2026-05-12 — CHECKPOINT 2 SDK adapter review

Reviewer: Opus 4.7 teammate (`opus47_checkpoint2_review`, run `run_00009`).

Verdict: **PASS**.

Evidence summarized by reviewer:

- `adaptSdkModelInfo` validates `unknown` input at the boundary and throws `CatalogShapeError` for malformed shapes.
- The function is total over accepted SDK-shaped inputs and deterministic.
- Sparse SDK model info is supported; only `id: string` is required.
- Defaults and lossy/unmapped fields are documented in `shape-adapter.ts` and this decisions file.
- `shape-adapter.test.ts` covers validation, capabilities, pricing, sparse input defaults, rich input mapping, unmapped field dropping, and non-mutation.
- `src/sdk/spike/catalog-spike.ts` is deleted; `tmp/sdk-spike-findings.md` remains.

Non-blocking cautions:

- The adapter intentionally does not map extension behavior metadata such as `thinkingConfig`, `apiFormat`, tiered pricing, or local provider loaded-context metadata. Those require host enrichment/upstream SDK work in later phases.
- Phase 3 agents should be prompted to translate `CatalogShapeError` into a catalog error arm and avoid caching failed shape-validation results.

Decision:

- CHECKPOINT 2 passed.
- Proceed to Phase 3.

## 2026-05-12 — Phase 3.1 cache/in-flight review

Reviewer: Opus 4.7 teammate (`opus47_phase31_review`, run `run_00010`).

Verdict: **pass with cautions — OK to commit before Phase 3.2**.

Evidence summarized by reviewer:

- Cache map is keyed by `${providerId}:${fingerprint}`.
- Records carry per-record `expiresAt` computed from injected `now() + ttlMs`.
- In-flight map is keyed identically and returns the same promise for matching provider/fingerprint.
- Tests cover provider/fingerprint cache identity, different fingerprint separation, in-flight reuse/non-reuse, and expiry.

Non-blocking cautions for Phase 3.2:

- `_testing` is acceptable as a temporary internal test hook for the cache substrate, but Phase 3.2 should exercise cache behavior through `resolveModels` once resolver wiring exists.
- Cache `set()` currently trusts that the loaded record's provider/fingerprint match the requested key. Phase 3.2 should add an invariant assertion before caching records produced by SDK resolution.
- Error/shape failures must not be cached in Phase 3.3.

Decision:

- Proceed with Phase 3.1 commit.
- Carry the record-key assertion into Phase 3.2 implementation.

## 2026-05-12 — Phase 3.2 resolveModels happy-path review

Reviewer: Opus 4.7 teammate (`opus47_phase32_review`, runs `run_00011`-`run_00013`).

Verdict: **pass with cautions — OK to commit before Phase 3.3**.

Evidence summarized by reviewer:

- `resolveModels` reads effective config through `ProviderConfigReader`, computes a config fingerprint, and uses provider+fingerprint cache/in-flight identity.
- SDK calls are deduped for matching provider/fingerprint and separated for different fingerprints.
- `forceRefresh` bypasses cache while still honoring in-flight dedupe.
- SDK `knownModels` are adapted through `adaptSdkModelInfo`, and a cache record key assertion runs before storing results.
- The catalog remains read-only with respect to the store; no `write`/`commitSelection` calls are present in `catalog.ts`.

Non-blocking cautions for Phase 3.3+:

- `reader.readSelection(providerId, "act")` is currently only an SDK model-id hint, not model-list identity; future mode-aware catalog surfaces should thread mode explicitly if needed.
- Empty `knownModels` currently returns an empty success result with `defaultModelId: ""`; Phase 3.3 should decide whether this remains success or becomes a config/empty error arm.
- `source` is currently `"sdk-dynamic"` for all SDK successful results, even when SDK internally used bundled fallback; source semantics should be refined when SDK exposes enough metadata or when fallbacks are layered.
- Phase 3.3 must translate SDK errors and `CatalogShapeError` into error arms and must not cache failed results.

Decision:

- Proceed with Phase 3.2 commit.
- Carry source/empty-result/error-arm policy into Phase 3.3.

## 2026-05-12 — Phase 3.2 resolveModels happy-path review

Reviewer: Opus 4.7 teammate (`opus47_phase32_review`, runs `run_00011`-`run_00013`).

Verdict: **pass with cautions — OK to commit before Phase 3.3**.

Evidence summarized by reviewer:

- `resolveModels` reads effective config through `ProviderConfigReader`, computes a config fingerprint, and uses provider+fingerprint cache/in-flight identity.
- SDK calls are deduped for matching provider/fingerprint and separated for different fingerprints.
- `forceRefresh` bypasses cache while still honoring in-flight dedupe.
- SDK `knownModels` are adapted through `adaptSdkModelInfo`, and a cache record key assertion runs before storing results.
- The catalog remains read-only with respect to the store; no `write`/`commitSelection` calls are present in `catalog.ts`.

Non-blocking cautions for Phase 3.3+:

- `reader.readSelection(providerId, "act")` is currently only an SDK model-id hint, not model-list identity; future mode-aware catalog surfaces should thread mode explicitly if needed.
- Empty `knownModels` currently returns an empty success result with `defaultModelId: ""`; Phase 3.3 should decide whether this remains success or becomes a config/empty error arm.
- `source` is currently `"sdk-dynamic"` for all SDK successful results, even when SDK internally used bundled fallback; source semantics should be refined when SDK exposes enough metadata or when fallbacks are layered.
- Phase 3.3 must translate SDK errors and `CatalogShapeError` into error arms and must not cache failed results.

Decision:

- Proceed with Phase 3.2 commit.
- Carry source/empty-result/error-arm policy into Phase 3.3.

## 2026-05-12 — Phase 3.3 error-path review

Reviewer: Opus 4.7 teammate (`opus47_phase33_review`, runs `run_00014`-`run_00015`).

Verdict: **pass — OK to commit before Phase 3.4**.

Evidence summarized by reviewer:

- Failure results are not cached: cache `set()` only runs in the success `.then(...)` path.
- In-flight entries are cleaned up on both success and rejection via `.finally(...)`.
- SDK rejection returns an `ok: false` error arm with provider id, fingerprint, error, and timestamp.
- `CatalogShapeError` is distinguished and mapped to `error.kind: "shape"`.
- Same-fingerprint calls retry after SDK and shape failures.

Non-blocking cautions:

- `toCatalogError` currently collapses all non-shape errors to `kind: "unknown"`; future work can preserve provider status/code when SDK exposes one and map obvious auth/network cases.
- Error objects intentionally avoid raw SDK error details; keep this behavior unless a redaction-safe diagnostic path is added.

Decision:

- Proceed with Phase 3.3 commit.
- Carry richer error classification/status-code preservation as a later hardening task.

## 2026-05-12 — Phase 3.4 store-driven invalidation review

Reviewer: Opus 4.7 teammate (`opus47_phase34_review`, run `run_00016`).

Verdict: **pass with cautions — OK to commit before Phase 3.5**.

Evidence summarized by reviewer:

- Catalog subscribes to the read-only store interface and handles `fields` events.
- On `fields`, it recomputes the latest effective config fingerprint for the changed provider and invalidates only cached records for that provider whose fingerprint no longer matches.
- `selection` events are ignored and do not invalidate model-list cache.
- Tests cover old-fingerprint invalidation, preserving the current fingerprint, preserving other providers' cache entries, and selection changes not invalidating cache.

Non-blocking cautions:

- `createProviderCatalog` does not currently expose a dispose path for its store subscription. This is acceptable for now because the public `ProviderCatalog` contract has no dispose method, but lifecycle cleanup may need attention when controller singletons are wired.
- Phase 3.6 subscription tests should ensure selection events alone do not notify model-list subscribers.

Decision:

- Proceed with Phase 3.4 commit.
- Revisit catalog lifecycle disposal when integrating into controller startup/shutdown if needed.

## 2026-05-12 — Phase 3.5 listProviders implementation

Implementation source:

- GPT-5.5 teammate implementation in `/Users/dpc/clients/cline/cline2` was used as the base.
- Lead review/synthesis added failure retry behavior for the per-catalog listing promise.
- The planned Opus 4.7 review could not complete because the team runtime reset, so the lead performed the architectural review directly before commit.

SDK API decision:

- Use `getAllProviders()` from `@clinebot/llms`.
- Do not use settings-backed/local provider listing APIs for Phase 3.5 because top-level provider listings must not read provider config or pull catalog listing toward provider settings storage.

Behavior:

- `ProviderCatalog.listProviders()` maps SDK `ProviderInfo` to lightweight `ProviderListing` records.
- Full model lists are intentionally omitted; provider models still flow through `resolveModels`.
- The listing promise is cached per catalog instance and reset on failure so a transient SDK listing error can be retried.
- The catalog still accepts only `ProviderConfigReader` and does not call `write` or `commitSelection`.

Validation:

- `npm run check-types -- --pretty false` passed. This also ran `npm run protos`, which generated missing proto outputs required by the focused vitest run.
- `NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/sdk/model-catalog/catalog.test.ts --reporter=dot` passed after proto generation: 1 file, 22 tests.
- Grep for `\.write\|commitSelection` in `catalog.ts` shows only the invariant doc comment.
- Grep for `as ProviderId\|as Fingerprint` under `src/sdk/model-catalog` shows only the expected contract comments and parse/compute boundary casts.

Decision:

- Phase 3.5 is complete.
- Proceed to Phase 3.6 (`subscribe(providerId, listener)`).

## 2026-05-13 — Phase 3.6 ProviderCatalog subscription implementation

Implementation:

- Added a per-provider listener registry inside `createProviderCatalog`.
- `resolveModels` now notifies listeners after completion for the requested provider.
- Notifications fire for successful fresh results, cache-hit results, and error-arm results.
- Store `selection` events still do not trigger model-list notifications; they are unrelated to catalog model-list freshness.
- The returned `Disposable` unregisters the listener and removes the empty provider listener set.

Validation:

- `npm run protos` completed successfully.
- `npm run check-types -- --pretty false` passed.
- `NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/sdk/model-catalog/catalog.test.ts --reporter=dot` passed after proto/typecheck generation: 1 file, 27 tests.
- `git diff --check` passed.
- Grep for `\.write\|commitSelection` in `catalog.ts` shows only the invariant doc comment.
- Grep for `as ProviderId\|as Fingerprint` under `src/sdk/model-catalog` shows only the expected contract comments and parse/compute boundary casts.

Decision:

- Phase 3.6 is complete.
- Proceed to CHECKPOINT 3 review.

## 2026-05-13 — CHECKPOINT 3 catalog review

Reviewer: Opus 4.7 teammate (`opus47_checkpoint3_review`, run `run_00001`).

Verdict: **PASS**.

Evidence:

- `createProviderCatalog` accepts `ProviderConfigReader`, not `ProviderConfigStore`.
- Grep for `\.write\|commitSelection` in `src/sdk/model-catalog/catalog.ts` shows only the invariant doc comment; the catalog does not call store write APIs.
- Cache and in-flight maps are keyed by `${providerId}:${fingerprint}`.
- Cache `set()` asserts the resolved record's provider/fingerprint matches the request before storing.
- Error arms are not cached; in-flight entries are cleaned up with `finally`.
- Store `fields` events invalidate only non-matching fingerprints for the affected provider.
- Store `selection` events do not invalidate cache and do not notify model-list subscribers.
- Provider model subscribers are keyed by provider id, fire after each `resolveModels` completion for that provider, including cache hits, and dispose unregisters them.
- No raw secrets are used in cache keys: fingerprints are opaque sha256 values and secret inputs are short-hashed before fingerprinting.
- Grep for `as ProviderId\|as Fingerprint` under `src/sdk/model-catalog` shows only contract comments and the allowed parse/compute boundary casts.

Validation:

- `npm run protos` passed.
- `for i in 1 2 3 4 5; do NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/sdk/model-catalog/catalog.test.ts --reporter=dot; done` passed: 5/5 runs, 27 tests each.
- `npm run check-types -- --pretty false` passed.

Non-blocking cautions:

- `listProviders` uses `authDescription` as the lightweight provider description slot because `ProviderListing` does not yet have a generic `description` field. Revisit if Phase 4 proto/UI needs a clearer field.
- The catalog holds the store subscription for the catalog lifetime; lifecycle disposal can be revisited when controller singletons are wired.

Decision:

- CHECKPOINT 3 passed.
- Proceed to Phase 4.1 proto plumbing.

## 2026-05-13 — Phase 4.1 proto definitions

Implementation:

- Added five RPCs to `ModelsService` in `proto/cline/models.proto`:
  - `listProviders(Empty) returns (ProviderListingsResponse)`
  - `resolveProviderModels(ResolveProviderModelsRequest) returns (ProviderModelsResponse)`
  - `readProviderConfig(StringRequest) returns (ProviderConfigResponse)`
  - `writeProviderConfig(WriteProviderConfigRequest) returns (ProviderConfigResponse)`
  - `commitModelSelection(CommitModelSelectionRequest) returns (Empty)`
- Added lightweight provider-listing messages.
- Added provider-model response messages carrying full `map<string, OpenRouterModelInfo>` model metadata, preserving the existing full protobuf `ModelInfo` representation.
- Added redacted provider-config response and write-patch messages.
- Used a string `mode` field in `CommitModelSelectionRequest` (`"plan"`/`"act"`) rather than importing `PlanActMode` from `state.proto`, because `state.proto` already imports `models.proto` and a reverse import would create a proto cycle. Phase 4.2 handlers must validate this boundary string.

Validation:

- `npm run protos` passed.
- Generated `src/shared/proto/cline/models.ts` contains `ProviderListingsResponse`, `ResolveProviderModelsRequest`, `ProviderModelsResponse`, `ProviderConfigResponse`, and `CommitModelSelectionRequest`.
- Generated service definitions contain all five new RPCs.
- `git diff --check` passed.
- `npm run check-types -- --pretty false` currently fails only because generated protobus setup imports the Phase 4.2 handler files that do not exist yet:
  - `@core/controller/models/listProviders`
  - `@core/controller/models/resolveProviderModels`
  - `@core/controller/models/readProviderConfig`
  - `@core/controller/models/writeProviderConfig`
  - `@core/controller/models/commitModelSelection`

Decision:

- Phase 4.1 proto definition is complete.
- Proceed to Phase 4.2 handlers to restore full typecheck.

## 2026-05-13 — Phase 4.2 provider model catalog handlers

Implementation:

- Added handler files under `src/core/controller/models/`:
  - `listProviders.ts`
  - `resolveProviderModels.ts`
  - `readProviderConfig.ts`
  - `writeProviderConfig.ts`
  - `commitModelSelection.ts`
- Added `providerCatalogShared.ts` for boundary validation and proto conversion helpers.
- Added `ProviderConfigStore` and `ProviderCatalog` singletons to `SdkController`, initialized at controller startup and exposed through `getProviderConfigStore()` / `getProviderCatalog()`.
- Handlers are thin and use the controller-provided singleton store/catalog rather than constructing fresh instances.
- `readProviderConfig` and `writeProviderConfig` return redacted config responses (`has_api_key`, `has_access_token`, `has_refresh_token`) and never serialize raw secrets.
- `commitModelSelection` validates the boundary `mode` string (`"plan"` / `"act"`) before committing a full `{providerId, modelId, modelInfo}` selection envelope.
- Expanded `toProtobufModelInfo` / `fromProtobufModelInfo` to preserve `name`, `temperature`, and `apiFormat`, matching the richer `OpenRouterModelInfo` proto shape.
- Expanded `vitest.config.sdk.ts` to include the new handler tests and the aliases they need.

Validation:

- `npm run protos` passed.
- `NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/core/controller/models/__tests__/providerCatalogHandlers.test.ts --reporter=dot` passed: 1 file, 6 tests.
- `NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/sdk/model-catalog/catalog.test.ts src/core/controller/models/__tests__/providerCatalogHandlers.test.ts --reporter=dot` passed: 2 files, 33 tests.
- `npm run check-types -- --pretty false` passed, restoring the full typecheck that Phase 4.1 intentionally broke until handlers existed.
- `git diff --check` passed.

Decision:

- Phase 4.2 handlers are complete.
- Proceed to Phase 4.3 backend integration smoke test.

## 2026-05-13 — Phase 4.3 backend integration smoke test

Implementation:

- Added a Node-side smoke test: `src/core/controller/models/__tests__/providerCatalogSmoke.test.ts`.
- The smoke test initializes a temporary file-backed `StateManager`, creates real `ProviderConfigStore` and `ProviderCatalog` instances, and exercises the handler boundary:
  - `listProviders` returns at least four providers and includes `deepseek`.
  - `resolveProviderModels({ providerId: "deepseek" })` returns at least four models.
  - `commitModelSelection({ providerId: "deepseek", mode: "act", modelId, modelInfo })` commits a full selection envelope.
  - `readProviderConfig(StringRequest("deepseek"))` round-trips the committed act selection.
- Added `plan_selection` / `act_selection` to `ProviderConfigResponse` so the Phase 4.3 round-trip assertion is expressible without exposing secrets.
- Added a minimal `src/test/vscode-vitest-stub.ts` and mapped `vscode` to it in `vitest.config.sdk.ts` so backend Node-side smoke tests can import storage/host-adjacent code without launching VS Code.
- Mocked `initializeDistinctId` in the smoke test; machine identity/host identity is unrelated to model-catalog handler behavior and otherwise requires a fully initialized `HostProvider`.

Validation:

- `npm run protos` passed.
- `NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/core/controller/models/__tests__/providerCatalogSmoke.test.ts --reporter=dot` passed: 1 file, 1 test.
- `NODE_ENV=production npx vitest run --config vitest.config.sdk.ts src/sdk/model-catalog/catalog.test.ts src/core/controller/models/__tests__/providerCatalogHandlers.test.ts src/core/controller/models/__tests__/providerCatalogSmoke.test.ts --reporter=dot` passed: 3 files, 34 tests.
- `npm run check-types -- --pretty false` passed.
- `git diff --check` passed.

Note:

- Immediately after `npm run protos`, the first Vitest invocation can intermittently fail to resolve freshly generated `src/shared/proto/...` modules in this workspace. Re-running the same Vitest command after `check-types` / generation completes succeeds. The final validation commands above passed.

Decision:

- Phase 4.3 is complete.
- Proceed to CHECKPOINT 4 review.

## 2026-05-13 — CHECKPOINT 4 RPC plumbing review

Reviewer: Opus 4.7 (user-provided verdict).

Verdict: **PASS**.

Decision:

- CHECKPOINT 4 passed.
- Proceed to Phase 5 webview foundation.

## 2026-05-13 — Phase 5.1 webview provider-model state shape

Implementation:

- Added normalized provider model state to `webview-ui/src/context/ExtensionStateContext.tsx`:
  - `providerModelsByProvider: Partial<Record<ProviderId, ProviderModelsState>>`
  - `latestModelRequestIdByProvider: Partial<Record<ProviderId, string>>`
- Added `startProviderModelsRequest(providerId, requestId)` to set the latest request id and mark the provider model state loading.
- Added `applyProviderModelsResponse(response)` with the stale-response apply rule:
  - apply only when `response.requestId === latestModelRequestIdByProvider[response.providerId]`
  - otherwise drop the response and log a debug message.
- Kept all existing provider-specific model state variables and refresh paths in place.

Validation:

- `npm run check-types -- --pretty false` passed.
- `cd webview-ui && npx tsc --noEmit --pretty false` passed.
- `npm run compile` passed, including typecheck, lint, proto lint, and esbuild.

Decision:

- Phase 5.1 is complete.
- Proceed to Phase 5.2 (`useProviderModels`).

## 2026-05-13 — Phase 5.2 useProviderModels hook

Implementation:

- Added `webview-ui/src/hooks/useProviderModels.ts`.
- The hook exposes `{ models, defaultModelId, isLoading, isStale, error, refresh, fingerprint }` for a provider id.
- On mount it calls `refresh()`.
- `refresh()` generates a request id, calls `startProviderModelsRequest(providerId, requestId)`, invokes `ModelsServiceClient.resolveProviderModels({ providerId, forceRefresh: true, requestId })`, and sends the response through `applyProviderModelsResponse`.
- RPC errors are converted into an error-shaped `ProviderModelsResponse` with the same request id, so the context apply rule still controls staleness.
- The hook does not import or call any selection-commit client/API.

Tests:

- Added `webview-ui/src/hooks/useProviderModels.test.ts`.
- Tests cover:
  - matching request id response is applied,
  - mismatched request id response is dropped by the apply rule,
  - two rapid refreshes only apply the second response.

Validation:

- `cd webview-ui && npx vitest run src/hooks/useProviderModels.test.ts --reporter=dot` passed: 1 file, 3 tests.
- `cd webview-ui && npx tsc --noEmit --pretty false` passed.
- `npm run check-types -- --pretty false` passed.

Decision:

- Phase 5.2 is complete.
- Proceed to Phase 5.3 (`useProviderConfig`).

## 2026-05-13 — Phase 5.2 request id simplification

Decision:

- Replaced `crypto.randomUUID()` request ids in `useProviderModels` with a simple module-local incrementing counter.
- The hook only needs request ids to be unique within the current webview process for stale-response rejection; global randomness is unnecessary.

Validation:

- `cd webview-ui && npx vitest run src/hooks/useProviderModels.test.ts --reporter=dot` passed: 1 file, 3 tests.
- `cd webview-ui && npx tsc --noEmit --pretty false` passed.
- `npm run check-types -- --pretty false` passed.

## 2026-05-13 — Phase 5.3 useProviderConfig hook

Implementation:

- Added `webview-ui/src/hooks/useProviderConfig.ts`.
- The hook exposes `{ config, write, commitSelection }` for a provider id.
- On mount/provider change it calls `ModelsServiceClient.readProviderConfig(StringRequest({ value: providerId }))` and stores the redacted config response locally.
- `write(patch)` calls `ModelsServiceClient.writeProviderConfig(...)`, stores the returned redacted config, and returns it.
- `commitSelection(mode, selection)` validates the selection provider id matches the hook provider id, calls `ModelsServiceClient.commitModelSelection(...)` with full `modelId` + protobuf `modelInfo`, then refreshes config via `readProviderConfig` so callers see the committed selection returned by Phase 4.3.
- The implementation intentionally uses read-on-mount plus pull-after-mutation rather than an existing webview state-push subscription for provider config; no provider-config push event exists yet, so CHECKPOINT 5 should treat this as a conscious interim trade-off rather than an accidental omission.

Tests:

- Added `webview-ui/src/hooks/useProviderConfig.test.ts`.
- Tests cover mount read, write round-trip, commit-selection round-trip, and mismatched-provider validation before RPC call.

Validation:

- `cd webview-ui && npx vitest run src/hooks/useProviderConfig.test.ts --reporter=dot` passed: 1 file, 4 tests.
- `cd webview-ui && npx vitest run src/hooks/useProviderModels.test.ts src/hooks/useProviderConfig.test.ts --reporter=dot` passed: 2 files, 7 tests.
- `cd webview-ui && npx tsc --noEmit --pretty false` passed.
- `npm run check-types -- --pretty false` passed.

Note:

- As with prior focused webview tests, the first Vitest invocation immediately after proto generation can fail to resolve freshly generated `@shared/proto/...` modules. Re-running the same command after generation/typecheck completes succeeds; the final validation above passed.

Decision:

- Phase 5.3 is complete.
- Proceed to Phase 5.4 (`ModelPickerWithManualEntry`).

## 2026-05-13 — Phase 5.4 ModelPickerWithManualEntry

Implementation:

- Added `webview-ui/src/components/settings/providers/ModelPickerWithManualEntry.tsx`.
- Props follow the Phase 5.4 shape and `selectedModel` / `onSelect` use a full selection envelope: `{ providerId, modelId, modelInfo }`.
- Known model dropdown selections construct `modelInfo` from the current `models` map.
- Custom/manual model ids use `openAiModelInfoSafeDefaults` plus the custom model name.
- Manual entry is available for custom-id providers during loading, error, empty-list, and selected-not-in-current-list states.
- Selecting the `Use custom model ID…` affordance reveals manual entry when a model list is present.
- Stale and not-in-current-list indicators are visible and do not auto-replace selection.

Review:

- Opus 4.7 teammate (`opus47_phase54_review`, run `run_00002`) reviewed the component and returned **PASS with cautions, no blockers**.
- Follow-up from review/self-check: the custom affordance now reveals the manual-entry form when selected.

Tests:

- Added `webview-ui/src/components/settings/providers/ModelPickerWithManualEntry.test.tsx`.
- Tests cover known-model selection, loading manual entry, error manual entry, custom commit with safe defaults, custom-option reveal, stale indicator, and not-in-current-list indicator.

Validation:

- `cd webview-ui && npx vitest run src/components/settings/providers/ModelPickerWithManualEntry.test.tsx --reporter=dot` passed: 1 file, 6 tests.
- `cd webview-ui && npx vitest run src/hooks/useProviderModels.test.ts src/hooks/useProviderConfig.test.ts src/components/settings/providers/ModelPickerWithManualEntry.test.tsx --reporter=dot` passed: 3 files, 13 tests.
- `cd webview-ui && npx tsc --noEmit --pretty false` passed.
- `npm run check-types -- --pretty false` passed.
- `npm run compile` passed before the final custom-affordance follow-up; the final changes were then covered by focused tests and typecheck.

Decision:

- Phase 5.4 is complete.
- Proceed to CHECKPOINT 5 review.

## 2026-05-13 — Phase 5.4 review follow-up hardening

Follow-up from Opus 4.7 review surfaced by user:

- The selected-not-in-current-list indicator originally only rendered when `allowsCustomIds` was true. It now renders for any provider when the selected model id is missing from the current model map, while manual entry remains gated by `allowsCustomIds`.
- Added a direct picker-level no-auto-select test for mid-refresh prop changes (`models={}` → populated `models`) to close the loop on the no mid-refresh paint invariant at the picker layer.

Validation:

- `cd webview-ui && npx vitest run src/components/settings/providers/ModelPickerWithManualEntry.test.tsx --reporter=dot` passed: 1 file, 8 tests.
- `cd webview-ui && npx tsc --noEmit --pretty false` passed.
- `npm run check-types -- --pretty false` passed.
