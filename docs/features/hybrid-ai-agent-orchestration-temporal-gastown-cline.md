# Hybrid AI Agent Orchestration Architecture: Temporal + Gas Town + Cline

## Executive Summary

This document defines the updated architecture for a hybrid AI-agent orchestration system using Temporal, Gas Town, Cline, GitHub, and a chat-based workflow interface.

The design does not assume that Cline should become the full orchestration engine. Gas Town already provides many local multi-agent orchestration primitives: workspace management, multi-agent coordination, persistent work state, work bundles, reusable workflow templates, agent health monitoring, scheduling controls, and merge-queue-style processing.

The recommended architecture is:

```text
Temporal = enterprise durable control plane
Gas Town = local multi-agent execution substrate
Cline = IDE/chat/agent interface and one possible runtime
GitHub = PR/event/source-control backbone
Chat UI = enterprise workflow launcher and approval surface
```

This keeps Temporal responsible for durable cloud/local workflows, GitHub event handling, approval waits, enterprise audit, cross-repo orchestration, cost tracking, and defect analytics. Gas Town handles local multi-agent execution and stateful workspace management. Cline integrates as an agent runtime, IDE interface, and potential control surface over Gas Town and Temporal.

## Key Finding from Gas Town Review

Gas Town is a multi-agent orchestration system for Claude Code, GitHub Copilot, Codex, Gemini, Cline, Cursor, and other AI coding agents with persistent work tracking.

| Gas Town Concept | Meaning | Role in Architecture |
|---|---|---|
| Mayor | primary AI coordinator | local coordinator / operator agent |
| Town | workspace directory | local execution environment |
| Rig | project/repo container | repository target |
| Crew | personal workspace | developer-local workspace |
| Polecat | worker agent | agent execution lane |
| Hook | git worktree-backed persistent storage | persistent work state |
| Convoy | bundle of work items | task group / workflow unit |
| Beads | git-backed issue/work ledger | local task ledger |
| Molecules | workflow templates | reusable local workflow recipes |
| Witness / Deacon / Dogs | watchdog/supervision system | local agent health monitoring |
| Refinery | merge queue processor | local PR/merge queue analog |
| Scheduler | capacity governor | local concurrency/rate-limit control |
| Seance | prior-session discovery | agent context recovery |
| Wasteland | federated work network | future cross-town coordination |

## Revised Architectural Principle

Do not duplicate Gas Town's local orchestration primitives inside Cline.

Instead:

1. Use Gas Town for local multi-agent execution.
2. Use Temporal for durable workflow state and enterprise orchestration.
3. Use Cline as one or more of:
   - an agent runtime launched by Gas Town,
   - an IDE/chat control surface for Gas Town,
   - a worker wrapper for repo-local code execution,
   - a human-facing interface for plan inspection and approval.
4. Use GitHub Actions and GitHub webhooks as event bridges into Temporal.
5. Use Markdown plans and Gas Town molecules/templates as reusable workflow definitions.

## High-Level Architecture

```text
Enterprise Chat UI
  -> Workflow API
  -> Temporal Cloud / Local Temporal
  -> Gas Town Activity Worker
  -> Gas Town Local Runtime
  -> Agent Runtimes: Cline, Claude Code, Codex, Cursor, Copilot, Gemini, local models
  -> GitHub branches / PRs / checks / evidence
```

## Responsibilities by Layer

### Chat UI

Responsible for accepting human goals, selecting workflow templates, selecting repos/rigs, showing generated plans, requesting approvals, displaying Temporal workflow status, displaying Gas Town convoy/agent status, showing PR evidence and costs, and supporting pause/resume/cancel/reroute actions.

### Workflow API

Responsible for authentication and RBAC, mapping users to GitHub/Gas Town/Temporal permissions, starting and signaling workflows, managing the template registry, enforcing enterprise policies, integrating with Jira/Confluence/Drive if needed, and aggregating run metadata.

### Temporal

Responsible for durable workflow IDs, run history, retries, signals, task queues, human approval waits, timers, cloud/local routing, cross-repo orchestration, cost and evidence aggregation, and defect correlation.

