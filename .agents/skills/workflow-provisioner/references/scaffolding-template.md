# Scaffolding Template Reference

## File Structure

A newly provisioned workflow worktree contains:

```
wt-<workflow-slug>/
+-- CLAUDE.md              # 4-Layer runtime instructions (from baseline)
+-- workflow.md             # Stage definitions with Role/Pattern/Depth (from baseline)
+-- workflow-state.md       # Progress tracker (from baseline)
+-- audit.md                # Execution log (from baseline)
+-- welcome-message.md      # Welcome message shown once at start (from baseline)
+-- .agents/
|   +-- .aidlc-rule-details/  # Project-owned vendored foundation rules
|   +-- skills/               # Only editable skill source
|   +-- workflow-bundle/      # Project-owned workflow metadata
+-- .claude/
|   +-- skills -> ../.agents/skills
+-- .codex/
|   +-- skills -> ../.agents/skills
+-- questions/              # Q&A harness directory
+-- artifacts/              # Stage outputs directory
+-- extensions/             # Optional domain-specific rules
+-- .gitignore              # Git ignore rules
```

Plus any files copied from base repo per `.worktreeinclude` rules.

The `.agents/` tree is the canonical project-owned workflow namespace. `.claude/` and `.codex/` only expose runtime adapters and must not hold copied skill sources.

## How To Use These Templates

The baseline templates are located at `references/baseline/`. When scaffolding:

1. Read each baseline template file (`.template` suffix)
2. Replace all `{{VARIABLE}}` placeholders using the substitution tables below
3. For stage lists: generate one block per stage from the user-provided stage list
4. Write the result as the target file in the worktree

Do NOT copy the templates literally with placeholders intact.

See `references/baseline/README.md` for the 4-Layer architecture overview and complete variable reference.

---

## Template Source Files

| Baseline Template | Target File | Description |
|-------------------|-------------|-------------|
| `baseline/CLAUDE.md.template` | `CLAUDE.md` | 4-Layer runtime instructions (Agent Harness, Knowledge Building, Execution Quality, Governance) |
| `baseline/workflow.md.template` | `workflow.md` | Stage definitions with Role, Pattern, Depth, Inputs/Outputs, Gate |
| `baseline/workflow-state.md.template` | `workflow-state.md` | Progress tracking with checkboxes and timestamps |
| `baseline/audit.md.template` | `audit.md` | Audit log initialization |
| `baseline/welcome-message.md.template` | `welcome-message.md` | User-facing welcome message |

---

## Variable Substitution

### Global Variables

| Variable | Source |
|----------|--------|
| `{{WORKFLOW_NAME}}` | User-provided workflow title (human-readable) |
| `{{WORKFLOW_DESCRIPTION}}` | User-provided one-paragraph description |
| `{{WORKFLOW_WELCOME_INTRO}}` | User-provided greeting paragraph for welcome message |
| `{{WORKFLOW_PURPOSE_DESCRIPTION}}` | User-provided detailed purpose explanation |
| `{{ISO_TIMESTAMP}}` | Current timestamp in ISO 8601 (e.g., `2026-03-15T21:30:00+09:00`) |
| `{{WORKTREE_PATH}}` | Absolute path of the new worktree |
| `{{BRANCH_NAME}}` | Git branch name (e.g., `wf/content-pipeline`) |

### Aggregate Variables (generated from stage list)

| Variable | Source |
|----------|--------|
| `{{STAGE_COUNT}}` | Total number of stages |
| `{{STAGE_SUMMARY_LIST}}` | Numbered list of all stages (e.g., `1. Research\n2. Planning...`) |
| `{{STAGE_CHECKBOXES}}` | Checkbox list for state tracking (e.g., `- [ ] Stage 1: Research\n...`) |
| `{{STAGE_VISUAL_DIAGRAM}}` | Visual stage flow diagram for welcome message |
| `{{STAGE_1_NAME}}` | Name of the first stage (used in state tracking) |

### Per-Stage Variables (for workflow.md stage blocks)

| Variable | Source | 4-Layer |
|----------|--------|---------|
| `{{STAGE_N_NAME}}` | User-provided stage name | — |
| `{{EXPERT_ROLE}}` | Expert perspective AI should adopt | L3: Role Assumption |
| `{{WHY_THIS_STAGE_EXISTS}}` | Stage purpose | — |
| `ALWAYS / CONDITIONAL` | Stage execution type | L3: Conditional Execution |
| `{{CONDITIONS}}` | Execution conditions (for CONDITIONAL stages) | L3: Conditional Execution |
| `Minimal / Standard / Comprehensive / Adaptive` | Depth level | L2: Adaptive Depth |
| `Simple / Plan-then-Execute` | Execution pattern | L3: Plan-then-Execute |
| `Inputs` list | Required prior artifacts | L2: Context-First |
| `Outputs` list | Produced artifacts | L2: Progressive Enrichment |
| `Completion Criteria` | Checkboxes for completion | L1: Stage Execution Loop |
| `Yes / No` | Approval gate flag | L1: Approval Gates |

