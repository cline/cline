# PRD 9: Task-bank Drive loop (plan → tasks → implement → archive)

## Problem

Drive mode still asks the user to pick postures (Plan / Agent / Ask / Debug). That recreates the mode-switching tax Drive is meant to remove.

Without a durable unit of work, Drive has nothing steady to execute against. Free-form turns invent work, drift, or re-plan forever. Plans alone are too editable to be the source of truth for what was done.

**Drive cannot work without something to work on.** The missing primitive is a **task bank**: durable implementable units that Drive consumes. Plans only sequence those units.

## Solution

Make **tasks** the only unit Drive implements. Make **plans** ephemeral indexes over those tasks.

```text
User message / open work
        │
        ▼
┌───────────────────────────────┐
│  Active plan with open tasks? │
└───────────────┬───────────────┘
         no     │     yes
                │
        ▼               ▼
   Plan posture      Agent posture
   (author / extend   (implement next
    plan + task files) open task)
                │
                ▼
   Task done → move task → `.drive/bank/archive/tasks/`
   Plan empty / closed → archive plan
                │
                ▼
   No open tasks left → Plan posture again
```

While Drive is on, the user stays in one mode. Posture is derived from the task bank unless the user explicitly overrides to Ask or Debug.

| Condition | Posture |
|---|---|
| No active plan, or no open tasks on the active plan | **Plan** |
| Active plan has open task references | **Agent** (bound to now task) |
| User sets Ask | **Ask** (override; no edits) |
| User sets Debug | **Debug** (override; evidence-first) |

## Core model

### DriveTask (durable)

- File under `.drive/bank/tasks/<id>.md`
- Holds implementable detail (scope, acceptance, verify, constraints)
- More immutable than a plan: prefer complete/archive over rewriting history
- On completion: move to `.drive/bank/archive/tasks/`

### DrivePlan (ephemeral sequencer)

- File under `.drive/bank/plans/<id>.plan.md`
- Ordered references to task ids only (plus title/status metadata)
- Editable: add, remove, reorder refs
- When drained or closed: archive under `.drive/bank/archive/plans/`

### Invariant

> Drive implements tasks. Plans only point at tasks. No open task ⇒ plan more.

## Goals

- Eliminate routine Plan ↔ Agent switching for Drive users
- Keep a continuous bank of implementable work while Drive is on
- Preserve completed work as archived tasks when plans are rewritten
- Make “what’s next” deterministic (feeds DRV-NOWNEXT)
- Keep Chat as the work surface

## Non-goals

- Bridging Focus Chain or Cline `team_task` in MVP
- Fuzzy query-to-task matching
- Replacing native Plan/Act when Drive is off
- Multi-human task assignment
- Owning prompts/tools/models in Drive config

## Locked decisions

| Fork | Choice |
|---|---|
| On-disk root | `.drive/bank/` |
| Layout | `tasks/`, `plans/`, `archive/tasks/`, `archive/plans/` |
| Schema names | `DriveTask`, `DrivePlan` (UI: task / plan) |
| Covered-check | Strict: bind `taskId` or enter Plan |
| Active plans | One `active` DrivePlan per room |
| Ask / Debug | User override only; clear is explicit |
| Partial failure | Task stays open + `lastFailure`; optional sibling fix-up task |
| Archive | MVP read-only; no unarchive |

## Personas

| Persona | Need |
|---|---|
| Everyday Cline user | Stay in Drive; don’t babysit mode switches |
| Pair programmer | Always know current / next task |
| Power user | Edit the plan without losing completed-task history |

## User stories

1. As a user in Drive, when work is uncovered, the partner plans (creates plan + task files) without me switching to Plan.
2. As a user, once open tasks exist, the partner implements the next task without me switching to Agent.
3. As a user, I can edit a plan (add/remove/reorder tasks) and the partner follows the updated bank.
4. As a user, when a task completes, it moves to archive and remains inspectable.
5. As a user, when the plan has no open tasks, the partner returns to planning.
6. As a user, I can force Ask or Debug and clear the override explicitly.
7. As a user, I can see now/next from the active plan’s task cursor.

## Requirements

| ID | Requirement |
|---|---|
| TASK-01 | Drive’s default loop is task-bank driven. |
| TASK-02 | A plan is an ordered list of task file refs. |
| TASK-03 | A task file holds implementable detail. |
| TASK-04 | Completing a task moves it to `.drive/bank/archive/tasks/`. |
| TASK-05 | Closing/draining a plan archives the plan; archived tasks remain. |
| TASK-06 | Plan edits do not rewrite archived tasks. |
| TASK-07 | While Drive is on, posture is auto-selected from bank state unless overridden. |
| TASK-08 | Covered-check is strict: bind `taskId` or Plan posture. |
| TASK-09 | Now/next derives from the active plan’s open task cursor. |
| TASK-10 | Ask blocks edits; Debug injects evidence-first (DRV-HOOK-POLICY). |
| TASK-11 | One-shot Q&A uses Ask override; no forced plan file. |

## Phasing

- **Phase A.** Spec and layout (this PRD, ARD-0008, DRV-TASK-BANK).
- **Phase B.** Shared types, bank store, loop policy.
- **Phase C.** Events, now/next, archive polish.
- **Phase D.** Plan editor UX and MODE-OVERLAY wire.

## Success metrics (qualitative)

- Users in Drive stop routinely switching Plan/Agent for multi-step work.
- Completed work remains under archive after plans are edited or archived.
- “What’s Drive doing?” answers as “task X of plan Y.”
- Empty bank returns to planning instead of free-form Agent drift.

## References

- [ARD-0008](../ard/ARD-0008-task-bank.md)
- [DRV-TASK-BANK](../features/DRV-TASK-BANK.md)
- [PRD 8](prd-drive-as-cline-mode.md)
- [DRV-MODE-OVERLAY](../features/DRV-MODE-OVERLAY.md)
- [DRV-NOWNEXT](../features/DRV-NOWNEXT.md)
