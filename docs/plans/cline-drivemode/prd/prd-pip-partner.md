# PRD 7: PiP Partner (companion call widget)

## Problem

The Drive tab and Call Stage are the correct **home** for a live pair call, but users often stay in **Chat** (or another hub surface) while a call is active. Without a companion chrome, they lose glanceable presence, mute, raise-hand, and the current narration line unless they navigate away from the work surface.

Variant C (PiP Partner) was earlier rejected because it was framed as a *replacement* for screen-share IA and because a true float-over-editor path is weak in VS Code. That rejection over-corrected. The missing product is not “PiP instead of Drive tab.” It is **PiP *while* Drive tab + Spotlight remain authoritative.**

## Solution

Ship a **PiP Partner** widget as a first-class Drive presentation mode:

1. A compact floating (or docked) call widget shows partner presence, speaking/muted/hand state, mode, and one live caption/narration line.
2. Controls on the widget: mute, raise hand, expand, leave (same hub ops as the Drive room).
3. **Expand** focuses the active Drive room (Drive tab + stage when available). PiP never owns room discovery or a second stage.
4. Hub webview is the primary host. The widget lives inside the hub window (`position: fixed` / panel chrome). It does **not** inject into Cursor or VS Code editor DOM (binding constraint).
5. VS Code / other hosts may later dock an equivalent companion inside the Cline panel using host APIs — never DOM hacks over the editor.

Drive tab remains primary IA. Chat Join remains the shortcut into the room. PiP is the **stay-in-Chat companion**.

```text
Drive tab + Spotlight     → authoritative room + shared work
Chat Join call            → shortcut into that room
PiP Partner               → glanceable controls while elsewhere in hub
```

## Goals

- Keep call awareness while the user reads Chat or other hub pages.
- Reuse the same room, roster, and control ops as DRV-CALL-STRIP / DRV-LEAVE-END / DRV-INTERRUPT.
- Make Expand the path back to stage and full transcript — PiP is not a second product.
- Preserve privacy-strict defaults (no new transcript/audio persistence).

## Non-goals

- Replacing Drive tab, Spotlight/stage, or Chat Join as the primary call surfaces.
- Floating over the VS Code / Cursor editor via DOM injection.
- A separate room list, stage, or address UI inside the PiP (address stays in the room).
- Pixel screen share inside the PiP (events-first stage stays on the room surface).
- Multi-human media / WebRTC (unchanged future work).

## Personas

| Persona | Need |
|---|---|
| Pair programmer | Stay in Chat while still seeing partner state and muting |
| Reviewer | Glance captions while scrolling tool output |
| Power user | Expand into stage without hunting the Drive tab |

## User stories

1. As a user in an active call, when I leave the Drive tab for Chat, a PiP widget remains visible with partner presence and mute.
2. As a user, I can mute, raise hand, and leave from the PiP; state matches the Drive call strip.
3. As a user, Expand focuses the active Drive room (and stage when on).
4. As a user, dismissing or leaving from PiP uses the same leave op as the room; the room may persist per DRV-LEAVE-END.
5. As a user, when I am not in a call, no PiP is shown.
6. As a privacy-conscious user, PiP never persists captions or audio beyond live display.

## Requirements

### Functional

| ID | Requirement |
|---|---|
| PIP-01 | PiP renders only when the local human is a participant in an active hub room. |
| PIP-02 | PiP shows partner display name, presence (speaking / muted / hand), and Drive sub-mode. |
| PIP-03 | PiP shows at most one live caption/narration line (current decision-point line). |
| PIP-04 | Mute, raise hand, and leave invoke the same hub ops as the call strip. |
| PIP-05 | Expand focuses Drive tab + active room; if stage is available, stage remains visible. |
| PIP-06 | PiP position is user-draggable within the hub webview bounds; position may be a live facet (session), not durable across restarts unless a durable facet is later added. |
| PIP-07 | Closing the PiP without leave hides the widget only (opt-out of companion chrome); leave remains explicit. |
| PIP-08 | No second writer, no `:7891`, no parallel room state. |

### Non-functional

| ID | Requirement |
|---|---|
| PIP-N1 | Hub webview only for MVP host path. |
| PIP-N2 | No Cursor/VS Code editor DOM injection. |
| PIP-N3 | Privacy-strict: captions are live projection only. |
| PIP-N4 | Accessible: keyboard focus order for mute / hand / expand / leave; visible focus rings. |

## Phasing

- **MVP (phase 2):** Hub webview PiP companion after room + call strip + stage basics exist. Feature [DRV-PIP](../features/DRV-PIP.md).
- **Later:** Docked companion inside VS Code Cline panel via host APIs; optional CLI status-bar parity already covered by [DRV-CLI-PARITY](../features/DRV-CLI-PARITY.md).

## Success metrics (qualitative)

- Users can complete a mute / raise-hand / expand loop without opening the Drive tab first.
- Expand always lands on the same room id as Chat Join and the Drive tab.
- Support threads never treat PiP as a second call product.

## Decision record

Architecture decision: [ARD-0006](../ard/ARD-0006-pip-partner-companion.md). Prior rejection in [00-vision.md](../00-vision.md) and wireframe notes is superseded by this PRD: PiP is in scope as a **companion**, not as primary IA.

## References

- Wireframe: [drive-wireframes/index.html](../../../design/drive-wireframes/index.html) variant C · [variant-c.png](../../../design/drive-wireframes/variant-c.png)
- Related features: [DRV-TOGGLE](../features/DRV-TOGGLE.md), [DRV-CALL-STRIP](../features/DRV-CALL-STRIP.md), [DRV-STAGE](../features/DRV-STAGE.md), [DRV-PERSONA-CHIP](../features/DRV-PERSONA-CHIP.md), [DRV-NARRATION](../features/DRV-NARRATION.md), [DRV-LEAVE-END](../features/DRV-LEAVE-END.md), [DRV-INTERRUPT](../features/DRV-INTERRUPT.md)
- Constraints: [cline-drivemode README](../README.md) (no DOM hacks, hub single writer)
