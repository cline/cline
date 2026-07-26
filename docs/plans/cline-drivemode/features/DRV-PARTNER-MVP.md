# DRV-PARTNER-MVP · One pair partner, end to end

Back to [README](../README.md). Phase 1 gate feature in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

This is the integration feature that makes phase 1 a product instead of a parts list. One human, one senior-engineer partner, a full call loop. Join, watch narrated work in the feed, change mode, steer by chat, leave, come back, end with a handoff. If this feels good, Drive is real.

## Acceptance criteria

- The full loop works on the hub webview against a real Cline session doing a small real task.
- Entry works from the Drive tab (primary) and from Chat Join call (shortcut) into the same room.
- The partner runs with the ported persona (DRV-SKILL-PORT may land in phase 2. Until then, a minimal persona directive ships inside the kernel posture).
- One pair partner only. The roster cannot seat a second agent in this phase (asserted, not just unimplemented). Roster UI still renders participants (DRV-ROSTER).
- The loop is documented as a repeatable smoke script in the plan folder so any agent can verify regressions.
- No second daemon (nothing on `:7891`), no Cursor DOM access, privacy-strict defaults confirmed during the smoke.

## Dependencies

- DRV-ROOM-MVP, DRV-DRIVE-TAB, DRV-ROSTER, DRV-TOGGLE, DRV-PERSONA-CHIP, DRV-NARRATION, DRV-MODE-OVERLAY, DRV-LEAVE-END.

## Surfaces touched

- Integration only. No new files beyond the smoke script and fixes it flushes out.

## Agent tasks

- [ ] Write the smoke script narrative. Exact steps, expected observations, and the hub log lines that confirm each. Include Drive-tab join and Chat Join shortcut into the same room.
  - Owner package: repo docs
  - Files likely: `docs/plans/cline-drivemode/smoke-phase1.md` (new)
  - Verify: a second agent can run it from the doc alone
  - Done when: the script names every checkpoint in the loop.
- [ ] Run the loop against a real small task (for example, add a test to a utility) and file defects as checklist items in the relevant feature files.
  - Owner package: integration
  - Files likely: none
  - Verify: `bun -F @cline/cline-hub dev` plus the smoke script. Use the `control-ui` skill for the webview drive.
  - Done when: the loop completes with zero manual patching.
- [ ] Assert the single-agent roster cap with a test.
  - Owner package: `@cline/core`
  - Files likely: `sdk/packages/core/src/hub/collaboration/room.test.ts`
  - Verify: `bun -F @cline/core test:unit`
  - Done when: seating a second agent without the DRV-TEAM-OPT flag fails with an actionable error.

## Risks

- Integration reveals event-ordering or reconnect issues invisible to unit tests. Mitigation. That is this feature's purpose. Defects route back to owning features as new checklist items rather than being patched inline.
