# DRV-HOOK-POLICY · Runtime hooks with an honest override path

Back to [README](../README.md). Phase 0 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Drive must shape prompts and turns (inject persona context, apply mode policy, enqueue steering) through a sanctioned mechanism. Today `prompt_submit` hooks can observe but may not rewrite. Without an explicit mutation contract, Drive would need side channels, which are fragile and dishonest to other extensions. This feature gives Drive, and any future consumer, a typed `AgentRuntimeHooks` override path.

## Acceptance criteria

- The hook contract distinguishes observe-only events from mutating events in types, not convention.
- A `prompt_submit` (or equivalently named) mutating hook can return a rewritten prompt, and the runtime applies it, with the original and rewritten forms visible in the session event log.
- Mutation is bounded. A hook can rewrite the prompt and attach context. It cannot silently drop a user turn (a drop is an explicit, logged outcome).
- Hook execution order and failure behavior are documented. A throwing hook never blocks the turn (fail open, log the failure).
- Kernel policies (mode overlays, steering injection) run through this path exclusively.
- Existing hook consumers keep working. Observe-only hooks compile unchanged.

## Dependencies

- None for the contract itself. DRV-KERNEL consumes it.

## Surfaces touched

- `sdk/packages/shared/src/hooks/events.ts` (event type split)
- `sdk/packages/core/src/hooks/hook-file-hooks.ts`, `hook-file-config.ts`, `subprocess.ts`
- `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts` (application point)

## Agent tasks

- [ ] Map current hook flow. Where `prompt_submit` fires, what it receives, where a returned value goes today.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hooks/*`, `src/runtime/turn-queue/pending-prompt-service.ts`
  - Verify: written summary in the PR description with file and line pointers
  - Done when: the application point for a rewrite is identified and confirmed by a failing-then-passing test sketch.
- [ ] Split hook event types into observing and mutating in shared schemas.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/hooks/events.ts`
  - Verify: `bun -F @cline/shared test` and `bun run types` from `sdk/`
  - Done when: mutating hooks have typed result shapes and observe-only hooks have `void` results.
- [ ] Implement rewrite application in the turn pipeline with original/rewritten both logged to session events.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/runtime/turn-queue/pending-prompt-service.ts`, hook engine call site
  - Verify: `bun -F @cline/core test:unit`
  - Done when: a test registers a rewriting hook and asserts the model received the rewritten prompt and the log holds both forms.
- [ ] Pin fail-open behavior. A throwing mutating hook logs and the turn proceeds with the original prompt.
  - Owner package: `@cline/core`
  - Files likely: hook engine tests
  - Verify: `bun -F @cline/core test:unit`
  - Done when: the failure-path test passes.

## Risks

- A mutating hook API is a power tool for every plugin, not just Drive. Mitigation. Mutation results are typed, logged, and visible in session events, so misuse is auditable.
- Rewrite point may sit in a hot path with ordering subtleties around queued prompts. Mitigation. The mapping task lands first and the steer queue feature (DRV-STEER-QUEUE) reuses its findings.
