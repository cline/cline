# Context Window Display Fix — Plan

> **Companion docs:** `design.md`, `architecture.md`, `implementation-plan.md`,
> `agent-guidance.md` in this directory. This document is the work plan for
> one bug, written so a fresh implementer (or reviewing agent) can carry it
> out without the conversation history that produced it.

## Problem statement

The chat status bar shows an incorrect context window for DeepSeek (128K)
when the DeepSeek picker correctly shows 1M for 1M-context models like
`deepseek-v4-pro`. Two related symptoms compound the bug:

1. **Stale 128K fallback.** For the `deepseek` provider,
   `webview-ui/src/components/settings/utils/providerUtils.ts`'s
   `normalizeApiConfiguration` returns `openAiModelInfoSafeDefaults` (defined
   in `src/shared/api.ts:1453`), whose `contextWindow` is hardcoded to
   `128_000`. The chat header reads this and displays 128K regardless of
   the actually-selected DeepSeek model.

2. **Cross-surface tearing after provider switch.** Switching the provider
   updates `apiConfiguration.actModeApiProvider` but leaves
   `apiConfiguration.actModeApiModelId` set to the *previous* provider's
   model id. The chat textarea renders `selectedProvider:selectedModelId`,
   producing nonsense like `deepseek:claude-sonnet-4-5-20250929`.

3. **Cross-surface tearing after picker commit.** When the DeepSeek picker
   calls `commitSelection`, it writes to the in-memory
   `ProviderConfigStore` but does **not** update
   `apiConfiguration.actModeApiModelId`. The chat surfaces (which read from
   `apiConfiguration`) and the picker (which reads the selection envelope)
   drift out of sync.

## Why the previous attempts failed

A prior fix attempt that threaded a "migrated provider configs" map through
React props had the right idea (read `ModelInfo` from the SDK-backed
selection envelope, not the hardcoded default) but was reverted because:

- It propagated the underlying `apiConfiguration` incoherence into the chat
  surfaces (the `deepseek:claude-sonnet-4-5-20250929` bug became more
  visible, not less).
- It produced cross-surface staleness after picker commits because each
  `useProviderConfig` consumer had its own `useState` cache and there was
  no way to invalidate the chat header's copy from a settings-panel commit.
- An earlier attempt to share state across consumers tried introducing
  `useProviderModels` into the chat path, which triggered a model-list
  refresh (`resolveProviderModels` with `forceRefresh: true`). This caused
  a second regression where the DeepSeek picker only displayed
  `deepseek-chat` and `deepseek-reasoner` instead of the SDK catalog's
  4-model list. Likely cause: a stray `useProviderModels` call from chat
  triggered a model-list resolve before the provider config had loaded,
  which hit a fallback path returning the live API's 2-model list, and
  that response overwrote the SDK-generated 4-model state via the apply
  rule.

## Architectural background

Two operating principles from `architecture.md` are load-bearing here:

- **Principle 2:** *"The picker is the only careful thing. All freshness,
  race, and fingerprint machinery lives in the picker path."*
- **Principle 4:** *"`ModelInfo` is part of the selection envelope. When
  the user picks a model, `{modelId, modelInfo}` are committed together.
  The stored snapshot wins over later SDK catalog changes."*

The consequence for chat/status display: it must read `ModelInfo`
derivable from a coherent `(providerId, modelId)` pair, and it must
**not** call `useProviderModels` / `resolveProviderModels` — those belong
to the picker path and have side effects (model-list cache mutation,
apply rule).

## Why this fix does not need a shared React store

A previous version of this plan proposed converting `useProviderConfig`
into a `useSyncExternalStore`-backed shared cache to fix the
picker-doesn't-update-chat tearing. That was an unnecessary detour.

`apiConfiguration` is *already* a globally-broadcast state object
reachable from `useExtensionState`. Every webview surface re-renders when
it changes. If we make `(provider, modelId)` in `apiConfiguration` the
single source of truth for "which model is selected," and resolve
`ModelInfo` from those two fields via a pure host RPC, then:

