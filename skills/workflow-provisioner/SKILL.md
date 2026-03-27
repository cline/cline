---
name: workflow-provisioner
description: Create and manage AI workflow projects as isolated git worktrees with project-scoped runtime setup. Use when starting a new workflow project that should run in its own worktree with dedicated CLAUDE.md, skills, and workflow definition files. Handles worktree creation, template scaffolding, .worktreeinclude file copying, canonical `.agent/` topology, and IDE workspace registration.
---

# Workflow Provisioner

## Overview

Use this skill to create a new AI workflow project as an isolated git worktree. Each workflow gets its own branch, directory, CLAUDE.md, and runtime configuration — ready to execute in a separate IDE session.

This skill implements the WorktreeProvisioner + TemplateBootstrapService pattern from the a2c.life architecture (FR-R12, FR-R13) as a developer tool.

Project-owned workflow assets follow one canonical namespace:

- `.agent/.aidlc-rule-details/` — vendored foundation rules
- `.agent/skills/` — only editable skill source
- `.agent/workflow-bundle/` — workflow metadata and bootstrap bundle
- `.claude/skills`, `.codex/skills` — runtime adapters only

For staged domain workflows such as numbered seller-stage pipelines, the shared data model docs under `aidlc-docs/construction/backend-foundation/functional-design/` are also project-owned source artifacts and should stay common rather than being forked into per-stage copies.

## Start Here

Load these references in order:

1. `references/worktree-lifecycle.md`
2. `references/scaffolding-template.md` (references baseline templates in `references/baseline/`)
3. `references/claude-runtime-setup.md`

**Baseline Templates**: The `references/baseline/` directory contains the 4-Layer AI Workflow Baseline templates. See `references/baseline/README.md` for the template architecture and variable reference.

## When To Use This Skill

Use this skill when:

- Starting a new workflow project that needs its own isolated workspace
- Creating a test workflow to validate on the a2c.life platform
- Setting up a Claude-powered workflow with CLAUDE.md-based execution
- Needing a repeatable process for workflow project creation

## Prerequisites

- Current directory must be a git repository (the base repo)
- Git must be installed and configured
- The base repo serves as the template source
- The base repo already contains the canonical `.agent/` workflow roots

## Execution Steps

### Step 1: Collect Workflow Information

Ask the user for (or derive from context):

1. **Workflow name** — short slug for branch/directory naming (e.g., `content-pipeline`)
2. **Workflow title** — human-readable name (e.g., "Content Production Pipeline Workflow")
3. **Workflow description** — one-paragraph summary of what the workflow does
4. **Workflow welcome intro** — a brief greeting paragraph for the welcome message
5. **Workflow purpose description** — detailed explanation of what the workflow achieves for the user
6. **Workflow stages** — ordered list of major steps/phases, each with:
   - **Stage name** — human-readable stage name
   - **Expert role** — the perspective the AI should adopt (e.g., "Market Analyst", "Pricing Consultant")
   - **Purpose** — why this stage exists
   - **Type** — `ALWAYS` (always executes) or `CONDITIONAL` (has conditions)
   - **Execute IF / Skip IF** — conditions for CONDITIONAL stages
   - **Depth** — `Minimal`, `Standard`, `Comprehensive`, or `Adaptive`
   - **Pattern** — `Simple` (direct execution) or `Plan-then-Execute` (plan first, approve, then execute)
   - **Inputs** — list of required prior artifacts (none for first stage)
   - **Outputs** — list of produced artifacts
   - **Completion criteria** — verifiable checkboxes for stage completion
   - **Approval gate** — `Yes` for stages with user-facing decisions, `No` otherwise

### Step 2: Pre-flight Checks

Before creating anything:

1. Verify branch `wf/<slug>` does not already exist
2. Verify target path does not already exist
3. Check if `.worktreeinclude` exists in base repo

If conflicts found, ask user how to resolve (see `references/worktree-lifecycle.md`).

### Step 3: Plan (Dry-run)

Generate and display a provisioning plan:

