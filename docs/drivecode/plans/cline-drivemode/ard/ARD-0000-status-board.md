# ARD-0000 · Decision status board

**Purpose.** One place to see what is Accepted, Proposed, Recommended-default, or Superseded.
**Owner.** Drivecode SE lead / PM.
**Related.** [LEADERSHIP-BRIEF.md](../LEADERSHIP-BRIEF.md), [HANDOFF.md](../HANDOFF.md), [../../HANDOFF.md](../../../HANDOFF.md).

## Status legend

| Status | Meaning |
|---|---|
| **Accepted** | Binding. Implementers may rely on it. |
| **Recommended** | Leadership default pending formal accept / `change: …`. Treat as Accepted for planning continuity unless overturned. |
| **Proposed** | Written; not yet leadership-endorsed. |
| **Superseded** | Replaced by a newer decision. Do not implement. |
| **Open** | Needs an explicit answer before Phase 0 schemas freeze. |

## Acceptance record

**2026-07-29.** Human instruction: `accept all` for **ARD-0000…0013** and the leadership DEC bundle (`DEC-agent-source-of-truth`, `DEC-package-location`, `DEC-open-product-forks`). **ARD-0014** (Chat-fork lifecycle) landed on `main` the same day as **Accepted** and is included on this board.

## Architecture decision records

| ID | Title | Status | Notes |
|---|---|---|---|
| [ARD-0001](ARD-0001-driveagent-home.md) | `.driveagent/` is the agent home | **Accepted** | |
| [ARD-0002](ARD-0002-agent-graph-canonical-derived.md) | Canonical YAML → derived graph | **Accepted** | |
| [ARD-0003](ARD-0003-recruit-and-roster-pack.md) | Recruit ranks; packs stay curated | **Accepted** | Lexical MVP |
| [ARD-0004](ARD-0004-gated-learn-privacy.md) | Gated learn; no transcript dump | **Accepted** | |
| [ARD-0005](ARD-0005-status-hub.md) | Status Hub: SQLite status log in the Cline SDK | **Accepted** — implemented | SDK-scope, not Drive-only. Store, service, hub ops, `report_status` tool, dashboard viewer |
| [ARD-0006](ARD-0006-pip-partner-companion.md) | PiP Partner is a companion surface | **Accepted** | |
| [ARD-0007](ARD-0007-drive-as-cline-mode.md) | Drive is a Cline mode | **Accepted** | |
| [ARD-0008](ARD-0008-task-bank.md) | Task bank is Drive’s execution primitive | **Accepted** | |
| [ARD-0009](ARD-0009-runtime-topology-local-cloud.md) | Runtime topology local / cloud / hybrid | **Accepted** | |
| [ARD-0010](ARD-0010-provider-harness-byok.md) | Provider harness (BYOK) | **Accepted** | |
| [ARD-0011](ARD-0011-demo-share-track.md) | Demo share track | **Accepted** | |
| [ARD-0012](ARD-0012-agent-router.md) | Agent router for multi-agent rooms | **Accepted** | |
| [ARD-0013](ARD-0013-state-partition.md) | Three-lane state partition | **Accepted** | Durable log + single live store; remote/org/audit are adapters |
| [ARD-0014](ARD-0014-chat-fork-lifecycle.md) | Chat-fork lifecycle (invisible auditable workers) | **Accepted** | Hub `drive.fork.*` + PromotePacket; reject CLI/checkpoint fork as worker substrate |

## Leadership decisions (this wave)

| ID | Title | Status |
|---|---|---|
| [DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md) | Author in `.driveagent/`; compile into host | **Accepted** |
| [DEC-package-location](../decisions/DEC-package-location.md) | `@cline/drive` in monorepo for phase 1 | **Accepted** |
| [DEC-open-product-forks](../decisions/DEC-open-product-forks.md) | Focus / streams / share / accent / revise | **Accepted** (bundle) |

## Architecture D1–D10

| ID | Title | Status |
|---|---|---|
| D1 | Kernel package `@cline/drive` | Accepted (architecture) |
| D2 | Hub single writer `:25463` | Accepted |
| D3 | Room-first; Drive tab primary | Accepted |
| D4 | Events-first stage; bidirectional sharer | Accepted |
| D5 | Hooks are the interception path | Accepted |
| D6 | Surfaces render typed events | Accepted |
| D7 | Facet catalog + lanes + hub durable writes | Accepted |
| D8 | Runtime topology local / cloud / hybrid | Accepted |
| D9 | Provider harness (BYOK) | Accepted |
| D10 | Three-lane state partition | Accepted ([ARD-0013](ARD-0013-state-partition.md)) |

SDK amendments (reducer/projection in `@cline/drive`; host port + conformance kit) must be reflected in `DRV-KERNEL` ACs before Phase 0 gate.

## Still Open (product gaps)

| Topic | Blocking artifact | Notes |
|---|---|---|
| Approval UI owner detail | [DRV-GATES](../features/DRV-GATES.md) | Feed card over existing approval plumbing. **Taxonomy enums landed** in `sdk/packages/shared/src/drive/gates.ts` (UI / expiry / hub projection still open) |
| Catch-up orientation copy owner | DRV-LEAVE-END | One factual “since you left” line from stage reducer |
| One-shot fork vs specialist | Later; not Phase 0 | Out of Phase 0; track under W-33 |

## Explicitly not open anymore (closed by this wave’s defaults)

- Formal ARD accept (ARD-0000…0013 + DEC bundle) → **Accepted** (2026-07-29 `accept all`). ARD-0014 (Chat-fork lifecycle) Accepted on `main` and indexed above.
- Separate `drivecode-sdk` repository for phase 1 → **Rejected** ([DEC-package-location](../decisions/DEC-package-location.md)).
- Pixel user-share in MVP → **Rejected** ([DEC-open-product-forks](../decisions/DEC-open-product-forks.md)).
- Dual prompt stores (facets + homes) → **Rejected** ([DEC-agent-source-of-truth](../decisions/DEC-agent-source-of-truth.md)).
- Background turns in unfocused rooms (MVP) → **Rejected**.

## Change control

1. New architectural fork → new ARD or DEC, linked here.
2. Do not silently edit Accepted decisions in feature files.
3. Supersessions require a one-line “Supersedes X” in the new record and a status flip here.
