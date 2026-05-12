# SDK-backed Model Catalog: Step-by-Step Implementation Plan

> Companion to `tmp/sdk-model-catalog-design.md` (the *why*) and `tmp/sdk-model-catalog-architecture.md` (the *what shape*). This doc is *what to do, in what order, with what exit criteria*. It is written so a simpler agent can execute it linearly and a senior reviewer can verify progress at checkpoints.

## How to use this document

Read `sdk-model-catalog-architecture.md` first. It defines the abstractions (`ProviderConfigStore`, `ProviderCatalog`), invariants, and dependency graph that every step here is shaped around. If a step here ever seems to contradict the architecture doc, the architecture doc wins; stop and raise a checkpoint.

Execution is type-first, then test, then assertion, then observability. Most failure modes are addressed structurally (the type system makes them not type-check) rather than caught by tests. Tests carry residual behavior. Treat each phase's exit criteria as the gate to the next; do not jump ahead.

## Operating Principles (read first, every time)

These come from the architecture doc. Repeating here so they're impossible to miss.

1. **The runtime is dumb.** Reads `{providerId, modelId, modelInfo, apiKey, baseUrl}` from a snapshot of `ProviderConfigStore` at task start, uses verbatim.
2. **The picker is the only careful thing.** Fingerprint, race, freshness machinery lives in `ProviderCatalog`.
3. **Refresh writes lists, not selections.** Enforced by type: `ProviderCatalog` cannot call `commitSelection`.
4. **`ModelInfo` is part of the selection envelope.** `commitSelection` takes the full triple atomically.
5. **Writes through abstractions update in-memory state synchronously before returning.** Disk persistence may be debounced.
6. **Types > assertions > tests.** Write the type or assertion first; reach for a test only when neither suffices.
7. **Observability is the long tail of assertions.**

## Language convention

Use "safe defaults," not "sane defaults." The existing `openAiModelInfoSaneDefaults` is renamed to `openAiModelInfoSafeDefaults` as part of Phase 0.

---


## Phase 0 — Contracts (types only, no behavior)

**Goal:** A `contracts.ts` file with every load-bearing type. Code that uses these types compiles against dummy implementations. Nothing works yet. Compile errors light up every place in the existing codebase that doesn't fit the abstraction; those are the bug list for later phases.

### Step 0.1 — Create `contracts.ts`

**Entry:**
- On a branch off `staging-environment`.
- Architecture doc is read.

**Task:**
- Create `src/sdk/model-catalog/contracts.ts`.
- Define every load-bearing type from the architecture doc: `ProviderId`, `ModelSelection`, `EffectiveProviderConfig`, `ProviderConfigPatch`, `Fingerprint`, `ProviderModelsResult`, `ProviderModelsEvent`, `ProviderConfigChange`, `ProviderListing`, `CatalogError`, `ProviderConfigStore` interface, `ProviderCatalog` interface, `Disposable`, `Mode` (re-export from existing).
- Branded types (`ProviderId`, `Fingerprint`) use `unique symbol` brands.
- Each type has a brief docstring stating its invariant.
- No imports of SDK packages. No runtime values yet.

**Exit:**
- `npx tsc --noEmit src/sdk/model-catalog/contracts.ts` succeeds.
- File is ≤ 250 lines.
- Every type from the architecture doc's "Load-bearing types" list is present.

### Step 0.2 — Rename `openAiModelInfoSaneDefaults`

**Entry:** Step 0.1 done.

**Task:**
- Rename `openAiModelInfoSaneDefaults` → `openAiModelInfoSafeDefaults` in `webview-ui/src/components/settings/utils/providerUtils.ts`.
- Update all import sites (use `grep -rln "openAiModelInfoSaneDefaults" src/ webview-ui/src/`).
- No behavior change.

**Exit:**
- `grep -rn "SaneDefaults" src/ webview-ui/src/` returns no hits.
- `npm run compile` succeeds.

### Step 0.3 — Skeleton modules with dummy implementations

**Entry:** Step 0.1, 0.2 done.

**Task:**
- Create the file layout from the architecture doc, each with a minimal dummy export:
  - `src/sdk/model-catalog/provider-id.ts`: `parseProviderId(raw): ProviderId` that returns `raw as ProviderId` (one of the few permitted casts; isolated to the parse function). Plus `isKnownProviderId(id)` predicate that returns `true` for the always-true case.
  - `src/sdk/model-catalog/fingerprint.ts`: `computeConfigFingerprint(providerId, config): Fingerprint` returns a constant placeholder.
  - `src/sdk/model-catalog/effective-config.ts`: `buildEffectiveProviderConfig(providerId): EffectiveProviderConfig` returns a hardcoded empty value.
  - `src/sdk/model-catalog/store.ts`: `createProviderConfigStore(): ProviderConfigStore` returning a stub that throws on every method.
  - `src/sdk/model-catalog/shape-adapter.ts`: `adaptSdkModelInfo(input): ModelInfo` returns `openAiModelInfoSafeDefaults`.
  - `src/sdk/model-catalog/catalog.ts`: `createProviderCatalog(store): ProviderCatalog` returning a stub that throws.
  - `src/sdk/model-catalog/index.ts`: re-exports the public surface.
- Each file has a one-line comment: `// Phase 0 stub. Behavior added in Phase N.`

**Exit:**
- `npm run compile` succeeds (the stubs are valid TS even if they throw at runtime).
- `src/sdk/model-catalog/index.ts` exports the two factory functions and the types from `contracts.ts`.
- No file in this directory imports from `@clinebot/*` yet (that comes later).

