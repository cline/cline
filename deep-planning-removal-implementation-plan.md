# Remove `/deep-planning` Default Slash Command — Implementation Plan

## Document purpose

This document is a standalone handoff artifact for the development team. Its purpose is to explain:

- what the `/deep-planning` default slash command is today,
- why removing it is architecturally reasonable,
- what the end state should look like after removal,
- exactly which files and systems need to change,
- how to verify that the removal is complete and safe,
- and what risks or edge cases should be watched during implementation.

This document is intentionally verbose. It is written so that a developer who has **not** read the planning conversation can still understand the intent, context, and step-by-step work required.

---

## Executive summary

### High-level goal

Remove `/deep-planning` as a **built-in default slash command** from the Cline codebase, while preserving the rest of the planning-oriented product experience through existing mechanisms such as Plan mode, normal tool use, and custom workflows.

### What this means in plain language

Today, `/deep-planning` appears to users as a special built-in command. In practice, it is **not** a separate engine or subsystem. It is mainly a piece of prompt orchestration: when the user types `/deep-planning`, Cline rewrites the incoming user message by prepending a large set of model-specific planning instructions. The normal task loop, normal tools, and normal `new_task` behavior do the rest.

Because of that, removing `/deep-planning` is mostly a matter of removing:

1. the command from slash-command listings and autocomplete,
2. the parser logic that recognizes it as a built-in command,
3. the prompt-generation code specific to deep planning,
4. associated tests,
5. and public/internal documentation that teaches users to rely on it.

### Architectural vision

The desired direction is that Cline should not carry a dedicated built-in “deep planning” command when the same broader product goal can be achieved through more general and composable primitives:

- **Plan mode** for exploration and discussion,
- **Act mode** for implementation,
- **standard tools** for investigation and execution,
- **custom workflows** if teams want reusable planning rituals,
- and **documentation** that teaches these general patterns instead of funneling users into a dedicated default slash command.

This makes the product surface simpler, reduces maintenance burden, and removes a feature whose behavior is largely implemented by prompt text rather than differentiated platform logic.

---

## Progress checklist

- [x] Confirm final product decision: hard removal vs temporary compatibility/deprecation message
- [x] Remove `/deep-planning` from built-in slash command metadata
- [x] Remove `/deep-planning` from built-in slash command parsing
- [x] Remove deep-planning prompt generation entry points
- [x] Delete the dedicated `src/core/prompts/commands/deep-planning/` implementation tree
- [x] Update command discovery and parser tests
- [x] Update CLI-visible command behavior expectations if needed
- [x] Remove or rewrite public docs that reference `/deep-planning`
- [x] Remove docs navigation and redirects for the deep-planning feature page
- [x] Update changelog or release notes only if the team wants the removal called out publicly
- [x] Run code verification, test verification, and docs link verification
- [x] Perform a final search to confirm no stale references remain in maintained source/docs

---

## Current architecture

## 1) Where `/deep-planning` enters the system

The built-in slash-command list lives in:

- `src/shared/slashCommands.ts`

This file defines the default commands that appear in slash-command discovery/autocomplete. `/deep-planning` is currently represented as a normal built-in command alongside commands like `/newtask`, `/smol`, `/newrule`, and `/reportbug`.

### Why this matters

If the command remains in this list, users will still see it in autocomplete and command discovery even if other code is removed. So removal must start here.

---

## 2) How the command is recognized at runtime

The built-in slash command parser lives in:

- `src/core/slash-commands/index.ts`

Important responsibilities in this file:

- defines `SUPPORTED_DEFAULT_COMMANDS`,
- detects slash commands inside tagged user content,
- gives built-in commands precedence over custom workflows with the same name,
- and rewrites user input by injecting command-specific prompt instructions.

For `/deep-planning`, the parser currently maps the command to:

- `deepPlanningToolResponse(...)`

That function returns prompt text which is prepended to the user’s message.

### Why this matters

This is the most important architectural fact about the feature:

> `/deep-planning` is primarily a **prompt injection pathway**, not a dedicated execution engine.

Removing the command from this parser is the step that truly turns off the built-in feature.

---

## 3) How the deep-planning prompt is built

The prompt entry point lives in:

- `src/core/prompts/commands.ts`

This file exports helper functions for built-in slash commands. For deep planning, it delegates to:

