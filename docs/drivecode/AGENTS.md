# docs/drivecode — agent guide

All Drive / drivecode / cline-drivemode documentation lives under this directory.
Do not create parallel trees at `docs/plans/`, `docs/design/`, `docs/reviews/`,
or `docs/assets/drivecode/`.

Human-facing product reference: [README.md](README.md).
Cold-start handoff: [HANDOFF.md](HANDOFF.md).
CI contract (path filters, gate, labels): [CI.md](CI.md).

## Layout

| Path | Put here |
|---|---|
| `README.md`, `architecture.md`, `native-vs-drivecode.md`, `skills-inventory.md`, `CI.md` | Implemented product reference (cite live code / workflows) |
| `HANDOFF.md` | Repo-level continuation brief |
| `plans/cline-drivemode/` | Product plans: ARDs, DRV features, PRDs, workflows, task graph |
| `plans/drivecode-sdk/` | Portable `@cline/drive` harness plan |
| `design/drive-wireframes/` | HTML wireframes, brand tokens, canvases, DEMO runbook |
| `assets/` | Product screenshots and logos (PNG) |
| `reviews/` | PR review notes and glossary |

Mintlify product docs (`docs/sdk/`, `docs/cli/`, `docs/features/`, …) stay outside
this nest. Brand source files under repo-root `assets/drive/` are not docs.

## Adding

1. Choose the row above. Prefer an existing folder over inventing a new top-level sibling.
2. New product work: start under `plans/cline-drivemode/` (`features/DRV-*.md`, `ard/ARD-*.md`, or update `TASK-GRAPH.md`).
3. New harness / host-port work: `plans/drivecode-sdk/`.
4. New screenshots: drop into `assets/` and link as `docs/drivecode/assets/<name>.png` from README / AGENTS / DEMO notes.
5. New wireframes: `design/drive-wireframes/`; update that folder’s README if it is a primary entry.
6. Link new docs from the nearest index (`plans/.../README.md`, this nest’s `README.md`, or `HANDOFF.md` when it changes the front door).

## Editing

- Keep product-reference pages (`README.md`, `architecture.md`, …) tied to code paths that exist in this repo.
- Prefer relative links inside the nest (`./plans/...`, `../../design/...` from deep plans).
- Prefer absolute repo paths in handoffs and external callouts: `docs/drivecode/...`.
- When renaming or moving a file, update absolute `docs/drivecode/...` strings and relative links that cross folder boundaries. Grep for the old path before finishing.
- Do not leave stubs at old locations (`docs/plans/...`, `docs/design/...`, etc.).
- Structural docs (architecture, ARDs, ops topology, director DAGs): load Cline skill **`diagram-first`**; Show stage diagrams use **`diagram-show`**. Honor [`.claude/diagram-conventions.md`](../../.claude/diagram-conventions.md). See [AGENT-RUNBOOK](plans/cline-drivemode/AGENT-RUNBOOK.md) § Diagram-first.

## Maintaining

- After shared SDK edits that docs cite, rebuild with `bun run build:sdk` before claiming behavior in reference pages.
- Screenshot refresh: write to `docs/drivecode/assets/` (see root `AGENTS.md` TUI / hub screenshot notes).
- Decision status stays on the ARD board: `plans/cline-drivemode/ard/ARD-0000-status-board.md`.
- Keep `HANDOFF.md` short; deep detail belongs in plans / ARDs, not duplicated here.

## Out of scope here

- Shipping Mintlify user docs (use the existing `docs/*.mdx` trees).
- Implementation code under `apps/` or `sdk/` — docs describe it; they do not replace it.