### Step 0.4 — Compile-error survey

**Entry:** Step 0.3 done.

**Task:**
- Create a single hidden type test: `src/sdk/model-catalog/_compile-survey.ts` that imports `ProviderConfigStore` and `ProviderCatalog` and writes commented-out lines representing each consumer pattern from the architecture doc's "Scenarios" section. For example:

```ts
// Scenario A: runtime reads a snapshot
// const config: EffectiveProviderConfig = store.read(providerId)
// const selection: ModelSelection | undefined = store.readSelection(providerId, "act")
```

Uncomment each and confirm the call site compiles against the contract. If anything doesn't compile, the contract is wrong; fix `contracts.ts`, not the call site.

**Exit:**
- All scenario patterns compile against the dummy implementations.
- Delete `_compile-survey.ts` (it was a discovery tool, not production code).
- Record any contract changes made during this step in `tmp/sdk-model-catalog-decisions.md`.

### CHECKPOINT 0 — Contracts review

**Reviewer:** Senior agent or human.


## Phase 1 — `ProviderConfigStore` implementation

**Goal:** A working `ProviderConfigStore` against current StateManager + `providers.json` + remote config. Selection storage handles Plan/Act correctly. Subscribers fire synchronously. No catalog work yet.

### Step 1.1 — `parseProviderId` and `ProviderId` predicates

**Entry:** CHECKPOINT 0 passed.

**Task:**
- Implement `parseProviderId(raw: string): ProviderId` for real. Accept any string, but log a one-time warning per unknown id. Returning a branded `ProviderId` is the contract.
- Implement `isKnownProviderId(id: ProviderId): id is KnownProviderId` against the existing `ApiProvider` union. `KnownProviderId` is a sub-brand of `ProviderId`.
- Unit tests: parse roundtrip, predicate behavior, no-cast escape.

**Exit:** Tests pass.

### Step 1.2 — `computeConfigFingerprint`

**Entry:** Step 1.1 done.

**Task:**
- Implement against the per-provider fingerprint-input lists from the design doc §Provider Configuration Mapping.
- API key fingerprint inputs use `sha256(key).slice(0, 12)`. Never raw keys.
- Tests:
  - Different base URL → different fingerprint (Ollama, LM Studio, LiteLLM).
  - Different API key → different fingerprint.
  - Same effective config → same fingerprint (deterministic).
  - Sentinel `"SECRET_SENTINEL_ABC"` as key does not appear in fingerprint output.
  - Different `apiLine` (Qwen/Z.AI/Moonshot/Minimax) → different fingerprint.
  - OpenAI-compatible custom headers included.

**Exit:** Tests pass.

### Step 1.3 — `buildEffectiveProviderConfig`

**Entry:** Step 1.2 done.

**Task:**
- Internal-to-store function. Reads from `StateManager.get()` (in-memory cache) plus SDK's `ProviderSettingsManager` (`providers.json`) plus remote config overlays.
- Merge order: provider-owned fields from `providers.json` → VSCode-specific from StateManager → remote config overrides last.
- Returns `EffectiveProviderConfig` carrying `providerId`, `apiKey?`, `baseUrl?`, `apiLine?`, `headers?`, `region?`. Mode-dependent selection is read separately via `readSelection`.
- Unit tests with mocked StateManager and `providers.json`. Cover Ollama, LiteLLM, DeepSeek, Qwen (apiLine), and one remote-config-locked case.

**Exit:** Tests pass.

**What to check:**

### Step 1.4 — `ProviderConfigStore` core implementation

**Entry:** Step 1.3 done.

**Task:**
- Implement `createProviderConfigStore()` returning a real `ProviderConfigStore`.
- `read(providerId)`: delegates to `buildEffectiveProviderConfig`. Returns fresh structurally equal object each call.
- `write(providerId, patch)`:
  - Updates the appropriate backing storage (StateManager for VSCode-specific; `providers.json` for provider-owned: apiKey/baseUrl/headers/region/apiLine/auth tokens).
  - In-memory cache updated synchronously before returning.
  - Disk persistence debounced via existing mechanisms.
  - Returns the new `EffectiveProviderConfig`.
  - Publishes a `ProviderConfigChange` event of kind `"fields"`.
- `commitSelection(providerId, mode, selection)`:
  - Selection (`modelId`, `modelInfo`) per mode → StateManager (per-provider `planModeXxxModelId`/`actModeXxxModelId` and `*ModelInfo` fields where they exist, otherwise the generic `planModeApiModelId`/`actModeApiModelId`).
  - `providers.json` `model` field is updated *only* when `planActSeparateModelsSetting=false`; with separate models on, `providers.json`'s single-model slot is left untouched to avoid Max's regression.
  - Publishes `ProviderConfigChange` of kind `"selection"` carrying the full `ModelSelection`.
- `readSelection(providerId, mode)`: reads back the triple. Returns `undefined` if any of `{modelId, modelInfo}` is missing.
- `subscribe(listener)`: registers and returns a `Disposable`. Listeners fire synchronously after each write, before write returns.

**Implementation notes:**
- The store interface does not distinguish secrets from non-secrets. Secrets live in the same `write`/`read` path and are included in `EffectiveProviderConfig` on the host. RPC handlers (Phase 2) redact at the serialization boundary.
- For Plan/Act with separate models on, both modes' selections live in StateManager only. `providers.json`'s `model` field is not used for Plan/Act distinction (per design doc §Provider Settings Storage Convergence).

