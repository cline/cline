# DRV-MODE-OVERLAY · Ask/debug overlays on the mode pill

Back to [README](../README.md). Phase 1 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Cline already has a plan/act pill. Drive adds ask and debug postures. Ask means explain without editing. Debug means evidence first, one hypothesis at a time. Overlaying these on the existing pill keeps one mode surface instead of two competing controls.

## Acceptance criteria

- When Drive is on, the mode pill exposes four postures: plan, act, ask, debug.
- Mode changes call the kernel state machine and broadcast `call_set_mode`, so every surface agrees on the mode.
- Ask mode blocks file edits at the policy layer (hook path from DRV-HOOK-POLICY), not just in UI affordances.
- Debug mode injects the evidence-first posture into the turn via the same hook path.
- When Drive is off, the pill is untouched native Cline.

## Dependencies

- DRV-KERNEL (state machine), DRV-HOOK-POLICY (posture injection), DRV-ROOM-MVP (mode broadcast), DRV-TOGGLE.

## Surfaces touched

- `apps/cline-hub/src/webview/src/` (mode pill component in the Chat header or composer)
- `sdk/packages/drive/src/driveMode.ts`
- `sdk/packages/core/src/hooks/` (posture injection call site)

## Agent tasks

- [ ] Locate the existing plan/act pill and its state plumbing.
  - Owner package: `@cline/cline-hub`
  - Files likely: `apps/cline-hub/src/webview/src/Chat.tsx`, composer components
  - Verify: written pointer to the pill component and its change handler
  - Done when: the overlay insertion point is named.
- [ ] Extend the pill with ask and debug when Drive is on, bound to `call_set_mode`.
  - Owner package: `@cline/cline-hub`
  - Files likely: pill component, `Chat.tsx`
  - Verify: `bun -F @cline/cline-hub test`
  - Done when: mode round-trips through the hub and back into the pill render.
- [ ] Implement posture injection. Ask blocks edit tools, debug prepends the evidence-first directive, both through the mutating hook contract.
  - Owner package: `@cline/drive` and `@cline/core`
  - Files likely: `sdk/packages/drive/src/driveMode.ts`, hook registration in core
  - Verify: `bun -F @cline/core test:unit`. A test in ask mode asserts an edit tool call is refused with an actionable reason.
  - Done when: policy tests pass for both postures.

## Risks

- Ask-mode enforcement that only lives in the system prompt is soft. Mitigation. Enforcement sits at the tool-execution policy layer, with the prompt posture as reinforcement.
