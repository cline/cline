---
name: skill-creator
description: Create new skills, modify and improve existing skills for this project. Use when users want to create a skill from scratch, edit or optimize an existing skill, or when meta-knowledge proposes a new skill. Ensures all created skills follow project runtime conventions, Layer1/Layer2 architecture, and accumulated knowledge-base lessons.
---

# Skill Creator (Project-Customized)

A project-customized skill for creating and improving skills within the a2c.life project ecosystem.

This skill wraps the standard skill creation workflow with project-specific runtime rules, accumulated meta-knowledge lessons, and Layer1/Layer2 architecture compliance.

It also enforces the repository topology contract: project-owned workflow assets belong under `.agent/`, while `.claude/` and `.codex/` stay thin runtime adapters rather than competing source locations.

## When To Use

- `meta-knowledge` proposes a new skill and the user approves
- User requests a new custom skill
- An existing skill needs structural improvement
- A helper skill needs promotion to a custom skill

## Start Here

Before creating or modifying any skill, load these references:

1. `references/meta-handoff-contract.md` — structured proposal intake for `meta-knowledge` handoffs
2. `references/project-deployment-rules.md` — runtime architecture and manifest registration
3. `references/knowledge-base-lessons.md` — accumulated lessons that apply to all new skills
4. `references/skill-anatomy.md` — structure, writing patterns, and progressive disclosure

## Operating Modes

Choose one mode before editing:

- **New skill** — create a brand-new custom skill in `.agent/skills/<name>/`
- **Existing skill refinement** — improve an existing project skill without changing its identity
- **Helper promotion** — convert an external/helper skill into a project-owned custom skill

Do not mix modes casually. If a request starts as refinement but actually needs a new skill boundary, say so and switch modes explicitly.

## Core Workflow

### 1. Intake The Request

Understand what job this pass is solving:

1. What capability gap or workflow friction triggered this request?
2. Is this a new skill, a refinement, or a helper promotion?
3. Which existing skills might overlap or conflict?
4. What artifacts will prove the work is complete?

If the request comes from `meta-knowledge`, require the structured handoff contract from `references/meta-handoff-contract.md`.

### 2. Determine The Mode

Route the work into one of these paths:

- **New skill**
  - A capability does not fit existing skills cleanly
  - The user approved creation of a new skill boundary
- **Existing skill refinement**
  - The current skill boundary is still correct
  - The work is about better prompts, references, scripts, templates, or gates
- **Helper promotion**
  - A helper/external skill has accumulated project-specific logic and should become local source of truth

### 3. Interview And Research

Ask about edge cases, input/output formats, success criteria, and dependencies. Check existing skills for overlap or integration points.

Before naming or placing anything new, answer these questions:

1. Does the proposed name describe the role and ownership of the asset?
2. Would the name still make sense if the current framework or tool changed?
3. Does the asset belong under the canonical `.agent/` namespace?
4. Is a topology refactor being requested explicitly, or should the current repo structure stay in place?
5. If this is a numbered stage skill, which shared data model docs already define its persistence boundary?

### 4. Write Or Refine The Skill

Mode-specific execution:

- **New skill**
  - Create `.agent/skills/<skill-name>/`
  - Prefer semantic names that describe the capability, not the current framework or IDE
  - Write `SKILL.md` and supporting directories
- **Existing skill refinement**
  - Preserve the current skill boundary
  - Preserve the current repository topology unless the user explicitly requested a topology refactor
  - Improve only the sections that address the proven friction
- **Helper promotion**
  - Preserve useful helper concepts
  - Re-home durable project logic into `.agent/skills/<skill-name>/`
  - Do not promote durable logic into `.claude/` or `.codex/`

When editing `SKILL.md`, fill in these components:

- **name**: Skill identifier (kebab-case)
- **description**: When to trigger, what it does. Be slightly "pushy" in the description to prevent under-triggering.
- **the rest of the skill body**

Follow the writing guide in `references/skill-anatomy.md`.

### 5. Apply Project Runtime Rules

After writing the skill:

1. Create or update the source at `.agent/skills/<skill-name>/`
2. Register or update `.agent/skills/skills.json`
3. Run the executable validation set from `references/project-deployment-rules.md`
4. Confirm the skill is reachable through both runtime links
5. Confirm no new source-of-truth files were introduced under `.claude/` or `.codex/`
6. If the skill is a numbered stage in a host-integrated workflow, update or confirm the shared data model docs, stage catalog, and artifact-role contract

### 6. Apply Knowledge-Base Lessons

Before finalizing, verify the skill respects all applicable lessons from the knowledge base. See `references/knowledge-base-lessons.md` for the full checklist.

Required reporting:

- List which lessons were **applied**
- List which lessons were **N/A**
- Briefly explain why each N/A lesson does not apply

Key checks:

- Layer1/Layer2 boundary respected
- Canonical `.agent/` namespace respected
- `.claude/.codex` remain runtime adapters only
- Naming is semantic and AI-readable rather than tool-branded
- Shared core plus stage extension rule respected for numbered stage skills
- Reusable vs temporary script separation
- Test artifacts routed to `aidlc-docs/test/<skill-name>/`
- No production code contamination patterns
- Z-index hierarchy documented if UI-related

### 7. Validate And Present

- Verify SKILL.md is under 500 lines
- Verify all referenced files exist
- Verify `.agent/skills/skills.json` entry is valid
- Verify `.claude/skills/<skill-name>/SKILL.md` resolves through the runtime link
- Verify `.codex/skills/<skill-name>/SKILL.md` resolves through the runtime link
- Present the mode used, validations run, and lessons applied/N/A

## Completion Gates

Do not finish skill creation until:

- [ ] Operating mode chosen explicitly (`new skill`, `existing skill refinement`, or `helper promotion`)
- [ ] If invoked from `meta-knowledge`, the structured handoff contract was captured
- [ ] SKILL.md written with YAML frontmatter (name, description)
- [ ] Skill directory structure follows anatomy rules
- [ ] Registered in `.agent/skills/skills.json`
- [ ] Executable validation set run successfully
- [ ] `.claude/skills` and `.codex/skills` runtime links verified
- [ ] Skill is reachable through both runtime links
- [ ] Naming and placement follow the canonical `.agent/` topology rules
- [ ] No tool-specific source directory was introduced
- [ ] For numbered stage skills, shared data model docs and stage catalog were updated or confirmed unchanged
- [ ] For numbered stage skills, artifact-role contract was aligned with the shared core plus stage extension model
- [ ] Knowledge-base lessons checked and applied
- [ ] Applied lessons / N-A lessons summary recorded
- [ ] Layer1/Layer2 boundary verified (skill is Layer2 only)

## Notes

- Prefer explaining the "why" over heavy-handed MUSTs
- Keep SKILL.md under 500 lines; use references/ for overflow
- When a skill supports multiple domains, organize by variant in references/
- Skills must not contain malware, exploit code, or misleading content