**Tests:**
- Round-trip: `write` then `read` returns the written value.
- Round-trip: `commitSelection` then `readSelection` returns the committed triple.
- Plan/Act independence: with `planActSeparateModelsSetting=true`, commit Plan=A and Act=B, both round-trip independently. (Load-bearing: this is Max's regression.)
- Subscribers fire synchronously: `let fired = false; subscribe(() => { fired = true }); write(...); expect(fired).toBe(true)`.
- Multiple writes in a tick produce multiple events in order.
- `commitSelection` produces a `"selection"` event; `write` does not (type-enforced and runtime-tested).
- Secrets do not leak: write a sentinel apiKey; assert the JSON-serialized form of the value returned over the RPC redaction layer does not contain the sentinel.

**Exit:** All tests pass. Run 5× to confirm no flakes.

**Offramp:** If StateManager or `ProviderSettingsManager` cannot satisfy synchronous-cache-write-before-return for any field, raise CHECKPOINT 1a. Do not paper over.

### Step 1.5 — Audit existing settings-update RPC handlers

**Entry:** Step 1.4 done.

**Task:**
- Read `src/core/controller/state/updateSettings.ts` and `src/core/controller/state/updateSettingsCli.ts`.
- Confirm both write through `StateManager.setGlobalState`/`setSecret` synchronously before returning. Per design doc §10.
- This is verification, not refactor. Record findings in `tmp/sdk-model-catalog-decisions.md`. If a gap exists, file a fix as Step 1.5a with a minimal patch and a test.

**Exit:** Findings recorded; gap (if any) closed.

### CHECKPOINT 1 — Store solid?

**Reviewer:** Senior agent.

**What to check:**
- All Phase 1 tests pass deterministically.
- `ProviderConfigStore` implementation is the only module under `src/sdk/model-catalog/` that imports StateManager/`ProviderSettingsManager` write APIs. Grep confirms.
- Plan/Act regression test passes.
- `read`/`write` round-trip across all provider fingerprint inputs.
- No `as` casts in `store.ts` or `effective-config.ts` outside `parseProviderId`.

---

- `contracts.ts` matches the architecture doc. No missing types, no extra types, no fields renamed without reason.
- Branded types are constructor-controlled. No `as ProviderId` or `as Fingerprint` outside the parse/compute functions.
- Every interface method has a docstring with at least one invariant.
- `npm run compile` succeeds.
- A reviewer can read `contracts.ts` and the architecture doc and find no inconsistency.

## Phase 2 — SDK spike + shape adapter

**Goal:** A working `shape-adapter.ts` against real SDK output for the four representative providers. The catalog will use this in Phase 3. No catalog yet.

### Step 2.1 — Live SDK spike

**Entry:** CHECKPOINT 1 passed.

**Task:**
- Create `src/sdk/spike/catalog-spike.ts` (deleted at the end of Phase 2).
- For each of `deepseek`, `ollama`, `litellm`, `openrouter`:
  - Build a minimal SDK input from real config (real API keys for cloud providers; local endpoints for Ollama/LiteLLM).
  - Call the SDK function identified per design doc §SDK Model Resolution API Usage — start with `resolveProviderConfig` from `@clinebot/core`.
  - Log the returned `{models, defaultModelId, source}` and the raw `ModelInfo` shape.
- Record findings in `tmp/sdk-spike-findings.md`: SDK function name(s), model count per provider, default ids, raw `ModelInfo` field names, any surprises.

**Exit:**
- Findings file exists.
- DeepSeek returns ≥4 models.
- Ollama returns the locally installed models (or empty if endpoint unreachable; document the failure mode).

**Offramp:** If the SDK does not expose a usable resolver for any of the four, raise CHECKPOINT 2a. We may need to call multiple SDK functions and compose; that decision needs documentation.

### Step 2.2 — Implement `shape-adapter.ts`

**Entry:** Step 2.1 done.

**Task:**
- Implement `adaptSdkModelInfo(sdkInfo): ModelInfo` per the design doc §Shape Adapter, using the real SDK shape captured in `tmp/sdk-spike-findings.md`.
- **Validate at the boundary.** A schema check (hand-rolled or zod, decide and document) runs before mapping; on failure, throw a typed `CatalogShapeError` that the catalog will translate into `CatalogError`.
- Default missing optional fields to `openAiModelInfoSafeDefaults` values; document each default in a comment table at top of file.
- Tests:
  - Capability flags derive correctly from SDK `capabilities`.
  - Pricing maps correctly.
  - Missing optional fields produce documented safe defaults.
  - Validation failure throws `CatalogShapeError`.

**Exit:** Tests pass.

**Offramp:** If SDK metadata lacks fields the extension currently uses (thinking configs, apiFormat, LM Studio context length), do not invent the mapping. Raise CHECKPOINT 2b for each, record the decision (host-enrich vs upstream vs drop) in `tmp/sdk-model-catalog-decisions.md`.

### Step 2.3 — Clean up spike

**Entry:** Step 2.2 done.

**Task:** Delete `src/sdk/spike/catalog-spike.ts`. Keep `tmp/sdk-spike-findings.md`.

**Exit:** `git ls-files src/sdk/spike/` returns empty.

### CHECKPOINT 2 — SDK adapter ready?

**Reviewer:** Senior agent.

**Check:** `adaptSdkModelInfo` is a small, tested, total function with explicit boundary validation. The set of fields it loses or defaults is documented.

---

## Phase 3 — `ProviderCatalog` implementation

**Goal:** A working `ProviderCatalog` that uses the SDK, caches by fingerprint, dedups in-flight requests, and subscribes to `ProviderConfigStore` changes for cache invalidation.

### Step 3.1 — Cache + in-flight map

**Entry:** CHECKPOINT 2 passed.

**Task:**
- Inside `catalog.ts`, implement a private cache with:
  - `Map<string, ProviderModelsRecord>` keyed by `${providerId}:${fingerprint}`.
  - Per-record `expiresAt` for TTL.
  - `Map<string, Promise<ProviderModelsRecord>>` for in-flight requests, keyed identically.
- Encapsulate inside the catalog factory; not a separate exported module.
- Tests:
  - Cache hit only on both provider and fingerprint match.
  - Different fingerprints don't collide.
  - In-flight promise reuse only when both match.
  - Expired records return undefined.

**Exit:** Tests pass.

### Step 3.2 — `resolveModels` happy path

**Entry:** Step 3.1 done.

**Task:**
- Implement `resolveModels(providerId, { forceRefresh })`:
  1. Read effective config via `store.read(providerId)` (the store reference is passed at construction; the catalog only holds the read-capable view of the store, not the writer — enforced by accepting a read-only interface type).
  2. Compute fingerprint.
  3. If not `forceRefresh`, check cache.
  4. Check in-flight map for `${providerId}:${fingerprint}`.
  5. Otherwise: call SDK, run shape adapter, store record in cache, return.
- Return a `ProviderModelsResult` success arm with `models`, `defaultModelId`, `source`, `configFingerprint`, `fetchedAt`.
- Tests:
  - Cache hit returns cached without calling SDK (mock SDK, assert call count zero).
  - `forceRefresh: true` bypasses cache.
  - Concurrent calls with same provider+fingerprint share one SDK call.
  - Concurrent calls with different fingerprints make separate SDK calls.

**Exit:** Tests pass.

### Step 3.3 — Error path

**Entry:** Step 3.2 done.

**Task:**
- On SDK error or `CatalogShapeError`, return a `ProviderModelsResult` error arm with `error: CatalogError`, `models` empty, plus the fingerprint and timestamp.
- Do not poison the cache: error records are *not* stored.
- Tests:
  - SDK rejection produces error arm.
  - Shape validation failure produces error arm.
  - After an error, subsequent same-fingerprint call retries (no cached error).

**Exit:** Tests pass.

### Step 3.4 — Store-driven cache invalidation

**Entry:** Step 3.3 done.

**Task:**
- The catalog subscribes to `store.subscribe`.
- On a `"fields"` change for provider P, recompute the latest fingerprint for P. Invalidate any cached records for P that do not match the new fingerprint. (The new fingerprint's record may not exist yet; that's fine, next `resolveModels` will compute it.)
- On a `"selection"` change: no catalog action. Selection does not affect the model list.
- Tests:
  - Write to Ollama base URL → old-fingerprint cache record is invalidated; new-fingerprint cache is empty.
  - `commitSelection` does not invalidate cache.

**Exit:** Tests pass.

### Step 3.5 — `listProviders`

**Entry:** Step 3.4 done.

**Task:**
- Implement using SDK's `listLocalProviders` (Max's discovery) or `ensureCustomProvidersLoaded` per spike findings.
- Cached per-process (no fingerprint). Refreshed when the catalog is asked to (not on every call).
- The proto for `ProviderListing` must carry enough to drive the top-level picker: id, name, optional family/protocol, optional descriptions, optional default model id. Does **not** carry the full model list (use `resolveModels` for that).
- Tests: returns ≥1 provider against a mocked SDK list response.

