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
| [../features/DRV-DEMO-SHARE.md](../features/DRV-DEMO-SHARE.md) | Feature checklist |
| [../features/DRV-AGENT-ROUTER.md](../features/DRV-AGENT-ROUTER.md) | Feature checklist |

**Defaults.** Router `suggest` for multi-agent; fractions off; demo blobs ephemeral; screenshot MVP before video; lexical seated scorer first.

**Not in this pack.** WebRTC pixel SFU, embeddings recruit rewrite, implementation code (land via phased tasks in PLAN.md).

## Implementation status

Reconciled against `main`: phases 1–8 and 10 in [PLAN.md](PLAN.md#phases-revised)
are partial; phase 9 is not started; no phase is yet evidenced complete.
Schemas, pure ranking/routing policy, manual Hub Spotlight and audio-flag ops,
the Mermaid producer, a sticky stage, and fraction-routing API scaffolding
exist.

Remaining work includes typed and operational A2A delivery, director ticks,
the complete template-producer kit, composer router preview/confirmation,
voice-slot roster UI, optional seats and fraction routing, the upstream license
pass, and production smokes. The simulated share-screen route demonstrates the
interaction but does not satisfy the production pipeline gate.