---

## Stage Generation Instructions

For templates that contain per-stage blocks:

1. Take the ordered stage list from user input
2. Number stages sequentially (Stage 1, Stage 2, ...)
3. Derive `<stage-slug>` as kebab-case of stage name (e.g., "Data Collection" -> "data-collection")
4. For each stage, populate all per-stage variables:
   - **Role**: the expert perspective the AI should adopt for this stage
   - **Purpose**: why this stage exists in the workflow
   - **Type**: ALWAYS or CONDITIONAL (with conditions if CONDITIONAL)
   - **Depth**: Adaptive (Minimal / Standard / Comprehensive) — let AI determine based on complexity
   - **Pattern**: Simple (direct execution) or Plan-then-Execute (plan → approve → execute)
   - **Inputs**: what previous stages produced that this stage needs (none for Stage 1)
   - **Outputs**: what this stage produces, saved to `artifacts/<stage-slug>/`
   - **Completion Criteria**: at least one verifiable condition per stage
   - **Approval Gate**: Yes for stages that produce user-facing decisions requiring explicit confirmation

---

## Template: .gitignore

Write this as .gitignore (not from baseline — standalone template).

---BEGIN TEMPLATE---

# Environment
.env
.env.local
.env.*

# Claude local settings
.claude/settings.local.json

# OS
.DS_Store
Thumbs.db

# Temporary
*.tmp
*.bak

---END TEMPLATE---

---

## 4-Layer Verification Checklist

After scaffolding is complete, verify 4-Layer pattern coverage:

### Layer 1: Agent Harness
- [ ] CLAUDE.md contains Session Start Protocol (Mechanism 1)
- [ ] CLAUDE.md contains Stage Execution Loop with 7 steps (Mechanism 2)
- [ ] CLAUDE.md contains Approval Gates with binary-only rule (Mechanism 3)
- [ ] CLAUDE.md contains Q&A Harness with question file format (Mechanism 4)
- [ ] CLAUDE.md contains Audit Trail with append-only rule (Mechanism 5)
- [ ] CLAUDE.md contains Artifact Management with naming rules (Mechanism 6)
- [ ] CLAUDE.md contains State Tracking with checkbox format (Mechanism 7)

### Layer 2: Knowledge Building
- [ ] CLAUDE.md contains Context-First Execution (load inputs before executing)
- [ ] CLAUDE.md contains Progressive Context Enrichment (cumulative context building)
- [ ] CLAUDE.md contains Structured Q&A with Contradiction Detection
- [ ] CLAUDE.md contains Adaptive Depth (Minimal/Standard/Comprehensive with 6 factors)

### Layer 3: Execution Quality
- [ ] CLAUDE.md contains Plan-then-Execute pattern (Part 1: Plan, Part 2: Execute)
- [ ] CLAUDE.md contains Role Assumption pattern
- [ ] CLAUDE.md contains Conditional Stage Execution (ALWAYS/CONDITIONAL)
- [ ] CLAUDE.md contains Artifact Traceability (Sources section)
- [ ] workflow.md stages include Role, Pattern, Type, and Depth fields

### Layer 4: Governance
- [ ] CLAUDE.md contains Extension System (extensions/ directory, opt-in files)
- [ ] CLAUDE.md contains Content Validation rules
- [ ] CLAUDE.md contains Emergent Behavior Prevention rules
- [ ] CLAUDE.md contains Error Handling rules

### Skills Runtime
- [ ] `.agents/.aidlc-rule-details/` exists as the project-owned vendored rule tree
- [ ] `.agents/skills/` exists as the only editable skill source
- [ ] `.agents/workflow-bundle/` exists as project-owned workflow metadata
- [ ] `.claude/skills` symlink points to `../.agents/skills`
- [ ] `.codex/skills` symlink points to `../.agents/skills`
- [ ] Universal and optional skills are reachable through both runtime links
- [ ] No copied per-IDE skill tree exists under `.claude/` or `.codex/`
- [ ] Project-owned workflow assets do not spill outside the canonical `.agents/` roots
- [ ] If numbered stage skills are present, shared data model docs exist under `aidlc-docs/construction/backend-foundation/functional-design/`
- [ ] If numbered stage skills are present, stage-specific docs extend shared core tables rather than redefining them