- `src/core/prompts/commands/deep-planning/index.ts`

That module then uses:

- `src/core/prompts/commands/deep-planning/registry.ts`
- `src/core/prompts/commands/deep-planning/types.ts`
- `src/core/prompts/commands/deep-planning/variants/*`

The registry selects a model-family-specific prompt variant (for example Anthropic, Gemini, GPT-5.1, generic fallback, etc.).

### Why this matters

This whole subtree exists to produce one thing: the planning instructions injected when the user types `/deep-planning`.

If the command is being removed entirely, this entire subtree should be considered a candidate for deletion unless the team explicitly wants to preserve it for future reuse.

The default recommendation in this plan is:

> **Delete it entirely**, because carrying dormant prompt infrastructure invites confusion and long-term maintenance drag.

---

## 4) How the task loop sees slash commands

Slash command parsing is invoked from the normal task pipeline in:

- `src/core/task/index.ts`

The task system calls `parseSlashCommands(...)` after mention parsing. There is no deep-planning-specific task engine or alternate task lifecycle. The normal task system continues running after the prompt rewrite.

### Why this matters

This confirms that removing `/deep-planning` does **not** require redesigning the task engine.

The task engine does not need a specialized cleanup pass. It only needs the built-in command to stop being recognized.

---

## 5) How the command appears in command discovery and the CLI

Available slash commands are served by:

- `src/core/controller/slash/getAvailableSlashCommands.ts`

That endpoint draws from:

- `src/shared/slashCommands.ts`

The CLI surfaces slash commands via its own command handling and filtering, but the built-in/shared command list still affects what the CLI receives and displays.

Relevant CLI files include:

- `cli/src/agent/ClineAgent.ts`
- `cli/src/utils/slash-commands.ts`

### Why this matters

Even though there is no deep-planning-specific CLI runtime logic, the command may still show up in CLI slash menus because it comes from shared slash-command metadata. Removing it from shared metadata should remove it from both VS Code and CLI slash discovery surfaces.

---

## 6) What `implementation_plan.md` actually is

The deep-planning prompt templates instruct the model to create an `implementation_plan.md` file. However, there is **no dedicated platform feature** that creates this file automatically outside the model’s ordinary tool use.

In other words:

- there is no special “implementation plan document service,”
- there is no runtime subsystem that depends on `implementation_plan.md`,
- and removing `/deep-planning` does not require removing any file-management engine tied to that document.

### Why this matters

This reduces risk significantly. The `implementation_plan.md` behavior is prompt-driven, not platform-driven.

---

## Desired final state

After this work is complete, the product should behave as follows:

1. `/deep-planning` is no longer advertised as a built-in slash command.
2. Typing `/deep-planning` does not invoke any built-in special behavior.
3. The deep-planning prompt-generation code no longer exists in maintained source.
4. Public docs no longer tell users to rely on `/deep-planning`.
5. Planning guidance instead points users toward more general patterns such as Plan mode and reusable workflows.
6. Tests and command listings reflect the smaller built-in command surface.

### Important product decision to finalize before coding

The team should decide between these two behaviors for a short transition period:

#### Option A — hard removal (recommended for a clean end state)

- `/deep-planning` simply stops being a built-in command.
- If a user types it, it is treated like ordinary text unless some custom workflow or MCP prompt happens to match.

**Pros:**

- simplest implementation,
- least code,
- cleanest long-term architecture.

**Cons:**

- users familiar with the command may be confused if it silently stops working.

#### Option B — temporary compatibility/deprecation shim (optional transition strategy)

- Keep a very small parser branch temporarily.
- Detect `/deep-planning` and replace it with a brief deprecation/redirect message telling users to use Plan mode or a workflow instead.
- Remove the shim in a later release.

**Pros:**

- smoother user transition,
- more explicit behavior.

**Cons:**

- adds temporary code that must later be removed,
- delays the “fully gone” state.

### Recommendation

If the product vision is truly “remove the default slash command entirely,” then the **final** state should be Option A. If needed, Option B can be used only as a short-lived migration phase, not the target architecture.

---

## Non-goals

To keep scope controlled, this project should **not** attempt to do the following unless separately approved:

