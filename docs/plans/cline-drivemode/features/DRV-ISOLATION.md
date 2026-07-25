# DRV-ISOLATION · Worktree isolation for multi-agent seats

Back to [README](../README.md). Phase 4 prerequisite of [DRV-TEAM-OPT](DRV-TEAM-OPT.md) in [TASK-GRAPH](../TASK-GRAPH.md).  
Owns workflow **W-28** (review isolated work). Hard dependency: **`teamOpt` must not enable without this.**

## Problem / user value

Seating a specialist beside the pair partner without isolation invites two agents to fight over the same files. Users need a bounded workspace (worktree or equivalent) for specialist jobs, a clear proposal lifecycle, and cascade-safe dismiss that does not trash pack-seated peers.

## Decision defaults

| Topic | Default |
|---|---|
| Isolation unit | Git worktree under a Drive-managed path (or host-equivalent sandbox) |
| Scope | Only agents seated with `seatSources` including `spawn` / specialist job — not the primary pair partner by default |
| Merge/apply | Human-gated proposal: review diff → accept/reject |
| teamOpt coupling | Flag **on** requires isolation capable host; if isolation unavailable, seating a second agent fails closed with a visible error |
| Dismiss | Cancel in-flight specialist tools; remove spawn seatSource; leave pack-claimed seats intact |

## Acceptance criteria

- With `teamOpt` on and isolation available, seating a specialist creates an isolated work area and binds the agent’s file tools to it.
- Specialist completion produces a reviewable proposal (diff / file list) in the room stage or feed — not a silent merge.
- Accept applies; reject discards; neither dumps transcripts into `.driveagent` knowledge (ARD-0004).
- With isolation unavailable, attempting a second agent seat fails with a typed error; pair-partner MVP remains usable.
- Cascade dismiss of a spawned specialist does not evict a participant still claimed by a RosterPack seatSource.
- Unit tests cover bind path, fail-closed without isolation, and cascade dismiss vs pack refcount.

## Dependencies

- DRV-TEAM-OPT, DRV-ROSTER, DRV-ROSTER-PACK, DRV-ROOM-MVP, DRV-PRIVACY, DRV-GATES (apply may be gated).

## Surfaces touched

- `@cline/drive` isolation policy interfaces
- `@cline/core` hub seating + host worktree adapter
- Hub webview review UI for proposals

## Agent tasks

- [ ] Define `IsolationPort` on the host capability descriptor (SDK alignment).
  - Owner package: `@cline/drive`
  - Verify: fakeHost conformance — declaring isolation and no-op fails closed
- [ ] Implement worktree (or sandbox) adapter for Cline host.
  - Owner package: `@cline/core`
  - Verify: unit tests with temp repo fixture
- [ ] Wire teamOpt seating path to require isolation; surface errors to room.
  - Owner package: `@cline/core` + webview
  - Verify: control-ui smoke with flag on/off
- [ ] Proposal accept/reject ops + stage/feed projection.
  - Owner package: `@cline/core` + webview
  - Verify: unit + hub tests

## Risks

- Soft dependency (“best effort isolation”) ships and corrupts workspaces. Mitigation: hard fail-closed.
- Isolation UX feels like a second product. Mitigation: keep proposals inside the room stage/feed; no separate “PR app” chrome in v1.