- The picker re-renders when `apiConfiguration` updates.
- The chat re-renders when `apiConfiguration` updates.
- Any path that wants to change the selection (picker commit, provider
  switch) has exactly one obligation: write both `actModeApiModelId` and
  the selection envelope coherently.

No external store, no subscription, no `useSyncExternalStore`. The host
becomes the source of truth; the webview is a pure function of it.

## Goals

1. The chat status bar shows the correct context window for the active
   `(provider, modelId)` pair on:
   - extension startup,
   - provider switch with no picker interaction,
   - picker commit,
   - cross-surface (settings panel commit reflected in chat header).
2. No "tearing" — `(provider, modelId)` is always coherent. The chat
   textarea never shows `deepseek:claude-sonnet-4-5-20250929`.
3. The model-list cache is never mutated by status-display code. The
   `useProviderModels` hook is never called from chat surfaces.
4. The fix is independently verifiable per step in the debug harness.

## Non-goals (deliberately out of scope)

- Migrating providers beyond DeepSeek. The fix must generalize, but only
  one provider (`deepseek`) is in `MIGRATED_PROVIDERS` for now.
- Cross-window or cross-process state synchronization (e.g. JetBrains
  plugin ↔ VSCode extension). The current bug is intra-window.
- A subscription/streaming RPC for provider config changes. The
  `apiConfiguration` broadcast already provides the trigger we need.
- Eager-commit semantics that would *write* a default selection envelope
  to the store on provider switch. The host can answer "what's the
  default ModelInfo for `deepseek`?" on demand without writing anything
  to the store.

## Key primitives already in place

These already exist; the plan reuses them. Do **not** re-derive or
duplicate:

- `@clinebot/llms` exports `MODEL_COLLECTIONS_BY_PROVIDER_ID:
  Record<string, ModelCollection>`. This is a static, in-memory constant
  built once at module load.
  `MODEL_COLLECTIONS_BY_PROVIDER_ID["deepseek"]?.models["deepseek-v4-pro"]`
  is a synchronous, side-effect-free lookup. No network. No cache
  mutation. No apply rule.

- `src/sdk/model-catalog/shape-adapter.ts` exports `adaptSdkModelInfo`
  which converts an SDK `ModelInfo` into the extension's `ModelInfo`
  shape.

- `ProviderConfigStore` (from `src/sdk/model-catalog/store.ts`) exposes
  `readSelection(providerId, mode)` which returns the committed
  `{providerId, modelId, modelInfo}` triple or `undefined`. Pure read.

- The `readProviderConfig` RPC is already side-effect-free.

- The webview's `useExtensionState` hook already broadcasts
  `apiConfiguration` changes to all consumers via React context.
  Mutations to `apiConfiguration` on the host propagate to every mounted
  component automatically.

## Plan

Four steps. Each step is independently verifiable; do not start the next
step until the previous one's exit criteria are met. The work is
host-heavy; the webview side is small at the end.

---

### Step 1 — Host: add a pure `resolveModelInfo` RPC

**Goal:** Provide the webview a side-effect-free way to ask "for this
`(providerId, modelId)`, what is the `ModelInfo`?" with a well-defined
fallback when `modelId` is omitted or unknown.

**Files to add/modify:**

- `proto/cline/models.proto`: add a new RPC.
- `src/core/controller/models/resolveModelInfo.ts`: new handler.
- `src/core/controller/models/__tests__/resolveModelInfo.test.ts`: new
  test file.

**Proto shape:**

```proto
service ModelsService {
  // ... existing RPCs
  // Resolve ModelInfo for (providerId, modelId). Pure read; no
  // model-list refresh, no cache mutation. modelId may be omitted to
  // request the provider's SDK default model.
  rpc resolveModelInfo(ResolveModelInfoRequest) returns (ResolveModelInfoResponse);
}

message ResolveModelInfoRequest {
  string provider_id = 1;
  optional string model_id = 2;
}

message ResolveModelInfoResponse {
  string provider_id = 1;
  // The resolved model id. Equals request.model_id when it exists in
  // the catalog or committed envelope; otherwise the SDK provider's
  // default model id; otherwise empty.
  string model_id = 2;
  // Empty when source == "unknown".
  optional OpenRouterModelInfo model_info = 3;
  // Resolution source. Tells callers which branch produced the answer
  // so they can degrade gracefully (e.g. show "unknown" rather than
  // 128K) when the catalog can't answer.
  string source = 4; // "committed-selection" | "sdk-known-models" | "sdk-default" | "unknown"
}
```

