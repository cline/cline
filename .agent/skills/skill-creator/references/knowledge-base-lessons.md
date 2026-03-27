# Knowledge-Base Lessons for Skill Creation

These lessons are distilled from the project's meta-knowledge knowledge-base. Every new skill must be checked against these before finalization.

## Reporting Rule

For every `skill-creator` pass, produce two short lists before completion:

- **Applied lessons** — lessons that materially shaped the change
- **N/A lessons** — lessons reviewed but not relevant, each with a brief reason

Do not leave lesson application implicit.

## Layer1/Layer2 Architecture

- Layer1 (AIDLC Foundation) files must NEVER be modified by any skill
- All skill customizations are Layer2 — they extend, never replace
- New phases, stages, or loops are added through skills, not by editing AIDLC rules
- Supplemental aidlc-docs directories coexist with standard structure
- State extensions append without removing standard sections

Anti-patterns:

- Editing `.agent/.aidlc-rule-details/*` for project-specific guidance
- Modifying `AGENTS.md` core workflow stages
- Changing standard aidlc-docs directory structure
- Overwriting standard aidlc-state.md sections

## Skill Boundary Discipline

- Prefer **existing skill refinement** when the current boundary is still correct
- Prefer **new skill** when the change would create awkward logic inside an existing skill
- Prefer **helper promotion** when reusable project logic lives outside `.agent/skills/`
- State the chosen mode explicitly before editing

## Script Separation Convention

1. **Reusable scripts** → `.agent/skills/<skill-name>/scripts/`
2. **Temporary/project-specific scripts** → `scripts/` at project root
3. SKILL.md should document this convention
4. `skills.json` scripts array lists only reusable scripts

## Test Artifact Routing

All test-related artifacts follow a skill-scoped directory convention:

```text
aidlc-docs/test/
├── <skill-name>/
│   ├── (optional)<sprint-number>/
│   ├── coverage/
│   ├── reconnaissance/
│   └── results/
```

Scripts should default to `aidlc-docs/test/<own-skill-name>/` without requiring explicit output path arguments.

## Test-Production Separation

- Production code: `app/` directory only
- Test code: `tests/` directory only
- Build exclusion for test directories
- No demo buttons, mock APIs, or TEST-ONLY tags in production code

## Discovery Sprint Meta Handoff

When a skill generates reusable process lessons, the workflow should explicitly hand those lessons to meta-knowledge. Include a meta-handoff step in sprint review or completion gates.

## Shared Runtime Links

Every new skill must follow the shared runtime architecture:

1. Source at `.agent/skills/<name>/`
2. Registered in `.agent/skills/skills.json`
3. `.claude/skills` must remain a symlink to `../.agent/skills`
4. `.codex/skills` must remain a symlink to `../.agent/skills`
5. Verify the new skill is reachable through both runtime links

## Canonical `.agent` Topology

- Project-owned workflow assets live under `.agent/`
- `.claude/` and `.codex/` are thin runtime adapters, not source-of-truth directories
- Prefer semantic names that describe capability and ownership over framework or tool branding
- Avoid duplicate namespace segments and competing copies of the same project asset

## Shared Core Plus Stage Extensions

- Numbered stage workflows should reuse shared core tables for runs, artifacts, evidence, handoffs, and approvals
- Stage-specific business payload belongs in `seller_stgNN_*` extension docs or tables
- Update the shared stage catalog before inventing ad hoc per-stage identity fields
- Keep artifact-role contracts synchronized with the stage output contract
- PostgreSQL+pgvector stays a retrieval index and must reference Oracle truth instead of replacing it

## Progressive Disclosure

- SKILL.md under 500 lines
- Reference files for detailed guidance
- Large references include a table of contents
- Scripts execute without being loaded into context

## Writing Style

- Explain the "why" behind instructions
- Prefer imperative form
- Include examples for output formats
- Use theory of mind so the skill generalizes
- Reframe all-caps absolutes into reasoning when possible