### Gas Town

Responsible for local workspace management, multi-agent dispatch, persistent work state, worktree-backed hooks, agent identities, convoy/task grouping, molecule/workflow templates, local health monitoring, scheduler/capacity control, and merge queue/refinery processing.

### Cline

Responsible for one or more roles:

1. Agent runtime launched by Gas Town.
2. IDE control surface for viewing and interacting with Gas Town state.
3. Chat-style developer interface for task execution.
4. Temporal activity worker wrapper for repo-local edits.
5. Human review and code inspection surface.

## Integration Strategy

### Option A: Gas Town CLI Wrapper

Temporal activities call `gt` and `bd` commands directly.

Example activities:

```text
create_town
add_rig
create_convoy
sling_bead
start_molecule
poll_convoy
query_agents
collect_evidence
open_or_collect_pr
escalate_blocker
```

Pros: fastest integration, minimal modification to Gas Town, validates architecture quickly, keeps local workflow intact.

Cons: CLI parsing is brittle, typed integration is limited, cost/evidence extraction may require wrappers.

### Option B: Gas Town API/SDK Layer

Add or expose a typed API around Gas Town operations. This is more robust, easier to integrate with Temporal, better for telemetry, and easier for enterprise support, but slower than the CLI wrapper.

### Option C: Cline as Gas Town Control Surface

Cline UI displays and controls towns, rigs, convoys, beads, molecules, active polecats, stuck agents, merge queue state, and workflow evidence.

Recommended approach:

```text
Phase 1: Temporal -> Gas Town CLI wrapper
Phase 2: structured Gas Town adapter/API
Phase 3: Cline UI/control integration
```

## Workflow Model

A complete run should look like this:

```text
User opens chat
-> selects workflow template
-> picks repo/rig
-> enters goal
-> Temporal workflow starts
-> Gas Town convoy/molecule is created
-> polecats are dispatched
-> agents run through Gas Town hooks/worktrees
-> Gas Town tracks progress
-> Temporal polls/signals state
-> cloud reviewers cross-check high-risk outputs
-> PRs are opened or collected
-> evidence pack is attached
-> human approves if needed
-> workflow completes with ledger/cost/defect metadata
```

## GitHub Event Integration

| GitHub Event | Temporal Action | Gas Town Action |
|---|---|---|
| Issue labeled `agent-plan` | start plan workflow | create convoy/molecule |
| PR opened | start PR review workflow | optional review convoy |
| PR synchronized | signal new commit | rerun review/validation |
| CI failed | signal validation failure | dispatch fix bead |
| Comment `/agent fix` | start fix workflow | sling fix bead |
| Merge to main | start post-merge validation | close/record convoy |
| workflow_dispatch | manual run | create requested work |

## Mapping Between Temporal and Gas Town

| Temporal | Gas Town |
|---|---|
| Workflow | Convoy or Molecule instance |
| Workflow ID | Convoy/Molecule ID |
| Activity | gt/bd command or worker operation |
| Task queue | local/cloud worker type |
| Signal | convoy update, PR event, approval |
| Child workflow | sub-convoy or molecule step |
| Retry | re-sling, nudge, handoff, re-run agent |
| Failure | escalation bead |
| Memo/Search attributes | repo, rig, risk, PR, cost, model |

## Standard Workflow Templates

The platform should ship with templates that can be implemented either as Temporal workflows, Gas Town molecules, or both.

### 1. Repo Readiness

Purpose: prepare a repo for agentic execution.

Steps:

1. Add repo as rig.
2. Inspect commands and structure.
3. Create or update `AGENTS.md` / `HOWTOAI.md`.
4. Create `.agent/invariants.md` and `.agent/commands.md`.
5. Run baseline checks.
6. Open PR with evidence.

### 2. Markdown Plan to Convoy/PR

Purpose: execute a Markdown plan via Gas Town convoys.

Steps:

1. Parse `PLAN.md` and `TASKS.md`.
2. Create beads for tasks.
3. Bundle beads into convoy.
4. Dispatch polecats.
5. Monitor convoy.
6. Collect PRs/evidence.
7. Run cross-check reviewers.
8. Close workflow.

