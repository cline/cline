# ARD-0003: Recruit ranks agents; RosterPack remains curated seating

## Status

Recommended

## Metadata

- Date: 2026-07-25
- Deciders: Drivecode planning (cline-drivemode)
- Related: PRD 6, ARD-0001, ARD-0002, DRV-ROSTER-PACK, DRV-TEAM-OPT

## Context

Users want “add the cybersecurity team to the call” and “who should do this?” Those sound like one feature but are two mechanisms:

1. **RosterPack** — human-curated seating preset (already decided; must not be named `Team`).
2. **Recruit** — query over agent portfolio graphs → ranked agents (+ optional pack suggestions).

Collapsing them would either make packs too smart (opaque) or recruit too rigid (only named crews).

## Decision

1. **Both exist.** Packs are presets. Recruit is search.
2. **Recruit MVP** is lexical/tag scoring over capability catalogs and labels (personal-site filter quality), implemented as an in-memory index scanned from `.driveagent/**` homes. No second daemon. No embeddings in MVP.
3. **Recruit may suggest packs** when pack member graphs cluster under the need, but seating a pack still goes through existing pack seatSources / seatCap / `teamOpt` rules.
4. **Spoken “team”** maps to pack **displayName** or recruit query text, never to a Drive type named Team.
5. **Seat path** is always hub room ops (`seatSources`). Recruit never writes participants itself; UI calls seat with the chosen slug(s).
6. **Empty graph agents** remain seatable manually and via packs; they simply rank low in recruit until authored.
7. **Drive-tab placement.** Recruit lives under the same **Add** affordance as packs (W-36 / W-38), not a separate Discord “server.” Results seat into the **active** room; multi-room focus rules (W-07) still apply to which room receives the seat.
8. **Addressing after recruit.** Newly seated agents do not automatically join the address set. The human addresses them explicitly, or uses address-follows-focus by opening their Transcript.

## Example resolutions

| User says / does | Resolves to |
|---|---|
| `/pack cybersecurity` | RosterPack slug `cybersecurity` |
| “add the cybersecurity team” (spoken) | Pack whose `displayName` fuzzy-matches (not a Team type) |
| `/recruit oauth review` | Ranked Driveagent slugs + optional pack suggestions |
| Add → Recruit → seat “Riley” | `room_seat` / manual seatSource for Riley’s profile |

## Consequences

**Positive**

- Clear UX: Add pack vs Recruit.
- Preserves platform naming invariants.
- Incremental delivery (P2) without blocking P0 profile.

**Negative**

- Two entry points to teach.
- Lexical recruit will miss fuzzy phrasing until P4.

## Alternatives considered

- **Packs only** — Cannot answer open-ended “who fits?”
- **Recruit only** — Loses one-click known crews; worse for repeatable rituals.
- **Rename RosterPack to TeamPack** — Rejected earlier; Cline runtime `Team` collision.

## References

- [DRV-ROSTER-PACK](../features/DRV-ROSTER-PACK.md)
- [DRV-TEAM-OPT](../features/DRV-TEAM-OPT.md)
- PRD 6 recruit API sketch
