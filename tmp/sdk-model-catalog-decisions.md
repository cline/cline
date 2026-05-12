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