### 3. Bug Reproduction and Fix

Purpose: convert bug report into a failing test and fix.

Steps:

1. Create bug bead.
2. Dispatch researcher polecat.
3. Dispatch test-writer polecat.
4. Confirm failing test.
5. Dispatch implementer polecat.
6. Run validation.
7. Run independent reviewer.
8. Open PR.

### 4. PR Multi-Agent Review

Purpose: review PRs with specialized agents.

Agents:

- code reviewer,
- test reviewer,
- security reviewer,
- invariant reviewer,
- cost/blast-radius reviewer.

### 5. Test Backfill

Purpose: improve coverage safely.

Steps:

1. Identify target files.
2. Create beads per test area.
3. Dispatch test-writer polecats.
4. Validate no production-code changes unless approved.
5. Open PRs.

### 6. CI Hardening

Purpose: strengthen required checks for agent-created PRs.

Steps:

1. Inspect current CI.
2. Add lint/test/typecheck gates.
3. Add local reproduction docs.
4. Validate GitHub checks.
5. Open PR.

### 7. Cross-Repo Change

Purpose: coordinate frontend/API/DAL/data/MDM changes.

Steps:

1. Temporal creates parent workflow.
2. Child workflows created per repo.
3. Gas Town rig/convoy created per repo.
4. Repo-specific polecats implement changes.
5. Cloud reviewers check integration semantics.
6. PRs merge in dependency order.
7. Release validation runs.

### 8. Release Validation

Purpose: validate release candidate against requirements and invariants.

Steps:

1. Collect merged PRs.
2. Map to requirements/Jira.
3. Run tests/regression checks.
4. Run invariant reviewers.
5. Produce release evidence.

### 9. Defect Correlation

Purpose: determine whether AI-assisted changes correlate with bugs.

Steps:

1. Pull bugs created in window.
2. Link bugs to PRs.
3. Link PRs to Gas Town beads/convoys and Temporal workflow IDs.
4. Analyze model/task/repo patterns.
5. Produce weekly report.

### 10. Architecture Invariant Check

Purpose: enforce semantic architecture constraints.

Steps:

1. Load repo invariants.
2. Inspect changed files.
3. Dispatch invariant reviewer.
4. Require human approval for violations.

## Multi-Agent and Multi-Model Cross-Checking

Recommended pattern for R2+ work:

```text
Planner agent drafts plan
Reviewer model critiques plan
Researcher maps code paths
Implementer performs bounded change
Test writer writes/updates tests
Reviewer model checks diff
Invariant reviewer checks domain/platform constraints
Human approves
```

Rules:

- Implementer and reviewer should not be the same agent/model for R2+.
- Tests should be written or reviewed by a separate agent from the implementer.
- R3/R4 changes require cloud semantic review.
- Local agents can draft and execute; cloud agents should review high-risk semantics.
- Human approval remains required for high-risk changes.

## Enterprise Standards Layer

Templates must carry standards:

- risk taxonomy,
- approval gates,
- PR size limits,
- required validation commands,
- evidence pack requirements,
- model-routing rules,
- local/cloud budget caps,
- security/PHI policies,
- reviewer ownership,
- invariant checks,
- allowed/forbidden paths.

## Cost and Evidence Model

Gas Town provides local work tracking via beads/convoys. The enterprise layer should add cost and model usage tracking.

Required run metadata:

```json
{
  "temporal_workflow_id": "initiative:repo:firefighter-modernization",
  "gas_town_convoy_id": "cv-abc123",
  "bead_id": "gt-x7k2m",
  "repo": "org/repo",
  "rig": "repo-rig",
  "agent_role": "implementer",
  "runtime": "cline|claude|codex|cursor|copilot",
  "model": "model-name",
  "provider": "local|anthropic|openai|google",
  "risk": "R2",
  "branch": "agent/firefighter/ci-hardening",
  "pr": 1477,
  "cost_usd": 0.18,
  "commands_run": ["make test", "make lint"],
  "result": "pr_opened"
}
```

