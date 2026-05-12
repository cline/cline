# SDK-backed Model Catalog: Architecture

> Companion to `tmp/sdk-model-catalog-design.md` (the *why*) and `tmp/sdk-model-catalog-implementation-plan.md` (the *what to do*). This document defines the abstractions, their invariants, and the dependency graph. It is the contract every implementer and reviewer holds the work to.

## Operating Principles

These are the principles every step of execution must preserve. If you find yourself writing code that violates one, stop and raise a checkpoint.

1. **The runtime is dumb.** Inference paths read `{providerId, modelId, modelInfo, apiKey, baseUrl}` from a snapshot taken at task start, and use it verbatim. No catalog lookups, no re-derivation, no "helpful" model swaps. If the provider says "no such model," the error surfaces cleanly.
2. **The picker is the only careful thing.** All freshness, race, and fingerprint machinery lives in the picker path. Its job is to never lie to the user about what list applies to what config.
3. **Refresh writes lists, not selections.** A model-list refresh updates the catalog's cache and the picker view. It never overwrites the user's selected model.
4. **`ModelInfo` is part of the selection envelope.** When the user picks a model, `{modelId, modelInfo}` are committed together. The stored snapshot wins over later SDK catalog changes.
5. **Writes through abstractions update in-memory state synchronously, before returning.** Disk persistence may be debounced. No consumer needs to coordinate with a refresh completion to observe a fresh write.
6. **Types > assertions > tests.** Express invariants in the type system where possible; assert at runtime at component boundaries where types cannot reach; reserve unit tests for behavior that depends on actual computation, not shape.
7. **Observability is the long tail of assertions.** Production assertions are crashes; observability tells us assertions *would have* fired in user environments.

## Language


## The two abstractions

The whole system rests on two interfaces. Everything else — RPCs, webview components, hooks, runtime providers — is a consumer or implementation of one of these.

### `ProviderConfigStore`

**Purpose:** the answer to "where do user-edited provider configuration fields live, and how do I read and write them coherently."

**Surface (sketch; final types live in `src/sdk/model-catalog/contracts.ts`):**

```ts
interface ProviderConfigStore {
  /**
   * Read effective config for a provider, with all overlays applied
   * (remote config, secrets, defaults). Returns a fresh structurally-equal
   * object on each call; callers must not mutate the result.
   *
   * Consistent with the last committed write within this process: a read
   * after an awaited write returns what was written.
   */
  read(providerId: ProviderId): EffectiveProviderConfig

  /**
   * Write specific fields. Returns the new EffectiveProviderConfig.
   * In-memory cache is updated before this returns; disk persistence is
   * debounced.
   */
  write(providerId: ProviderId, patch: ProviderConfigPatch): EffectiveProviderConfig

  /**
   * Commit a model selection atomically with its info envelope. This is
   * the only entry point that writes selection state. Catalog refreshes
   * have no access to this method by type.
   */
  commitSelection(providerId: ProviderId, mode: Mode, selection: ModelSelection): void

  /**
   * Read the current selection for a (provider, mode). Intent, not derivation.
   * Returns undefined if the user has not yet picked a model.
   */
  readSelection(providerId: ProviderId, mode: Mode): ModelSelection | undefined

  /**
   * Subscribe to changes. Fires synchronously after each committed write,
   * with the new effective config (or selection) for the affected provider.
   */
  subscribe(listener: ProviderConfigChangeListener): Disposable
}
```

**Invariants:**

- **I1.** `read(p)` after `write(p, patch)` returns a value reflecting `patch`. Always, within the same process.
- **I2.** `commitSelection` is the only method that produces a `ModelSelection` write event. No other code path writes `{providerId, modelId, modelInfo}` triples.
- **I3.** `write` cannot produce a `ModelSelection` event. Field writes (apiKey, baseUrl, headers, etc.) are distinct from selection writes by type.
- **I4.** `read` is pure within the no-writes-in-between window. Two reads with no intervening write return structurally equal values.
- **I5.** Subscribers fire synchronously after the write that triggered them, before the write call returns. This makes "did the listener see this change?" decidable without ordering ambiguity.
- **I6.** Secrets are never present in `EffectiveProviderConfig` outputs that cross a serialization boundary (RPC, log). The store provides a separate `readSecrets` variant for the narrow callers (session factory) that need them, or returns secret-bearing fields only when the caller is on the host.