**Exit:** Tests pass.

### Step 3.6 — `subscribe(providerId, listener)`

**Entry:** Step 3.5 done.

**Task:**
- Per-provider listener registry. Fires `ProviderModelsEvent` whenever `resolveModels` completes for that provider (regardless of whether the result was served from cache or freshly fetched).
- Tests:
  - Listener fires after `resolveModels`.
  - Listener does not fire when only `commitSelection` happens.
  - Disposable returned by `subscribe` actually unregisters.

**Exit:** Tests pass.

### CHECKPOINT 3 — Catalog solid?

**Reviewer:** Senior agent.

**What to check:**
- `ProviderCatalog` does not hold a write-capable reference to the store. Grep confirms `commitSelection` and `write` are not called from `catalog.ts`. The store reference's type is a read-only subset (`ProviderConfigReader` interface or equivalent in `contracts.ts`).
- Cache and in-flight maps cannot be reached by non-matching fingerprints.
- All Phase 3 tests pass 5× without flake.

---



**Decision:** Proceed to Phase 1, or revise contracts.


## Phase 4 — RPC plumbing

**Goal:** Five RPCs that expose `ProviderConfigStore` and `ProviderCatalog` to the webview. No existing RPCs touched yet.

### Step 4.1 — Define proto

**Entry:** CHECKPOINT 3 passed.

**Task:**
- Edit `proto/cline/models.proto`. Add:
  - `rpc listProviders(Empty) returns (ProviderListingsResponse);`
  - `rpc resolveProviderModels(ResolveProviderModelsRequest) returns (ProviderModelsResponse);` (carries `provider_id`, `force_refresh`, returns models + default + source + `config_fingerprint`)
  - `rpc readProviderConfig(StringRequest) returns (ProviderConfigResponse);` (provider_id; returns redacted effective config — fields safe to display, with secrets booleanized to `has_api_key`/`has_access_token`)
  - `rpc writeProviderConfig(WriteProviderConfigRequest) returns (ProviderConfigResponse);` (provider_id + patch; returns the updated redacted config)
  - `rpc commitModelSelection(CommitModelSelectionRequest) returns (Empty);` (provider_id, mode, model_id, model_info)