After editing the proto, run `npm run protos`.

**Handler logic (`resolveModelInfo.ts`):**

The handler must be **synchronous in effect** — no `await`, no calls into
any function that performs I/O or mutates a cache. It can be declared
`async` to satisfy the gRPC handler signature.

Resolution order:

1. **`committed-selection`**: If `request.modelId` is non-empty, look up
   the committed selection in both modes (`act` first, then `plan`) via
   `controller.getProviderConfigStore().readSelection(providerId, mode)`.
   If any selection has the matching `modelId`, return that envelope's
   `modelInfo` via `toProtobufModelInfo`.

2. **`sdk-known-models`**: If `request.modelId` is non-empty, look up
   `MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.models[request.modelId]`.
   If found, return `adaptSdkModelInfo(...)` converted to proto.

3. **`sdk-default`**: Read
   `MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId]?.provider?.defaultModelId`.
   If non-empty and present in `.models`, return that
   `(modelId, modelInfo)`.

4. **`unknown`**: Return `{providerId, modelId: request.modelId ?? "",
   modelInfo: undefined, source: "unknown"}`.

**Tests (must include all of these):**

- Returns `source: "committed-selection"` and the envelope's modelInfo
  when the store has a matching selection.
- Returns `source: "sdk-known-models"` and the SDK's modelInfo for a
  model in `MODEL_COLLECTIONS_BY_PROVIDER_ID` that has no committed
  selection.
- Returns `source: "sdk-default"` with the provider's default model when
  `request.modelId` is omitted.
