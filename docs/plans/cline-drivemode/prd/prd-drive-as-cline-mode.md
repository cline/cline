# PRD 8: Drive as a Cline mode (seamless integration)

## Problem

Drive features (rooms, Spotlight, roster, PiP, address, interrupt) must ship without teaching users a second product. If Drive feels like “leave Cline and open Drive,” adoption and trust suffer. Users already understand **Plan** and **Act** as modes of the same agent.

## Solution

Treat **Drive** as a Cline mode that enables those features inside existing Cline surfaces.

```text
Native Cline:   Plan | Act
Drive mode on:  Drive active → postures Plan | Agent | Ask | Debug
                + room, stage, roster, PiP, address, interrupt
Drive mode off: Plan | Act again — no Drive chrome
```

Activation lives on the mode control users already use. Chat remains the default place work happens. The hub Drive activity is optional room management under the same Cline Hub chrome—not a separate app.

See [ARD-0007](../ard/ARD-0007-drive-as-cline-mode.md).

## Goals

- Entering Drive feels like switching Plan → Act: one control, same session, same hub.
- Drive features appear only when Drive mode is on.
- Visual language stays Cline (tokens, composer, hub rail)—no second brand shell.
- Off is clean: native Chat/composer with zero Drive affordances.

## Non-goals

- Removing the room domain model or Spotlight.
- Deleting the Drive hub activity (it remains for room list / roster depth).
- Replacing Plan/Act semantics; Drive nests collaborative postures on top.
- A standalone marketing product that replaces Cline Hub.

## Personas

| Persona | Need |
|---|---|
| Everyday Cline user | Try Drive without learning a new app |
| Pair programmer | Stay in Chat with stage/PiP while Drive is on |
| Power user | Open Drive activity only when managing rooms/packs |

## User stories

1. As a user, I can switch the mode control to **Drive** the same way I switch to Plan or Act.
2. As a user, when Drive turns on, I am in (or attach to) the active call room without a setup wizard.
3. As a user, while Drive is on I can choose Plan / Agent / Ask / Debug postures.
4. As a user, Chat remains usable as the main transcript; stage and PiP appear as Cline chrome, not a foreign window.
5. As a user, turning Drive off removes Drive-only chrome and returns Plan | Act.
6. As a user, I never see a second product name competing with “Cline” in primary chrome (labels say Drive *mode* / call, not a separate suite).

## Requirements

| ID | Requirement |
|---|---|
| MODE-01 | Mode control exposes Drive as a peer activation to Plan/Act entry (exact segment layout may be Plan \| Act \| Drive, or Drive as an explicit on-state adjacent to Plan/Act—implementation chooses one; UX review must confirm “mode-like” recognition). |
| MODE-02 | Drive on ⇒ room attach/create + Drive affordances enabled. |
| MODE-03 | Drive off ⇒ native Plan \| Act only; no call strip, stage, PiP, address bar, or Drive tab requirements to complete a turn. |
| MODE-04 | While Drive on, posture control is Plan \| Agent \| Ask \| Debug per DRV-MODE-OVERLAY. |
| MODE-05 | Primary work surface in Drive mode is Chat (session column), with optional stage split and PiP. |
| MODE-06 | Drive hub activity is optional navigation for rooms/roster; not required to enter Drive mode. |
| MODE-07 | Copy and IA present Drive as a mode of Cline, not a separate product launch. |
| MODE-08 | CLI parity uses the same mode semantics (status bar Drive on/off already sketches this). |

## Phasing

- **Phase 1:** Mode entry + Chat-centered Drive on (DRV-TOGGLE, DRV-MODE-OVERLAY, room MVP, feed behaviors).
- **Phase 2:** Stage, strip, PiP, address—still gated by Drive mode.
- **Phase 3:** Voice—still gated by Drive mode.

## Success metrics (qualitative)

- A Cline user can explain Drive as “another mode like Plan/Act” after one session.
- Support never needs “open the Drive app” as a step—only “switch to Drive mode” / “turn Drive off.”
- Screenshots of Drive-on Chat still read as Cline Hub.

## References

- [ARD-0007](../ard/ARD-0007-drive-as-cline-mode.md)
- [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md)
- [DRV-TOGGLE](../features/DRV-TOGGLE.md)
- [DRV-DRIVE-TAB](../features/DRV-DRIVE-TAB.md)
- [DRV-PIP](../features/DRV-PIP.md)
- [00-vision.md](../00-vision.md)
