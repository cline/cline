# CHECKLIST · Phase 0 entry

**Purpose.** Planning gate before anyone freezes Drive event / home / graph / facet schemas.  
**Rule.** Do not open competing schema PRs for both “ConfiguredAgent-only” and “Driveagent home” worlds.  
**Related.** [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md), [ard/ARD-0000-status-board.md](ard/ARD-0000-status-board.md).

## Must be true

- [x] Harrison reply recorded: `accept all` (2026-07-29) for ARD-0000…0013 + DEC bundle. Accept recorded on [ARD-0000](ard/ARD-0000-status-board.md). ARD-0014 (Chat-fork lifecycle) later landed Accepted on `main` and is indexed on the board.
- [x] Leadership defaults adopted for schema drafts; formal accept flipped to **Accepted** on the status board and each ARD/DEC header.
- [x] [DEC-agent-source-of-truth](decisions/DEC-agent-source-of-truth.md) applied: vision non-goal amended; `AgentRef` union locked. **Accepted.**
- [x] [DEC-package-location](decisions/DEC-package-location.md) applied: HANDOFF open package question closed. **Accepted.**
- [x] [DEC-open-product-forks](decisions/DEC-open-product-forks.md) applied: focus, stream, share, accent closed in `DRIVE-TAB.md`. **Accepted.**
- [ ] [TASK-GRAPH.md](TASK-GRAPH.md) includes sheet / home / graph / recruit / gates in the correct phases.
- [x] [DRV-GATES](features/DRV-GATES.md) exists with v1 action taxonomy (even if UI is later).
- [x] [DRV-KERNEL](features/DRV-KERNEL.md) ACs list host port, conformance kit, revise-not-restart (or tracked follow-up tasks).
- [x] [schemas/README.md](schemas/README.md) indexes the Phase 0 schema set.
- [x] [ops/hub-drive-ops.md](ops/hub-drive-ops.md) lists join/leave/mute/stage/mode + config/home ops sketch.
- [x] No-prompt invariant test targets named (facet files vs home files vs compiled view).
- [x] Success metrics baseline listed in [prd/prd-success-metrics.md](prd/prd-success-metrics.md).

## Exit criteria

When every box above is checked, the Phase 0 planning/schema-freeze gate is
green. ARD-0000…0013 and the DEC bundle are **Accepted**; remaining unchecked
items are reconciliation blockers before the schema surface is declared frozen.

The implementation slices are:

1. `@cline/shared` Drive event + participant/roster/address types  
2. Facet catalog parse/merge/tombstone  
3. `@cline/drive` package scaffold + policies  
4. Home/graph schema stubs + compile fixture from `examples/driveagent-pair-partner/`

**Current on branch `cursor/drive-mvp-blockers-d61f`.** Slices (1)–(4) landed: locked `AgentRef`, home/graph schemas + `compileDriveagentHome` fixture, schemas README index, facet no-prompt targets, gates taxonomy enums, Chat `call_join` → hub snapshot + Spotlight mount, and `CLINE_HOST_CAPABILITIES.promptRewrite: false` by default. Formal accept of ARD-0000…0013 + DEC bundle recorded 2026-07-29. Still open for freeze: TASK-GRAPH phase placement sign-off, and hub home ops beyond the ops sketch. Do **not** deepen Chat-local Join-call React state as authority — hub snapshots remain the Phase 1 contract.

## Anti-patterns

- Starting Profile write UI before compile fixture tests.
- Adding a second daemon “just for recruit index.”
- Putting prompts into `AgentProfile` “temporarily.”
- Treating Chat-local Drive React state as hub room authority.