- Returns `source: "sdk-default"` when `request.modelId` references a
  model not in the catalog (provider switch tear case: deepseek + a
  claude-only model id should fall through to deepseek's SDK default).
- Returns `source: "unknown"` for a provider id that the SDK doesn't
  know.
- **Crucially:** spy on the model-list cache and
  `resolveProviderModels`-adjacent paths; assert nothing was called. The
  handler must be observably side-effect-free.
- Spy on `store.commitSelection` and any `store.write*` methods; assert
  nothing was called. The handler must not mutate the store.

**Exit criteria:**

- `npm run compile` clean.
- New unit tests pass.
- `git grep -n "resolveModelInfo" src/core/controller/models/` shows
  handler and tests only — no callers yet.

**Out of scope for this step:**

- Wiring this RPC into any webview code. That happens in step 4.
- Touching `commitModelSelection` or provider-switch behavior.

---


### Step 2 — Host: make `commitModelSelection` also write the legacy `apiConfiguration` modelId field

**Goal:** Eliminate the cross-surface tear after picker commit by ensuring
`apiConfiguration.{plan,act}ModeApiModelId` is updated atomically with the
selection envelope. After this step, picker commits cause
`apiConfiguration` to change, which is the React re-render trigger the
chat surfaces rely on.

**Background:** Today,
`src/core/controller/models/commitModelSelection.ts` only calls
`store.commitSelection(...)`. The legacy field
`apiConfiguration.actModeApiModelId` (defined in
`src/shared/storage/state-keys.ts:192`) is set by separate code paths
(`updateApiConfiguration.ts`, settings panel actions, etc.). The
DeepSeek picker calls `commitSelection` via `useProviderConfig`; it does
NOT call `updateApiConfiguration`, so the legacy field stays stale.

The runtime (`buildApiHandler`) reads `actModeApiModelId` for inference.
If a user commits `deepseek-v4-pro` via the picker, but the legacy field
still says `deepseek-chat`, inference will go against `deepseek-chat`.
This is also a runtime correctness bug, not just a display bug — fixing
it here is independently valuable.

**Files to modify:**

- `src/core/controller/models/commitModelSelection.ts`: extend handler.
- `src/core/controller/models/__tests__/`: extend existing tests, add
  new assertions.

**Logic to add:**

After `store.commitSelection(...)`, also update the legacy
`apiConfiguration` fields via the existing `StateManager` / controller
mechanism. Specifically:

- For `mode === "act"`: write `actModeApiModelId = modelId` (and
  `actModeApiProvider = providerId` defensively).
- For `mode === "plan"`: write `planModeApiModelId = modelId` (and
  `planModeApiProvider = providerId`).

Use the same controller plumbing that `updateApiConfiguration` uses —
find the existing helper for writing modeled config fields, do not
reinvent. Search `src/core/controller/state/updateSettings.ts` and
`src/core/storage/StateManager.ts` for the right write path. The change
must trigger the state broadcast back to the webview the same way other
configuration changes do.

**Tests to update / add:**

- `providerCatalogHandlers.test.ts` (existing): the existing assertion
  that `commitSelection` was called must still pass; add an assertion
  that the controller's state-write helper was also called with the
  legacy fields.
- New test: after `commitModelSelection({providerId: "deepseek", mode:
  "act", modelId: "deepseek-v4-pro", modelInfo: ...})`, the next
  `getStateToPostToWebview()` (or equivalent broadcast snapshot)
  includes `apiConfiguration.actModeApiModelId === "deepseek-v4-pro"`
  and `actModeApiProvider === "deepseek"`.
- Round-trip test: commit a selection, then call `buildApiHandler(...)`
  (or inspect what would be passed to it) and assert it sees
  `deepseek-v4-pro` as the model id, not whatever was in the legacy
  field before the commit.

**Exit criteria:**

- `npm run compile` clean.
- All existing `providerCatalog*` tests still pass.
- New round-trip test demonstrates legacy field is updated.
- In the debug harness: open chat with DeepSeek, open picker, pick
  `deepseek-v4-pro`, evaluate `apiConfiguration.actModeApiModelId` via
  `web.evaluate`; it should equal `"deepseek-v4-pro"`.

**Out of scope:**

- Provider switch normalization (step 3).
- Webview rendering changes (step 4).

---


### Step 3 — Host: normalize `(provider, modelId)` on provider switch

**Goal:** Ensure that switching `apiConfiguration.actModeApiProvider`
from `anthropic` to `deepseek` cannot leave `actModeApiModelId` pointing
at `claude-sonnet-4-5-20250929`. After this step, `(provider, modelId)`
in `apiConfiguration` is always coherent: `modelId` is always either a
committed DeepSeek selection or the SDK default model for DeepSeek.

**Background:** A commit `3cf06f0a1 Normalize DeepSeek provider switch
model` did exactly this for the legacy path. It was reverted by
`d22881d61 Delete legacy DeepSeek provider; SDK catalog is the source
of truth` with the rationale that *"with both flows reading the SDK,
the dropdown and runtime config no longer disagree, so the workaround
is unnecessary."* That assumption turned out to be wrong: the chat
surfaces still read `apiConfiguration.actModeApiModelId`, so an
incoherent `(provider, modelId)` is still visible.

This step re-introduces the normalization, but rewires it to consult
the SDK catalog and the `ProviderConfigStore` instead of the legacy
hardcoded `deepSeekModels` map (which no longer exists).

**Files to modify:**

- Probably reintroduce
  `src/core/controller/models/providerSwitchNormalization.ts` (look at
  the deleted version in `git show 3cf06f0a1` for prior art, but
  rewrite the resolution logic per below — do not just `git revert`).
- The callers that the original commit modified:
  `updateApiConfiguration.ts`, `updateApiConfigurationPartial.ts`,
  `updateApiConfigurationProto.ts`, and `state/updateSettings.ts`.

**Resolution logic for `normalizeProviderSwitchModel(providerId, currentModelId)`:**

1. If `currentModelId` belongs to the new provider's
   `MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId].models`, keep it.
2. Otherwise, if `store.readSelection(providerId, "act")` exists, use
   that model id. (User had previously committed a DeepSeek model;
   restore it.)
3. Otherwise, use
   `MODEL_COLLECTIONS_BY_PROVIDER_ID[providerId].provider.defaultModelId`.
4. Otherwise, leave as empty string (caller decides; chat will render
   "unknown" via the `source: "unknown"` path from step 1).

Apply this for both `plan` and `act` modes when the corresponding
provider field changes.

**Tests:**

- Switching `anthropic → deepseek` with `currentModelId =
  "claude-sonnet-4-5-20250929"` produces `actModeApiModelId =
  "deepseek-v4-flash"` (or whatever the SDK default is — assert it
  equals
  `MODEL_COLLECTIONS_BY_PROVIDER_ID["deepseek"].provider.defaultModelId`).
- Switching `anthropic → deepseek` when the user previously committed
  `deepseek-v4-pro` produces `actModeApiModelId = "deepseek-v4-pro"`.
- Switching `anthropic → deepseek` when current model is already
  `deepseek-v4-flash` is a no-op.
- Switching to a non-migrated provider falls back to the existing
  legacy behavior (read the original `providerSwitchNormalization`
  logic from `git show 3cf06f0a1` carefully before deciding what to
  keep).

**Exit criteria:**

- All tests pass.
- Debug harness: open chat with Anthropic, switch provider to DeepSeek
  (without opening the picker), evaluate
  `apiConfiguration.actModeApiModelId` — should equal the DeepSeek SDK
  default, not the Anthropic model id.

**Out of scope:**

- Webview rendering changes (step 4).
- Provider switch normalization for other migrated providers — none
  exist yet.

---


### Step 4 — Webview: read `ModelInfo` via the pure RPC

**Goal:** Replace the chat surfaces' use of `normalizeApiConfiguration`
(which returns hardcoded `openAiModelInfoSafeDefaults` for DeepSeek) with
a hook that calls `resolveModelInfo` from step 1. With steps 2 and 3 in
place, `apiConfiguration.(plan|act)ModeApi(Provider|ModelId)` is now
always coherent, so this RPC always has good inputs.

**Files to add:**

- `webview-ui/src/hooks/useNormalizedApiConfiguration.ts`: new hook.
- `webview-ui/src/hooks/useNormalizedApiConfiguration.test.ts`: new
  tests.

**Files to modify:**

- `webview-ui/src/components/chat/task-header/TaskHeader.tsx`: replace
  `normalizeApiConfiguration` with the new hook.
- `webview-ui/src/components/chat/ChatView.tsx`: same.
- `webview-ui/src/components/chat/ChatTextArea.tsx`: same.

**Hook contract:**

```ts
export function useNormalizedApiConfiguration(mode: Mode): NormalizedApiConfig
```

- Reads `apiConfiguration` from `useExtensionState`.
- Computes `activeProvider` and `currentModelId` from `apiConfiguration`
  mode-specific fields.
- If `activeProvider` is in `MIGRATED_PROVIDERS` (initially
  `Set(["deepseek"])`), calls
  `ModelsServiceClient.resolveModelInfo({providerId, modelId})` with
  the current pair. Updates local state with the response. Returns
  `{selectedProvider, selectedModelId: response.modelId,
  selectedModelInfo: fromProtobufModelInfo(response.modelInfo)}` if
  `source !== "unknown"`; otherwise returns a placeholder with
  `contextWindow: undefined`.
- If `activeProvider` is not migrated, delegates to
  `normalizeApiConfiguration(apiConfiguration, mode)` as today.
- Re-runs whenever `(activeProvider, currentModelId)` changes — this is
  the *only* trigger needed because `apiConfiguration` is the
  React-context broadcast that every commit (step 2) and provider
  switch (step 3) updates.

**Tests (must include):**

- Returns the SDK's modelInfo when the active provider is `deepseek`
  and modelId is `deepseek-v4-pro`. (Mock
  `ModelsServiceClient.resolveModelInfo` to return a response with
  `modelInfo.contextWindow === 1_000_000`; assert
  `selectedModelInfo.contextWindow === 1_000_000`.)
- Returns `contextWindow: undefined` during the very first render
  before the RPC resolves (no 128K flash).
- Returns the SDK default's modelInfo when `modelId` is empty.
- **Regression guard:** mock
  `ModelsServiceClient.resolveProviderModels` as well; assert it is
  **never called** when the hook is mounted with `apiProvider:
  "deepseek"`. This is the test that proves the prior regression
  cannot reoccur.
- Falls back to legacy `normalizeApiConfiguration` for `anthropic`
  without calling `resolveModelInfo` (mock asserts no calls).

**Important constraint: hook structure.**

The hook must call `useState` and `useEffect` in the same order every
render. Do not conditionally call hooks based on `isMigrated`. The
pattern is:

```ts
const { apiConfiguration } = useExtensionState()
const provider = ... // derived from apiConfiguration
const modelId = ... // derived from apiConfiguration
const isMigrated = MIGRATED_PROVIDERS.has(provider)

const [resolvedInfo, setResolvedInfo] = useState<ResolveModelInfoResponse | undefined>(undefined)

useEffect(() => {
  if (!isMigrated) return
  let cancelled = false
  void ModelsServiceClient.resolveModelInfo({ providerId: provider, modelId })
    .then((response) => { if (!cancelled) setResolvedInfo(response) })
  return () => { cancelled = true }
}, [isMigrated, provider, modelId])

return useMemo(() => {
  if (!isMigrated) return normalizeApiConfiguration(apiConfiguration, mode)
  // ... use resolvedInfo, fall back to placeholder if undefined
}, [apiConfiguration, mode, isMigrated, resolvedInfo])
```

The `cancelled` flag is important: when `provider` or `modelId`
changes during a pending RPC, the stale response must be discarded.

**Exit criteria:**

- All new and existing webview tests pass (`npx vitest run` in
  `webview-ui/`).
- Host-side typecheck clean.
- Webview typecheck clean.
- Debug harness manual verification (see "Manual verification" below).

**Out of scope:**

- Adding other providers to `MIGRATED_PROVIDERS`. That happens as each
  provider gets migrated.
- Subscriptions or pub/sub. Not needed.

---


## Manual verification (debug harness)

After all four steps land, run this sequence to confirm the fix:

```bash
# Start harness
npx tsx src/dev/debug-harness/server.ts --skip-build --auto-launch
curl localhost:19229/api -d '{"method":"launch","params":{"skipBuild":false}}'
curl localhost:19229/api -d '{"method":"ui.open_sidebar"}'
curl localhost:19229/api -d '{"method":"web.evaluate","params":{"expression":"document.querySelectorAll(\".sr-only\").forEach(el => el.parentElement?.click())"}}'
```

**Scenario A: Fresh install, switch to DeepSeek, never open picker.**

1. Anthropic is the default provider; verify chat header shows a 200K
   context window (anthropic default model).
2. Open settings, switch provider to DeepSeek, enter API key, close
   settings without touching the model picker.
3. Open chat. Chat header should show:
   - Model display: `deepseek:<sdk-default-model-id>` (NOT
     `deepseek:claude-sonnet-4-5-20250929`).
   - Context window: the SDK default's actual context window (1M for
     current DeepSeek models, but assert against the SDK-reported
     number, not the literal `1_000_000`).
