# AGENT-RUNBOOK · Executing these plans with agents

Back to [README](README.md).

## How to pick work

1. Open [TASK-GRAPH.md](TASK-GRAPH.md). Find the lowest phase whose gate is not yet green.
2. Inside that phase, pick a feature whose dependencies (listed in its file) are complete.
3. Inside that feature, execute the agent-task checklist top to bottom. Tasks are ordered so read-and-map tasks come before write tasks.
4. Check off tasks in the feature file as they complete, with a one-line note if reality diverged from the plan.
5. When a feature's acceptance criteria all hold, mark it in the README status table.

Never start a task whose feature dependencies are red. Never start a phase whose predecessor gate is red.

## Spawning agents

One agent per feature is the default grain. One agent per checklist task is acceptable for large features (DRV-ROOM-MVP, DRV-INTERRUPT) when tasks touch disjoint files.

Prompt contract for each spawned agent:

- Working directory `C:\Users\harri\Documents\dev\profiles\hhalperin\active\cline-drivecode`.
- Link the feature file and require reading it plus this runbook's conventions before editing.
- Name the exact checklist tasks in scope. Nothing else is in scope.
- Require the task's verify command to run and pass before the agent reports done.
- Require a diff summary naming files changed and tests added.

Agents working the same phase must not share write targets. Features in one phase touch disjoint files by design. If two in-flight features collide on a file, serialize them rather than merging concurrent edits.

## Environment and conventions

- **Bun only.** `bun install`, `bun run ...`, `bun -F <pkg> <script>`. Never npm, yarn, or pnpm.
- **SDK rebuild rule.** After changing any `sdk/packages/*` source, run `bun run build:sdk` from `sdk/` before running anything that imports it. Missing `dist/` errors mean a stale build, not a code bug (see `sdk/AGENTS.md`).
- **Package boundaries.** `shared → llms → agents → core → apps`. The Drive kernel (`@cline/drive`) sits beside `agents` in spirit: pure, stateless, no core dependency. Route changes to the package that owns the concern.
- **Repo code style.** ESM, named exports, exhaustive switches with `never` defaults, imports at the top of the module.
- **Verify commands per surface.**
  - Schemas: `bun -F @cline/shared test`
  - Kernel: `bun -F @cline/drive test`
  - Hub/core: `bun -F @cline/core test:unit`
  - Hub app: `bun -F @cline/cline-hub test` and `bun -F @cline/cline-hub typecheck`
  - CLI: `bun -F @cline/cli test:unit`
  - Cross-package: `bun run types` and `bun run test` from `sdk/`
- **Runtime verification.** Webview features smoke on `bun -F @cline/cline-hub dev` using the `control-ui` skill (cursor-team-kit). TUI features smoke on `bun run cli -i` using the `control-cli` skill. A live turn requires an LLM provider credential (`ANTHROPIC_API_KEY` or `cline auth`).
- **Known environment artifacts.** The `@cline/core` workspace-manifest git test fails on cloud VMs due to remote-rewrite rules, and some CLI e2e string assertions have pre-existing drift. Do not chase these as regressions.

## Skills and hooks to use while executing

- `control-ui` and `control-cli` for runtime verification (named above).
- `how` (pstack) over any unfamiliar subsystem before changing it. The hub server internals and the turn loop qualify.
- `deslop` (cursor-team-kit) over every diff before commit. `unslop` over any prose.
- `verify-this` when a claim needs fresh evidence (for example, "mute is enforced hub-side").
- `create-skill` when DRV-SKILL-PORT authors skill files.
- Drive's own runtime hooks are product code (DRV-HOOK-POLICY), not agent tooling. Do not confuse the two.

## Diagram-first vs diagram-show (Cline skills)

Honor [`.claude/diagram-conventions.md`](../../../../.claude/diagram-conventions.md). Skills live under `.agents/skills/` (Cline discovers them; SDK-backed, not Claude plugins).

| Skill | When |
|---|---|
| **`diagram-first`** | Structural nest docs: ARDs, [architecture.md](../../architecture.md), share-and-router, ops topology, show-backlog DAGs |
| **`diagram-show`** | Enqueue/present `diagram.*` Show items via `SHOW_TEMPLATE_KIT` + `drive.show.*` |

**Do not** use diagram-first as the default for feature checklists or PR implementation plans — use visual-plan / the DRV checklist. Do not replace [TASK-GRAPH.md](TASK-GRAPH.md) with date `gantt` charts.

When shipping structural nest Mermaid:

1. Edit existing ` ```mermaid ` fences in place (stable node IDs).
2. Caption ≤5 bullets; never narrate arrows; list open questions from blind spots.
3. Gate with `bun sdk/scripts/validate-mermaid.ts <doc.md>` (same rules as `@cline/drive` `validateMermaidSource`).
4. After correcting a naming mistake, offer to record the rule in `.claude/diagram-conventions.md`.

## Hard constraints (repeat offenders)

- No second daemon. Nothing listens on `:7891`. The hub on `:25463` is the only server.
- No Cursor or VS Code chrome DOM hacks.
- Privacy-strict defaults. No transcript or audio persistence, ever, without the explicit debug flag.
- No timeframes in any plan or status doc.
- Branch and commit per the git workflow rules. Feature branches (`feat/drv-toggle`), Conventional Commits, tests green before push, no direct commits to protected branches.

## Reporting

Each completed feature reports: acceptance criteria status line by line, verify commands run with results, deviations from the plan file, and any new checklist items filed into other features (integration defects route to the owning feature, not inline patches).