**Storage strategy (implementation detail, not visible to consumers):**

- Provider-owned fields (apiKey, baseUrl, headers, region, apiLine, OAuth tokens, last-used model): persisted via SDK's `ProviderSettingsManager` (`~/.cline/data/settings/providers.json`).
- VSCode-specific fields (Plan/Act model selection per provider, VSCode LM selector, UI flags): persisted via `StateManager` (`~/.cline/data/globalState.json`, `secrets.json`).
- Remote config overlays: applied at read time.
- Effective config is the merge of all three, with remote overrides last.

This split is internal. Consumers see one coherent abstraction.

We use "safe defaults" rather than "sane defaults" for default-value constants and helpers. The existing `openAiModelInfoSaneDefaults` constant in `webview-ui/src/components/settings/utils/providerUtils.ts` is to be renamed `openAiModelInfoSafeDefaults` and references updated, as part of the work in Phase 0 of the implementation plan.


### `ProviderCatalog`

**Purpose:** the answer to "what models can a user pick for this provider with their current config, and what is their info."

**Surface:**

```ts
interface ProviderCatalog {
  /**
   * List providers available from the SDK catalog. Used by the top-level
   * provider picker.
   */
  listProviders(): Promise<ReadonlyArray<ProviderListing>>

  /**
   * Resolve models for a provider given the current effective config.
   * Internally manages a fingerprint-keyed cache and in-flight dedup.
   * Reads effective config from ProviderConfigStore; callers do not pass it.
   */
  resolveModels(
    providerId: ProviderId,
    options?: { forceRefresh?: boolean },
  ): Promise<ProviderModelsResult>

  /**
   * Subscribe to model-list updates for a provider. Fires when a refresh
   * completes for the latest fingerprint.
   */
  subscribe(
    providerId: ProviderId,
    listener: (event: ProviderModelsEvent) => void,
  ): Disposable
}
```

**Invariants:**

- **C1.** `ProviderCatalog` is read-only with respect to `ProviderConfigStore`. It cannot call `write` or `commitSelection`. Enforced by type: it does not hold a write-capable reference to the store.
- **C2.** Every `resolveModels` result carries the `configFingerprint` it was computed against. Consumers compare fingerprints, not freshness flags.
- **C3.** The cache and the in-flight map are keyed by `${providerId}:${fingerprint}`. A request for fingerprint X never satisfies a caller asking for fingerprint Y.
- **C4.** When `ProviderConfigStore` publishes a change for provider P, the catalog invalidates its cache entries for P with non-matching fingerprints and may start a background refresh for the new fingerprint. It does not invalidate the user's selection.
- **C5.** The catalog never writes selection. Subscribers do not have authority to commit; they only observe.
- **C6.** SDK shape validation happens at the catalog's boundary. Malformed SDK responses produce a `CatalogError`, not malformed data downstream.

**Storage strategy (implementation detail):**

- In-memory cache keyed by `${providerId}:${fingerprint}` with per-record TTL.
- In-flight `Promise` map keyed the same way.
- No disk cache. SDK bundled catalog serves as the offline fallback.


## Dependency graph