- The `ProviderModelsResponse` carries full `ModelInfo` (context window, pricing, capabilities). **This is the lesson from Max's commit: the proto must not impoverish the data.**
- Do not delete or modify any existing RPC.
- Run `npm run protos`.

**Exit:** `npm run protos` succeeds. Generated types appear in `src/shared/proto/cline/models.ts`.

### Step 4.2 — Handlers

**Entry:** Step 4.1 done.

**Task:**
- Create handlers under `src/core/controller/models/`:
  - `listProviders.ts` → `catalog.listProviders()`.
  - `resolveProviderModels.ts` → `catalog.resolveModels(...)`. Generate a `request_id` to carry in the response.
  - `readProviderConfig.ts` → `store.read(...)`, redact secrets (booleanize) before returning.
  - `writeProviderConfig.ts` → `store.write(...)`, return redacted view.
  - `commitModelSelection.ts` → `store.commitSelection(...)`.
- The catalog and store are singletons; create them at controller startup and inject.
- Each handler validates the proto request at the boundary (assertion seam) before calling into the abstraction.
- Each handler is ≤ 60 lines.

**Exit:**
- `npm run compile` succeeds.
- Each handler has a unit test with mocked store/catalog.

### Step 4.3 — Backend integration smoke test

**Entry:** Step 4.2 done.

**Task:**
- Debug-harness scenario or Node-side integration test:
  - Launch extension host.
  - Call `listProviders` and assert ≥4 providers returned.
  - Call `resolveProviderModels({providerId: "deepseek"})` and assert ≥4 models.
  - Call `commitModelSelection({providerId: "deepseek", mode: "act", modelId, modelInfo})` and round-trip via `readProviderConfig`.
- Document the test command in `tmp/sdk-model-catalog-decisions.md`.

**Exit:** Test passes.

### CHECKPOINT 4 — RPC plumbing solid?

**Reviewer:** Senior agent.

**Check:**
- Five RPCs callable end-to-end.
- `ProviderModelsResponse` carries full `ModelInfo`, not `openAiModelInfoSafeDefaults`.
- Boundary validation in each handler.
- Old RPCs untouched.

---

---


## Phase 5 — Webview foundation

**Goal:** Two hooks (`useProviderModels`, `useProviderConfig`) and one component (`ModelPickerWithManualEntry`). Picker correctness invariants are enforced. No provider component migrated yet.

### Step 5.1 — Webview state shape

**Entry:** CHECKPOINT 4 passed.

**Task:**
- Edit `webview-ui/src/context/ExtensionStateContext.tsx`.
- Add `providerModelsByProvider: Partial<Record<ProviderId, ProviderModelsState>>` and `latestModelRequestIdByProvider: Partial<Record<ProviderId, string>>`.
- Add setter that respects the apply rule: only apply a response if `response.requestId === latestModelRequestIdByProvider[providerId]`. Otherwise drop silently and log.
- Do not remove or rename any existing state variables.

**Exit:** `npm run compile` succeeds. Webview boots without errors in debug harness.

### Step 5.2 — `useProviderModels` hook

**Entry:** Step 5.1 done.

**Task:**
- Create `webview-ui/src/hooks/useProviderModels.ts`.
- Signature: `useProviderModels(providerId): { models, defaultModelId, isLoading, isStale, error, refresh, fingerprint }`.
- On mount: calls `refresh()`.
- `refresh()`:
  1. Generate `requestId`.
  2. Set `latestModelRequestIdByProvider[providerId] = requestId`.
  3. Set `isLoading: true`.
  4. Call `ModelsServiceClient.resolveProviderModels({providerId, forceRefresh: true})`.
  5. On response/error: apply rule from Step 5.1.
- **The hook does not write `*ModelId` or `*ModelInfo` state. Ever.** Type the return so it does not even import the commit-selection client.
- Tests:
  - Matching requestId is applied.
  - Mismatched requestId is dropped.
  - Two rapid `refresh()` calls: only the second response is applied.

**Exit:** Tests pass.

### Step 5.3 — `useProviderConfig` hook

**Entry:** Step 5.2 done.

**Task:**
- Create `webview-ui/src/hooks/useProviderConfig.ts`.
- Signature: `useProviderConfig(providerId): { config, write, commitSelection }`.
- `config` is the latest redacted `ProviderConfigResponse`.
- `write(patch)` calls `writeProviderConfig` RPC.
- `commitSelection(mode, selection)` calls `commitModelSelection` RPC.
- Subscribes via existing webview state push.

**Exit:** Round-trip tests pass.

### Step 5.4 — `ModelPickerWithManualEntry`

**Entry:** Step 5.3 done.

**Task:**
- Create `webview-ui/src/components/settings/providers/ModelPickerWithManualEntry.tsx`.
- Props: `{ models, isLoading, isStale, error, allowsCustomIds, selectedModel, onSelect }`.
- `onSelect` takes a full `ModelSelection` triple. When the user picks from the dropdown, the component constructs the triple from `models[id]`. When the user manually enters a custom id, the component uses per-provider safe defaults for `modelInfo`.
- Branches:
  - `isLoading || error` and `allowsCustomIds`: manual entry control enabled.
  - Models present: dropdown plus "Use custom model ID…" affordance if `allowsCustomIds`.
  - `isStale`: visible indicator, no auto-default.
  - Selected model not in `models` and `allowsCustomIds`: shown with "not in current list" indicator; not auto-replaced.
