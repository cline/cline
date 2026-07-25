# DRV-KERNEL · The @cline/drive kernel package

Back to [README](../README.md). Phase 0 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Drive behavior (sub-modes, narration policy, interrupt policy) must live somewhere pure and testable, not scattered across the hub server and two webviews. The kernel is that home. It keeps the pair-partner's brain independent of any surface, which is what makes CLI parity and future VS Code support cheap.

## Acceptance criteria

- New workspace package `@cline/drive` at `sdk/packages/drive` with build, typecheck, and test scripts matching sibling packages.
- Kernel exposes a state machine: `active` flag plus `subMode` (`plan | act | ask | debug`), transitions validated, illegal transitions rejected.
- Narration policy is a pure function from work events to optional narration events, with a density setting (`decision-points` default, `every-tool` opt-in).
- Interrupt policy is a pure function classifying a hand-raise against turn state into `pause-after-tool | hard-cancel | queue-steer`.
- Kernel emits only `DriveEvent` values from DRV-EVENTS. No transport, no UI, no file persistence inside the kernel.
- Dependency direction holds. Kernel depends on `@cline/shared` only. `@cline/core` consumes kernel interfaces, never the reverse.
- Unit tests cover mode transitions, narration density both settings, and all interrupt classifications.

## Dependencies

- DRV-EVENTS (schemas the kernel emits).

## Surfaces touched

- `sdk/packages/drive/` (new package: `package.json`, `src/index.ts`, `src/driveMode.ts`, `src/narrationPolicy.ts`, `src/interruptPolicy.ts`)
- `sdk/package.json` workspace registration and `build:sdk` inclusion

## Agent tasks

- [ ] Scaffold the package with sibling-package conventions (ESM, named exports, dist-based exports map).
  - Owner package: `@cline/drive`
  - Files likely: `sdk/packages/drive/package.json`, `tsconfig.json`, `src/index.ts`
  - Verify: `bun run build:sdk` from `sdk/` succeeds with the new package included
  - Done when: `bun -F @cline/drive test` runs (even with one placeholder test) and `bun run types` passes.
- [ ] Implement the Drive state machine.
  - Owner package: `@cline/drive`
  - Files likely: `src/driveMode.ts`, `src/driveMode.test.ts`
  - Verify: `bun -F @cline/drive test`
  - Done when: transition table is exhaustive and invalid transitions throw typed errors.
- [ ] Implement the narration policy with density settings.
  - Owner package: `@cline/drive`
  - Files likely: `src/narrationPolicy.ts`, `src/narrationPolicy.test.ts`
  - Verify: `bun -F @cline/drive test`
  - Done when: decision-point density emits for plan steps, mode changes, and failures, and stays silent for routine tool calls.
- [ ] Port and adapt the interrupt classifier from claude-drive's `interruptPolicy.ts` as a pure function.
  - Owner package: `@cline/drive`
  - Files likely: `src/interruptPolicy.ts`, `src/interruptPolicy.test.ts`
  - Verify: `bun -F @cline/drive test`
  - Done when: stop, clarify, redirect, and fresh-start inputs classify to the documented outcomes.

## Risks

- Kernel scope creep toward owning transport or persistence. Mitigation. The package has no dependency on `@cline/core`, enforced by the package manifest.
- A new package slows the SDK build graph. Mitigation. The kernel is small and pure. If build time regresses, it is measurable at the `build:sdk` gate.