- redesign Plan mode,
- redesign custom workflows,
- redesign Focus Chain or Memory Bank,
- replace deep planning with a new built-in command,
- create a new planning document system,
- or broadly rewrite slash-command infrastructure unrelated to this removal.

This work is about **removal and cleanup**, not inventing a new planning feature.

---

## Implementation workstreams

## Workstream 1 — Remove built-in command metadata

### Files

- `src/shared/slashCommands.ts`

### Required changes

- Remove the `deep-planning` object from `BASE_SLASH_COMMANDS`.

### Why this matters

This is the canonical source for built-in slash command discovery. Removing the entry ensures the command disappears from:

- command lists,
- autocomplete menus,
- any server responses built from the base slash command list,
- and shared assumptions about the set of default commands.

### Developer checklist

- [x] Remove the `deep-planning` object from `BASE_SLASH_COMMANDS`
- [x] Confirm neighboring command definitions remain valid and formatting/linting stays clean

---

## Workstream 2 — Remove parser support for the built-in command

### Files

- `src/core/slash-commands/index.ts`

### Required changes

- Remove `"deep-planning"` from `SUPPORTED_DEFAULT_COMMANDS`
- Remove the `"deep-planning": deepPlanningToolResponse(...)` entry from `commandReplacements`
- Remove the import of `deepPlanningToolResponse`

### Why this matters

This is the code that currently interprets `/deep-planning` as a built-in command and injects special instructions. Once this code is removed, the built-in runtime behavior is gone.

### Behavioral implication to understand clearly

After this parser change, `/deep-planning` will no longer be privileged over custom workflows.

That means:

- if no workflow or MCP prompt matches that name, it becomes ordinary text,
- if a team creates a custom workflow named `deep-planning`, that workflow could now claim the command name.

This is not necessarily bad, but the team should be aware of it.

### Developer checklist

- [x] Remove the deep-planning import
- [x] Remove deep-planning from `SUPPORTED_DEFAULT_COMMANDS`
- [x] Remove deep-planning from `commandReplacements`
- [x] Re-read the parser flow and verify no dead imports or unused parameters remain

---

## Workstream 3 — Remove prompt entry points and delete the deep-planning prompt tree

### Files

- `src/core/prompts/commands.ts`
- `src/core/prompts/commands/deep-planning/index.ts`
- `src/core/prompts/commands/deep-planning/registry.ts`
- `src/core/prompts/commands/deep-planning/types.ts`
- `src/core/prompts/commands/deep-planning/variants/index.ts`
- `src/core/prompts/commands/deep-planning/variants/anthropic.ts`
- `src/core/prompts/commands/deep-planning/variants/gemini.ts`
- `src/core/prompts/commands/deep-planning/variants/gemini3.ts`
- `src/core/prompts/commands/deep-planning/variants/generic.ts`
- `src/core/prompts/commands/deep-planning/variants/gpt51.ts`

### Required changes

In `src/core/prompts/commands.ts`:

- remove the import of `getDeepPlanningPrompt`
- remove the exported `deepPlanningToolResponse` helper

Then delete the entire `src/core/prompts/commands/deep-planning/` directory.

### Why this matters

Once the parser no longer calls deep-planning prompt generation, this code becomes dead. Keeping it around would:

- imply the feature still exists,
- invite future confusion,
- and increase maintenance cost for no user-facing value.

### Important note for reviewers

Deleting this directory is **not** removing a platform subsystem. It is removing a set of prompt templates and the registry logic used to choose among them.

### Developer checklist

- [x] Remove `getDeepPlanningPrompt` import from `src/core/prompts/commands.ts`
- [x] Remove `deepPlanningToolResponse` from `src/core/prompts/commands.ts`
- [x] Delete the full `src/core/prompts/commands/deep-planning/` subtree
- [x] Run typecheck to catch any stale imports or exports

---

## Workstream 4 — Update command discovery tests and related unit tests

### Files already known to be relevant

- `src/test/slash-commands.test.ts`
- `src/core/slash-commands/__tests__/index.test.ts`

### Required changes

#### In `src/test/slash-commands.test.ts`

This file validates the RPC endpoint that returns available slash commands. It relies on `BASE_SLASH_COMMANDS`, so removing the command from the shared list will change expected command counts and the set of built-ins present.

Likely work:

