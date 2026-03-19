# Notification Hook Implementation Plan

This document is a stripped-down implementation plan for making the Notification hook production-ready. It focuses only on the code changes and unit tests required to implement the work.

## Goal

Make Notification hook behavior explicit, centralized, and test-covered without redesigning the broader hook system.

## Scope

In scope:

- notification-specific code changes
- protobuf/input contract changes needed by Notification
- unit test additions and updates

Out of scope:

- product/process rollout details
- telemetry dashboards and operational follow-up
- broad hook-runtime redesign
- UI/product docs beyond what is necessary for implementation

---

## Implementation Summary

The minimal implementation should do four things:

1. Add a centralized Notification helper.
2. Refactor existing Notification call sites to use that helper.
3. Expand `NotificationData` with the additive fields needed for a production payload contract.
4. Add/update unit tests for Notification-specific behavior.

---

## Code Changes

### 1. Add a centralized Notification helper

Create a new module:

- `src/core/hooks/notification-hook.ts`

This module should own all Notification-specific behavior currently duplicated across call sites.

### Responsibilities

- build the Notification payload
- check whether hooks are enabled
- centralize message truncation
- set additive contract fields
- call `executeHook(...)`
- force Notification to remain non-cancellable and non-context-mutating at the caller boundary
- swallow/log failures as non-fatal

### Recommended exports

- `emitNotificationHook(...)`
- `emitUserAttentionNotification(...)`
- `emitTaskCompleteNotification(...)`

### Required behavior

`emitNotificationHook(...)` should:

- call `executeHook({ hookName: "Notification", ... })`
- always use `isCancellable: false`
- always use silent UI behavior (`say: async () => undefined`)
- ignore returned `cancel`
- ignore returned `contextModification`
- log when unsupported outputs are returned
- catch/log errors and never throw back into task flow

### Centralized constants/logic

Move Notification message truncation into this helper and define one shared max-length constant there.

Use the existing effective limit:

- `8000`

The helper should set:

- truncated `message`
- `messageTruncated`

---

### 2. Refactor `Task.ask(...)` Notification emission

Update:

- `src/core/task/index.ts`

Replace the private `runNotificationHook(...)` method and its direct `executeHook(...)` usage with the new helper.

### Keep existing behavior

- Continue emitting Notification for ask-driven user-attention boundaries.
- Continue skipping Notification for `command_output`.

### Mapping for ask-based notifications

For ask notifications emitted from `Task.ask(...)`:

- `event = "user_attention"`
- `source = "ask"` or preserve legacy-compatible source handling via helper
- `sourceType = "ask"`
- `sourceId = <ask type>`
- `message = text || ""`
- `waitingForUserInput = true`
- `requiresUserAction = true`
- `severity = "info"`

Note: if backward compatibility requires keeping `source` aligned with current behavior, preserve the current field shape while also populating normalized additive fields.

---

### 3. Refactor `AttemptCompletionHandler` Notification emission

Update:

- `src/core/task/tools/handlers/AttemptCompletionHandler.ts`

Replace the local `runNotificationHook(...)` implementation with the new helper.

### Remove from this file

- Notification-specific truncation logic
- duplicated hook-enabled checks for Notification
- direct `executeHook(...)` usage for Notification

### Mapping for completion notifications

For completion notifications:

- `event = "task_complete"`
- `source = "attempt_completion"`
- `sourceType = "tool"`
- `sourceId = "attempt_completion"`
- `message = result`
- `waitingForUserInput = false`
- `requiresUserAction = false`
- `severity = "info"`

---

### 4. Expand `NotificationData` in protobuf

Update:

- `proto/cline/hooks.proto`

Additive fields to add to `NotificationData`:

```proto
message NotificationData {
  string event = 1;
  string source = 2;
  string message = 3;
  bool waiting_for_user_input = 4;

  string event_version = 5;
  string event_id = 6;
  bool message_truncated = 7;
  string source_type = 8;
  string source_id = 9;
  bool requires_user_action = 10;
  string severity = 11;
}
```

### Field intent

