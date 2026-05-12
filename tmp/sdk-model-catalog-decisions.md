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