- update snapshots/expectations if any exist,
- ensure tests still pass with one fewer base command,
- consider adding an explicit assertion that `deep-planning` is absent, similar to the existing “deprecated subagent” absence check.

#### In `src/core/slash-commands/__tests__/index.test.ts`

This file currently focuses on MCP parsing. It may not require direct edits unless shared helpers or imports change. However, this is a good place to add a focused parser test if the team wants to lock in the new behavior.

Possible new test ideas:

- `/deep-planning` is **not** treated as a built-in command anymore
- if present as plain user text, it does not trigger built-in command replacement

### Why this matters

When removing a built-in command, tests should protect against future accidental reintroduction.

### Developer checklist

- [x] Update command-discovery tests to reflect the smaller built-in command list
- [x] Add an explicit “deep-planning is absent” assertion if helpful
- [x] Add parser-level regression coverage if the team wants the behavior documented in tests

---

## Workstream 5 — Review CLI implications

### Files

- `cli/src/agent/ClineAgent.ts`
- `cli/src/utils/slash-commands.ts`

### Expected code changes

Possibly none, or only indirect changes.

### Why this workstream exists

The CLI is probably affected only through shared command metadata and slash-command discovery. However, the team should still verify that:

- the CLI slash menu no longer shows `/deep-planning`,
- filtering and insertion still work normally,
- and no CLI tests implicitly assume the older command set.

### Developer checklist

- [x] Confirm CLI command lists no longer surface `/deep-planning`
- [x] Confirm there is no CLI-only special handling to remove
- [x] Run CLI tests if the command list affects any user-facing snapshots or assumptions

---

## Workstream 6 — Remove or rewrite public documentation

### Documentation files known to reference `/deep-planning`

- `docs/features/deep-planning.mdx`
- `docs/core-workflows/using-commands.mdx`
- `docs/core-workflows/plan-and-act.mdx`
- `docs/features/focus-chain.mdx`
- `docs/features/memory-bank.mdx`
- `docs/contributing/documentation-guide.mdx`
- `docs/docs.json`

There may also be changelog references and other historical mentions outside the docs site.

### Required documentation strategy

The docs should not merely delete references without replacement. They should explain the new intended user path.

### Recommended doc replacement themes

Replace `/deep-planning` guidance with language such as:

- use **Plan mode** when you want structured investigation before implementation,
- use **custom workflows** if your team wants a reusable planning ritual,
- use **Focus Chain** with normal planning/execution flow instead of tying it to a removed built-in command,
- use **Memory Bank** to improve context quality for large tasks,
- and for large tasks, create a planning artifact manually or through a workflow rather than relying on a dedicated built-in slash command.

### File-by-file guidance

#### `docs/features/deep-planning.mdx`

Recommended action: **delete this page entirely** unless the team wants to preserve a historical migration note.

If deleted:

- also remove it from docs navigation,
- and remove any redirects that map to it.

#### `docs/core-workflows/using-commands.mdx`

- remove the `/deep-planning` row from the command table
- remove the dedicated `/deep-planning` section
- revise surrounding narrative so the command list remains coherent

#### `docs/core-workflows/plan-and-act.mdx`

- remove or rewrite the “Using `/deep-planning`” section
- replace it with guidance on when to use Plan mode, and possibly when to create a planning document manually or through a workflow

#### `docs/features/focus-chain.mdx`

- remove phrasing that positions Focus Chain as something that “pairs with Deep Planning” specifically
- reframe it as a general progress-tracking mechanism for any complex implementation

#### `docs/features/memory-bank.mdx`

- remove direct references to `/deep-planning`
- reframe Memory Bank as improving planning quality in general

#### `docs/contributing/documentation-guide.mdx`

- remove example prose that uses `/deep-planning` as the canonical feature example
- replace with Plan mode, workflows, or a neutral multi-file planning example

#### `docs/docs.json`

- remove `features/deep-planning` from docs navigation
- remove redirects related to the deep-planning docs path

### Why this matters

If docs are not updated thoroughly, users will continue trying to use the removed command and perceive the product as broken.

### Developer checklist

- [x] Delete or intentionally replace `docs/features/deep-planning.mdx`
- [x] Remove the page from `docs/docs.json` navigation
- [x] Remove relevant redirects in `docs/docs.json`
- [x] Update references in `using-commands`, `plan-and-act`, `focus-chain`, `memory-bank`, and contributing docs
- [x] Run link checking after docs changes

