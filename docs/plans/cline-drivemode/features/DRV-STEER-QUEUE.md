# DRV-STEER-QUEUE · Steering while the partner works

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

On a real call you talk while your pair types. The user must be able to say "also handle the empty case" mid-turn without cancelling anything. Steering messages queue, the partner acknowledges them at the next natural boundary, and nothing is lost.

## Acceptance criteria

- Typing in the composer while a turn runs queues a steer message instead of blocking or erroring.
- Queued steers are visible (a queued chip above the composer) and retractable before consumption.
- The partner consumes queued steers at tool boundaries through the mutating hook path (DRV-HOOK-POLICY), acknowledging each in narration.
- The steer queue lives in core turn infrastructure, reusing `pending-prompt-service.ts` rather than a parallel queue.
- Ordering is preserved. Two steers arrive in the order sent.

## Dependencies

- DRV-HOOK-POLICY (injection contract), DRV-ROOM-MVP, DRV-NARRATION (acknowledgment rendering).

## Surfaces touched

- `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`
- `apps/cline-hub/src/webview/src/components/Composer.tsx` (queue affordance)
- `apps/cline-hub/src/webview/src/components/ai-elements/queue.tsx` (bundled, consume if suitable)
- TUI already has `apps/cli/src/tui/components/queued-prompts.tsx` for parity later

## Agent tasks

- [ ] Map the pending prompt service. How prompts queue today, where they are consumed, what the hub exposes.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` and its tests
  - Verify: written map with pointers
  - Done when: the steer consumption point at tool boundaries is identified.
- [ ] Add steer semantics. Mid-turn prompts tagged as steers, consumed at tool boundaries via the mutating hook, order preserved.
  - Owner package: `@cline/core`
  - Files likely: `pending-prompt-service.ts`, hook registration
  - Verify: `bun -F @cline/core test:unit`
  - Done when: a test queues two steers mid-turn and asserts ordered consumption and turn continuation.
- [ ] Add the composer queue affordance with retract.
  - Owner package: `@cline/cline-hub`
  - Files likely: `Composer.tsx`, possibly `ai-elements/queue.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke queuing a steer during a real turn
  - Done when: a live steer is acknowledged in narration without a cancel.

## Risks

- Steers that arrive during a long single tool call wait invisibly. Mitigation. The queued chip shows pending state, and the interrupt feature covers the "no, stop now" case.
- Double injection if both the steer queue and hook path mutate the same turn. Mitigation. Steers flow only through the hook contract, asserted in the ordering test.
