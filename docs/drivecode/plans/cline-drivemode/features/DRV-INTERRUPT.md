# DRV-INTERRUPT · Raise hand

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

The user must always be able to stop the partner without feeling like they are yanking a power cord. Raising a hand pauses the work at the next safe boundary, the partner acknowledges, and the user speaks. This is the trust feature. Pairing only works when interruption is cheap.

## Acceptance criteria

- A raise-hand action exists in the call strip and as a composer shortcut.
- Default semantics are pause-after-current-tool. The running tool completes, no new tool starts, the partner acknowledges the hand.
- A hard-cancel escape (press again, or a distinct control) maps to Cline's existing cancel channel.
- Classification of what follows the pause (stop, clarify, redirect, fresh start) uses the kernel interrupt policy (DRV-KERNEL).
- Resume works. After the exchange, the partner continues or replans depending on the classification.
- The wireframes name pause-vs-cancel as an open product fork. This plan ships pause-after as the default with hard-cancel one press away, then gathers real usage instead of blocking on the preference call.

## Dependencies

- DRV-KERNEL (interrupt policy), DRV-CALL-STRIP (control home), DRV-STEER-QUEUE (the clarify/redirect payload path).

## Surfaces touched

- `sdk/packages/drive/src/interruptPolicy.ts`
- `sdk/packages/core/src/runtime/` (pause-after-tool mechanics on the turn loop)
- `apps/cline-hub/src/webview/src/components/CallStrip.tsx`, `Composer.tsx`

## Agent tasks

- [ ] Map Cline's existing cancel channel and the turn loop's tool-boundary points.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/runtime/`, agents-loop boundary in `@cline/agents` if the loop lives there
  - Verify: written map naming the pause insertion point and the cancel API
  - Done when: pause-after-tool has a concrete mechanism, not an assumption.
- [ ] Implement pause-after-tool. A raised hand sets a flag the turn loop checks between tools, emitting paused presence.
  - Owner package: `@cline/core` (and `@cline/agents` only if the boundary requires it, respecting package boundaries per `sdk/AGENTS.md`)
  - Files likely: turn loop, `sdk/packages/core/src/hub/collaboration/ops.ts` (`call_raise_hand`)
  - Verify: `bun -F @cline/core test:unit`. A test raises mid-turn and asserts the current tool finishes and the next never starts.
  - Done when: pause and resume round-trip in tests.
- [ ] Wire the strip control and composer shortcut, with hard-cancel escape, and smoke live.
  - Owner package: `@cline/cline-hub`
  - Files likely: `CallStrip.tsx`, `Composer.tsx`
  - Verify: `bun -F @cline/cline-hub test`, live smoke raising a hand during a multi-tool task
  - Done when: live pause, acknowledgment, redirect, and resume are observed.

## Risks

- Pause-after during a very long tool (large build) feels unresponsive. Mitigation. The UI shows "finishing current step" immediately on raise, and hard-cancel stays one press away.
- Touching the agents loop crosses a package boundary. Mitigation. The mapping task decides placement first, and any `@cline/agents` change stays stateless per the SDK boundary rules.
