# ARD-0000 · Decision status board

**Purpose.** One place to see what is Accepted, Proposed, Recommended-default, or Superseded.  
**Owner.** Drivecode SE lead / PM.  
**Related.** [LEADERSHIP-BRIEF.md](../LEADERSHIP-BRIEF.md), [HANDOFF.md](../HANDOFF.md), [../HANDOFF-drivecode.md](../../HANDOFF-drivecode.md).

## Status legend

| Status | Meaning |
|---|---|
| **Accepted** | Binding. Implementers may rely on it. |
| **Recommended** | Leadership default pending Harrison `accept all` / `change: …`. Treat as Accepted for planning continuity unless overturned. |
| **Proposed** | Written; not yet leadership-endorsed. |
| **Superseded** | Replaced by a newer decision. Do not implement. |
| **Open** | Needs an explicit answer before Phase 0 schemas freeze. |

## Architecture decision records

| ID | Title | Status | Notes |
|---|---|---|---|
| [ARD-0001](ARD-0001-driveagent-home.md) | `.driveagent/` is the agent home | **Recommended** | Accept unless SoT decision overturns |
| [ARD-0002](ARD-0002-agent-graph-canonical-derived.md) | Canonical YAML → derived graph | **Recommended** | |
| [ARD-0003](ARD-0003-recruit-and-roster-pack.md) | Recruit ranks; packs stay curated | **Recommended** | Lexical MVP |
| [ARD-0004](ARD-0004-gated-learn-privacy.md) | Gated learn; no transcript dump | **Recommended** | |

Promotion rule. When Harrison replies `accept all`, flip these four to **Accepted** in this board and in each ARD header.

## Leadership decisions (this wave)

| ID | Title | Status |
|---|---|---|
| [DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md) | Author in `.driveagent/`; compile into host | **Recommended** |
| [DEC-package-location](../decisions/DEC-package-location.md) | `@cline/drive` in monorepo for phase 1 | **Recommended** |
| [DEC-open-product-forks](../decisions/DEC-open-product-forks.md) | Focus / streams / share / accent / revise | **Recommended** (bundle) |

## Architecture D1–D7

| ID | Title | Status |
|---|---|---|
| D1 | Kernel package `@cline/drive` | Accepted (architecture) |
| D2 | Hub single writer `:25463` | Accepted |
| D3 | Room-first; Drive tab primary | Accepted |
| D4 | Events-first stage; bidirectional sharer | Accepted |
| D5 | Hooks are the interception path | Accepted |
| D6 | Surfaces render typed events | Accepted |
| D7 | Facet catalog + lanes + hub durable writes | Accepted |

SDK amendments (reducer/projection in `@cline/drive`; host port + conformance kit) are **Recommended** and must be reflected in `DRV-KERNEL` ACs before Phase 0 gate.

## Still Open (must clear Phase 0 checklist)

| Topic | Blocking artifact | Default if silent |
|---|---|---|
| Formal ARD accept | This board | Recommended → treat as Accepted for schema drafts only; mark Accepted after human reply |
| Approval UI owner detail | [DRV-GATES](../features/DRV-GATES.md) | Feed card over existing approval plumbing |
| Catch-up orientation copy owner | DRV-LEAVE-END | One factual “since you left” line from stage reducer |
| One-shot fork vs specialist | Later; not Phase 0 | Out of Phase 0; track under W-33 |

## Explicitly not open anymore (closed by this wave’s defaults)

- Separate `drivecode-sdk` repository for phase 1 → **Rejected** ([DEC-package-location](../decisions/DEC-package-location.md)).
- Pixel user-share in MVP → **Rejected** ([DEC-open-product-forks](../decisions/DEC-open-product-forks.md)).
- Dual prompt stores (facets + homes) → **Rejected** ([DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md)).
- Background turns in unfocused rooms (MVP) → **Rejected**.

## Change control

1. New architectural fork → new ARD or DEC, linked here.
2. Do not silently edit Accepted decisions in feature files.
3. Supersessions require a one-line “Supersedes X” in the new record and a status flip here.