## Chat Front End Requirements

The chat front end should support selecting Temporal workflow templates, selecting Gas Town formulas/molecules, choosing repo/rig, creating convoys from natural language, approving plans, viewing active agents, viewing convoy progress, viewing Temporal workflow state, viewing GitHub PR evidence, pausing/resuming/canceling workflows, nudging or handing off stuck agents, and rerouting from local to cloud review.

Example commands:

```text
/start repo-readiness for certifyos/api-layer
/start plan-to-convoy using docs/agent-plans/firefighter/PLAN.md
/review-pr certifyos/api-layer#1477
/show convoy cv-abc123
/show agents for rig api-layer
/nudge agent polecat-7
/reroute task gt-x7k2m to cloud-review
/approve workflow step semantic-review
/show cost for workflow initiative:api-layer:firefighter
```

## Cline Integration Detail

### Cline as Agent Runtime

Gas Town should be able to launch Cline as a runtime.

Expected usage:

```text
gt sling <bead-id> <rig> --agent cline
```

### Cline as IDE Control Surface

Cline can display active town, rigs, crew workspaces, convoys, beads, active polecats, stuck agents, molecule steps, and PR evidence.

### Cline as Temporal Worker

For workflows where Cline owns execution directly, Cline can expose Temporal activities:

```text
run_cline_task
review_diff_with_cline
summarize_pr_with_cline
run_validation_in_worktree
```

## Mac M4 Implementation Profile

CertifyOS has already cloned Cline and added Mac M4 support directly. The architecture should treat Mac M4 laptops as first-class local execution nodes, not merely developer machines.

Goal:

```text
Temporal Cloud / Local Temporal
  -> task queue: agent-local-repo-search
  -> task queue: agent-local-context-compression
  -> task queue: agent-local-test-generation
  -> task queue: agent-local-worktree
  -> Mac M4 Worker
  -> Gas Town
  -> Cline MacM4 runtime
  -> local model runtime
  -> GitHub branch / PR
```

The Mac M4 worker should operate in three modes:

1. Fully local mode: local Temporal + Gas Town + Cline + local models.
2. Hybrid mode: cloud Temporal routes selected tasks to Mac M4 local workers.
3. Cloud-review mode: Mac M4 performs implementation and validation; cloud workers perform semantic review.

### Mac M4 Responsibilities

Mac M4 local workers should handle repo search and summarization, Markdown plan parsing, context compression, log summarization, test skeleton generation, docs generation, low-risk implementation, local worktree setup, local lint/test execution, PR evidence generation, selected R2 implementation when human-approved, and local Gas Town town/rig/convoy execution.

Mac M4 workers should not autonomously handle R3/R4 semantic approval, auth/security/PHI-sensitive implementation without approval, production infra changes, high-risk DAL/MDM changes without cloud review, or auto-merge to main.

### Recommended Mac M4 Routing

| Task Type | Mac M4 Local | Cloud Required |
|---|---:|---:|
| repo search | yes | no |
| log compression | yes | no |
| Markdown plan parsing | yes | no |
| docs generation | yes | no |
| unit test skeletons | yes | optional review |
| low-risk implementation | yes | optional review |
| local validation | yes | no |
| PR evidence pack | yes | no |
| R2 semantic review | maybe | recommended |
| DAL/MDM/security review | no | yes |
| R4 approval | no | yes + human |

## What Remains After Cloned Cline + MacM4 Support

Since Cline has already been cloned and Mac M4 support added, the remaining work should focus on orchestration integration.

### P0: Prove Local Execution Loop

Required:

1. Confirm Cline MacM4 runtime can run a local model reliably.
2. Confirm Cline can execute repo-local tasks from a worktree.
3. Confirm it can read `AGENTS.md`, `HOWTOAI.md`, and repo plans.
4. Confirm it can run validation commands and capture results.
5. Confirm it can generate a PR evidence pack.
6. Confirm it can write local execution metadata.

Output:

```text
local task -> local model -> code/test/docs change -> validation -> evidence
```