- Tests cover each branch.

**Exit:** Tests pass.

### CHECKPOINT 5 — Picker correctness designed in?

**Reviewer:** Human (UX-heavy).

**Check:**
- Component never writes selection except via `onSelect`.
- Manual entry reachable in loading and error states.
- Five trap modes from the conversation are walked through manually and visibly handled.

---


## Phase 6 — DeepSeek pilot

**Goal:** One provider end-to-end. Old code paths still in place; this is additive. Validates that the contracts work in practice before broad migration.

### Step 6.1 — Migrate the DeepSeek settings panel

**Entry:** CHECKPOINT 5 passed.

**Task:**
- Find DeepSeek's settings component under `webview-ui/src/components/settings/providers/`.
- Replace direct imports of `deepSeekModels` with `useProviderModels("deepseek")` and `useProviderConfig("deepseek")`.
- Use `ModelPickerWithManualEntry`. DeepSeek `allowsCustomIds = false`.
- Selection writes go through `useProviderConfig.commitSelection`.

**Exit:**
- DeepSeek panel loads. Models appear (≥4). Selecting persists `{modelId, modelInfo}` atomically.
- `grep -n "deepSeekModels" webview-ui/src` returns no non-type hits.

### Step 6.2 — Verify runtime is dumb for DeepSeek

**Entry:** Step 6.1 done.

**Task:**
- Read `src/core/api/providers/deepseek.ts`. Confirm `getModel()` reads `modelId`/`modelInfo` from passed-in config, not a static map.
- If a static-map lookup exists, replace with read from passed-in config. Add test: `getModel().info` equals the passed-in info.
- Verify `cline-session-factory.ts` resolves provider config via `ProviderConfigStore` and snapshots at task start.

**Exit:** Runtime test passes. `cline-session-factory` does not import `deepSeekModels`.

### Step 6.3 — End-to-end live test

**Entry:** Step 6.2 done.

**Task (debug harness):**
- Launch, dismiss overlay, open settings.
- Switch to DeepSeek, enter API key.
- Screenshot: ≥4 models visible.
- Pick a model; start a 1-turn task ("Say hello"); confirm completion.

**Exit:** Screenshots in `tmp/screenshots/phase-6/`.

### CHECKPOINT 6 — DeepSeek pilot OK?

**Reviewer:** Senior agent or human.

**Check:** Model count and default match (or exceed) pre-migration. Logs show `source: sdk-bundled` or `sdk-dynamic`. End-to-end works. No `openAiModelInfoSafeDefaults` substituted for real metadata.

---


## Phase 7 — Local/base-URL providers

**Goal:** Ollama, LM Studio, LiteLLM. Trap-mode test suite passes. Polling removed.

### Step 7.1 — Migrate Ollama

**Entry:** CHECKPOINT 6 passed.

**Task:**
- Migrate Ollama settings component to use `useProviderModels` and `useProviderConfig` with `ModelPickerWithManualEntry`. `allowsCustomIds = true`.
- **Remove the 2-second polling.** Mount-time refresh and a manual refresh button replace it.

**Exit:**
- `grep -n "setInterval\|setTimeout" webview-ui/src/components/settings/providers/ollama*` returns no polling hits.
- Ollama panel works end-to-end in debug harness.

### Step 7.2 — Trap-mode test suite for Ollama

**Entry:** Step 7.1 done.

**Task:** Write these seven tests against the catalog + store + hook + component. Race tests use injected deferreds, no real timers.

1. **Selection survives baseUrl change.** modelId=A, baseUrl=X. Change baseUrl=Y. Refresh completes without A. Assert modelId still A. Picker shows "not in current list" indicator.
2. **Stale response discarded.** Refresh in flight for X. Change to Y. Refresh for Y starts. X resolves last. Assert state shows Y.
3. **Manual entry during loading.** Mock SDK to hang. User types `my-custom:latest` and commits. Assert `{modelId: "my-custom:latest", modelInfo: <safe defaults>}` in store.
4. **Manual entry during error.** Mock SDK to fail. Same as above.
5. **No mid-refresh paint.** Mock SDK to return 5 models. Picker shows 0 or 5; never 1–4.
6. **`ModelInfo` envelope preserved.** Commit with `{contextWindow: 99999}`. Refresh. Stored `modelInfo.contextWindow` still 99999.
7. **Refresh does not write selection.** Commit modelId=A. Refresh. Assert modelId unchanged.

**Exit:** All seven tests pass. Run 5× without flake.

### Step 7.3 — Migrate LM Studio

**Entry:** Step 7.2 passed.

**Task:**
- Same pattern. Remove 6-second polling.
- Preserve loaded/max-context metadata. If SDK doesn't surface this, add an `lmstudio`-specific host enrichment step inside the catalog (after `adaptSdkModelInfo`, before cache). Mark for upstream.

**Exit:** Polling gone. Panel works. Test #6 variant for LM Studio added.

### Step 7.4 — Migrate LiteLLM

**Entry:** Step 7.3 passed.

**Task:** Same pattern. LiteLLM model list depends on baseUrl AND apiKey; verify fingerprint includes both.

**Exit:** Panel works. Fingerprint tests for combined changes added.

### CHECKPOINT 7 — Local providers solid?

**Reviewer:** Human.