```
        ┌──────────────────┐
        │ Webview Settings │
        │ Picker / UI      │
        └────────┬─────────┘
                 │ reads/writes provider config via RPC
                 │ asks catalog for models via RPC
                 │ commits selections via RPC
                 ▼
        ┌──────────────────┐ reads config from ┌────────────────────┐
        │ ProviderCatalog  │──────────────────▶│ ProviderConfigStore│
        └────────┬─────────┘                   └────────┬───────────┘
                 │ calls SDK                            │ reads/writes
                 ▼                                      ▼
        ┌──────────────────┐                   ┌────────────────────┐
        │  @clinebot/llms  │                   │   StateManager     │
        │  @clinebot/core  │                   │ + providers.json   │
        └──────────────────┘                   │ + remote config    │
                                               └────────────────────┘

        ┌──────────────────┐  reads snapshot from
        │ Runtime / Task   │─────────────────────▶ ProviderConfigStore
        └──────────────────┘  (no catalog access)

        ┌──────────────────┐  reads snapshot from
        │ Auxiliary infer  │─────────────────────▶ ProviderConfigStore
        └──────────────────┘  (no catalog access)

        ┌──────────────────┐
        │      SDK         │ given ProviderSettings directly by session
        └──────────────────┘ factory (which translates from
                             ProviderConfigStore)
```

### Properties this graph guarantees

- **`ProviderCatalog` depends on `ProviderConfigStore`, not vice versa.** Catalog is derived from config. Config is the more fundamental abstraction.
- **Runtime has no dependency on `ProviderCatalog`.** Picker uses the catalog; runtime uses snapshots of the store. They share no read path, so they cannot disagree on model identity or metadata.
- **The webview imports neither abstraction directly.** It talks to both via RPC. No `@clinebot/*` imports in webview code.
- **The SDK is a leaf, not a trunk.** The SDK serves the catalog (lists, resolution) and the session factory (`ProviderSettings` input), but does not own the abstractions our system is built around. "The SDK is canonical" is the wrong framing; the SDK is *an implementation source* among several, called by our abstractions when convenient.


## Structural impossibilities

Because the abstractions are shaped this way, several classes of bug are prevented by construction, not by discipline. They cannot occur because the code that would produce them does not type-check.

| Failure mode | Why it cannot occur |
|---|---|
| A refresh handler overwrites the user's selection | `ProviderCatalog` does not hold a write-capable reference to `ProviderConfigStore`. `commitSelection` is not in its type-visible surface. |
| A `modelId` is committed without `modelInfo` | `commitSelection` takes a single `ModelSelection` triple. The type does not admit a partial. |
| A response for old base URL paints over a fresh list | Cache and in-flight map are keyed by `${providerId}:${fingerprint}`. Old fingerprint cannot match new request. The webview apply rule compares fingerprints carried in the response. |
| OAuth sign-in switches the user's inference provider | OAuth flow calls `write(provider, {auth: ...})`, never `commitSelection`. The two operations are distinct by type. (This is the bug Max's commit's `setLastUsed: false` fix patches; in our architecture it is impossible to write.) |
| Runtime uses a model the picker doesn't know about, or vice versa | Picker and runtime are not connected. Picker reads `ProviderCatalog.resolveModels`. Runtime reads `ProviderConfigStore.readSelection` (committed `{modelId, modelInfo}`). The selection's `modelInfo` is the one used; catalog changes don't retroactively change committed selections. |
| Webview imports SDK code | Webview holds no reference to either abstraction. Only RPC clients. SDK is not on the webview's import graph at all. |
| Stale closure in webview produces a write with old values | Field writes via RPC are not built from React state; they pass the new value as an argument. Selection commits pass the full `ModelSelection` triple as one operation. |
| Two consumers disagree about the storage layout | Storage layout is private to `ProviderConfigStore`. Consumers do not name `providers.json` or `globalState.json` anywhere. |

## Scenarios: how the abstractions serve their consumers

Each scenario walks one user-visible behavior and confirms the abstractions handle it without races or coordination.

### A. User changes Ollama base URL, closes settings, immediately runs inference

1. Settings UI RPC: `store.write("ollama", {baseUrl: "X"})`. Returns synchronously after in-memory update.
2. User closes settings. Nothing depends on the picker view for correctness.
3. User starts task. Task construction: `store.read("ollama")` and `store.readSelection("ollama", mode)`. Snapshot has `baseUrl: "X"` and the previously committed `{modelId, modelInfo}`.
4. Task uses snapshot for the duration of inference. If the model is not present on the new endpoint, the provider returns an error; the error surfaces cleanly.

No coordination with catalog refresh required. Catalog state is irrelevant to runtime correctness.

