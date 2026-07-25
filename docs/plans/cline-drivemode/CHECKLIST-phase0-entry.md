# CHECKLIST · Phase 0 entry

**Purpose.** Planning gate before anyone freezes Drive event / home / graph / facet schemas.  
**Rule.** Do not open competing schema PRs for both “ConfiguredAgent-only” and “Driveagent home” worlds.  
**Related.** [LEADERSHIP-BRIEF.md](LEADERSHIP-BRIEF.md), [ard/ARD-0000-status-board.md](ard/ARD-0000-status-board.md).

## Must be true

- [ ] Harrison reply recorded: `accept all` **or** `change: <id + new default>` for ARD-0001…0004.
- [ ] If silent, leadership **Recommended** defaults are explicitly adopted for schema drafts and noted on ARD-0000 (still flip to Accepted on human reply).
- [ ] [DEC-agent-source-of-truth](decisions/DEC-agent-source-of-truth.md) applied: vision non-goal amended; `AgentRef` union locked.
- [ ] [DEC-package-location](decisions/DEC-package-location.md) applied: HANDOFF open package question closed.
- [ ] [DEC-open-product-forks](decisions/DEC-open-product-forks.md) applied: focus, stream, share, accent closed in `DRIVE-TAB.md`.
- [ ] [TASK-GRAPH.md](TASK-GRAPH.md) includes sheet / home / graph / recruit / gates in the correct phases.
- [ ] [DRV-GATES](features/DRV-GATES.md) exists with v1 action taxonomy (even if UI is later).
- [ ] [DRV-KERNEL](features/DRV-KERNEL.md) ACs list host port, conformance kit, revise-not-restart (or tracked follow-up tasks).
- [ ] [schemas/README.md](schemas/README.md) indexes the Phase 0 schema set.
- [ ] [ops/hub-drive-ops.md](ops/hub-drive-ops.md) lists join/leave/mute/stage/mode + config/home ops sketch.
- [ ] No-prompt invariant test targets named (facet files vs home files vs compiled view).
- [ ] Success metrics baseline listed in [prd/prd-success-metrics.md](prd/prd-success-metrics.md).

## Exit criteria

When every box above is checked, Phase 0 implementation may start with:

1. `@cline/shared` Drive event + participant/roster/address types  
2. Facet catalog parse/merge/tombstone  
3. `@cline/drive` package scaffold + policies  
4. Home/graph schema stubs + compile fixture from `examples/driveagent-pair-partner/`

**In progress (schemas + kernel + facets).** Items (1) and (3) landed; facet catalog / merge / path helpers / pure store landed on `cursor/drive-phase0-schemas-kernel-a8d3`. Remaining: hub durable IO, home/graph stubs + compile fixture. Do **not** deepen Chat-local Join-call React state — replace with hub snapshots in Phase 1.

## Anti-patterns

- Starting Profile write UI before compile fixture tests.
- Adding a second daemon “just for recruit index.”
- Putting prompts into `AgentProfile` “temporarily.”
- Treating Chat-local Drive React state as hub room authority.
