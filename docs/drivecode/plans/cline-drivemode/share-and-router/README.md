# share-and-router · Reference plan index

Canonical architecture plan for **demo share** and **multi-agent router**.

| File | What |
|---|---|
| [PLAN.md](PLAN.md) | Full architecture, Cursor research, SOLID, phases, risks |
| [../09-demo-share.md](../09-demo-share.md) | Demo share track summary |
| [../10-agent-router.md](../10-agent-router.md) | Agent router summary |
| [../11-spotlight-a2a.md](../11-spotlight-a2a.md) | Spotlight, mute/deafen, A2A |
| [../ard/ARD-0011-demo-share-track.md](../ard/ARD-0011-demo-share-track.md) | ADR demo share |
| [../ard/ARD-0012-agent-router.md](../ard/ARD-0012-agent-router.md) | ADR agent router |
| [../ard/ARD-0014-chat-fork-lifecycle.md](../ard/ARD-0014-chat-fork-lifecycle.md) | ADR chat-fork lifecycle |
| [../features/DRV-DEMO-SHARE.md](../features/DRV-DEMO-SHARE.md) | Feature checklist |
| [../features/DRV-AGENT-ROUTER.md](../features/DRV-AGENT-ROUTER.md) | Feature checklist |
| [../features/DRV-CHAT-FORK.md](../features/DRV-CHAT-FORK.md) | Invisible auditable worker forks |

**Defaults.** Router `suggest` for multi-agent; fractions off; demo blobs ephemeral; screenshot MVP before video; lexical seated scorer first; chat forks invisible+auditable with PromotePacket merge.

**Not in this pack.** WebRTC pixel SFU, embeddings recruit rewrite, CLI `/fork` as worker substrate, raw transcript merge.

## Implementation status

Reconciled against `main` via [PR #39](https://github.com/hhalperin/cline-drivecode/pull/39) (`docs/reconcile-drive-plans`): phases 1–8 and 10 in [PLAN.md](PLAN.md#phases-revised) are partial; phase 9 is not started; no phase is yet evidenced complete.

**Landed (partial).** Schemas, pure ranking/routing policy, manual Hub Spotlight and audio-flag ops, Mermaid producer, sticky stage, fraction-routing API scaffolding. ChatForkLifecycle schemas + pure policy + hub `drive.fork.*` (claim/promote/cancel/audit/tick) + Workers audit UI + `?demoChatFork=1` demo ([ARD-0014](../ard/ARD-0014-chat-fork-lifecycle.md)).

**Remaining (share/router).** Typed and operational A2A delivery polish, continuous seated director agents, complete template-producer kit, composer router preview/confirmation, voice-slot roster UI, optional seats and fraction routing, upstream license pass, production Spotlight Gaps A/B/C smokes. The simulated share-screen and ChatFork demos demonstrate interaction but do not satisfy the full production pipeline gate.

**Remaining (chat forks).** Real worktree isolation for overlapping edits ([DRV-ISOLATION](../features/DRV-ISOLATION.md)); wave `runTask` binding; richer agent-stream TranscriptFocus (fork audit pane ships now).
