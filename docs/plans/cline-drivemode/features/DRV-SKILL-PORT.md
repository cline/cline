# DRV-SKILL-PORT · Port the Drive persona and mode skills

Back to [README](../README.md). Phase 2 in [TASK-GRAPH](../TASK-GRAPH.md).

## Problem / user value

The senior-engineer feel is mostly prompt engineering that already exists. cursor-drive ships `drive-persona` (voice, concision, teaching posture), `drive-modes` (mode-intent detection), and `drive-concise` (outcome-first responses). Porting them gives the Cline partner its personality without reinventing it.

## Acceptance criteria

- Persona, modes, and concise skills exist in Cline's skill/rules format and load when Drive is on.
- All Cursor-specific references (MCP tool names, `drive_set_mode` calls, Cursor mode names) are rebound to the kernel and room ops or removed.
- Mode-intent detection ("let's plan", "go ahead", "what is", "debug this") maps to `call_set_mode`, and stays Tier 0/1 (regex first, cheap classification only if regex is insufficient).
- The persona applies only inside Drive. Native Cline behavior is untouched when Drive is off.
- The workflows named in the inventory (join, leave, steer, interrupt, mode, handoff explain, end session) each have a documented trigger phrase set.

## Dependencies

- DRV-KERNEL (mode machine to bind to), DRV-MODE-OVERLAY (shared mode surface). Source material from `../cursor-drive/.cursor/skills/`.

## Surfaces touched

- `.agents/skills/` or the repo's skill location for hub sessions (confirm during the first task)
- `sdk/packages/drive/src/` (mode-intent regex table)

## Agent tasks

- [ ] Confirm how Cline loads skills/rules for hub sessions and where Drive-conditional loading can hook.
  - Owner package: `@cline/core`
  - Files likely: plugin/skill loading in core, `.agents/skills/` layout
  - Verify: written pointer to the loading mechanism
  - Done when: the conditional-load path is named.
- [ ] Port the three skills with Cursor references rebound or removed.
  - Owner package: repo skills
  - Files likely: new skill directories under the confirmed location
  - Verify: manual review against the source skills, then a live session confirming the persona tone
  - Done when: a Drive session responds outcome-first and mode phrases flip the pill.
- [ ] Implement the mode-intent table as a Tier 0 regex map in the kernel with tests.
  - Owner package: `@cline/drive`
  - Files likely: `sdk/packages/drive/src/modeIntent.ts`, tests
  - Verify: `bun -F @cline/drive test`
  - Done when: the phrase table from `drive-modes` classifies correctly and ambiguous phrases fall through to no-op.

## Risks

- Persona prose written for Cursor's agent may fight Cline's system prompt. Mitigation. Port incrementally and smoke tone on a live session per skill, not all three at once.
