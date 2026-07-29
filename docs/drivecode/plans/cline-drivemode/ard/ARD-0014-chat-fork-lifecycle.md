# ARD-0014: Chat-fork lifecycle (invisible auditable workers)

## Status

Accepted

## Metadata

- Date: 2026-07-29
- Deciders: Drivecode planning (cline-drivemode)
- Related: [share-and-router/PLAN.md](../share-and-router/PLAN.md), [DRV-TRANSCRIPT](../features/DRV-TRANSCRIPT.md), [DRV-PARALLEL-WAVES](../features/DRV-PARALLEL-WAVES.md), [DRV-PRIVACY](../features/DRV-PRIVACY.md), [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md), [ARD-0011](ARD-0011-demo-share-track.md), W-33 in [05-workflows.md](../05-workflows.md)

## Context

Reactive share screen is a dual-backlog planning problem (Do + Show), not WebRTC. Parallel specialist work needs separate LLM contexts so the director can keep ranking Show items while workers run. Naïve approaches fail:

- Concatenating worker transcripts into the main chat explodes memory and noise.
- CLI `/fork` and app `forkSession` copy the full conversation and become the active session with no promote-back.
- Checkpoint `session.restore` can hard-reset one shared cwd, which is unsafe for parallel editors.
- Hub declares `session.fork` / `session.forked` but has no handler; that path must not be overloaded without an adapter.

## Decision

1. **Hybrid visibility.** Worker forks are **invisible by default** and **auditable on demand** (agent-stream focus or retain-for-audit). No always-on parallel chat tabs.
2. **Fork only at hard boundaries.** Do-item claim, wave batch item start, or review gate. Not on director replan ticks, Spotlight rank changes, or mute/spotlight UI.
3. **Seed, do not clone.** Workers spawn with a compact `SeedPacket` (goal, briefing, path contract, linked Show templates). Prefer `parentSessionId` child sessions or Team sub-sessions over full-message copy.
4. **Promote, do not merge.** Terminal outcome is a `PromotePacket` (summary, decisions, show ids, event refs, audit handle). Main session receives the summary only. Never splice raw worker turns into `roomTranscript` or merge compaction sidecars.
5. **Archive then drop.** While retained, canonical worker messages stay readable via `auditHandle`. After retention (or unless privacy-debug), drop messages; keep PromotePacket + artifact URIs.
6. **Workspace isolation.** Parallel edit forks require path-disjoint contracts in the seed packet and/or real worktree isolation (`HostCapabilities.worktreeIsolation`). Shared-cwd parallel mutation is illegal under `assertForkLegal`.
7. **Reject as worker substrate.** CLI `/fork`, checkpoint restore, and unimplemented hub `session.fork` are not ChatForkLifecycle. W-33 one-shot side-question forks remain a related GAP, not this Do/Show worker loop.
8. **Ownership.** Schemas in `@cline/shared`; pure policy in `@cline/drive`; session spawn/cancel/audit listing in `@cline/core`; audit UI in hub (DRV-CHAT-FORK).

## Consequences

**Positive**

- Director can plan and present Show backlog while workers run.
- Memory stays bounded (seed + promote, not N full transcripts in main context).
- Humans can still audit worker history without living in parallel chat tabs.
- Aligns with DRV-TRANSCRIPT (focus is projection) and DRV-PRIVACY (no casual transcript persistence).

**Negative**

- Implementers must wire PromotePacket into main context and Do backlog completion.
- Workspace isolation is mandatory for overlapping edit forks (extra host capability work).
- Audit retention window needs an explicit policy and GC.

## Alternatives considered

- Visible parallel chats always — rejected as default (memory + UI cost).
- Invisible workers with no audit — rejected (leadership bar).
- Raw transcript merge / CRDT — rejected (no existing merge; compaction prefix-hash bound).
- Reuse CLI `/fork` or checkpoint restore — rejected (wrong semantics; unsafe cwd).
- Wait for full seated director agent cast — rejected; attach forks to Do claim first.

## Links

- [share-and-router/PLAN.md](../share-and-router/PLAN.md) · ChatForkLifecycle section
- [DRV-CHAT-FORK](../features/DRV-CHAT-FORK.md)
- [sdk/packages/shared/src/drive/chatFork.ts](../../../../../sdk/packages/shared/src/drive/chatFork.ts)
- [sdk/packages/drive/src/director/chatForkPolicy.ts](../../../../../sdk/packages/drive/src/director/chatForkPolicy.ts)
