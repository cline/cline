# ARD-0007: Drive is a Cline mode, not a separate product

## Status

Accepted

## Metadata

- Date: 2026-07-27
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 8, DRV-MODE-OVERLAY, DRV-TOGGLE, DRV-DRIVE-TAB, D3 in 01-architecture.md

## Context

Earlier planning treated Drive as a product home (Drive tab first, Chat Join as a shortcut into “Drive”). That produced strong room IA, but it also risked reading as a second app bolted onto Cline.

The product goal is different: **Drive is a mode of Cline**, akin to Plan and Act. Entering Drive enables call/room/stage/PiP/roster features. Leaving Drive returns native Cline. The experience must feel almost seamless inside existing hub Chat and composer chrome—not a brand fork.

## Decision

1. **Drive is a first-class Cline mode.** Users enter and exit Drive from the same mode surface family as Plan/Act (composer / mode pill). Native Cline without Drive remains Plan | Act only.
2. **Mode enables features.** Drive mode on attaches or creates the active room and unlocks Drive affordances (presence, stage, address, PiP, ask/debug postures, interrupt). Drive mode off does not show those affordances.
3. **Postures nest under Drive.** While Drive is active, posture is Plan | Agent | Ask | Debug (existing DRV-MODE-OVERLAY mapping to native plan/act). Ask/Debug are not peer top-level modes next to Drive.
4. **Chat is the default work surface in Drive mode.** Session feed, composer, and (when on) stage split live in the familiar Chat column. Users should not need a separate app switch to pair-program.
5. **Drive tab is room management, not a second product.** The hub activity for channels/rooms remains useful for multi-room discovery and roster depth, but it is **Cline hub navigation**, not “leave Cline for Drive.” Copy and chrome stay Cline-branded; avoid “open Drive” as if it were another product.
6. **Join / Leave language.** Prefer “Drive on / Drive off” or mode selection over a standalone product launch. Chat Join call remains a valid synonym for entering Drive mode + attaching the room.
7. **Amends D3.** Room-first domain stays. “Drive tab primary product home” is replaced by **Drive mode primary activation**; Drive tab is secondary IA for rooms. See [01-architecture.md](../01-architecture.md).

## Consequences

**Positive**

- Matches how Cline users already switch Plan/Act.
- Clear off-switch: native Cline untouched when Drive is off.
- Reduces dual-brand / dual-home confusion.

**Negative**

- Drive tab wireframes must be read as room management, not the sole north star entry.
- Mode pill density increases (Drive + nested postures).

## Alternatives considered

- **Drive tab remains the only entry** — Rejected for seamlessness; forces an app-switch feel.
- **Drive as orthogonal toggle separate from Plan/Act forever** — Weaker “akin to Plan and Act” story; keep nested postures instead.
- **Separate Cline Drive product chrome** — Rejected; conflicts with seamless integration.

## References

- [PRD 8](../prd/prd-drive-as-cline-mode.md)
- [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md)
- [DRV-TOGGLE](../features/DRV-TOGGLE.md)
- [00-vision.md](../00-vision.md)
