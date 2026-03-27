# AI Workflow Baseline Template

## Overview

This baseline template captures the **4-Layer pattern system** extracted from AIDLC (AI-Driven Development Life Cycle). These patterns are domain-agnostic — they control how an AI agent operates, not what domain it operates in.

## 4-Layer Architecture

```
+===================================================================+
|  Layer 4: GOVERNANCE                                              |
|  Extension System, Content Validation, Emergent Behavior Prevention|
+-------------------------------------------------------------------+
|  Layer 3: EXECUTION QUALITY                                       |
|  Plan-then-Execute, Role Assumption, Conditional Execution,       |
|  Artifact Traceability                                            |
+-------------------------------------------------------------------+
|  Layer 2: KNOWLEDGE BUILDING                                      |
|  Context-First, Progressive Enrichment, Q&A + Contradiction       |
|  Detection, Adaptive Depth                                        |
+-------------------------------------------------------------------+
|  Layer 1: AGENT HARNESS                                           |
|  Session Protocol, Stage Execution Loop, Approval Gates,          |
|  Q&A Harness, Audit Trail, Artifact Management, State Tracking    |
+===================================================================+
```

- **Layer 1 (Agent Harness)**: Controls agent behavior — predictable, trackable, auditable
- **Layer 2 (Knowledge Building)**: Ensures sufficient context before action — model construction
- **Layer 3 (Execution Quality)**: Ensures correct execution — model-driven quality
- **Layer 4 (Governance)**: Prevents boundary violations — compliance and consistency

**Layer 2 + Layer 3 = Model-Driven Execution**: L2 builds the "model" (accumulated artifact context), L3 executes based on that model. Neither works well alone.

## Template Files

| File | Purpose | Variables |
|------|---------|-----------|
| `CLAUDE.md.template` | Runtime instructions for the AI agent (4-Layer complete) | `WORKFLOW_NAME`, `WORKFLOW_DESCRIPTION` |
| `workflow.md.template` | Stage definitions with Role, Inputs, Depth, Pattern, Gate | All stage variables |
| `workflow-state.md.template` | Progress tracking with checkboxes and timestamps | `WORKFLOW_NAME`, `ISO_TIMESTAMP`, stage list |
| `audit.md.template` | Audit log initialization | `WORKFLOW_NAME`, `ISO_TIMESTAMP`, path info |
| `welcome-message.md.template` | User-facing welcome (shown once at workflow start) | `WORKFLOW_NAME`, stage info |

## Variable Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `{{WORKFLOW_NAME}}` | Human-readable workflow name | `Content Production Pipeline Workflow` |
| `{{WORKFLOW_DESCRIPTION}}` | One-paragraph workflow description | `End-to-end process for producing...` |
| `{{ISO_TIMESTAMP}}` | Creation timestamp in ISO 8601 | `2026-03-15T21:30:00+09:00` |
| `{{WORKTREE_PATH}}` | Absolute path to the worktree | `/Users/.../wt-content-pipeline` |
| `{{BRANCH_NAME}}` | Git branch name | `wf/content-pipeline` |
| `{{STAGE_COUNT}}` | Total number of stages | `10` |
| `{{STAGE_SUMMARY_LIST}}` | Numbered list of all stages | `1. Research\n2. Planning...` |
| `{{STAGE_CHECKBOXES}}` | Checkbox list for state tracking | `- [ ] Stage 1: Research\n...` |

## Stage Definition Variables (per stage)

| Variable | Description | Layer |
|----------|-------------|-------|
| `{{STAGE_N_NAME}}` | Stage name | — |
| `{{EXPERT_ROLE}}` | Role the AI assumes | L3: Role Assumption |
| `{{WHY_THIS_STAGE_EXISTS}}` | Stage purpose | — |
| `ALWAYS / CONDITIONAL` | Stage execution type | L3: Conditional Execution |
| `{{CONDITIONS}}` | Execution conditions | L3: Conditional Execution |
| `Minimal / Standard / Comprehensive` | Adaptive depth | L2: Adaptive Depth |
| `Simple / Plan-then-Execute` | Execution pattern | L3: Plan-then-Execute |
| `Inputs` list | Required prior artifacts | L2: Context-First |
| `Outputs` list | Produced artifacts | L2: Progressive Enrichment |
| `Completion Criteria` | Checkboxes for completion | L1: Stage Execution Loop |
| `Yes / No` | Approval gate flag | L1: Approval Gates |

## Scaffolded Directory Structure

```
{{WORKTREE_PATH}}/
  CLAUDE.md              <- Agent runtime instructions (from template)
  workflow.md            <- Stage definitions (from template)
  workflow-state.md      <- Progress tracking (from template)
  audit.md               <- Audit log (from template)
  welcome-message.md     <- Welcome message (optional, from template)
  questions/             <- Q&A harness files (created during execution)
  artifacts/             <- Stage output directories (created during execution)
    <stage-1-slug>/
    <stage-2-slug>/
    ...
  extensions/            <- Optional domain-specific rules (opt-in)
```

## Usage

The `workflow-provisioner` skill uses these templates to scaffold new workflow worktrees. The provisioner:

1. Collects workflow information (name, description, stages)
2. Substitutes variables in templates
3. Creates the worktree with scaffolded files
4. Verifies 4-Layer pattern coverage

For manual use, copy these templates and replace all `{{VARIABLE}}` placeholders with actual values.
