# Reintroduce Hooks Feature Toggle — Implementation Plan

## Objective

Reintroduce a user-facing feature toggle for hooks so users can explicitly enable/disable hooks execution at runtime, while preserving current hooks infrastructure (discovery, management UI, telemetry, CLI support, and cross-platform behavior).

This plan is designed to be production-ready, low-risk, and easy to execute incrementally.

---

## Scope and Intended Behavior

### Product behavior

- Add back **Feature Settings** toggle: `Enable Hooks`.
- When disabled:
  - No hook execution should occur (`TaskStart`, `TaskResume`, `TaskCancel`, `PreToolUse`, `PostToolUse`, `TaskComplete`, `PreCompact`, etc.).
  - Hook-related message grouping in chat should be disabled (already keyed off `hooksEnabled` in chat view state).
  - Hooks tab in Rules/Workflows modal should be hidden (already keyed off `hooksEnabled`).
- When enabled:
  - Existing hooks behavior should function as it does today.

### Platform behavior

- Keep platform guardrails in `getHooksEnabledSafe` as the single choke point for effective behavior.
- Use persisted setting as input, and apply platform policy there (so all call sites inherit behavior consistently).

### Non-goals

- No redesign of hook script format or hook protocol.
- No changes to hook discovery semantics.
- No expansion of remote-config governance for hooks in this pass.

---

## Architectural Approach

Use a **single-source-of-truth pipeline**:

1. Persisted state key (`hooksEnabled`) in settings/global state.
2. Proto request/response plumbing (`UpdateSettingsRequest.hooks_enabled`, `Settings.hooks_enabled`).
3. Controller update handling writes the state key and emits telemetry.
4. Runtime gate (`getHooksEnabledSafe(userSetting)`) computes effective state.
5. UI and CLI consume effective state from controller (`postStateToWebview` / CLI config view).

This keeps hooks enablement logic centralized and avoids fragile per-call-site branching.

---

## Detailed Code Changes

## 1) Storage schema and defaults

### Files

- `src/shared/storage/state-keys.ts`

### Changes

- Re-add `hooksEnabled` in `USER_SETTINGS_FIELDS`:
  - `hooksEnabled: { default: false as boolean }`
- Ensure generated type exports include it via existing `Settings` composition.

### Rationale

- Default false preserves historical behavior of explicit opt-in.

---

## 2) Proto contract restoration

### Files

- `proto/cline/state.proto`
- generated artifacts via existing proto generation scripts

### Changes

- In `UpdateSettingsRequest`:
  - Remove reservation for field 26 and reintroduce:
    - `optional bool hooks_enabled = 26;`
- In `Settings` message:
  - Reintroduce:
    - `optional bool hooks_enabled = 152;`
- Regenerate generated proto code/stubs.

### Rationale

- Restores wire compatibility for settings updates from webview/CLI.

---

## 3) Runtime gate and effective setting

### Files

- `src/core/hooks/hooks-utils.ts`
- `src/core/hooks/__tests__/hooks-utils.test.ts`

### Changes

- Change signature back to setting-aware form:
  - from `getHooksEnabledSafe(): boolean`
  - to `getHooksEnabledSafe(userSetting: boolean | undefined): boolean`
- Implement behavior:
  - Normalize legacy object shape (`{ user, featureFlag }`) defensively.
  - Apply platform policy in one place.
  - Return effective boolean.
- Update all call sites to pass persisted setting from `StateManager`.

### Expected call-site updates

Files currently calling `getHooksEnabledSafe()` with no args should pass:

- `stateManager.getGlobalSettingsKey("hooksEnabled")`

Likely files include:

- `src/core/controller/index.ts`
- `src/core/task/index.ts`
- `src/core/task/ToolExecutor.ts`
- `src/core/task/tools/utils/ToolHookUtils.ts`
- `src/core/task/tools/handlers/AttemptCompletionHandler.ts`
- `src/core/task/tools/handlers/SummarizeTaskHandler.ts`

### Rationale

- Keeps hook enablement semantics centralized and predictable.

---

## 4) Controller settings update path

### Files

- `src/core/controller/state/updateSettings.ts`

### Changes

- Re-add `if (request.hooksEnabled !== undefined) { ... }` block.
- Persist with `controller.stateManager.setGlobalState("hooksEnabled", !!request.hooksEnabled)`.
- Add telemetry capture for toggle change (recommended):
  - use existing `telemetryService.captureFeatureToggle(...)` with feature key `"hooks"`
  - optionally also emit hooks-specific event (`hooks.enabled` / `hooks.disabled`) if preferred by telemetry owners.

### Rationale

- Restores settings round-trip and observability.

---

## 5) Webview feature settings UI

### Files

- `webview-ui/src/components/settings/sections/FeatureSettingsSection.tsx`
- (indirectly) `webview-ui/src/components/settings/utils/settingsHandlers.ts`

### Changes

- Add hooks toggle row in Feature Settings section (Agent group recommended).
- Wire `onChange` to:
  - `updateSetting("hooksEnabled", checked)`
- Surface platform messaging as needed (if policy blocks enablement).

### Notes

- Current app already consumes `hooksEnabled` in key places:
  - chat grouping (`ChatView`)
  - hooks tab visibility (`ClineRulesToggleModal`)
