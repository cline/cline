# DEC · Open product forks (bundle)

**Status.** Recommended  
**Date.** 2026-07-25  
**Deciders.** Drivecode leadership planning wave  
**Closes.** Preference forks listed in `DRIVE-TAB.md`, W-07 / W-12 gaps, accent preference, user-share fork

## Decisions

### 1. Multi-room focus (`room.focusPolicy`)

**MVP default: `focus-room`.** Exactly one room may run agent turns. Unfocused rooms are **view-only projections** (roster + history visible; no background tool loop; no spend).

- Switching focus pauses the previous room after the current tool (same interrupt policy family as raise-hand) unless the room is already idle.
- Notifications for unfocused rooms are out of MVP (no toast spam).
- Multi-room IA (list of rooms) still ships in Phase 1 chrome; runtime concurrency does not.

**Why.** Predictable cost, simpler hub, honest MVP. Background multi-room runtimes need isolation + budget policy first.

### 2. Per-agent transcript model

**MVP: filtered projection** of the shared room event log (addressed-to / from that agent), not a separate private event store.

- UI may still present “Agent stream” as a focus mode.
- A dedicated private log remains a Phase 2+ option if filtered projection fails address-follows-focus UX.

**Why.** Smaller schema; privacy-easier; avoids dual retention surfaces.

### 3. User share MVP

**Structured only** (selection / file / terminal pin). Pixel capture / WebRTC stays in multi-user media plan.

**Why.** Matches architecture D4 and vision; closes the wireframe “open fork” that contradicted architecture.

### 4. Brand accent

**Violet edge** for selection (left edge + raised surface). Primary CTA may stay filled. Do not ship violet-fill density as the default Drive chrome.

**Why.** Matches cline.bot accent spend; keeps the stage the brightest plane.

### 5. Revise-not-restart (W-12)

**Kernel acceptance criterion:** when the user barges in mid-turn with a correction, the default policy is **revise** (preserve useful tool results and continue) rather than discard-and-restart, unless the correction explicitly says restart / cancel.

- Misclassification lean: revise.
- Hard cancel remains available via raise-hand + end / explicit cancel.

**Owner feature.** `DRV-KERNEL` gains this AC; `DRV-INTERRUPT` references it.

### 6. Catch-up orientation (W-06)

On rejoin, show one factual **“since you left”** line derived from stage/now-next projection (files touched, last command, open plan step). No LLM inventing narrative when history is thin — fall back to a plain list (same rule as end handoff).

**Owner.** `DRV-LEAVE-END` + stage projection helpers.

### 7. Mic mute ⊥ TTS quiet (W-23)

Independent controls. Muting mic must not imply TTS off; quieting TTS must not imply mic off. Call strip shows both states.

## Non-decisions (explicitly deferred)

| Topic | Defer to |
|---|---|
| Wake/sleep voice phrases (W-21) | Deferred section of DRV-MIC |
| One-shot fork vs seated specialist (W-33) | Post–teamOpt product spike |
| Semantic/embeddings recruit | PRD 6 P4 |
| TextChannels product | After Drive call MVP proves retention |

## Doc patches required

- `DRIVE-TAB.md` open forks → mark closed with pointers here.
- `DRV-ROOM-MVP` / `DRV-KERNEL` / `DRV-TRANSCRIPT` / `DRV-SHARE` ACs absorb the above.
- Facet `focusPolicy` default remains `focus-room` and is no longer “open.”