- `event_version`: explicit schema/version marker, initially `"1"`
- `event_id`: unique ID per emission
- `message_truncated`: whether `message` was shortened
- `source_type`: normalized source classification
- `source_id`: specific source identifier
- `requires_user_action`: explicit action signal
- `severity`: initial value `"info"`

### Follow-up implementation step

After updating the proto, regenerate protobuf artifacts used by the TypeScript codebase.

---

### 5. Update Notification hook template comments

Update:

- `src/core/hooks/templates.ts`

Keep this scoped to implementation-facing guidance only.

The Notification template should reflect:

- Notification is observation-only
- `cancel` is ignored
- `contextModification` is ignored
- hook failures are non-fatal
- additive payload fields now exist

This is a small but useful implementation change because the template acts as the developer-facing contract for hook authors.

---

## Unit Test Plan

### 1. Add Notification helper unit tests

Add:

- `src/core/hooks/__tests__/notification-hook.test.ts`

This should become the main contract test suite for Notification-specific behavior.

### Required test cases

1. **emits user-attention notifications with normalized payload**
   - verify event/type/source mapping for ask-based notifications

2. **emits task-complete notifications with normalized payload**
   - verify completion mapping

3. **does not emit for `command_output`**
   - verify skip behavior remains intact

4. **centralizes truncation**
   - long message is truncated in helper
   - `messageTruncated` is `true`

5. **preserves backward-compatible fields**
   - existing fields remain present and correct:
     - `event`
     - `source`
     - `message`
     - `waitingForUserInput`

6. **ignores unsupported Notification outputs**
   - returned `cancel: true` does not affect caller behavior
   - returned `contextModification` is ignored
   - unsupported outputs are logged

7. **fails open**
   - `executeHook(...)` failure does not propagate

8. **passes additive fields**
   - verify `eventVersion`, `eventId`, `messageTruncated`, `sourceType`, `sourceId`, `requiresUserAction`, `severity`

---

### 2. Update `Task.ask` unit tests

Update:

- `src/core/task/__tests__/Task.ask.test.ts`

The current test harness stubs `runNotificationHook`. After refactoring, it should instead stub the new helper usage in whatever form is most practical for the new implementation.

Add/adjust tests to verify:

- Notification emission still happens for non-`command_output` asks
- `command_output` continues to skip Notification

Keep the current ask lifecycle assertions intact.

---

### 3. Keep `hook-executor` tests generic

Update as needed:

- `src/test/hook-executor.test.ts`

This file should continue testing generic `executeHook(...)` behavior, not the Notification policy layer.

Specifically:

- keep generic Notification execution coverage if useful
- do not rely on this file as proof of Notification production semantics
- move Notification policy assertions into `notification-hook.test.ts`

---

### 4. Add/refine call-site tests for completion flow if needed

If `AttemptCompletionHandler` already has targeted tests, update them to assert that completion notifications route through the helper rather than duplicating logic.

If no direct test exists, add a focused unit test around the handler behavior most likely to regress:

- task completion emits the completion Notification once
- emitted payload uses the expected completion mapping

---

## Minimal File-by-File Plan

### New file

- `src/core/hooks/notification-hook.ts`

### Files to modify

- `src/core/task/index.ts`
- `src/core/task/tools/handlers/AttemptCompletionHandler.ts`
- `proto/cline/hooks.proto`
- `src/core/hooks/templates.ts`
- `src/core/task/__tests__/Task.ask.test.ts`
- `src/test/hook-executor.test.ts` (only as needed to keep coverage aligned)

### New/updated tests

- `src/core/hooks/__tests__/notification-hook.test.ts`
- existing completion-handler tests, if present

---

## Acceptance Criteria

- All Notification hook emissions go through one helper.
- `Task.ask(...)` and `AttemptCompletionHandler` no longer contain duplicated Notification execution code.
- Notification payload includes the additive production fields.
- Notification message truncation is centralized.
- Notification callers explicitly ignore `cancel` and `contextModification`.
- `command_output` remains excluded.
- Notification failures remain non-fatal.
- Unit tests cover Notification helper behavior and call-site expectations.