### P1: Add Temporal Activity Boundary

Expose Cline MacM4 as a Temporal worker activity host.

Activities:

```text
run_cline_local_task
summarize_repo_local
compress_context_local
write_tests_local
run_validation_local
summarize_diff_local
write_pr_evidence_local
```

Each activity should return structured output:

```json
{
  "task_id": "test-backfill-provider-service",
  "risk": "R1",
  "model": "macm4-local-model",
  "provider": "local",
  "commands_run": ["make test"],
  "files_changed": ["..."],
  "result": "validated",
  "cost_usd": 0.00,
  "duration_ms": 123456
}
```

### P2: Add Gas Town Runtime Integration

If Gas Town is used as the local multi-agent substrate, Cline MacM4 should work in two ways:

1. As a Gas Town runtime/preset:

```text
gt sling <bead-id> <rig> --agent cline-macm4
```

2. As a Temporal activity worker that delegates to Gas Town:

```text
Temporal activity -> gt convoy create -> gt sling -> Cline MacM4 runtime -> collect result
```

Required work:

- add `cline-macm4` runtime preset to Gas Town config,
- ensure startup prompts and hooks work for Cline,
- ensure Cline receives bead/convoy context,
- ensure completion evidence can be written back to Beads/Gas Town,
- ensure Cline local model routing is configurable by risk.

### P3: Add Worktree and Evidence Standardization

Even if Gas Town manages hooks/worktrees, Cline MacM4 should emit standardized evidence:

```text
.agent/runs/<run-id>.json
.agent/cost/<run-id>.json
PR evidence block
Gas Town bead update
Temporal activity result
```

Evidence should include task ID, Temporal workflow ID, Gas Town convoy/bead IDs, model/runtime used, local/cloud route, files changed, commands run, tests passed/failed, cost estimate, reviewer required, and risk class.

### P4: Add Cloud Escalation Hooks

Cline MacM4 should be able to escalate when local model confidence is low, validation fails repeatedly, task touches R3/R4 paths, context exceeds local model limits, semantic review is required, or the user requests cloud review.

Escalation output:

```json
{
  "status": "escalation_requested",
  "reason": "R3 path touched: mdm/survivorship/**",
  "recommended_queue": "agent-cloud-high-risk",
  "local_summary": "...",
  "artifacts": ["diff", "test-output", "repo-summary"]
}
```

## Fork Strategy

### Should We Fork Cline?

Yes. This is already done, and it makes sense.

Recommended fork boundaries:

- Mac M4 local model provider,
- Temporal activity worker mode,
- Gas Town runtime compatibility,
- PR evidence pack generator,
- cost/evidence metadata hooks,
- enterprise policy adapters,
- local/cloud routing plugin interface.

### Should We Fork Gas Town?

Recommendation: start without a hard fork if possible; create an adapter first.

Fork Gas Town only if needed for structured JSON output for commands, a stable API/SDK surface, enterprise auth/RBAC integration, model/cost metadata capture, Cline MacM4 runtime hooks, Temporal worker callbacks, custom evidence emission, or CertifyOS-specific policy gates.

Preferred strategy:

```text
adapter first -> small upstream PRs -> fork only for enterprise integration gaps
```

### Should We Fork Temporal?

No. Use stock Temporal Cloud or stock self-hosted Temporal. Required customization can be handled through workflows, activities, workers, task queues, interceptors, search attributes, and external services.

### Should We Fork Beads?

Do not fork initially. Use Beads as-is, inspect its data model, map bead IDs to Temporal workflow/task IDs, and export bead/convoy state into the enterprise ledger.

Fork Beads only if required for structured APIs, enterprise metadata fields, cost/model telemetry, bidirectional sync with Temporal/GitHub/Jira, performance/scaling issues, or custom durability semantics.

### Fork Strategy Summary

| Project | Fork? | Recommendation |
|---|---:|---|
| Cline | yes | already cloned; make it CertifyOS execution/IDE worker |
| Gas Town | not initially | use adapter first; fork only for structured APIs/enterprise hooks |
| Temporal | no | use stock Temporal Cloud/self-hosted |
| Beads | no initially | mirror/export state; fork only if absolutely required |

