# AutoQA

Agent-driven, checked-in QA for every Cline product surface (VS Code, JetBrains,
CLI/TUI, Desktop, Kanban, ACP, Connectors, Cloud).

The runner is a computer-use agent (Cline CLI) living in a sandboxed container
whose egress is proxied so it can hold *dummy* provider keys. Everything the
agent needs to decide "what can I test next?" and everything it produces lives
in this repository and is committed. The product source lives in
[cline/cline](https://github.com/cline/cline); this repo only *refers* to it
(`touches:` paths, `docs:` paths) and optionally reads a local checkout for
planning signals.

```
autoqa/
├── README.md              ← you are here
├── package.json           ← `bun run autoqa …`, `bun run validate`; no dependencies
├── SCHEMA.md              ← field reference for cases / prereqs / runs
├── prereqs/prereqs.yaml   ← prerequisite catalog + shorthand sets (std.ide, std.cli …)
├── cases/<surface>/*.yaml ← cases, grouped by feature file; the *case id* is the unit
├── prompts/               ← agent prompts: runner (the crawl), retest, triage
├── scripts/autoqa.ts      ← bun tool: validate | list | new-run | state | plan | record | report
└── runs/<run-id>/         ← one directory per run (committed)
    ├── run.yaml           ← platform, host, build versions, commit under test
    ├── state.yaml         ← prerequisite bits the agent has flipped on/off
    ├── results.yaml       ← one record per case attempt (pass/fail/blocked/skip)
    ├── journal.md         ← what the agent did, in order, with timestamps
    ├── screenshots/       ← evidence the agent chose to keep
    ├── transcript/        ← optional raw transcript for debugging
    └── summary.md         ← bugs to file, fixes confirmed, flakiness notes
```

## Quick start

```bash
bun --version                         # Bun ≥ 1.2 (uses Bun.YAML; no npm deps)
bun run validate                      # lint prereqs/, cases/, runs/
bun run autoqa list --host vscode     # what applies to a VS Code run
bun run autoqa new-run --platform linux --host vscode
bun run autoqa plan <run-id>          # what to do next
```

Optional: set `CLINE_REPO=/path/to/cline` (defaults to `../cline`) so `plan`
can score cases by recently changed `touches:` paths and by `.changeset/*.md`
tags. Without it the planner still works; the recency signals are just empty.

`run.yaml` records both `commit` (this repo) and `cline_commit` (the checkout,
if any) so a run can be tied to the cases *and* the code it was scored against.
The build actually under test is what you put in `build:`.

## The three nouns

### Case
A case is **one thing someone could say is broken** and be understood:
"the Reset Code button is broken when checkpoints are disabled" — not
"checkpoints are broken". Every case has

* an `id` (`<surface>.<feature>.<behaviour>`) that developers can cite in PRs
  and issues (`autoqa: ide.checkpoints.reset-code-button`),
* `requires` — prerequisite ids (or sets) that must be true before the steps
  make sense,
* `provides` — prerequisite bits that become true when the case passes
  (so a passing "send a task" case unlocks the history cases for free),
* `steps` — a list of `do:` / `expect:` / `capture:` items written for an agent,
* signals for planning: `priority`, `tags`, `touches` (source paths),
  `refs` (issues/PRs), `maturity`.

Cases are **generic across hosts** when possible: an IDE case with
`hosts: [vscode, jetbrains]` is the same case run twice. Platform- or
host-specific details go in `notes:` keyed by host/platform.

### Prerequisite
A prerequisite is a named bit of world state (`account.logged-in`,
`provider.working`, `ide.open`, `task.completed`). Each has

* `check` — how the agent (or a shell command) verifies it,
* `establish` — a micro-skill: how to make it true,
* `requires` — prerequisites of the prerequisite.

**Sets** (`std.ide`, `std.cli`, `std.desktop`) bundle the typical state so a
case can say `requires: [std.ide]` instead of listing six things.

### Run
A run is one agent session against one platform + host + build. The agent
does not hand-edit YAML; it calls `autoqa state set` and `autoqa record`, and
the tool keeps `state.yaml` / `results.yaml` consistent. Runs are committed so
the history is reviewable and `report` can build a case × platform matrix.


## The crawl (how a run works)

```
new-run ─▶ plan ─▶ (establish prereq | run case) ─▶ record ─▶ plan ─▶ … ─▶ retest failures in isolation ─▶ summary
```

1. `plan` reads the run's `state.yaml` and `results.yaml`, filters cases by
   platform/host, and returns
   * **ready** cases (all prereqs true, not yet attempted), scored, or
   * if nothing is ready, the **prerequisite to establish next** — the one
     that unblocks the most value — with its `establish` instructions.
2. The agent runs the top item, keeps screenshots that prove the `expect:`
   lines, and calls `record`.
3. `record` flips the case's `provides` bits on pass, and on fail queues the
   case for an **isolated retest** at the end of the run (fresh task/window,
   minimal shared state). A fail that passes in isolation is recorded as
   `flaky` with the suspected interfering case — that is real information
   about feature interdependence.
4. The run ends with `summary.md`: bugs to file (with case id, steps, evidence),
   fixes confirmed (case + PR/issue ref → let the triage agent close it), and
   blocked cases with the missing prerequisite.

Efficiency comes from *batching*, not from clean setups: the planner prefers
cases whose prerequisites are already true, and `provides` chains cases into
natural flows (send task → approve edit → view changes → reset code → history).

## Planning: what to test first

`plan` scores each ready case; the score is printed so humans can sanity-check
the ordering. Signals, in order of weight:

| signal | why |
|---|---|
| `refs` to an open issue/PR, or `--focus <id or tag>` | someone asked; confirming a fix closes work |
| previously **failed** in an earlier run | learning "it is fixed now" is the highest-value outcome |
| `touches` paths changed recently (`git log`) | recently changed code breaks first |
| tags mentioned in `.changeset/*.md` | shipped-this-release behaviour |
| `priority` P0…P3 | smoke tests before edge cases |
| short `estimated_minutes` | cheap cases first inside a tier |

Everything is a heuristic; the agent may reorder for batching reasons and must
say so in the journal.

## Trust

* `maturity: draft` cases were written from docs/source without a green run;
  `reviewed` means a human checked the steps; `trusted` means it has passed on
  at least two platforms. `report` shows maturity so a red `draft` case is read
  as "check the case" before "file a bug".
* Every failure record needs a screenshot or a pasted terminal excerpt.
* Never edit results after the fact; append a new record.

## Adding a case

1. Pick the feature file under `cases/<surface>/` (or create one).
2. Write the case so that "*title* is broken when …" is unambiguous.
3. `requires:` the smallest honest set; add `provides:` if it leaves useful state.
4. Fill `touches:` with the source files that implement the behaviour — this is
   what makes the recency signal work.
5. `bun scripts/autoqa.ts validate`.

## Relationship to other test layers (in cline/cline)

* `evals/` — model-quality evals and CLI smoke scenarios (headless, no UI).
* `apps/vscode/src/test/e2e` — Playwright e2e in a real VS Code with a mock API.
* **this repo** — cross-surface, real UI, real (proxied) providers, agent-run,
  aimed at finding and confirming product bugs on the surfaces users touch.

## Referencing a case from cline/cline

In a PR description or issue, write `autoqa: <case-id>` (e.g.
`autoqa: ide.checkpoints.reset-code-button`). The retest prompt
(`prompts/retest.md`) takes a list of case ids plus a build ref and produces a
run whose `summary.md` names the build, so a confirming comment can go straight
back to the PR.