```
Workflow Provisioning Plan
==========================
Branch:    wf/<workflow-slug>
Path:      <base-repo-parent>/wt-<workflow-slug>

Baseline Templates (from references/baseline/):
  - CLAUDE.md.template    → CLAUDE.md (4-Layer runtime instructions)
  - workflow.md.template  → workflow.md (stage definitions with Role/Pattern/Depth)
  - workflow-state.md.template → workflow-state.md (progress tracker)
  - audit.md.template     → audit.md (execution log)
  - welcome-message.md.template → welcome-message.md (shown once at start)

Additional files:
  - .gitignore (git ignore rules)

Directories to create:
  - questions/ (Q&A harness files)
  - artifacts/ (stage output files)
  - extensions/ (optional domain-specific rules)

Local files to copy (from .worktreeinclude):
  - .env, .env.local, .env.* (if they exist)
  - .claude/settings.local.json (if exists)

Canonical workflow assets to preserve:
  - `.agent/.aidlc-rule-details/` (project-owned foundation rules)
  - `.agent/skills/` (only editable skill source)
  - `.agent/workflow-bundle/` (workflow metadata bundle)

Skills to expose through runtime links (worktree `.agent/skills/` → `.claude/skills`, `.codex/skills`):
  - aidlc-discovery-sprint/
  - meta-knowledge/
  - screen-interaction-design/
  - workflow-provisioner/

Stages: [list all stages with Role, Pattern, and Gate info]

4-Layer Coverage:
  ✓ Layer 1: Agent Harness (7 mechanisms)
  ✓ Layer 2: Knowledge Building (context-first, enrichment, Q&A, depth)
  ✓ Layer 3: Execution Quality (plan-then-execute, role, conditional, traceability)
  ✓ Layer 4: Governance (extensions, validation, emergent prevention, errors)
```

Wait for user approval before proceeding.

### Step 4: Create Worktree

Execute in order (see `references/worktree-lifecycle.md` for details):

1. `git worktree add <path> -b wf/<workflow-slug>`
2. Parse `.worktreeinclude` from base repo (if exists)
3. Copy matching local files to the new worktree
4. Initialize the workflow scaffold (Step 5)

### Step 5: Scaffold Workflow Files

Read `references/scaffolding-template.md` for scaffolding instructions. Use the **baseline templates** from `references/baseline/` as the foundation. Create these files in the worktree:

1. **CLAUDE.md** — from `references/baseline/CLAUDE.md.template`:
   - Complete 4-Layer pattern system (Agent Harness, Knowledge Building, Execution Quality, Governance)
   - Replace `{{WORKFLOW_NAME}}` and `{{WORKFLOW_DESCRIPTION}}`

2. **workflow.md** — from `references/baseline/workflow.md.template`:
   - Stage definitions with Role, Purpose, Type, Depth, Pattern, Inputs, Outputs, Completion Criteria, Approval Gate
   - Generate one stage block per user-provided stage
   - Replace all `{{STAGE_*}}` variables

3. **workflow-state.md** — from `references/baseline/workflow-state.md.template`:
   - Replace `{{STAGE_CHECKBOXES}}` with generated checkbox list

4. **audit.md** — from `references/baseline/audit.md.template`:
   - Replace metadata variables (timestamp, path, branch)

5. **welcome-message.md** — from `references/baseline/welcome-message.md.template`:
   - Replace `{{WORKFLOW_WELCOME_INTRO}}`, `{{WORKFLOW_PURPOSE_DESCRIPTION}}`, `{{STAGE_VISUAL_DIAGRAM}}`

6. **.gitignore** — Git ignore rules for env files (see scaffolding-template.md)

7. **Directories**: `questions/`, `artifacts/`, `extensions/`

8. **Skills** — Keep `.agent/skills/` as the only editable skill source in the worktree, then expose it through `.claude/skills` and `.codex/skills` runtime links:

   **Source of truth**: `.agent/skills/skills.json` in the base repo defines the available skill bundle.

   **Skill selection policy** (`worktreeSkillPolicy` in skills.json):
   - **`universal`**: Always deployed to every worktree (e.g., `meta-knowledge`, `workflow-provisioner`)
   - **`optional`**: Presented to the user during provisioning for selection

   **Provisioning procedure**:
   1. Read `.agent/skills/skills.json` from the base repo
   2. Parse `worktreeSkillPolicy.universal` → auto-include these skills
   3. Parse `worktreeSkillPolicy.optional` → present to user for selection:
      ```
      Optional skills available for this worktree:
      - aidlc-discovery-sprint — Discovery sprints with UI wireframes
      - webapp-testing — Screen-design based test generation
      - frontend-design — Production-grade HTML prototypes
      - screen-interaction-design — Screen specs and interaction flows

      Which optional skills do you want to include? (or "none")
      ```
   4. Copy `<base-repo>/.agent/skills/` to `<worktree>/.agent/skills/`
   5. Create runtime links:
      - `<worktree>/.claude/skills -> ../.agent/skills`
      - `<worktree>/.codex/skills -> ../.agent/skills`
   6. Verify the selected skills are reachable through both runtime links
   7. Verify `<worktree>/.claude/skills` and `<worktree>/.codex/skills` both resolve to `<worktree>/.agent/skills`
   8. Do not create copied per-IDE skill trees under `.claude/skills/<name>` or `.codex/skills/<name>`

   **Why shared runtime links**: `.agent/skills/` remains the only editable skill source, while Claude Code and Codex read the same bundle without copy drift or competing tool-specific sources of truth.