### B. User changes base URL twice rapidly while picker is open

1. First write. Store publishes change. Catalog subscriber invalidates the old fingerprint's cache entry, computes new fingerprint, starts refresh, notifies subscribers.
2. Picker shows loading state.
3. Second write before first refresh completes. Store publishes again. Catalog computes a third fingerprint, sees it doesn't match the in-flight refresh, abandons that result (or lets it resolve into the cache under its own fingerprint, where no one is asking for it), starts a new refresh.
4. Webview apply rule: only apply a result whose fingerprint matches the latest expected fingerprint. First and second refresh results, if they arrive, are discarded.

The fingerprint guard inside `ProviderCatalog` is the only place that has to be careful. Consumers fire-and-forget plus subscribe.

### C. User picks a model

1. User clicks model in picker. Webview RPC: `commitSelection("ollama", "act", {providerId, modelId, modelInfo})`.
2. Store updates the atomic triple. Publishes a `ModelSelection` change event.
3. Subscribers fire (the webview updates its view).

No partial write is expressible. No refresh handler can overwrite this, because refresh handlers do not have access to `commitSelection`.

### D. Plan/Act with `planActSeparateModelsSetting=true`

1. Store's `commitSelection` takes `(providerId, mode, selection)`. Each mode keeps its own value.
2. The store decides where to put it. Plan/Act mode selection is held in StateManager; provider-level "last used model" lives in `providers.json` (and may be set from whichever mode wrote last).
3. Consumers do not need to know.

This is the regression Max hit. Here it is structurally avoided: the abstraction acknowledges mode, the storage strategy is private.

### E. Second VSCode window changes a setting

1. Window B writes via its `ProviderConfigStore` instance. Disk gets updated.
2. Window A's store does not know.
3. Future: a file watcher in the store implementation can publish changes. Consumers do not change.

Honest non-magic: cross-window sync is out of scope for v1; the abstraction makes adding it later a localized change.

### F. Remote config changes mid-session

1. Remote config layer calls `store.write` (or an internal equivalent) for affected providers.
2. Store recomputes effective configs, publishes changes.
3. Catalog subscribers invalidate caches for affected providers; picker eventually re-renders with new lists.
4. Running tasks are unaffected: they snapshotted at start and do not re-read.

The right behavior. New tasks see new config; running tasks finish with the config they started with.

### G. OAuth sign-in writes a token

1. OAuth flow completes. Calls `store.write("cline", {auth: {accessToken: ...}})`.
2. Does **not** call `commitSelection`. The user's current selection is untouched.
3. Webview's `cline` settings panel sees the new token via subscription; can now fetch the catalog.

The OAuth-changes-selection bug is structurally impossible.

### H. Auxiliary inference (commit-message-generator)

1. Caller reads `store.read(providerId)` and `store.readSelection(providerId, mode)` for a snapshot.
2. Calls SDK runtime with that snapshot.

Identical pattern to runtime. Cannot disagree with the main task path, because both use the same store reads.

### I. SDK release changes shape

1. Catalog's boundary parser fails validation.
2. `resolveModels` returns a `CatalogError`.
3. Webview shows error state. Picker offers manual entry where applicable.
4. We update the parser. No consumer changes.

The boundary is where shape drift is absorbed.

| `as ApiProvider` cast in a hot path | `ProviderId` is a branded type. `as` does not construct one; only `parseProviderId` does. The cast is impossible to write; the parse function with a default is the only path. |
| A new SDK release changes shape and corrupts our cache | SDK responses are validated at the catalog's boundary. Malformed responses become `CatalogError`, not malformed cache records. |


## Type and assertion strategy

Following Operating Principle 6, we lean on types where possible, assertions where types cannot reach, and tests for residual behavior.

### Load-bearing types

These types do most of the work of preventing failure modes.