4. Run inference. It should succeed and target the SDK default model.

**Scenario B: Pick a model from the picker.**

1. From scenario A, open settings, open the DeepSeek model picker.
2. Verify all 4 SDK-catalog models are listed (regression guard: if
   only 2 models appear, step 4's hook is calling `useProviderModels`
   or otherwise triggering a model-list refresh).
3. Pick `deepseek-v4-pro`.
4. Close settings.
5. Chat header should immediately show `deepseek:deepseek-v4-pro` and a
   1M context window.
6. Open settings again, verify the picker still shows `deepseek-v4-pro`
   as selected.

**Scenario C: Picker commit while chat is open.**

1. From scenario B, with chat open showing `deepseek-v4-pro`, open
   settings.
2. Change the picker to `deepseek-v4-flash`.
3. Without reloading anything, look at the chat header.
4. The model display and context window should update to reflect
   `deepseek-v4-flash`. This is the cross-surface update test.

**Regression guard: capture model-list RPC calls.**

```bash
# Before doing any of the above scenarios:
curl localhost:19229/api -d '{"method":"ext.evaluate","params":{"expression":"globalThis.__resolveProviderModelsCallCount = 0; const orig = ModelsServiceClient.resolveProviderModels; ModelsServiceClient.resolveProviderModels = (...args) => { globalThis.__resolveProviderModelsCallCount += 1; return orig.apply(this, args); }"}}'

# After running the scenarios:
curl localhost:19229/api -d '{"method":"ext.evaluate","params":{"expression":"globalThis.__resolveProviderModelsCallCount"}}'
```