**Check:**
- Rapid baseUrl edits never strand the user.
- Step 7.2 tests pass deterministically.
- No polling timers in webview.

**If this checkpoint fails, do not proceed.** Local providers are the load-bearing UX case.

---


## Phase 8 — Remaining provider waves

**Goal:** Migrate the rest. Each wave is mechanical: same hooks, same component, different `allowsCustomIds`.

### Wave A — Static cloud providers

Providers: Anthropic, Gemini, OpenAI Native, xAI, Mistral, Cerebras, Nebius, Fireworks, WandB, Together, Sambanova, Doubao, Nous Research, Huawei Cloud MaaS, Hicap, Aihubmix.

- Follow DeepSeek pattern.
- `allowsCustomIds` per provider (most: false).
- Per provider: `grep -n "<provider>Models" webview-ui/src` returns no non-type hits.
- Per provider: live test (select model + 1-turn inference).

**Checkpoint 8A:** Review.

### Wave B — Dynamic-fetch providers

Providers: OpenRouter, Cline, Groq, Baseten, Requesty, Vercel AI Gateway, Hugging Face.

- Same pattern.
- If the SDK lacks dynamic support, the existing extension dynamic fetcher is wrapped inside `catalog.ts` as a fallback source. `source` marks `extension-dynamic`. Log when used.

**Checkpoint 8B:** Review `source` distribution; identify upstream candidates.

### Wave C — Region/apiLine providers

Providers: Qwen, Z.AI, Moonshot, Minimax.

- Per-provider migration. If SDK supports `apiLine`, pass through. Otherwise compatibility logic inside the catalog.
- Test per provider: switching `apiLine` invalidates cache.

**Checkpoint 8C:** Review.

### Wave D — Complex cloud providers

Providers: Bedrock, Vertex, OpenAI Codex, Claude Code, SAP AI Core, Qwen Code, AskSage, Dify.

- Structured config (regions, projects, deployment ids). Each is its own mini-checkpoint.
- **Offramp:** if a provider's config does not map cleanly to the SDK shape, raise a checkpoint and pause.

### Wave E — Host-specific providers

Providers: `vscode-lm`, `oca`.

- Stay on host adapters, not SDK.
- Wrap behind the same RPCs and hooks. The catalog routes these provider ids to host adapters internally.
- Classic handlers in `src/core/api/providers/vscode-lm.ts` and `oca.ts` are **kept**.

### CHECKPOINT 8 — All providers migrated through abstractions?

**Reviewer:** Senior agent.

**Check:**
- Every settings panel uses `useProviderModels` and `useProviderConfig`.
- `grep -rn "Models[^A-Za-z]" webview-ui/src --include="*.tsx" --include="*.ts"` finds no imports of hardcoded maps from `src/shared/api.ts`.
- Old provider-specific RPCs not called from webview.

---


## Phase 9 — Runtime audit and auxiliary inference

**Goal:** Confirm runtime is dumb everywhere. Remove `buildApiHandler()` usages outside core provider files.

### Step 9.1 — Audit `getModel()` implementations

**Entry:** CHECKPOINT 8 passed.

**Task:**
- For every file in `src/core/api/providers/`, read `getModel()`.
- Each must read `modelId` and `modelInfo` from passed-in config; static-map lookups for `getModel()` purposes are removed.
- For each file, add a test asserting `getModel().info` equals the passed-in info.
- Record results in `tmp/sdk-model-catalog-runtime-audit.md`: provider, pattern (clean / refactored), test added.

**Exit:** Audit table complete. No provider file uses a static map in `getModel()`.

**Offramp:** If a runtime file uses model maps for behavior beyond `getModel()` (e.g. family-based request shaping), do not refactor — raise CHECKPOINT 9a.

### Step 9.2 — Migrate auxiliary inference

**Entry:** Step 9.1 done.

**Task:**
- `src/hosts/vscode/commit-message-generator.ts` and `src/core/controller/task/explainChangesShared.ts`: read `{modelId, modelInfo, apiKey, baseUrl}` from `ProviderConfigStore`, use SDK runtime directly or via existing `buildApiHandler` — decide once and document.
- `grep -rn "buildApiHandler" src/ --include="*.ts"` should show only core provider construction site(s) and tests.

**Exit:** Both files updated; grep is clean.

### CHECKPOINT 9 — Runtime can't diverge from picker?

**Reviewer:** Senior agent.

**Check:** Pick model in DeepSeek picker → read store via `readSelection` → construct `DeepSeekHandler` → `getModel().info` deep-equals stored `modelInfo`. Same for 3 other providers.

---

## Phase 10 — Deletion

**Goal:** Remove the parallel code paths. This is where the system becomes simple.

### Step 10.1 — Delete hardcoded model maps

**Entry:** CHECKPOINT 9 passed.

**Task:**
- For each map in `src/shared/api.ts` (per design doc §Current Extension Situation):
  - `grep -rn "<provider>Models\b" src/ webview-ui/src` to find remaining references.
  - If only types reference it, delete the map; keep types via `Record<string, ModelInfo>`.
  - If a runtime fallback needs a single default, keep only that constant.
- Update `src/shared/api.ts`.

**Exit:** `npm run compile` succeeds. `wc -l src/shared/api.ts` is dramatically smaller (record before/after).

### Step 10.2 — Delete provider-specific RPCs

**Entry:** Step 10.1 done.