- **`ProviderId`.** Branded string. Constructed only by `parseProviderId(raw: string): ProviderId`. No `as` casts.
- **`ModelSelection`.** Triple `{providerId, modelId, modelInfo}`. The only shape `commitSelection` accepts. Partial writes are not expressible.
- **`EffectiveProviderConfig`.** Constructor-controlled. Produced only by `ProviderConfigStore.read`. Carries `providerId` and well-typed fields; consumers cannot fabricate one.
- **`ProviderConfigPatch`.** A union of allowed write operations. Does **not** include selection fields. Field writes and selection commits are distinguished by type.
- **`Fingerprint`.** Branded string. Produced only by `computeConfigFingerprint`. Cache and in-flight maps are keyed by this.
- **`ProviderModelsResult`.** Discriminated union of success (with models and fingerprint) and error variants. Consumers must handle both arms.
- **`Mode`.** Existing `"plan" | "act"`. Used everywhere selection is read/written.

### Boundary assertions

These run at component seams where types cannot reach (data crossing from outside the type system or across serialization).

- **SDK response validation.** The catalog parses SDK responses with an explicit schema check. Failure → `CatalogError`, not malformed downstream data.
- **RPC request validation.** Handlers validate proto inputs before passing to `ProviderConfigStore`. Failure → RPC error, not corrupted store.
- **Mirror consistency (dev/test only).** When the store writes the same logical field to both StateManager and `providers.json` (transitionally), an assertion in dev/test mode reads both back and confirms they agree. In production this degrades to a logged warning.
- **Cache-key invariant.** When writing a cache record, assert `record.providerId === fingerprintInputs.providerId` and `record.fingerprint === computeConfigFingerprint(fingerprintInputs)`. Tautologies in the happy path; trip on a refactor that breaks them.
- **Fingerprint contains no raw secrets.** Test-time assertion that scans fingerprint output for known sentinel secret values.

### Residual unit tests

After types and assertions, the remaining tests cover behavior that types cannot express:

- Resolver returns expected model id for given config.
- Catalog dedups same-fingerprint concurrent requests into one SDK call.
- Webview apply rule discards mismatched fingerprints.
- Manual model entry persists across refresh that doesn't include the typed id.

### Observability

## File layout

```
src/sdk/model-catalog/
  contracts.ts              # All types and interfaces. Imported by everything.
  provider-id.ts            # parseProviderId, branded ProviderId type, predicates.
  fingerprint.ts            # computeConfigFingerprint, Fingerprint branded type.
  effective-config.ts       # buildEffectiveProviderConfig (internal to store).
  store.ts                  # ProviderConfigStore implementation.
  shape-adapter.ts          # SDK ModelInfo → extension ModelInfo, with validation.
  catalog.ts                # ProviderCatalog implementation.
  index.ts                  # Public exports.
  *.test.ts                 # Tests colocated.

src/core/controller/models/
  listProviders.ts          # RPC handler → catalog.listProviders
  resolveProviderModels.ts  # RPC handler → catalog.resolveModels
  readProviderConfig.ts     # RPC handler → store.read
  writeProviderConfig.ts    # RPC handler → store.write
  commitModelSelection.ts   # RPC handler → store.commitSelection

webview-ui/src/hooks/
  useProviderModels.ts      # Wraps RPC + apply rule. Read-only view of catalog.
  useProviderConfig.ts      # Wraps RPC + subscribe. Read/write view of store.

webview-ui/src/components/settings/providers/
  ModelPickerWithManualEntry.tsx
  GenericSdkProvider.tsx    # Adapted from Max's commit, retargeted to abstractions.
```

The `src/sdk/model-catalog/` directory is the only place that imports `@clinebot/*` SDK packages on the host. The webview imports none of these. The runtime providers under `src/core/api/providers/` import from `contracts.ts` only when they need types (e.g. `EffectiveProviderConfig`); they do not call the catalog.


What types and assertions don't catch in production, observability surfaces:

- Per-`resolveModels` response: log `provider`, `source`, `fingerprint.slice(0, 12)`, `requestId`. No secrets.
- Per-startup: log SDK package version and canonical SDK resolver function in use.
- Source distribution: track how often `source: legacy-static` is returned. Migration is real when this approaches zero for migrated providers.