- Reintroducing state updates should reactivate those behaviors.

---

## 6) Extension state shaping

### Files

- `src/core/controller/index.ts`
- `src/shared/ExtensionMessage.ts`
- `webview-ui/src/context/ExtensionStateContext.tsx`

### Changes

- In `getStateToPostToWebview`, compute hooks enabled using persisted setting:
  - `getHooksEnabledSafe(this.stateManager.getGlobalSettingsKey("hooksEnabled"))`
- Ensure defaults in context remain safe (`false`) until hydrated.

### Rationale

- Makes state deterministic and hydration-safe.

---

## 7) CLI toggle support

### Files

- `cli/src/index.ts`
- `cli/src/components/ConfigViewWrapper.tsx`
- `cli/src/components/ConfigView.tsx`
- `cli/src/components/ConfigViewComponents.tsx` (if tab gating constants live there)

### Changes

- Stop hardcoding hooks enabled in CLI config view wrapper (`true`).
- Read effective value from state/runtime gate and pass through.
- Ensure settings editor allows modifying `hooksEnabled` from CLI config (if settings tab supports all global settings keys, this is mostly schema/proto plumbing).

---

## 8) Migrations and backward compatibility

### Files

- `src/core/storage/state-migrations.ts` (only if needed)

### Strategy

- No mandatory migration required if default = false and missing values are handled.
- Optional one-time migration policy decision:
  - if wanting continuity for users used to always-on hooks, can set true for users with existing hooks scripts discovered.
  - otherwise keep default false for explicit opt-in simplicity.

### Recommendation

- **Do not add auto-enable migration** in this pass (keep behavior explicit and predictable).

---

## 9) Telemetry

### Files

- `src/services/telemetry/TelemetryService.ts`
- `src/core/controller/state/updateSettings.ts`

### Changes

- Ensure toggle changes are tracked consistently (feature toggle or hooks-specific event).
- Confirm event naming with telemetry maintainers:
  - preferred: one toggle event source of truth.

---

## Testing Plan

## A) Unit tests (concise, scoped)

### 1. Hooks utils behavior

- File: `src/core/hooks/__tests__/hooks-utils.test.ts`
- Cases:
  - returns false when user setting false.
  - returns true when user setting true on supported platform.
  - returns expected value on win32 per platform policy.
  - handles undefined and legacy object shape.

### 2. Settings update handling

- Add/update tests around `updateSettings` handling for `hooksEnabled`:
  - writes global state key correctly.
  - telemetry fired once on change (if implemented).
  - no-op when field absent.

### 3. Webview feature settings component

- Add focused UI test in settings section suite:
  - hooks toggle renders.
  - toggling calls `updateSetting("hooksEnabled", ...)`.

### 4. (Optional) Controller state shaping

- Test `getStateToPostToWebview` maps persisted `hooksEnabled` via gate.

---

## B) Manual verification checklist

- [ ] Open Settings → Features and verify `Enable Hooks` is present.
- [ ] Toggle OFF:
  - [ ] Trigger a task and confirm no hook execution entries appear.
  - [ ] Confirm hooks tab is hidden in Rules/Workflows modal.
  - [ ] Confirm chat view no longer combines hook sequences.
- [ ] Toggle ON:
  - [ ] Trigger task with known hook scripts and confirm execution.
  - [ ] Confirm hooks tab is visible and functional.
- [ ] Restart extension and verify setting persists.
- [ ] Verify behavior on Windows/macOS/Linux aligns with platform policy.
- [ ] Verify CLI config view reflects and can update hooks setting.

---

## Rollout and Risk Mitigation

- Keep logic behind existing hook execution gate only; avoid broad refactors.
- Land in small commits:
  1. schema/proto restoration
  2. runtime/controller wiring
  3. UI/CLI wiring
  4. tests
- Validate generated artifacts in CI before merge.

---

## Self-Reflection and Design Iteration Notes

### Iteration 1 considered

- Reintroduce toggle by branching in each hook invocation call site.

### Why rejected

- High risk of missing edge hooks (`PreCompact`, completion handler, tool helpers).

### Final approach selected

- Restore a setting-driven **single choke point** in `getHooksEnabledSafe` and route all decisions through it.

### Why this is production-smart

- Centralized policy + lower regression surface.
- Matches historical architecture and existing code expectations.
- Easier to test and reason about over time.

---

## Development Execution Checklist

- [ ] Re-add `hooksEnabled` in `state-keys.ts` with default false.
- [ ] Restore proto fields for hooks setting and regenerate artifacts.
- [ ] Rework `getHooksEnabledSafe` to consume persisted setting + platform policy.
- [ ] Update all runtime callers to pass `stateManager.getGlobalSettingsKey("hooksEnabled")`.
- [ ] Re-add `hooksEnabled` handling in `updateSettings.ts` (+ telemetry capture).
- [ ] Reintroduce hooks toggle UI in `FeatureSettingsSection.tsx`.
- [ ] Wire controller state serialization to use effective hooks setting from persisted value.
- [ ] Ensure CLI config view reads/writes real hooks setting (remove hardcoded true).
- [ ] Add/adjust unit tests (`hooks-utils`, update-settings, settings UI).
- [ ] Run manual verification checklist across key flows.
- [ ] Prepare PR notes highlighting behavior changes and migration/default decision.
