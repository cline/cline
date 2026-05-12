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
