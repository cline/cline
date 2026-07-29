# DRV-PRIVACY · Privacy-strict defaults

Back to [README](../README.md). Phase 0 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

Drive listens (mic) and observes (work events). Users must be able to trust that nothing is retained or shipped anywhere by default. Privacy is a boundary property, so it must be designed into the schemas and the hub before voice features exist, not patched on after.

## Acceptance criteria

- Strict mode is the default. No raw audio retention, no transcript persistence, no telemetry for Drive events.
- Event schemas structurally cannot carry raw audio (asserted by a DRV-EVENTS test).
- Voice pipeline (when DRV-MIC and DRV-TTS land) processes audio in memory only. Transcripts feed the prompt pipeline and are then discarded unless debug mode is explicitly enabled.
- Hub room state and event history live in memory or the local state directory only, never leave localhost in MVP phases.
- Debug mode is an explicit, logged opt-in with a visible indicator in the call strip.
- Log output redacts secrets and omits sensitive config values.

## Dependencies

- DRV-EVENTS (schema-level enforcement point).

## Surfaces touched

- `sdk/packages/shared/src/drive/events.ts` (schema constraints)
- `sdk/packages/core/src/hub/collaboration/` (retention behavior)
- Later phases: `apps/cline-hub` voice components (in-memory handling)

## Agent tasks

- [ ] Write the privacy invariant doc section and a checklist the voice features must pass.
  - Owner package: repo docs
  - Files likely: this file, `AGENT-RUNBOOK.md` conventions section
  - Verify: reviewed against the policy pack rules
  - Done when: DRV-MIC, DRV-TTS, and DRV-CAPTIONS reference the checklist in their acceptance criteria.
- [ ] Add schema-level assertions that no drive event carries raw audio or full-transcript fields.
  - Owner package: `@cline/shared`
  - Files likely: `sdk/packages/shared/src/drive/events.test.ts`
  - Verify: `bun -F @cline/shared test`
  - Done when: the assertion test exists and fails on violation.
- [ ] Add retention tests to the room runtime. Event history capped, nothing written outside the state directory, nothing on the wire beyond localhost.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/room.test.ts`
  - Verify: `bun -F @cline/core test:unit`
  - Done when: tests pin the retention cap and the localhost-only bind.

## Risks

- Debug convenience erodes strict defaults over time. Mitigation. Debug mode is a single named flag with a UI indicator, and the assertion tests make silent regressions fail CI.