Expected: the call count after scenarios A, B, C equals the number of
times the user explicitly opened the DeepSeek picker. It must **not**
be incremented by chat-only operations.


## Validation commands (run between each step)

```bash
# Type check
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p webview-ui/tsconfig.json

# Lint
npx biome check src/ webview-ui/src/

# Host tests
npx vitest run

# Webview tests
cd webview-ui && npx vitest run --reporter=dot
```

## Risk register

- **Risk:** `MODEL_COLLECTIONS_BY_PROVIDER_ID` is part of
  `@clinebot/llms`'s public surface but is a static initialized
  constant; if a future SDK upgrade changes initialization to be async,
  the host code in step 1 breaks. **Mitigation:** the handler can fall
  back to `getProvider(providerId)` (async) if the static lookup
  misses, but the synchronous path is the common case. Test for both.

- **Risk:** Step 2 writes both the selection envelope and the legacy
  field. If the writes are not atomic (e.g. broadcast happens between
  them), the webview could observe a brief inconsistent state.
  **Mitigation:** use a single controller method that performs both
  writes and emits one broadcast. Look at how other controller methods
  batch writes (e.g. `updateApiConfiguration`).

- **Risk:** Step 3's normalization might fire on every state update,
  not just on provider switches. **Mitigation:** the original
  `3cf06f0a1` commit carefully gated normalization on detecting a
  provider field change. Reuse that gating pattern.