---

## Workstream 7 — Decide how to handle historical references

### Likely files

- `CHANGELOG.md`
- possibly old docs or migration notes

### Recommendation

Historical changelog entries generally should **not** be rewritten unless the team has a strong policy for retroactive changelog cleanup.

The safest default is:

- keep historical changelog references as historical facts,
- but add a new changelog/release note entry announcing the removal if the team wants it visible to users.

### Why this matters

Not every mention of deep planning must be erased. The key distinction is:

- **maintained product behavior and docs** should reflect current reality,
- **historical records** may remain historical.

### Developer checklist

- [x] Decide whether to add a new changelog entry for the removal
- [x] Leave historical changelog references alone unless product policy says otherwise

---

## Detailed step-by-step implementation sequence

This section gives the practical order in which a developer should make the changes.

### Phase 1 — Prepare and verify current state

- [x] Create a branch for the removal work
- [x] Run a repository-wide search for `deep-planning` and `/deep-planning` to establish the current footprint
- [x] Confirm whether the team wants hard removal or a temporary deprecation shim

Suggested discovery commands:

```bash
rg -n "deep-planning|/deep-planning|implementation_plan\.md" /Users/evekillaby/dev/github.com/cline/cline
```

### Phase 2 — Remove the built-in command from source

- [x] Edit `src/shared/slashCommands.ts`
- [x] Edit `src/core/slash-commands/index.ts`
- [x] Edit `src/core/prompts/commands.ts`
- [x] Delete `src/core/prompts/commands/deep-planning/`

### Phase 3 — Update tests

- [x] Update `src/test/slash-commands.test.ts`
- [x] Add or update parser regression tests if needed
- [x] Review CLI tests for any command-count assumptions

### Phase 4 — Update docs and navigation

- [x] Remove or rewrite `docs/features/deep-planning.mdx`
- [x] Update `docs/core-workflows/using-commands.mdx`
- [x] Update `docs/core-workflows/plan-and-act.mdx`
- [x] Update `docs/features/focus-chain.mdx`
- [x] Update `docs/features/memory-bank.mdx`
- [x] Update `docs/contributing/documentation-guide.mdx`
- [x] Update `docs/docs.json`

### Phase 5 — Verify and clean up

- [x] Run typechecking
- [x] Run relevant unit tests
- [x] Run CLI tests if command-list behavior might be affected
- [x] Run docs link checking
- [x] Run a final repository-wide search for stale references

---

## Verification plan

The verification plan should be layered. Developers should not stop after one passing command.

## A) Code health verification

Run full typechecking:

```bash
npm run check-types
```

Why:

- catches dead imports/exports,
- catches deleted-module references,
- validates root, webview, and CLI TypeScript surfaces.

---

## B) Root unit/integration safety checks

At minimum, run unit tests:

```bash
npm run test:unit
```

If time and CI expectations permit, run the broader test suite appropriate to the branch policy.

---

## C) CLI verification

Run CLI tests:

```bash
npm run cli:test
```

Also build the CLI if command-discovery behavior is considered important to the release:

```bash
npm run cli:build
```

Why:

- validates shared command metadata does not break CLI consumers,
- confirms packaging/type generation remains healthy.

---

## D) Docs verification

Run docs link checking:

```bash
npm run docs:check-links
```

Why:

- removing the page and redirects can easily create broken links,
- docs references to `/features/deep-planning` or command anchors must be cleaned up properly.

---

## E) Build verification

Run a normal production-style package build if the branch is nearing merge readiness:

```bash
npm run package
```

Why:

- validates extension packaging pipeline after code and docs cleanup,
- catches lingering integration issues not seen in isolated tests.

---

## F) Final reference sweep

Run a final search after edits:

```bash
rg -n "deep-planning|/deep-planning|implementation_plan\.md" /Users/evekillaby/dev/github.com/cline/cline
```

Interpretation guidance:

- maintained source/docs references should be gone unless intentionally preserved,
- historical changelog references may remain if the team chose to keep them,
- generated or compiled artifacts should not be edited directly.

---

## Potential risks and how to mitigate them

## Risk 1 — Silent user confusion

### Description

Users who previously relied on `/deep-planning` may try to use it after removal and not understand why it no longer behaves specially.

