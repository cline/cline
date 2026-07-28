# ARD-0006: PiP Partner is a companion surface, not primary IA

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 7, DRV-PIP, DRV-DRIVE-TAB, DRV-STAGE, DRV-TOGGLE, DRV-CALL-STRIP

## Context

Wireframe variant C (PiP Partner) was rejected when it was treated as an alternative primary IA to the Drive tab / Call Stage. That framing was wrong for the product we are shipping:

- Users need glanceable call controls while staying in Chat.
- Drive tab + Spotlight must remain the authoritative room and share surfaces.
- Floating over the VS Code editor via DOM injection is forbidden and weak.

The forcing function is an explicit product requirement to **build PiP**, without undoing the Drive-tab north star.

## Decision

1. **PiP is in scope** as a companion widget for an active hub room (feature [DRV-PIP](../features/DRV-PIP.md), [PRD 7](../prd/prd-pip-partner.md)).
2. **Primary IA unchanged.** Drive tab owns rooms; Chat Join is a shortcut; Spotlight/stage owns shared work. PiP does not replace any of them.
3. **Same ops.** Mute, raise hand, leave, and membership projection are shared with the call strip. No second writer.
4. **Expand** focuses the active Drive room (and stage when present). PiP is not a second stage.
5. **Host path.** MVP is hub webview only. No Cursor/VS Code editor DOM injection. Later hosts may dock an equivalent companion via real host APIs.
6. **Supersedes** the “Variant C stays rejected” language in [00-vision.md](../00-vision.md) and the historical wireframe cut label — rejection applied to PiP-*as-primary*, not to PiP-*as-companion*.

## Consequences

**Positive**

- Users keep call awareness without abandoning Chat.
- Decision trail stays honest: earlier rejection was about IA primacy, not the widget concept.

**Negative**

- Another chrome surface to keep in sync with the call strip.
- VS Code float-over-editor expectations must be actively managed in docs and UX copy.

## Alternatives considered

- **Keep PiP rejected** — Leaves a real gap when users work in Chat during a live call.
- **PiP as primary IA** — Rejected again; loses roster/stage/address home.
- **Editor DOM overlay** — Violates binding constraints; brittle across hosts.

## References

- [PRD 7](../prd/prd-pip-partner.md)
- [DRV-PIP](../features/DRV-PIP.md)
- [DRIVE-TAB.md](../../../design/drive-wireframes/DRIVE-TAB.md)
- Wireframe variant C in `docs/design/drive-wireframes/index.html`
