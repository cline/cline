### Related Issue
**Issue:** N/A – Internal telemetry diagnostics improvement approved to unblock minimal tracking for empty assistant messages.

### Description
Implements minimal diagnostics for the “empty assistant message” condition with zero UI/proto/interface churn:
- Duck-typed provider request ID from ApiHandler when available (Cline/OpenRouter expose `lastGenerationId`), without changing ApiHandler interfaces.
- Emits telemetry event `task.provider_api_error` with fields: `{ ulid, model, provider, errorMessage: "empty_assistant_message", requestId? }`.
- Adds structured console log:
  ```
  [EmptyAssistantMessage] { ulid, providerId, modelId, requestId }
  ```
- Optionally appends “(reqId: …)” to the user-visible error string only when `requestId` is present.
- Scope kept strictly minimal per guidance; no tests added.

Files touched:
- `src/core/task/index.ts`
  - In `Task.recursivelyMakeClineRequests` branch where no assistant content (text/tool_use) is returned:
    - Extract `requestId` via `(this.api as any)?.lastGenerationId || (typeof (this.api as any)?.getLastRequestId === "function" ? (this.api as any).getLastRequestId() : undefined)`.
    - Log `console.error("[EmptyAssistantMessage]", { ulid, providerId, modelId: model.id, requestId: reqId })`.
    - Call `telemetryService.captureProviderApiError({ ulid: this.ulid, model: model.id, provider: providerId, errorMessage: "empty_assistant_message", requestId: reqId })`.
    - Append “(reqId: …)” to `say("error", ...)` only when present.
- `src/services/telemetry/TelemetryService.ts`
  - Extend `captureProviderApiError` signature to accept optional `provider?: string` (backwards-compatible).

No UI/proto changes. No ApiHandler interface changes. No new deps.

### Test Procedure
- Type check and lint:
  - `npm run check-types` (runs protos + tsc + webview tsc)
  - `npm run compile` (build + lint)
- Manual validation flow:
  1) Force the empty-assistant-message path (e.g., provider stream yielding no text/tool_use).
  2) Observe console error log: `[EmptyAssistantMessage]` with `{ ulid, providerId, modelId, requestId }`.
  3) Confirm telemetry: `task.provider_api_error` emitted with `errorMessage="empty_assistant_message"`, includes `provider` and `requestId` when available.
  4) Confirm the user-visible error string appends “(reqId: …)” only when a request ID exists.

Risk Assessment:
- Localized change; read-only to providers via duck-typing. The telemetry API was extended with an optional `provider` field; existing call sites remain valid. No changes to control flow except logging/telemetry and optional error suffix when applicable.

### Type of Change
- [x] ✨ New feature (non-breaking diagnostic/telemetry addition)
- [ ] 🐛 Bug fix
- [ ] 💥 Breaking change
- [x] ♻️ Refactor Changes (localized instrumentation)
- [ ] 💅 Cosmetic Changes
- [ ] 📚 Documentation update
- [ ] 🏃 Workflow Changes

### Pre-flight Checklist
- [x] Changes are limited to a single feature/bugfix scope
- [x] Code formatted/linted (`npm run format && npm run lint`)
- [ ] Tests are passing (`npm test`) — not applicable for this change per instructions (no tests added)
- [x] I have reviewed [contributor guidelines](https://github.com/cline/cline/blob/main/CONTRIBUTING.md)
- [ ] I have created a changeset using `npm run changeset` (not required; internal non-user-facing)

### Screenshots
N/A – backend diagnostics only.

### Additional Notes
- Per instruction: no UI/proto changes, no interface churn, no tests.
- Telemetry and structured logging provide correlation via provider + requestId without increasing surface area.
