# DRV-CHAT-FORK · Invisible auditable worker forks

Back to [README](../README.md). Decision: [ARD-0014](../ard/ARD-0014-chat-fork-lifecycle.md). Architecture: [share-and-router/PLAN.md](../share-and-router/PLAN.md).

## Problem / user value

Share screen feels reactive when a Show backlog fills while work runs in parallel. That needs separate worker contexts. Humans must still be able to audit a worker when something looks wrong, without living in a wall of parallel chats.

## Product defaults (locked)

- Workers are **invisible by default**.
- Workers are **auditable on demand** (agent-stream focus or retain-for-audit).
- “Merge” means **PromotePacket** into main context, never raw transcript splice.
- Room transcript is never forked for focus ([DRV-TRANSCRIPT](DRV-TRANSCRIPT.md)).

## Audit UX sketch

| Affordance | Behavior |
|---|---|
| Default room / Spotlight | No worker chat tabs. Human sees room feed + sticky Show items from director rank. |
| Roster / agent-stream focus | Selecting a worker participant (or Do-item “Open audit”) projects that worker’s agent stream. Focus is a client filter over tagged events + optional read of retained canonical messages via `auditHandle`. Does not fork hub room state. |
| Retain for audit | Toggle on a completed worker keeps messages until retention expires or human clears. Off by default unless privacy-debug. |
| Promote to visible thread | Explicit human (or review-gate) action. Temporary focusable thread; does **not** auto-merge history into main. |
| After Drop | Audit UI shows PromotePacket summary + artifact URIs only; message body is gone. |

No always-on chat tabs. No second room writer.

## Acceptance criteria

- [x] `SeedPacket` / `PromotePacket` / lifecycle schemas in `@cline/shared`.
- [x] Pure policy: `assertForkLegal`, `buildSeedPacket`, `applyPromotePacket` in `@cline/drive`.
- [x] Do-item claim can spawn a worker session from a `SeedPacket` (hub `drive.fork.claim`).
- [x] Worker completion emits `PromotePacket`; main Do item moves to done/blocked; Show ids stay in director state.
- [x] Default UI does not list worker sessions as parallel chats (session list filters `chatFork` / `isSubagent`).
- [x] “Open audit” focuses audit pane for that `auditHandle` (`ChatForkAuditPanel` + `drive.fork.audit.get`).
- [x] `assertForkLegal` enforced at spawn for overlapping path contracts without worktree isolation.
- [x] Privacy-strict: default drop on promote; retain opt-in via `retainForAudit` / `drive.fork.retain.set`.

## Demo

`/drive?demoChatFork=1` mounts `ChatForkDemo` (claim → show → promote beats, Workers audit panel).

## Sequencing (from share/router reconcile)

Chat forks attach to **Do claim** and feed the Show backlog. They do not unblock:

- Production Spotlight Gaps A/B/C (Chat still needs Hub snapshot + canonical Spotlight)
- Full A2A delivery polish
- Phase 4 [DRV-ISOLATION](DRV-ISOLATION.md) for overlapping edit forks (path-disjoint works now)

Resource admission reuses guardrails from [PR #32](https://github.com/hhalperin/cline-drivecode/pull/32) / [12-performance.md](../12-performance.md). Concurrent forks default to 2 (`DEFAULT_MAX_CONCURRENT_CHAT_FORKS`). Director tick runs via `drive.fork.tick` and best-effort after `call_record_work`.

## Dependencies

- Director dual backlog ([share-and-router/PLAN.md](../share-and-router/PLAN.md))
- [DRV-TRANSCRIPT](DRV-TRANSCRIPT.md), [DRV-PARALLEL-WAVES](DRV-PARALLEL-WAVES.md), [DRV-PRIVACY](DRV-PRIVACY.md)
- Spotlight production Gaps A/B/C remain a parallel track for end-to-end demos
- Task-bank Do items ([task-bank-drive-loop/overview.md](../task-bank-drive-loop/overview.md)) when Do backlog prefers bank tasks

## Surfaces touched

- `sdk/packages/shared/src/drive/chatFork.ts`, `roomLive.ts`, `hub.ts`
- `sdk/packages/drive/src/director/chatForkPolicy.ts`, `chatForkLifecycle.ts`
- `sdk/packages/core/src/hub/server/handlers/drive-fork-handlers.ts`, `drive-fork-tick.ts`
- Hub webview: `ChatForkAuditPanel.tsx`, `ChatForkDemo.tsx`, `useDriveSession` Workers panel, Chat session filter
- Session list filter: `apps/cline-hub/src/server/session-mapping.ts`

## Agent tasks

- [x] ARD-0014 locks hybrid invisible+auditable + promote-not-merge.
- [x] Schemas: `SeedPacket`, `PromotePacket`, lifecycle states.
- [x] Pure policy: `assertForkLegal`, `buildSeedPacket`, `applyPromotePacket`.
- [x] Hub ops + UI audit affordances.
- [x] Wire Do claim → spawn → promote; director tick for claim intents.

## Risks

- Overloading CLI `/fork` or checkpoint restore. Mitigation: ARD forbids them as substrate.
- Shared-cwd races. Mitigation: `assertForkLegal` + path contracts / worktree isolation.
- Audit retention vs privacy. Mitigation: default drop; retain opt-in; no raw bytes on event log.
- Related W-33 one-shot fork confusion. Mitigation: document as related GAP, separate product loop.