- **Risk:** Step 4's hook may issue an RPC on every render if its
  `useEffect` dependencies are unstable. **Mitigation:** the deps are
  primitive strings (`provider`, `modelId`, `isMigrated`), so they
  will only change when the underlying value changes. Add a test that
  mounts the hook and re-renders with unchanged inputs; assert
  `resolveModelInfo` is called only once.

## Open questions for the implementer

1. Should the `source: "sdk-default"` fallback in step 1 happen only
   for migrated providers, or for all providers? **Recommended:** all
   providers; let the webview decide whether to surface the default or
   show "unknown" by checking the `source` field.

2. In step 2, should the legacy-field write happen *before* or *after*
   the store commit? If commit fails (validation error), the legacy
   field should not be written. **Recommended:** commit first, then
   write legacy fields, then emit the single broadcast.

3. In step 3, is there a way to test the normalization without going
   through the full state-management plumbing? **Recommended:** pull
   the resolution logic into a pure function
   `normalizeProviderSwitchModel(...)` (no controller dependency) and
   unit-test that directly, then test the caller integration once.

## Definition of done

- [ ] All four steps' exit criteria met.
- [ ] All three manual verification scenarios pass in the debug
      harness.
- [ ] The regression guard (call count of `resolveProviderModels`)
      confirms chat-only operations do not refresh the model list.
- [ ] `webview-ui` test suite green (`npx vitest run`).
- [ ] Host test suite green (`npx vitest run`).
- [ ] Both typechecks clean.
- [ ] `git diff --stat` reviewed: changes confined to the files listed
      in each step's "Files to modify" section. No surprise edits to
      unrelated provider panels.

## Implementer guidance

- Land each step as a separate commit with the title format
  `model-catalog (context-window fix step N): <one-line summary>`.
  This makes bisection trivial if a later step regresses.
- Do not skip the unit tests in step 1 even though the RPC is not yet
  called by anyone. The tests are the spec for step 4's mock.
- If you find yourself reaching for `useProviderModels`,
  `useSyncExternalStore`, a subscription RPC, or any other
  state-sharing mechanism in step 4, stop: the design assumes
  `apiConfiguration` is the single trigger. If that assumption breaks
  down, write up why in this document and re-plan.