**Task:**
- For each old RPC (refreshOpenRouterModelsRpc, refreshClineModelsRpc, refreshGroqModelsRpc, refreshBasetenModelsRpc, refreshLiteLlmModelsRpc, getOllamaModels, getLmStudioModels, refreshOpenAiModels, refreshOcaModels):
  - If still referenced, stop and raise CHECKPOINT 10.
  - Delete from proto and handler directory.
  - Run `npm run protos`.

**Exit:** `grep -rn` for those RPC names returns no hits.

### Step 10.3 — Delete provider model disk caches

**Entry:** Step 10.2 done.

**Task:**
- Remove code that writes provider-model disk caches (per design doc §6).
- Leave a one-time startup cleanup that deletes old files if present.

**Exit:** `grep -rn "getModelsCache\|setModelsCache" src/` returns no application hits.

### Step 10.4 — Delete classic provider handlers (per delete-gate table)

**Entry:** Step 10.3 done.

**Task:**
- For each provider in design doc §Extension providers to delete:
  - Verify all six delete gates per design doc §Delete gates. Record in audit file.
  - If any gate fails, skip this provider.
  - Delete the file.
  - Run `npm run compile`.
- Do **not** delete `vscode-lm.ts` or `oca.ts`.

**Exit:** Audit records "all gates passed" per deleted file. Compile and tests pass.

### CHECKPOINT 10 — Deletion review

**Reviewer:** Senior agent or human.

**Check:**
- `src/core/api/providers/` significantly smaller.
- Bundle size delta within ±10%.
- No dead/commented code.

---


## Phase 11 — Final validation and observability

### Step 11.1 — Run the judgment-plan layers

**Entry:** CHECKPOINT 10 passed.

**Task:**
- **Layer 0 grep checks** automated as `scripts/check-no-legacy-model-imports.sh`. Patterns: webview imports `@clinebot/*`, webview imports hardcoded maps, webview calls old RPCs, non-picker code writes `*ModelId`/`*ModelInfo`.
- **Race/fingerprint tests** (from Phases 1, 3, 7): run 10× to confirm zero flakes.
- **Debug-harness scenarios:** DeepSeek, Ollama, LM Studio, LiteLLM, OpenRouter, one regional provider. Screenshots.
- **Failure-mode matrix:** fill `tmp/sdk-model-catalog-failure-modes.md` with disposition + evidence for the 16 failure modes from design doc §Pre-mortem.

**Exit:** All layers green.

### Step 11.2 — Observability

**Entry:** Step 11.1 done.

**Task:**
- Per `resolveModels` response: log `provider`, `source`, `fingerprint.slice(0, 12)`, `requestId`.
- Startup: log SDK package version and canonical SDK function in use.
- Counters: `source: legacy-static` count per provider (should be zero for migrated providers).

**Exit:** Logs visible in debug harness.

### CHECKPOINT 11 — Final review

**Reviewer:** Human.

**Check:**
- A reviewer can read the architecture doc + `contracts.ts` + the audit file and understand the system without reading code.
- The system is simpler than before (see "What 'done' looks like" below).

---

## Cross-cutting policies (apply throughout)

### When to STOP and raise a CHECKPOINT

- Any exit criterion can't be met and the fix isn't a one-line typo.
- Any design choice the plan didn't make for you.
- Any flaky test (run 3×; one flake = stop).
- Any grep that should return zero returns nonzero.
- Any single-step bundle-size growth >10%.

### What never to do

- Never write to `*ModelId`/`*ModelInfo` outside a user-initiated picker action routed through `commitSelection`.
- Never add a model-list lookup inside a runtime `getModel()`.
- Never reuse a provider-only cache key or in-flight promise.
- Never put raw secrets in fingerprints, cache keys, logs, or response payloads.
- Never let a refresh-completion handler "fix" the user's selection.
- Never add disk caching for provider model lists.
- Never bypass `useProviderModels`/`useProviderConfig` from a provider settings component.
- Never paint a partial model list mid-refresh.
- Never delete a classic provider handler without all six delete gates green.
- Never use `as ProviderId` or `as Fingerprint` outside the parse/compute boundary functions.
- Never use the word "sane" in identifiers for default constants/helpers.

### Test discipline

- Race tests use injected deferreds, never real timers.
- Each test is independent.
- `await new Promise(setTimeout(..., 50))` in a test is a bug; fix it.
- "No flake" runs 5× locally before commit.

### File and code shape

- Every file under `src/sdk/model-catalog/` ≤ 300 lines.
- No `as` casts outside parse/compute boundary functions.
- One responsibility per file.
- Public API of `src/sdk/model-catalog/` is `index.ts`. Internal modules not imported from outside.

---

## What "done" looks like

The model catalog system is two abstractions (`ProviderConfigStore`, `ProviderCatalog`) with well-typed interfaces, a single host-side resolver module (~7 small files under `src/sdk/model-catalog/`), five RPCs, two webview hooks (`useProviderModels`, `useProviderConfig`), one picker component (`ModelPickerWithManualEntry`), and a runtime that reads snapshots from `ProviderConfigStore` verbatim. The classic provider directory contains only host-specific adapters (`vscode-lm`, `oca`). Hardcoded model maps in `src/shared/api.ts` are gone. Provider-specific RPCs are gone. Disk caches for provider models are gone. Selection writes happen only via `commitSelection`. Refresh writes touch only the catalog's cache. Several bug classes — refresh-overwrites-selection, OAuth-changes-provider, picker/runtime metadata divergence, stale-response-paints, raw-secret-in-cache-key — are structurally impossible rather than test-prevented. A reviewer can read the architecture doc plus `contracts.ts` plus four files and understand the whole system.