## Phased Implementation Plan

### Phase 0: Gas Town Validation Spike

Duration: 3-5 days

Goals:

- install Gas Town locally,
- add one repo as rig,
- run Mayor workflow,
- create convoy,
- dispatch at least two agents,
- inspect beads/convoys/hooks,
- validate Cline runtime integration.

### Phase 1: Temporal-to-Gas-Town CLI Wrapper

Duration: 1-2 weeks

Build Temporal activities for convoy creation, bead slinging, convoy polling, agent listing, nudging, evidence collection, and molecule startup.

### Phase 2: Mac M4 Cline Worker Integration

Duration: 1-2 weeks

Build Cline MacM4 local task runner, Cline MacM4 Temporal activity worker, local model provider interface, evidence output, and cloud escalation hook.

### Phase 3: Chat-Controlled Local Workflow

Duration: 1-2 weeks

Build simple chat workflow launcher, template selection, repo/rig selection, convoy creation, progress view, and approval prompt.

### Phase 4: GitHub Event Bridge

Duration: 1-2 weeks

Build GitHub Action or GitHub App event bridge, PR opened/synchronized signals, issue label triggers, PR comment commands, and workflow status checks.

### Phase 5: Enterprise Template Library

Duration: 2 weeks

Implement standard workflows for repo readiness, Markdown plan to convoy/PR, bug reproduction and fix, PR multi-agent review, test backfill, CI hardening, cross-repo change, release validation, defect correlation, and architecture invariant checks.

### Phase 6: Cost, Risk, and Evidence Layer

Duration: 2 weeks

Build model/cost ledger, risk classifier, PR evidence pack standard, budget caps, local/cloud routing policy, and high-risk approval gates.

### Phase 7: Cloud Temporal and Hybrid Workers

Duration: 2-3 weeks

Build cloud Temporal deployment, cloud reviewer workers, local worker registration, task queue routing, and cross-repo orchestration.

### Phase 8: Cline UI Integration

Duration: 2-4 weeks

Build Cline panel for Gas Town state, Cline panel for Temporal workflow state, commands to launch templates, commands to nudge/reroute agents, and PR evidence viewer.

### Phase 9: Metrics and Defect Correlation

Duration: 2-3 weeks

Build dashboards, AI-assisted PR metrics, defect linkage, model ROI analysis, and repo health reports.

## Revised MVP Definition

A successful MVP should demonstrate:

1. Chat starts a workflow.
2. Temporal creates durable workflow run.
3. Gas Town creates convoy/beads.
4. Cline MacM4 executes at least one local agent task.
5. Tests run locally.
6. PR evidence is generated.
7. Cloud reviewer performs independent review.
8. Human approval is required for R2+.
9. Cost/evidence is recorded.
10. GitHub PR is linked to the workflow.

## Recommended First Pilot

Pilot repo: forked Cline repo or GitHub firefighter repo.

Pilot workflow sequence:

1. Repo readiness via Gas Town.
2. Markdown plan to convoy.
3. Multi-agent test backfill.
4. PR multi-agent review.
5. Cost/evidence capture.
6. Cloud semantic review for one R2+ PR.

Pilot success criteria:

- at least five agent-created or agent-assisted PRs,
- at least two concurrent polecats,
- at least one workflow started from chat,
- all PRs include evidence packs,
- cost captured for local/cloud model usage,
- at least one local implementation + cloud review path,
- no autonomous merges.

## Final Recommendation

Keep the architecture cohesive by forking only where strategic.

- Continue the Cline fork because Mac M4 execution and IDE integration are core differentiators.
- Do not fork Temporal.
- Do not fork Beads initially.
- Do not fork Gas Town immediately; build a Temporal/Gas Town adapter first and fork only if integration requires structured APIs, runtime hooks, or enterprise telemetry.

The highest-value next work is proving the end-to-end path:

```text
Chat -> Temporal -> Gas Town -> Cline MacM4 -> PR -> Cloud Review -> Human Approval -> Ledger
```