### Mitigation

- update docs thoroughly,
- add a release note if appropriate,
- optionally use a short-lived deprecation shim before hard removal.

---

## Risk 2 — Broken docs navigation or redirects

### Description

Deleting the docs page without cleaning navigation and redirects can leave broken links and Mintlify issues.

### Mitigation

- update `docs/docs.json` carefully,
- run `npm run docs:check-links`.

---

## Risk 3 — Dead imports or orphaned prompt code

### Description

Because the feature spans shared metadata, parser wiring, and prompt generation, it is easy to remove one layer but leave stale imports in another.

### Mitigation

- remove from the top down,
- run typecheck early,
- do a final `rg` search.

---

## Risk 4 — Accidental behavior change for custom workflows

### Description

Once `/deep-planning` is no longer reserved as a built-in command, custom workflows with that file name could take over the command name.

### Mitigation

- treat this as an intentional consequence of removing built-in precedence,
- document it for reviewers,
- decide whether this is acceptable before merge.

---

## Risk 5 — Over-expanding scope

### Description

The team might be tempted to simultaneously redesign planning UX, command UX, docs IA, and workflow authoring patterns.

### Mitigation

- keep this project focused on removal,
- capture larger UX improvements as follow-up tickets instead of bundling them here.

---

## Recommended review checklist for code reviewers

- [ ] `/deep-planning` no longer appears in built-in slash-command metadata
- [ ] parser no longer treats `/deep-planning` as a built-in command
- [ ] deep-planning prompt-generation code has been fully removed
- [ ] no maintained source files still import deep-planning prompt code
- [ ] command discovery tests reflect the new built-in command set
- [ ] docs no longer instruct users to use `/deep-planning`
- [ ] docs navigation and redirects are clean
- [ ] typecheck, tests, and docs link checks passed

Status after implementation:

- [x] `/deep-planning` no longer appears in built-in slash-command metadata
- [x] parser no longer treats `/deep-planning` as a built-in command
- [x] deep-planning prompt-generation code has been fully removed
- [x] no maintained source files still import deep-planning prompt code
- [x] command discovery tests reflect the new built-in command set
- [x] docs no longer instruct users to use `/deep-planning`
- [x] docs navigation and redirects are clean
- [x] typecheck, tests, and docs link checks passed

---

## Recommended commit strategy

To make review easier, consider splitting the implementation into logical commits:

### Commit 1 — Core code removal

- remove built-in metadata,
- remove parser wiring,
- remove prompt entry points,
- delete deep-planning prompt tree.

### Commit 2 — Tests

- update slash-command and parser tests.

### Commit 3 — Docs

- remove docs page,
- update navigation,
- rewrite related workflow/feature docs.

This is not required, but it makes review and rollback easier.

---

## Suggested implementation notes for a layperson stakeholder

If you are not deep in the codebase, the simplest way to understand this project is:

1. `/deep-planning` looks like a special product feature.
2. Under the hood, it is mostly a special prompt template attached to a normal slash-command system.
3. That means the codebase is not losing a giant subsystem.
4. Instead, we are removing a built-in shortcut and cleaning up the prompt code and docs that supported it.
5. The broader planning experience can still exist through more general mechanisms, which is why this removal is architecturally safe.

---

## Completion criteria

This project should be considered complete only when all of the following are true:

- [x] `/deep-planning` is gone from `BASE_SLASH_COMMANDS`
- [x] `/deep-planning` is gone from built-in slash parsing
- [x] deep-planning prompt code has been deleted from `src/core/prompts/commands/deep-planning/`
- [x] no maintained code imports or references the deleted modules
- [x] relevant tests pass
- [x] docs no longer present `/deep-planning` as a current feature
- [x] docs navigation and links are valid
- [x] final repository search shows no unexpected maintained references

---

## Optional follow-up work (not part of this removal unless separately approved)

- [ ] Create a reusable “planning workflow” example for teams that still want a structured planning ritual
- [ ] Add docs teaching how to create a custom workflow that generates a planning artifact
- [ ] Improve Plan mode docs so large-task guidance is stronger without relying on a dedicated slash command
- [ ] Add a brief migration note for users who previously depended on `/deep-planning`

These are good follow-ups, but they should not block the command-removal project unless product leadership wants a bundled migration story.