### Step 6: Register in IDE Workspace

Inform the user how to add the new worktree to their IDE:

- **VS Code**: `File > Add Folder to Workspace...` -> select `<path>`
- **Cursor/Claude Code**: The worktree is accessible at the displayed path

### Step 7: Verify (4-Layer Coverage Check)

Run verification checks:

1. **File existence**: Confirm all scaffold files exist:
   - CLAUDE.md, workflow.md, workflow-state.md, audit.md, welcome-message.md, .gitignore
2. **Directory existence**: Confirm directories exist:
   - questions/, artifacts/, extensions/, `.agent/.aidlc-rule-details/`, `.agent/skills/`, `.agent/workflow-bundle/`, `.claude/`, `.codex/`
3. **Skills**: Confirm all skills are reachable through both runtime links:
   - .claude/skills/aidlc-discovery-sprint/, .claude/skills/meta-knowledge/, .claude/skills/screen-interaction-design/, .claude/skills/workflow-provisioner/
   - .codex/skills/aidlc-discovery-sprint/, .codex/skills/meta-knowledge/, .codex/skills/screen-interaction-design/, .codex/skills/workflow-provisioner/
   - Verify `.claude/skills` and `.codex/skills` are symlinks to `.agent/skills`
   - Verify no copied per-IDE skill trees were introduced under `.claude/` or `.codex/`
   - Verify `.agent/.aidlc-rule-details/`, `.agent/skills/`, and `.agent/workflow-bundle/` remain the only project-owned workflow roots
   - If the workflow includes numbered stage skills, verify shared data model docs remain in the common backend-foundation area instead of duplicated per stage
4. **Worktree registration**: Confirm worktree is listed in `git worktree list`
5. **Local files**: Confirm files from `.worktreeinclude` were copied (if applicable)
6. **4-Layer Pattern Verification**:
   - [ ] **Layer 1 — Agent Harness**: CLAUDE.md contains all 7 mechanisms (Session Protocol, Stage Loop, Approval Gates, Q&A Harness, Audit Trail, Artifact Management, State Tracking)
   - [ ] **Layer 2 — Knowledge Building**: CLAUDE.md contains Context-First, Progressive Enrichment, Q&A + Contradiction Detection, Adaptive Depth
   - [ ] **Layer 3 — Execution Quality**: workflow.md stages include Role, Pattern, Conditional fields; CLAUDE.md contains Plan-then-Execute, Role Assumption, Traceability
   - [ ] **Layer 4 — Governance**: CLAUDE.md contains Extension System, Content Validation, Emergent Behavior Prevention, Error Handling
7. **Display summary** with next steps

## Worktree Lifecycle

The provisioner manages the following lifecycle states:

| State | Description | Action |
|-------|-------------|--------|
| create | New worktree + scaffold | `git worktree add` |
| activate | Claude session starts in worktree | User opens in IDE |
| suspend | Session ends, worktree preserved | User closes IDE |
| resume | Reopen existing worktree | User reopens in IDE |
| archive | Mark as read-only, preserve artifacts | Manual or automation |
| prune | Remove worktree and branch | `git worktree remove` |

## Naming Convention

- **Branch**: `wf/<workflow-slug>`
- **Path**: `<base-repo-parent>/wt-<workflow-slug>`
- **Example**: Branch `wf/content-pipeline`, Path `../wt-content-pipeline`

## Constraints

- Worktree isolation is code-level only (not security boundary)
- Claude account quota is shared across worktrees
- Global Claude settings (~/.claude/) are shared
- Global or home-directory rules/skills are not the active project source of truth
- Each worktree should run in its own Claude session (no multi-workflow mixing)
